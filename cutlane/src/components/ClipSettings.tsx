"use client";

import { useActionState } from "react";
import { updateClip, type ActionState } from "@/app/actions";

export function ClipSettings({ clipId, title }: { clipId: string; title: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateClip.bind(null, clipId), null);
  return (
    <form action={action} className="space-y-2">
      <label className="label" htmlFor="clip-title">Title</label>
      <div className="flex gap-2">
        <input id="clip-title" name="title" defaultValue={title} maxLength={200} className="input" />
        <button disabled={pending} className="btn-secondary shrink-0">Save</button>
      </div>
      {state?.error && <p className="text-xs text-red-300">{state.error}</p>}
      {state?.ok && <p className="text-xs text-emerald-300">{state.message}</p>}
    </form>
  );
}
