import Link from "next/link";
import { PLANS } from "@/config/plans";
import { modes } from "@/lib/env";
import { getBilling, usageMeters } from "@/lib/billing/server";
import { syncFromCheckoutSession } from "@/lib/billing/stripe";
import { openPortal } from "@/app/billing-actions";
import { MockBillingControls } from "@/components/billing-client";
import { UsageMeter } from "@/components/billing";
import { Alert, Badge, DemoTag, PageHeader } from "@/components/ui";

export const metadata = { title: "Billing" };

const fmt = (d: Date | null) => (d ? d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

const STATUS: Record<string, { label: string; color: "green" | "amber" | "red" | "lane" | "neutral" }> = {
  trialing: { label: "Free trial", color: "lane" },
  active: { label: "Active", color: "green" },
  past_due: { label: "Payment failed", color: "red" },
  unpaid: { label: "Unpaid", color: "red" },
  paused: { label: "Paused", color: "amber" },
  canceled: { label: "Canceled", color: "neutral" },
  incomplete: { label: "Checkout incomplete", color: "amber" },
  incomplete_expired: { label: "Expired", color: "neutral" },
};

const BLOCKED: Record<string, string> = {
  payment_failed: "Your payment failed and the 3-day grace period has ended. Update your card to unlock CutLane. Nothing was deleted.",
  unpaid: "Your subscription is unpaid. Update your card to unlock CutLane. Nothing was deleted.",
  trial_payment_pending: "Your trial ended but the first payment didn't go through. Update your card to continue.",
  paused: "Your subscription is paused. Resume it to continue.",
};

export default async function BillingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  let b = await getBilling();
  if (modes.stripe && sp.session_id) {
    await syncFromCheckoutSession(sp.session_id, b.workspace.id).catch((e) => console.error("[cutlane] checkout sync failed:", (e as Error).message));
    b = await getBilling();
  }
  const s = b.subscription;
  const meters = await usageMeters(b);
  const st = s ? (STATUS[s.status] ?? { label: s.status, color: "neutral" as const }) : null;
  const live = s && b.ent.access !== "none";

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Billing" subtitle={<>Plan, payments and usage. {!modes.stripe && <DemoTag label="Test mode" />}</>} />

      <div className="mb-6 space-y-2">
        {sp.checkout === "success" && live && (
          <Alert kind="success">{s!.status === "trialing" ? `Your 3-day trial has started. It ends ${fmt(s!.trialEnd)}.` : "You're subscribed. Thanks!"}</Alert>
        )}
        {sp.checkout === "success" && !live && modes.stripe && <Alert kind="info">Payment received. Your plan will appear here in a few seconds. Refresh if it doesn&apos;t.</Alert>}
        {sp.blocked && BLOCKED[sp.blocked] && <Alert kind="error">{BLOCKED[sp.blocked]}</Alert>}
        {sp.already && <Alert kind="info">You already have a plan. Manage it below.</Alert>}
      </div>

      {!live ? (
        <section className="card p-6 text-center">
          <p className="text-lg font-semibold">{s?.status === "canceled" ? "Your plan has ended" : "No active plan"}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">CutLane has no free plan. Your clips, notes and submissions are kept; pick a plan to keep working.</p>
          <Link href="/pricing" className="btn-primary mt-5">See plans</Link>
        </section>
      ) : (
        <section className="card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Current plan</p>
              <p className="mt-1 text-2xl font-bold">
                {PLANS[s!.plan].name}{" "}
                <span className="text-base font-normal text-muted">
                  {PLANS[s!.plan].monthlyPrice !== null ? `$${s!.interval === "year" ? PLANS[s!.plan].annualPrice + "/yr" : PLANS[s!.plan].monthlyPrice + "/mo"}` : "Custom pricing"}
                </span>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge color={st!.color}>{st!.label}</Badge>
              {s!.cancelAtPeriodEnd && <Badge color="amber">Cancels at period end</Badge>}
              {b.ent.access === "grace" && <Badge color="red">Grace period</Badge>}
              {b.ent.access === "restricted" && <Badge color="red">Restricted (read-only)</Badge>}
            </div>
          </div>

          <dl className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {s!.status === "trialing" && (
              <div>
                <dt className="text-xs text-muted">Trial ends</dt>
                <dd className="text-sm font-medium">{fmt(s!.trialEnd)}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-muted">{s!.cancelAtPeriodEnd ? "Access until" : s!.status === "trialing" ? "First charge" : "Next renewal"}</dt>
              <dd className="text-sm font-medium">{s!.source === "manual" && !s!.currentPeriodEnd ? "No end date" : fmt(s!.status === "trialing" ? s!.trialEnd : s!.currentPeriodEnd)}</dd>
            </div>
            {b.ent.usagePeriod && (
              <div>
                <dt className="text-xs text-muted">Monthly limits reset</dt>
                <dd className="text-sm font-medium">{fmt(b.ent.usagePeriod.end)}</dd>
              </div>
            )}
            {b.ent.graceEndsAt && (
              <div>
                <dt className="text-xs text-muted">{b.ent.access === "grace" ? "Grace period ends" : "Grace period ended"}</dt>
                <dd className="text-sm font-medium text-danger">{fmt(b.ent.graceEndsAt)}</dd>
              </div>
            )}
          </dl>

          <div className="mt-6 border-t border-border pt-4">
            {s!.source === "stripe" && modes.stripe && (
              <form action={openPortal} className="flex flex-wrap items-center gap-3">
                <button className="btn-primary">Manage billing</button>
                <span className="text-xs text-muted">Update your card, view invoices, change plan or cancel in the Stripe customer portal.</span>
              </form>
            )}
            {s!.source === "mock" && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-warning">Test mode: simulate Stripe events</p>
                <MockBillingControls status={s!.status} cancelAtPeriodEnd={s!.cancelAtPeriodEnd} pastDue={Boolean(s!.pastDueSince)} />
                <p className="mt-2 text-xs text-muted">These go through the same subscription rules as real webhooks. With Stripe keys set, this becomes the Stripe customer portal.</p>
              </div>
            )}
            {s!.source === "manual" && <p className="text-sm text-muted">Custom plan managed by CutLane. Contact us to change limits or seats.</p>}
          </div>
        </section>
      )}

      {meters.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Usage</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {meters.map((m) => (
              <UsageMeter key={m.metric} metric={m.metric} used={m.used} limit={m.limit} detail={m.detail} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
