"use client";

import { useActionState, useOptimistic, useState, useTransition } from "react";
import { confirmLinkManually, recheckPostUrl, savePostUrl, toggleChecklist, type ActionState } from "@/app/actions";
import { CHECKLISTS, checklistComplete } from "@/lib/posting/platforms";
import { PLATFORM_LABELS, type Platform } from "@/lib/whop/campaigns-core";
import type { PostLink } from "@/lib/repo";
import { ActionFeedback } from "./billing";

const PLACEHOLDER: Record<Platform, string> = {
  instagram: "https://www.instagram.com/reel/…",
  tiktok: "https://www.tiktok.com/@you/video/…",
  youtube_shorts: "https://www.youtube.com/shorts/…",
};

const CHECK_UI: Record<PostLink["check_status"], { label: string; cls: string }> = {
  unchecked: { label: "Not checked", cls: "text-muted" },
  ok: { label: "Loads publicly", cls: "text-success-fg" },
  blocked: { label: "Couldn't verify automatically", cls: "text-warning-fg" },
  failed: { label: "Not reachable", cls: "text-danger-fg" },
};

export function PostingPanel({ clipId, platform, link, locked }: { clipId: string; platform: Platform; link: PostLink | null; locked: boolean }) {
  const steps = CHECKLISTS[platform];
  const [checklist, setOptimistic] = useOptimistic(link?.checklist ?? {}, (s: Record<string, boolean>, u: { id: string; v: boolean }) => ({ ...s, [u.id]: u.v }));
  const [, startToggle] = useTransition();
  const [state, formAction, saving] = useActionState<ActionState, FormData>(savePostUrl.bind(null, clipId, platform), null);
  const [busy, startBusy] = useTransition();
  // Open by default until a link is saved; afterwards the user controls it (doesn't snap shut on save).
  const [open, setOpen] = useState(!link?.url);
  const done = steps.filter((s) => checklist[s.id]).length;
  const complete = checklistComplete(platform, checklist);

  return (
    <details className="card group overflow-hidden" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="font-semibold">{PLATFORM_LABELS[platform]}</p>
          <p className="truncate text-xs text-muted">{link?.url ? link.url : `${done}/${steps.length} steps done`}</p>
        </div>
        <div className="flex items-center gap-2">
          {link?.url && <span className={`text-xs font-medium ${CHECK_UI[link.check_status].cls}`}>{CHECK_UI[link.check_status].label}</span>}
          <span aria-hidden className="text-muted transition group-open:rotate-180">⌄</span>
        </div>
      </summary>

      <div className="space-y-4 border-t border-border p-4">
        <ul className="space-y-2">
          {steps.map((s) => (
            <li key={s.id}>
              <label className="flex cursor-pointer gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                  checked={Boolean(checklist[s.id])}
                  disabled={locked}
                  onChange={(e) => {
                    const v = e.target.checked;
                    startToggle(async () => {
                      setOptimistic({ id: s.id, v });
                      await toggleChecklist(clipId, platform, s.id, v);
                    });
                  }}
                />
                <span className={checklist[s.id] ? "text-fg-secondary line-through decoration-border-strong" : ""}>{s.label}</span>
              </label>
            </li>
          ))}
        </ul>

        <form action={formAction} className="space-y-2">
          <label className="label" htmlFor={`url-${platform}`}>Live post link</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id={`url-${platform}`}
              name="url"
              type="url"
              inputMode="url"
              defaultValue={link?.url ?? ""}
              placeholder={PLACEHOLDER[platform]}
              className="input"
              disabled={locked}
            />
            <button disabled={saving || locked} className="btn-primary shrink-0">
              {saving ? "Checking…" : link?.url ? "Update" : "Save link"}
            </button>
          </div>
          {!complete && !link?.url && <p className="text-xs text-muted">Tip: tick off the checklist before you post.</p>}
          <ActionFeedback state={state} />
        </form>

        {link?.url && (
          <div className="space-y-2 rounded-xl bg-raised/60 p-3 text-sm">
            <p className={CHECK_UI[link.check_status].cls}>
              {CHECK_UI[link.check_status].label}
              {link.check_http_status ? ` · HTTP ${link.check_http_status}` : ""}
            </p>
            {link.check_message && <p className="text-xs text-muted">{link.check_message}</p>}
            {link.check_status === "blocked" && (
              <label className="flex gap-2 text-xs">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-accent"
                  checked={link.manual_confirmed}
                  disabled={locked || busy}
                  onChange={(e) => {
                    const v = e.target.checked;
                    startBusy(() => confirmLinkManually(clipId, platform, v));
                  }}
                />
                I opened this link in a private window (logged out) and the post loads.
              </label>
            )}
            <div className="flex gap-2">
              <a href={link.url} target="_blank" rel="noopener noreferrer" className="btn-ghost px-2 py-1 text-xs">Open ↗</a>
              <button type="button" disabled={busy || locked} onClick={() => startBusy(() => recheckPostUrl(clipId, platform))} className="btn-ghost px-2 py-1 text-xs">
                {busy ? "Checking…" : "Re-check"}
              </button>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
