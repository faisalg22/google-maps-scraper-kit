"use client";

import { useActionState } from "react";
import { adminSetCustomPlan } from "@/app/billing-actions";
import type { ActionState } from "@/lib/action-errors";
import { ActionFeedback } from "./billing";

const FIELDS: [string, string][] = [
  ["saved_channels", "Saved channels"],
  ["clips_monthly", "Clips / month"],
  ["submissions_monthly", "Submissions / month"],
  ["notes", "Notes"],
  ["accounts_per_platform", "Accounts / platform"],
  ["render_minutes_monthly", "Render min / month"],
  ["ai_cuts_monthly", "AI cuts / month"],
];

export function AdminPlanForm({ workspaceId, current, seats }: { workspaceId: string; current: Record<string, number | null>; seats: number }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(adminSetCustomPlan.bind(null, workspaceId), null);
  return (
    <form action={action} className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {FIELDS.map(([k, label]) => (
          <label key={k} className="text-xs text-ink-400">
            {label}
            <input name={k} type="number" min={0} defaultValue={current[k] ?? ""} placeholder="∞" className="input mt-1 py-1.5" />
          </label>
        ))}
        <label className="text-xs text-ink-400">
          Seats
          <input name="seats" type="number" min={1} required defaultValue={seats} className="input mt-1 py-1.5" />
        </label>
        <label className="text-xs text-ink-400">
          Ends on (optional)
          <input name="ends_at" type="date" className="input mt-1 py-1.5" />
        </label>
      </div>
      <p className="text-xs text-ink-400">Leave a limit empty for unlimited.</p>
      <ActionFeedback state={state} />
      <button disabled={pending} className="btn-primary px-3 py-1.5 text-xs">{pending ? "Saving…" : "Assign Custom plan"}</button>
    </form>
  );
}
