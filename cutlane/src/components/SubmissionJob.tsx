"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { retrySubmission } from "@/app/actions";
import { JOB_LABELS, POLL_INTERVAL_MS, isPendingJob, type JobState } from "@/lib/whop/submission-job-core";

interface Status {
  state: JobState;
  status: string;
  error: string | null;
}

const STEPS: JobState[] = ["queued", "uploading", "processing", "creating", "done"];

/**
 * Drives a queued submission to completion by calling the advance endpoint step by step.
 * Mounted wherever a pending job is visible, so closing the tab only pauses it.
 */
export function SubmissionJobRunner({ jobId, initialState, initialError }: { jobId: string; initialState: JobState; initialError?: string | null }) {
  const router = useRouter();
  const [s, setS] = useState<Status>({ state: initialState, status: initialState, error: initialError ?? null });
  const [running, setRunning] = useState(isPendingJob(initialState));
  const [retrying, startRetry] = useTransition();
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (!running) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const res = await fetch(`/api/submissions/${jobId}/advance`, { method: "POST", cache: "no-store" });
        if (!alive.current) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const next = (await res.json()) as Status;
        setS(next);
        if (next.state === "done" || next.state === "failed") {
          setRunning(false);
          router.refresh();
          return;
        }
        timer = setTimeout(tick, next.state === "processing" || next.state === "uploading" || next.error ? POLL_INTERVAL_MS : 50);
      } catch {
        timer = setTimeout(tick, POLL_INTERVAL_MS * 2); // offline or server hiccup: keep trying
      }
    };
    tick();
    return () => {
      alive.current = false;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, running, router]);

  const idx = STEPS.indexOf(s.state);
  return (
    <div className="space-y-2 rounded-xl border border-border bg-raised p-3 text-sm" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <p className={s.state === "failed" ? "font-medium text-danger-fg" : s.state === "done" ? "font-medium text-success-fg" : "font-medium"}>{JOB_LABELS[s.state]}</p>
        {isPendingJob(s.state) && <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden />}
      </div>
      {s.state !== "failed" && (
        <div className="flex gap-1" aria-hidden>
          {STEPS.slice(1).map((step, i) => (
            <span key={step} className={`h-1.5 flex-1 rounded-full ${i < idx ? "bg-accent" : "bg-raised-hover"}`} />
          ))}
        </div>
      )}
      {s.error && <p className="text-xs text-muted">{s.state === "failed" ? s.error : `Retrying: ${s.error}`}</p>}
      {isPendingJob(s.state) && <p className="text-xs text-muted">You can leave this page; it continues when you come back.</p>}
      {s.state === "failed" && (
        <button
          type="button"
          disabled={retrying}
          onClick={() =>
            startRetry(async () => {
              const r = await retrySubmission(jobId);
              if (r?.jobId) {
                setS({ state: "queued", status: "queued", error: null });
                setRunning(true);
              } else if (r?.error) setS((x) => ({ ...x, error: r.error ?? x.error }));
            })
          }
          className="btn-secondary px-3 py-1.5 text-xs"
        >
          {retrying ? "Retrying…" : "Try again"}
        </button>
      )}
    </div>
  );
}
