/**
 * Subscription state machine. Pure, so webhook handling and test-mode simulation share
 * exactly the same rules and can be unit-tested.
 *
 * Stripe → normalizeStripeSubscription() → applySnapshot(prev, snap) → row saved in Postgres.
 * invoice.payment_failed → applyPaymentFailed(); invoice.paid → applyPaymentSucceeded().
 */
import type { PlanId } from "@/config/plans";
import type { SubscriptionState } from "./entitlements";

export interface SubscriptionRow extends SubscriptionState {
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  lastEventAt: Date | null;
}

export interface PriceMap {
  beginner?: string;
  clipper?: string;
  beginnerAnnual?: string;
  clipperAnnual?: string;
}

export function planForPrice(priceId: string | null | undefined, prices: PriceMap): { plan: PlanId; interval: "month" | "year" } | null {
  if (!priceId) return null;
  if (priceId === prices.beginner) return { plan: "beginner", interval: "month" };
  if (priceId === prices.beginnerAnnual) return { plan: "beginner", interval: "year" };
  if (priceId === prices.clipper) return { plan: "clipper", interval: "month" };
  if (priceId === prices.clipperAnnual) return { plan: "clipper", interval: "year" };
  return null;
}

export function priceFor(plan: PlanId, interval: "month" | "year", prices: PriceMap): string | undefined {
  if (plan === "beginner") return interval === "year" ? prices.beginnerAnnual : prices.beginner;
  if (plan === "clipper") return interval === "year" ? prices.clipperAnnual : prices.clipper;
  return undefined;
}

export interface StripeSnapshot {
  id: string;
  customerId: string | null;
  workspaceId: string | null;
  status: string;
  priceId: string | null;
  priceInterval: "month" | "year" | null;
  metadataPlan: string | null;
  trialStart: Date | null;
  trialEnd: Date | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  anchor: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  eventAt: Date;
}

const ts = (s: unknown): Date | null => (typeof s === "number" && s > 0 ? new Date(s * 1000) : null);

/**
 * Reads a Stripe Subscription object. Handles both API shapes: current_period_* on the
 * subscription (older versions) and on subscription items (2025-03-31 and later).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeStripeSubscription(sub: any, eventCreatedSeconds: number): StripeSnapshot {
  const item = sub?.items?.data?.[0];
  const price = item?.price ?? item?.plan ?? null;
  const customer = typeof sub.customer === "string" ? sub.customer : (sub.customer?.id ?? null);
  // cancel_at (set by the portal's "cancel at period end" in newer API versions) also counts.
  const periodEnd = ts(item?.current_period_end ?? sub.current_period_end);
  const cancelAt = ts(sub.cancel_at);
  return {
    id: String(sub.id),
    customerId: customer,
    workspaceId: sub.metadata?.workspace_id ?? null,
    status: String(sub.status),
    priceId: price?.id ?? null,
    priceInterval: price?.recurring?.interval === "year" || price?.interval === "year" ? "year" : price ? "month" : null,
    metadataPlan: sub.metadata?.plan ?? null,
    trialStart: ts(sub.trial_start),
    trialEnd: ts(sub.trial_end),
    periodStart: ts(item?.current_period_start ?? sub.current_period_start),
    periodEnd,
    anchor: ts(sub.billing_cycle_anchor),
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end) || Boolean(cancelAt && periodEnd && cancelAt.getTime() <= periodEnd.getTime()),
    canceledAt: ts(sub.canceled_at),
    eventAt: new Date(eventCreatedSeconds * 1000),
  };
}

const TERMINAL = new Set(["canceled", "incomplete_expired"]);
const LIVE = new Set(["trialing", "active", "past_due", "unpaid", "paused"]);

export interface ApplyResult {
  row: SubscriptionRow | null;
  /** True when the event was older than what we already have, or about a superseded subscription. */
  ignored: boolean;
  /** The subscription includes a trial: mark the account's one trial as used. */
  trialUsed: boolean;
}

