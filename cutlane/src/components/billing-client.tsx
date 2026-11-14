"use client";

import { useActionState, useTransition } from "react";
import { addSocialAccount, joinWaitlist, mockSimulate, saveChannel, submitSalesLead, unsaveChannel } from "@/app/billing-actions";
import type { ActionState } from "@/lib/action-errors";
import type { MockEvent } from "@/lib/billing/subscription-core";
import { ActionFeedback } from "./billing";

export function ContactSalesForm({ defaultName, defaultEmail }: { defaultName?: string; defaultEmail?: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(submitSalesLead, null);
  if (state?.ok) return <p className="rounded-xl border border-success/30 bg-success/10 p-4 text-sm text-success">{state.message}</p>;
  return (
    <form action={action} className="space-y-3">
      {/* Honeypot (hidden from people, filled by bots) */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Company website<input name="company_website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="lead-name">Name</label>
          <input id="lead-name" name="name" required maxLength={120} defaultValue={defaultName} className="input" autoComplete="name" />
        </div>
        <div>
          <label className="label" htmlFor="lead-email">Email</label>
          <input id="lead-email" name="email" type="email" required maxLength={200} defaultValue={defaultEmail} className="input" autoComplete="email" />
        </div>
        <div>
          <label className="label" htmlFor="lead-team">Team size</label>
          <select id="lead-team" name="teamSize" required defaultValue="" className="input">
            <option value="" disabled>Choose…</option>
            {["1", "2-5", "6-20", "21-50", "50+"].map((t) => (
              <option key={t} value={t}>{t} {t === "1" ? "person" : "people"}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="lead-accounts">Accounts needed</label>
          <input id="lead-accounts" name="accountsNeeded" required maxLength={200} placeholder="e.g. 10 TikTok, 5 IG, 5 Shorts" className="input" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="lead-msg">Anything else? (optional)</label>
        <textarea id="lead-msg" name="message" rows={3} maxLength={2000} className="input resize-y" placeholder="Monthly clip volume, campaigns you work on…" />
      </div>
      <ActionFeedback state={state} />
      <button disabled={pending} className="btn-primary w-full sm:w-auto">{pending ? "Sending…" : "Contact sales"}</button>
    </form>
  );
}

export function WaitlistForm({ signedInEmail }: { signedInEmail?: string | null }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(joinWaitlist, null);
  if (state?.ok) return <p className="text-sm text-success">{state.message}</p>;
  return (
    <form action={action} className="space-y-2">
      {!signedInEmail && <input name="email" type="email" required placeholder="you@example.com" className="input" aria-label="Email for the Clipper waitlist" />}
      <button disabled={pending} className="btn-secondary w-full">{pending ? "Joining…" : "Join the waitlist"}</button>
      <ActionFeedback state={state} />
    </form>
  );
}

const MOCK_BUTTONS: { ev: MockEvent; label: string; when: (s: string, cancel: boolean, pastDue: boolean) => boolean }[] = [
  { ev: "trial_converts", label: "Trial ends → charge card", when: (s) => s === "trialing" },
  { ev: "payment_failed", label: "Payment fails", when: (s, _c, pd) => (s === "active" || s === "trialing") && !pd },
  { ev: "grace_expires", label: "Skip 3-day grace", when: (_s, _c, pd) => pd },
  { ev: "payment_recovered", label: "Card updated → paid", when: (_s, _c, pd) => pd },
  { ev: "cancel_at_period_end", label: "Cancel at period end", when: (s, c) => (s === "active" || s === "trialing") && !c },
  { ev: "resume", label: "Resume", when: (_s, c) => c },
  { ev: "period_ends", label: "Billing period ends", when: (s) => s === "active" },
  { ev: "cancel_now", label: "Cancel immediately", when: (s) => s !== "canceled" },
];

export function MockBillingControls({ status, cancelAtPeriodEnd, pastDue }: { status: string; cancelAtPeriodEnd: boolean; pastDue: boolean }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap gap-2">
      {MOCK_BUTTONS.filter((b) => b.when(status, cancelAtPeriodEnd, pastDue)).map((b) => (
        <button key={b.ev} disabled={pending} onClick={() => start(() => mockSimulate(b.ev))} className="btn-secondary px-3 py-1.5 text-xs">
          {b.label}
        </button>
      ))}
    </div>
  );
}

export function SaveChannelButton({ channel, saved }: { channel: { channelId: string; title: string; thumbnail: string | null; subscribers: number }; saved: boolean }) {
  const [state, setState] = useActionState<ActionState, "save" | "unsave">(async (_p, op) => {
    if (op === "unsave") {
      await unsaveChannel(channel.channelId);
      return null;
    }
    return saveChannel(channel);
  }, null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(() => setState(saved ? "unsave" : "save"))}
        className={saved ? "btn-secondary" : "btn-primary"}
      >
        {saved ? "★ Saved" : "☆ Save channel"}
      </button>
      {state?.upgrade && <ActionFeedback state={state} />}
      {state?.error && !state.upgrade && <ActionFeedback state={state} />}
    </div>
  );
}

export function AddAccountForm({ platforms }: { platforms: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addSocialAccount, null);
  return (
    <form action={action} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[180px_1fr_auto]">
        <select name="platform" className="input" aria-label="Platform">
          {platforms.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <input name="handle" required maxLength={61} placeholder="@yourhandle" className="input" aria-label="Handle" />
        <button disabled={pending} className="btn-primary">{pending ? "Adding…" : "Add account"}</button>
      </div>
      <ActionFeedback state={state} />
    </form>
  );
}
