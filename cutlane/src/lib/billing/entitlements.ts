/**
 * THE entitlements helper: subscription state → access level, limits and features.
 * Pure (no server imports): used by server actions, route handlers, pages, and tests.
 *
 *   access = "full"       trialing / active / canceling (until period end)
 *            "grace"      payment failed < 3 days ago: everything still works, with a banner
 *            "restricted" grace over, unpaid, paused, or a trial whose payment never landed:
 *                         read-only (view and export your data, no new work)
 *            "none"       no subscription, canceled, or checkout never completed: pick a plan
 */
import { GRACE_DAYS, PLANS, V2_FEATURES, type Feature, type Limits, type Metric, type PlanId } from "@/config/plans";

export type SubStatus = "trialing" | "active" | "past_due" | "unpaid" | "canceled" | "incomplete" | "incomplete_expired" | "paused";

export interface SubscriptionState {
  plan: PlanId;
  status: SubStatus | string;
  source: "stripe" | "mock" | "manual";
  interval: "month" | "year";
  trialStart: Date | null;
  trialEnd: Date | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  billingAnchor: Date;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  pastDueSince: Date | null;
}

export interface WorkspaceOverrides {
  customLimits?: Partial<Record<Metric, number | null>>;
  seats?: number | null;
}

export type Access = "full" | "grace" | "restricted" | "none";

export type AccessReason =
  | "no_subscription"
  | "trialing"
  | "active"
  | "canceling"
  | "payment_grace"
  | "payment_failed"
  | "trial_payment_pending"
  | "unpaid"
  | "paused"
  | "canceled"
  | "checkout_incomplete";

export interface Entitlements {
  plan: PlanId | null;
  access: Access;
  reason: AccessReason;
  limits: Limits;
  features: Feature[];
  canWrite: boolean;
  canRead: boolean;
  trialEndsAt: Date | null;
  graceEndsAt: Date | null;
  periodEndsAt: Date | null;
  /** Window for monthly counters (resets on the billing date). */
  usagePeriod: { start: Date; end: Date } | null;
}

const DAY = 86_400_000;
/** Allowance for a late Stripe webhook before a stale state starts to bite. */
export const WEBHOOK_LEEWAY_MS = DAY;

const ZERO_LIMITS: Limits = {
  saved_channels: 0,
  clips_monthly: 0,
  submissions_monthly: 0,
  notes: 0,
  accounts_per_platform: 0,
  seats: 0,
  render_minutes_monthly: 0,
  ai_cuts_monthly: 0,
};

export function resolveAccess(sub: SubscriptionState | null, now: Date): { access: Access; reason: AccessReason; graceEndsAt: Date | null } {
  if (!sub) return { access: "none", reason: "no_subscription", graceEndsAt: null };
  const t = now.getTime();
  const graceFrom = (since: Date) => new Date(since.getTime() + GRACE_DAYS * DAY);

  switch (sub.status) {
    case "trialing":
      if (sub.trialEnd && t <= sub.trialEnd.getTime() + WEBHOOK_LEEWAY_MS) return { access: "full", reason: "trialing", graceEndsAt: null };
      return { access: "restricted", reason: "trial_payment_pending", graceEndsAt: null };

    case "active": {
      if (sub.pastDueSince) {
        const g = graceFrom(sub.pastDueSince);
        return t < g.getTime() ? { access: "grace", reason: "payment_grace", graceEndsAt: g } : { access: "restricted", reason: "payment_failed", graceEndsAt: g };
      }
      if (sub.cancelAtPeriodEnd) {
        if (sub.currentPeriodEnd && t > sub.currentPeriodEnd.getTime() + WEBHOOK_LEEWAY_MS) return { access: "none", reason: "canceled", graceEndsAt: null };
        return { access: "full", reason: "canceling", graceEndsAt: null };
      }
      // Manual (Custom) plans may carry an end date set by an admin.
      if (sub.source === "manual" && sub.currentPeriodEnd && t > sub.currentPeriodEnd.getTime()) return { access: "none", reason: "canceled", graceEndsAt: null };
      return { access: "full", reason: "active", graceEndsAt: null };
    }

    case "past_due": {
      const g = graceFrom(sub.pastDueSince ?? now);
      return t < g.getTime() ? { access: "grace", reason: "payment_grace", graceEndsAt: g } : { access: "restricted", reason: "payment_failed", graceEndsAt: g };
    }
    case "unpaid":
      return { access: "restricted", reason: "unpaid", graceEndsAt: null };
    case "paused":
      return { access: "restricted", reason: "paused", graceEndsAt: null };
    case "incomplete":
      return { access: "none", reason: "checkout_incomplete", graceEndsAt: null };
    case "canceled":
    case "incomplete_expired":
    default:
      return { access: "none", reason: "canceled", graceEndsAt: null };
  }
}

