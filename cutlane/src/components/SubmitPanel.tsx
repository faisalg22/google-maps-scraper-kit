"use client";

import { useActionState } from "react";
import { submitClip, type ActionState } from "@/app/actions";
import { ActionFeedback } from "./billing";

export function SubmitPanel({
  clipId,
  urls,
  blockers,
  canAttach,
  isDemo,
}: {
  clipId: string;
  urls: string[];
  blockers: string[];
  canAttach: boolean;
  isDemo: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(submitClip.bind(null, clipId), null);
  const disabled = blockers.length > 0 || pending;

  return (
    <form action={action} className="card space-y-4 p-4">
      <div>
        <p className="font-semibold">Submit to Whop</p>
        <p className="text-xs text-muted">Only links that are saved and load publicly are sent (up to 10).</p>
      </div>

      {urls.length > 0 && (
        <ul className="space-y-1">
          {urls.map((u) => (
            <li key={u} className="truncate rounded-lg bg-raised px-3 py-1.5 font-mono text-xs text-success-fg">✓ {u}</li>
          ))}
        </ul>
      )}

      {blockers.length > 0 && (
        <ul className="space-y-1 text-sm text-warning-fg">
          {blockers.map((b) => (
            <li key={b}>• {b}</li>
          ))}
        </ul>
      )}

      <div>
        <label className="label" htmlFor="caption">Caption for reviewers (optional)</label>
        <textarea id="caption" name="caption" rows={2} maxLength={2000} className="input resize-y" placeholder="Anything the reviewer should know" />
      </div>

      {canAttach ? (
        <label className="flex gap-2 text-sm">
          <input type="checkbox" name="attachFile" defaultChecked className="mt-0.5 h-4 w-4 accent-accent" />
          <span>
            Attach the clip file too <span className="text-muted">(uploaded to Whop Files from our server)</span>
          </span>
        </label>
      ) : (
        <p className="text-xs text-muted">This campaign accepts post links only, so the file isn&apos;t attached.</p>
      )}

      <ActionFeedback state={state} />

      <button disabled={disabled} className="btn-primary w-full">
        {pending ? "Submitting… (uploading can take a minute)" : isDemo ? "Submit (demo)" : "Submit to Whop"}
      </button>
    </form>
  );
}
