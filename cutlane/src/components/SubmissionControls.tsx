"use client";

import { useActionState, useTransition } from "react";
import { simulateReview, syncSubmissions, type ActionState } from "@/app/actions";

export function SyncButton({ isDemo }: { isDemo: boolean }) {
  const [state, action, pending] = useActionState<ActionState>(async () => syncSubmissions(), null);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <button disabled={pending} className="btn-secondary">{pending ? "Syncing…" : isDemo ? "Refresh" : "Sync with Whop"}</button>
      {state?.error && <span className="text-xs text-danger">{state.error}</span>}
      {state?.ok && <span className="text-xs text-muted">{state.message}</span>}
    </form>
  );
}

export function SimulateReview({ submissionId }: { submissionId: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-warning">Demo:</span>
      <button disabled={pending} onClick={() => start(() => simulateReview(submissionId, "approved"))} className="btn-ghost px-2 py-1 text-xs text-success">Approve</button>
      <button disabled={pending} onClick={() => start(() => simulateReview(submissionId, "denied"))} className="btn-ghost px-2 py-1 text-xs text-danger">Reject</button>
    </div>
  );
}