/** Monthly window containing `now`, anchored on the billing day (Jan 31 → Feb 28 → Mar 31 …). UTC. */
export function usagePeriod(anchor: Date, now: Date): { start: Date; end: Date } {
  const addMonths = (k: number) => {
    const y = anchor.getUTCFullYear();
    const m = anchor.getUTCMonth() + k;
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(anchor.getUTCDate(), lastDay), anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds()));
  };
  if (now < anchor) return { start: anchor, end: addMonths(1) };
  let k = (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (now.getUTCMonth() - anchor.getUTCMonth());
  if (addMonths(k) > now) k -= 1;
  return { start: addMonths(k), end: addMonths(k + 1) };
}

export function limitsFor(plan: PlanId, overrides: WorkspaceOverrides = {}): Limits {
  const base = { ...PLANS[plan].limits };
  if (plan === "custom") {
    for (const [k, v] of Object.entries(overrides.customLimits ?? {})) {
      if (k in base && (v === null || (typeof v === "number" && v >= 0))) base[k as Metric] = v;
    }
  }
  if (overrides.seats && plan === "custom") base.seats = overrides.seats;
  return base;
}

export function getEntitlements(
  sub: SubscriptionState | null,
  overrides: WorkspaceOverrides,
  now: Date,
  opts: { v2Released?: boolean } = {},
): Entitlements {
  const { access, reason, graceEndsAt } = resolveAccess(sub, now);
  const hasPlan = sub !== null && access !== "none";
  const plan = hasPlan ? sub!.plan : null;
  const features = plan ? PLANS[plan].features.filter((f) => opts.v2Released || !V2_FEATURES.includes(f)) : [];
  return {
    plan,
    access,
    reason,
    limits: plan ? limitsFor(plan, overrides) : { ...ZERO_LIMITS },
    features,
    canWrite: access === "full" || access === "grace",
    canRead: access !== "none",
    trialEndsAt: sub?.status === "trialing" ? sub.trialEnd : null,
    graceEndsAt,
    periodEndsAt: sub?.currentPeriodEnd ?? null,
    usagePeriod: sub && hasPlan ? usagePeriod(sub.billingAnchor, now) : null,
  };
}

export type LimitLevel = "ok" | "warn" | "full";

/** At 80% warn; at 100% block. `used` above the limit (after a downgrade) is kept, never deleted. */
export function checkLimit(limit: number | null, used: number, adding = 1): { allowed: boolean; level: LimitLevel; pct: number; remaining: number | null } {
  if (limit === null) return { allowed: true, level: "ok", pct: 0, remaining: null };
  const pct = limit === 0 ? 1 : used / limit;
  const allowed = used + adding <= limit;
  const level: LimitLevel = used >= limit ? "full" : pct >= 0.8 ? "warn" : "ok";
  return { allowed, level, pct: Math.min(pct, 1), remaining: Math.max(limit - used, 0) };
}

export function hasFeature(ent: Entitlements, f: Feature): boolean {
  return ent.canWrite && ent.features.includes(f);
}

export class LimitReachedError extends Error {
  constructor(
    public metric: Metric,
    public limit: number,
    public used: number,
  ) {
    super(`You've reached your plan's limit (${used}/${limit}).`);
  }
}

export class AccessBlockedError extends Error {
  constructor(public reason: AccessReason) {
    super(
      reason === "no_subscription" || reason === "canceled" || reason === "checkout_incomplete"
        ? "Choose a plan to keep using CutLane."
        : reason === "payment_failed" || reason === "unpaid"
          ? "Your payment failed and the 3-day grace period has ended. Update your card to continue. Your data is safe."
          : reason === "trial_payment_pending"
            ? "Your trial ended and the first payment hasn't gone through. Update your card to continue."
            : "Your subscription is paused. Resume it to continue.",
    );
  }
}

export class FeatureUnavailableError extends Error {
  constructor(public feature: Feature) {
    super("This feature isn't included in your plan.");
  }
}