export function applySnapshot(prev: SubscriptionRow | null, snap: StripeSnapshot, prices: PriceMap, now: Date): ApplyResult {
  const sameSub = prev?.stripeSubscriptionId === snap.id;

  // Out-of-order delivery: Stripe doesn't guarantee event order.
  if (prev && sameSub && prev.lastEventAt && snap.eventAt < prev.lastEventAt) return { row: prev, ignored: true, trialUsed: false };
  // An old subscription ending must not overwrite a newer live one (e.g. re-subscribed after cancel).
  if (prev && !sameSub && LIVE.has(prev.status) && TERMINAL.has(snap.status)) return { row: prev, ignored: true, trialUsed: false };

  const mapped = planForPrice(snap.priceId, prices);
  const plan: PlanId =
    mapped?.plan ?? (snap.metadataPlan === "clipper" || snap.metadataPlan === "beginner" ? snap.metadataPlan : (prev?.plan ?? "beginner"));
  const interval = mapped?.interval ?? snap.priceInterval ?? prev?.interval ?? "month";

  let pastDueSince = sameSub ? (prev?.pastDueSince ?? null) : null;
  if (snap.status === "past_due" || snap.status === "unpaid") pastDueSince = pastDueSince ?? now;
  if (snap.status === "active" || snap.status === "trialing") pastDueSince = null;

  const row: SubscriptionRow = {
    plan,
    status: snap.status,
    source: "stripe",
    interval,
    stripeSubscriptionId: snap.id,
    stripePriceId: snap.priceId,
    trialStart: snap.trialStart,
    trialEnd: snap.trialEnd,
    currentPeriodStart: snap.periodStart,
    currentPeriodEnd: snap.periodEnd,
    billingAnchor: snap.anchor ?? snap.periodStart ?? prev?.billingAnchor ?? now,
    cancelAtPeriodEnd: snap.cancelAtPeriodEnd,
    canceledAt: snap.canceledAt,
    pastDueSince,
    lastEventAt: snap.eventAt,
  };
  return { row, ignored: false, trialUsed: Boolean(snap.trialEnd) };
}

export function applyPaymentFailed(prev: SubscriptionRow | null, failedAt: Date): SubscriptionRow | null {
  if (!prev || TERMINAL.has(prev.status)) return prev;
  return { ...prev, pastDueSince: prev.pastDueSince ?? failedAt, status: prev.status === "active" ? "past_due" : prev.status };
}

export function applyPaymentSucceeded(prev: SubscriptionRow | null): SubscriptionRow | null {
  if (!prev) return prev;
  return { ...prev, pastDueSince: null, status: prev.status === "past_due" || prev.status === "unpaid" ? "active" : prev.status };
}

// ── Test-mode simulation (no Stripe keys): same row shape, same rules ──────────

const DAY = 86_400_000;
const addMonths = (d: Date, n: number) => {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
};

export function mockStartSubscription(plan: PlanId, interval: "month" | "year", withTrial: boolean, now: Date): SubscriptionRow {
  const trialEnd = withTrial ? new Date(now.getTime() + 3 * DAY) : null;
  const start = trialEnd ?? now;
  return {
    plan,
    status: withTrial ? "trialing" : "active",
    source: "mock",
    interval,
    stripeSubscriptionId: null,
    stripePriceId: null,
    trialStart: withTrial ? now : null,
    trialEnd,
    currentPeriodStart: now,
    currentPeriodEnd: withTrial ? trialEnd : addMonths(now, interval === "year" ? 12 : 1),
    billingAnchor: withTrial ? now : start,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    pastDueSince: null,
    lastEventAt: now,
  };
}

export type MockEvent =
  | "trial_converts"
  | "payment_failed"
  | "grace_expires"
  | "payment_recovered"
  | "cancel_at_period_end"
  | "resume"
  | "period_ends"
  | "cancel_now"
  | "change_plan_clipper"
  | "change_plan_beginner";

export function mockTransition(row: SubscriptionRow, ev: MockEvent, now: Date): SubscriptionRow {
  switch (ev) {
    case "trial_converts": {
      if (row.status !== "trialing") return row;
      // Stripe moves the billing anchor to the trial end, so usage resets at conversion.
      return { ...row, status: "active", trialEnd: row.trialEnd, currentPeriodStart: now, currentPeriodEnd: addMonths(now, row.interval === "year" ? 12 : 1), billingAnchor: now };
    }
    case "payment_failed":
      return applyPaymentFailed({ ...row, status: row.status === "trialing" ? "active" : row.status }, now)!;
    case "grace_expires":
      return row.pastDueSince ? { ...row, pastDueSince: new Date(now.getTime() - 4 * DAY) } : row;
    case "payment_recovered":
      return applyPaymentSucceeded(row)!;
    case "cancel_at_period_end":
      return { ...row, cancelAtPeriodEnd: true, canceledAt: now };
    case "resume":
      return { ...row, cancelAtPeriodEnd: false, canceledAt: null };
    case "period_ends":
      if (row.cancelAtPeriodEnd) return { ...row, status: "canceled", currentPeriodEnd: now };
      return { ...row, currentPeriodStart: now, currentPeriodEnd: addMonths(now, row.interval === "year" ? 12 : 1) };
    case "cancel_now":
      return { ...row, status: "canceled", canceledAt: now, currentPeriodEnd: now };
    case "change_plan_clipper":
      return { ...row, plan: "clipper" };
    case "change_plan_beginner":
      return { ...row, plan: "beginner" };
  }
}
