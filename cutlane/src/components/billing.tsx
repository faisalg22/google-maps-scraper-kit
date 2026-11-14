import Link from "next/link";
import { METRIC_LABELS, type Metric } from "@/config/plans";
import type { ActionState } from "@/lib/action-errors";

/** Usage meter: green → amber at 80% → red at 100%. */
export function UsageMeter({ metric, used, limit, detail }: { metric: Metric; used: number; limit: number | null; detail?: string }) {
  const meta = METRIC_LABELS[metric];
  const pct = limit === null ? 0 : limit === 0 ? 100 : Math.min(100, Math.round((used / limit) * 100));
  const level = limit === null ? "ok" : used >= limit ? "full" : pct >= 80 ? "warn" : "ok";
  const bar = level === "full" ? "bg-red-400" : level === "warn" ? "bg-amber-400" : "bg-lane-400";
  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{meta.label}</p>
        <p className={`font-mono text-sm ${level === "full" ? "text-red-300" : level === "warn" ? "text-amber-300" : "text-ink-300"}`}>
          {used.toLocaleString()}
          <span className="text-ink-400"> / {limit === null ? "∞" : limit.toLocaleString()}</span>
        </p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-800" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={meta.label}>
        <div className={`h-full ${bar}`} style={{ width: `${limit === null ? 4 : pct}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-ink-400">
        {level === "full"
          ? used > (limit ?? 0)
            ? "Over your plan's limit. Nothing was deleted; new ones are blocked until you upgrade or free up space."
            : "Limit reached: new ones are blocked."
          : level === "warn"
            ? "You've used 80% or more."
            : limit === null
              ? "Unlimited"
              : `${(limit - used).toLocaleString()} left${meta.monthly ? " this month" : ""}`}
        {detail ? ` · ${detail}` : ""}
      </p>
    </div>
  );
}

/** Shown when a server action was blocked by the plan (limit, access or feature). */
export function UpgradePrompt({ upgrade }: { upgrade: NonNullable<ActionState>["upgrade"] }) {
  if (!upgrade) return null;
  if (upgrade.kind === "access") {
    return (
      <div className="rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-100">
        <p className="font-semibold">Your plan isn&apos;t active</p>
        <p className="mt-0.5 text-red-100/80">Your data is safe. Update billing to continue.</p>
        <Link href="/billing" className="btn-primary mt-2 px-3 py-1.5 text-xs">Go to billing</Link>
      </div>
    );
  }
  const label = upgrade.kind === "limit" ? METRIC_LABELS[upgrade.metric].label.toLowerCase() : "this feature";
  return (
    <div className="rounded-xl border border-lane-400/40 bg-lane-400/10 p-3 text-sm">
      <p className="font-semibold text-lane-400">
        {upgrade.kind === "limit" ? `You've hit your plan's limit for ${label} (${upgrade.used}/${upgrade.limit}).` : "Not included in your plan."}
      </p>
      <p className="mt-0.5 text-ink-300">
        Nothing was deleted.{" "}
        {upgrade.kind === "limit" && METRIC_LABELS[upgrade.metric].monthly ? "Monthly limits reset on your billing date. " : ""}
        Upgrade for higher limits, or talk to us about a Custom plan.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Link href="/pricing" className="btn-primary px-3 py-1.5 text-xs">See plans</Link>
        <Link href="/pricing#custom" className="btn-ghost px-3 py-1.5 text-xs">Contact sales</Link>
      </div>
    </div>
  );
}

export function ActionFeedback({ state }: { state: ActionState }) {
  if (!state) return null;
  if (state.upgrade) return <UpgradePrompt upgrade={state.upgrade} />;
  if (state.error) return <p className="text-sm text-red-300" role="alert">{state.error}</p>;
  if (state.ok && state.message) return <p className="text-sm text-emerald-300">{state.message}</p>;
  return null;
}

export interface PlanBannerData {
  access: "full" | "grace" | "restricted" | "none";
  reason: string;
  planName: string;
  trialEndsAt: string | null;
  graceEndsAt: string | null;
  periodEndsAt: string | null;
  warnMetrics: string[];
  fullMetrics: string[];
  testMode: boolean;
}

const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** App-wide billing status strip (trial countdown, failed payment, restriction, usage warnings). */
export function PlanBanner({ b }: { b: PlanBannerData }) {
  let tone = "";
  let body: React.ReactNode = null;
  if (b.access === "grace") {
    tone = "border-red-400/30 bg-red-400/10 text-red-100";
    body = <>Payment failed. Update your card by <strong>{b.graceEndsAt ? fmt(b.graceEndsAt) : "soon"}</strong> to keep access.</>;
  } else if (b.access === "restricted") {
    tone = "border-red-400/30 bg-red-400/15 text-red-100";
    body = <>Access is restricted ({b.reason.replace(/_/g, " ")}). You can view your data but not create new work.</>;
  } else if (b.reason === "trialing" && b.trialEndsAt) {
    tone = "border-lane-400/30 bg-lane-400/10 text-lane-400";
    body = <>Beginner trial: ends {fmt(b.trialEndsAt)}, then $29/mo unless you cancel.</>;
  } else if (b.reason === "canceling" && b.periodEndsAt) {
    tone = "border-amber-400/30 bg-amber-400/10 text-amber-100";
    body = <>Your plan is canceled and ends {fmt(b.periodEndsAt)}. Resume anytime.</>;
  } else if (b.fullMetrics.length) {
    tone = "border-red-400/30 bg-red-400/10 text-red-100";
    body = <>Limit reached: {b.fullMetrics.join(", ")}.</>;
  } else if (b.warnMetrics.length) {
    tone = "border-amber-400/30 bg-amber-400/10 text-amber-100";
    body = <>You&apos;ve used 80%+ of: {b.warnMetrics.join(", ")}.</>;
  }
  if (!body) return null;
  return (
    <div className={`border-b px-4 py-2 text-center text-xs ${tone}`}>
      {body}{" "}
      <Link href={b.access === "full" && (b.fullMetrics.length || b.warnMetrics.length) ? "/dashboard" : "/billing"} className="font-semibold underline underline-offset-2">
        {b.access === "full" && (b.fullMetrics.length || b.warnMetrics.length) ? "View usage" : "Manage billing"}
      </Link>
    </div>
  );
}
