/**
 * Submission job state machine (pure, unit-tested). A submission with an attached file moves:
 *
 *   queued ──upload──▶ processing ──(file ready)──▶ creating ──create──▶ done
 *      ▲                   │ (file failed / >15 min)          │
 *      └── stale claim ────┴──────────────▶ failed ◀───────────┘ (Whop error)
 *
 * Each call to the advance endpoint performs at most ONE step, so every request stays short
 * (the upload step is bounded by the clip size, max 1 GB).
 */

export type JobState = "queued" | "uploading" | "processing" | "creating" | "done" | "failed";

export interface JobRow {
  job_state: JobState;
  job_updated_at: Date;
  job_attempts: number;
}

export const STALE_UPLOAD_MS = 15 * 60_000; // an upload claim older than this is assumed dead
export const PROCESSING_TIMEOUT_MS = 20 * 60_000; // Whop processing longer than this → fail
export const MAX_ATTEMPTS = 3;
export const POLL_INTERVAL_MS = 2500;

export type JobStep =
  | { kind: "upload" } // claim queued → uploading, then create + PUT the file
  | { kind: "check_file" } // processing: one status check
  | { kind: "create" } // creating: POST /bounty_submissions (idempotent)
  | { kind: "fail"; reason: string }
  | { kind: "wait" } // another request holds the upload claim
  | { kind: "none" }; // done or failed

export function nextStep(row: JobRow, now: Date): JobStep {
  const age = now.getTime() - row.job_updated_at.getTime();
  switch (row.job_state) {
    case "queued":
      return row.job_attempts >= MAX_ATTEMPTS ? { kind: "fail", reason: "Uploading to Whop failed several times. Try again later." } : { kind: "upload" };
    case "uploading":
      // A previous request died mid-upload (tab closed, function killed): start over.
      if (age > STALE_UPLOAD_MS) return row.job_attempts >= MAX_ATTEMPTS ? { kind: "fail", reason: "The upload to Whop didn't finish." } : { kind: "upload" };
      return { kind: "wait" };
    case "processing":
      return age > PROCESSING_TIMEOUT_MS ? { kind: "fail", reason: "Whop took too long to process the clip. Try submitting again." } : { kind: "check_file" };
    case "creating":
      return { kind: "create" };
    default:
      return { kind: "none" };
  }
}

export const JOB_LABELS: Record<JobState, string> = {
  queued: "Waiting to upload…",
  uploading: "Uploading clip to Whop…",
  processing: "Whop is processing the clip…",
  creating: "Submitting to Whop…",
  done: "Submitted",
  failed: "Failed to send",
};

export const isPendingJob = (s: string) => s === "queued" || s === "uploading" || s === "processing" || s === "creating";
