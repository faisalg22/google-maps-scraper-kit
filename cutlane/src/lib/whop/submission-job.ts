import "server-only";
import { modes } from "../env";
import { one, q, pgTextArray } from "../db";
import { releaseMonthly } from "../billing/usage-core";
import { createAndUploadFile, createSubmission, fileUploadStatus } from "./submissions";
import { nextStep, type JobState } from "./submission-job-core";

interface Row {
  id: string;
  user_id: string;
  clip_id: string | null;
  bounty_id: string;
  caption: string | null;
  urls: string[];
  file_ids: string[];
  idempotency_key: string;
  job_state: JobState;
  job_error: string | null;
  job_attempts: number;
  job_updated_at: Date;
  usage_period_start: Date | null;
  storage_key: string | null;
  file_name: string | null;
  workspace_id: string | null;
}

export interface JobStatus {
  id: string;
  state: JobState;
  status: string;
  error: string | null;
}

async function load(userId: string, id: string): Promise<Row | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const r = await one<Row>(
    `select s.id, s.user_id, s.clip_id, s.bounty_id, s.caption, s.urls, s.file_ids, s.idempotency_key, s.job_state, s.job_error,
            s.job_attempts, s.job_updated_at, s.usage_period_start, c.storage_key, c.file_name,
            (select workspace_id from workspace_members m where m.user_id = s.user_id) as workspace_id
       from submissions s left join clips c on c.id = s.clip_id
      where s.id = $1 and s.user_id = $2`,
    [id, userId],
  );
  return r ? { ...r, job_updated_at: new Date(r.job_updated_at), usage_period_start: r.usage_period_start ? new Date(r.usage_period_start) : null } : null;
}

const status = (r: { id: string; job_state: JobState; job_error: string | null }, s: string): JobStatus => ({ id: r.id, state: r.job_state, status: s, error: r.job_error });

async function fail(r: Row, reason: string): Promise<JobStatus> {
  const done = await one<{ id: string }>(
    `update submissions set job_state = 'failed', status = 'failed', job_error = $2, job_updated_at = now(), updated_at = now()
      where id = $1 and job_state not in ('done', 'failed') returning id`,
    [r.id, reason.slice(0, 500)],
  );
  // Refund the "submission this month" unit reserved when it was queued (only once).
  if (done && r.workspace_id && r.usage_period_start) await releaseMonthly(q, r.workspace_id, "submissions_monthly", r.usage_period_start);
  if (done && r.clip_id) await q(`update clips set status = 'posted', updated_at = now() where id = $1 and status = 'submitted'`, [r.clip_id]);
  return { id: r.id, state: "failed", status: "failed", error: reason };
}

/** Perform at most one step of the job. Safe to call concurrently (claims are conditional updates). */
export async function advanceSubmissionJob(userId: string, id: string): Promise<JobStatus | null> {
  const r = await load(userId, id);
  if (!r) return null;
  const step = nextStep(r, new Date());

  try {
    switch (step.kind) {
      case "none":
      case "wait":
        return status(r, r.job_state === "done" ? "submitted" : r.job_state);
      case "fail":
        return await fail(r, step.reason);

      case "upload": {
        const claimed = await one<{ job_attempts: number }>(
          `update submissions set job_state = 'uploading', job_attempts = job_attempts + 1, job_updated_at = now(), job_error = null
            where id = $1 and job_state = $2 and date_trunc('milliseconds', job_updated_at) = date_trunc('milliseconds', $3::timestamptz) returning job_attempts`,
          [r.id, r.job_state, r.job_updated_at.toISOString()],
        );
        if (!claimed) return status(r, r.job_state); // someone else took it
        if (!r.storage_key || !r.file_name) return await fail(r, "The clip file no longer exists.");
        const fileId = modes.whop
          ? await createAndUploadFile(userId, r.storage_key, r.file_name, `${r.idempotency_key}:${claimed.job_attempts}`)
          : `demo_file_${r.id.slice(0, 8)}`;
        await q(
          `update submissions set job_state = 'processing', file_ids = $2::text[], job_updated_at = now() where id = $1`,
          [r.id, pgTextArray([fileId])],
        );
        if (r.clip_id) await q(`update clips set whop_file_id = $2 where id = $1`, [r.clip_id, fileId]);
        return { id: r.id, state: "processing", status: "processing", error: null };
      }

      case "check_file": {
        const fileId = r.file_ids[0];
        if (!fileId) return await fail(r, "No uploaded file was recorded.");
        const s = modes.whop ? await fileUploadStatus(userId, fileId) : "ready";
        if (s === "failed") return await fail(r, "Whop couldn't process the clip file.");
        if (s !== "ready") return status(r, "processing");
        await q(`update submissions set job_state = 'creating', job_updated_at = now() where id = $1 and job_state = 'processing'`, [r.id]);
        return { id: r.id, state: "creating", status: "creating", error: null };
      }

      case "create": {
        if (!modes.whop) {
          await q(
            `update submissions set job_state = 'done', status = 'submitted', whop_submission_id = $2, job_updated_at = now(), submitted_at = now(), updated_at = now()
              where id = $1 and job_state = 'creating'`,
            [r.id, `demo_btys_${r.id.slice(0, 8)}`],
          );
          return { id: r.id, state: "done", status: "submitted", error: null };
        }
        // Idempotency-Key makes a repeated create (two tabs, a retry) return the same submission.
        const sub = await createSubmission(userId, { bountyId: r.bounty_id, urls: r.urls, fileIds: r.file_ids, caption: r.caption, idempotencyKey: r.idempotency_key });
        await q(
          `update submissions set job_state = 'done', status = $3, whop_submission_id = $2, raw = $4::jsonb, job_updated_at = now(), submitted_at = now(), updated_at = now()
            where id = $1 and job_state = 'creating'`,
          [r.id, sub.id, sub.status ?? "submitted", JSON.stringify(sub)],
        );
        return { id: r.id, state: "done", status: sub.status ?? "submitted", error: null };
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unexpected error";
    // Upload errors go back to the queue (retried up to MAX_ATTEMPTS); Whop rejections fail now.
    if (step.kind === "upload") {
      await q(`update submissions set job_state = 'queued', job_error = $2, job_updated_at = now() where id = $1 and job_state = 'uploading'`, [r.id, msg.slice(0, 500)]);
      return { id: r.id, state: "queued", status: "queued", error: msg };
    }
    if (step.kind === "check_file") return { id: r.id, state: "processing", status: "processing", error: null }; // transient: poll again
    return await fail(r, msg);
  }
}

/** Pending jobs for a user (resumed by the browser when they open the clip or submissions page). */
export async function pendingJobIds(userId: string, clipId?: string): Promise<string[]> {
  const rows = await q<{ id: string }>(
    `select id from submissions where user_id = $1 and job_state not in ('done', 'failed') ${clipId ? "and clip_id = $2" : ""} order by submitted_at`,
    clipId ? [userId, clipId] : [userId],
  );
  return rows.map((r) => r.id);
}
