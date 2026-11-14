import { describe, expect, it } from "vitest";
import { PLANS } from "@/config/plans";
import { checkLimit, getEntitlements, resolveAccess, usagePeriod, WEBHOOK_LEEWAY_MS } from "@/lib/billing/entitlements";
import {
  applyPaymentFailed,
  applyPaymentSucceeded,
  applySnapshot,
  mockStartSubscription,
  mockTransition,
  normalizeStripeSubscription,
  planForPrice,
  type PriceMap,
  type SubscriptionRow,
} from "@/lib/billing/subscription-core";

const DAY = 86_400_000;
const T0 = new Date("2026-11-14T12:00:00Z");
const at = (days: number) => new Date(T0.getTime() + days * DAY);
const prices: PriceMap = { beginner: "price_beg", clipper: "price_clip", beginnerAnnual: "price_beg_y", clipperAnnual: "price_clip_y" };

/** A Stripe Subscription object in the 2025+ API shape (period on the item). */
function stripeSub(over: Record<string, unknown> = {}, item: Record<string, unknown> = {}) {
  return {
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    metadata: { workspace_id: "ws_1", plan: "beginner" },
    trial_start: null,
    trial_end: null,
    billing_cycle_anchor: T0.getTime() / 1000,
    cancel_at_period_end: false,
    cancel_at: null,
    canceled_at: null,
    items: {
      data: [
        {
          price: { id: "price_beg", recurring: { interval: "month" } },
          current_period_start: T0.getTime() / 1000,
          current_period_end: at(30).getTime() / 1000,
          ...item,
        },
      ],
    },
    ...over,
  };
}
const snap = (over: Record<string, unknown> = {}, item: Record<string, unknown> = {}, eventAt = T0) =>
  normalizeStripeSubscription(stripeSub(over, item), eventAt.getTime() / 1000);

const ent = (row: SubscriptionRow | null, now: Date, v2 = false) => getEntitlements(row, {}, now, { v2Released: v2 });

// ─────────────────────────────────────────────────────────────────────────────
describe("trial", () => {
  const trial = mockStartSubscription("beginner", "month", true, T0);

  it("gives full Beginner access during the 3-day trial", () => {
    const e = ent(trial, at(1));
    expect(e.access).toBe("full");
    expect(e.reason).toBe("trialing");
    expect(e.plan).toBe("beginner");
    expect(e.trialEndsAt?.getTime()).toBe(at(3).getTime());
    expect(e.limits.clips_monthly).toBe(180);
    expect(e.canWrite).toBe(true);
  });

  it("converts to paid at the end of the trial and resets monthly usage", () => {
    const converted = mockTransition(trial, "trial_converts", at(3));
    expect(converted.status).toBe("active");
    expect(ent(converted, at(4)).access).toBe("full");
    // New billing anchor = conversion date, so counters start fresh.
    expect(ent(converted, at(4)).usagePeriod!.start.getTime()).toBe(at(3).getTime());
  });

  it("restricts (not deletes) if the trial ended and Stripe never confirmed payment", () => {
    const e = ent(trial, new Date(at(3).getTime() + WEBHOOK_LEEWAY_MS + 60_000));
    expect(e.access).toBe("restricted");
    expect(e.reason).toBe("trial_payment_pending");
    expect(e.canRead).toBe(true);
    expect(e.canWrite).toBe(false);
  });

  it("canceling during the trial keeps access until the trial ends, then ends it", () => {
    const canceling = mockTransition(trial, "cancel_at_period_end", at(1));
    expect(ent(canceling, at(2)).access).toBe("full");
    const ended = mockTransition(canceling, "cancel_now", at(3));
    expect(ent(ended, at(3)).access).toBe("none");
  });

  it("marks the one-per-account trial as used when a Stripe subscription has a trial", () => {
    const s = snap({ status: "trialing", trial_start: T0.getTime() / 1000, trial_end: at(3).getTime() / 1000 });
    const r = applySnapshot(null, s, prices, T0);
    expect(r.trialUsed).toBe(true);
    expect(r.row!.status).toBe("trialing");
    expect(ent(r.row, at(2)).access).toBe("full");
    expect(applySnapshot(null, snap(), prices, T0).trialUsed).toBe(false);
  });

  it("only Beginner offers a trial", () => {
    expect(PLANS.beginner.trialDays).toBe(3);
    expect(PLANS.clipper.trialDays).toBe(0);
    expect(PLANS.custom.selfServe).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("upgrade", () => {
  it("Beginner → Clipper (price change via portal) raises limits immediately", () => {
    const beginner = applySnapshot(null, snap(), prices, T0).row!;
    expect(ent(beginner, at(1)).limits.saved_channels).toBe(10);
    const up = applySnapshot(beginner, snap({}, { price: { id: "price_clip", recurring: { interval: "month" } } }, at(2)), prices, at(2)).row!;
    expect(up.plan).toBe("clipper");
    const e = ent(up, at(2));
    expect(e.limits).toMatchObject({ saved_channels: 50, clips_monthly: 600, submissions_monthly: 600, notes: null, accounts_per_platform: 3 });
  });

  it("V2 features stay off until released, even on Clipper", () => {
    const clipper = mockStartSubscription("clipper", "month", false, T0);
    expect(ent(clipper, at(1)).features).not.toContain("editor");
    expect(ent(clipper, at(1), true).features).toEqual(expect.arrayContaining(["editor", "ai_cuts", "captions", "auto_post", "saved_projects"]));
    expect(ent(clipper, at(1), true).limits.render_minutes_monthly).toBeGreaterThan(0);
  });

  it("maps monthly and annual prices", () => {
    expect(planForPrice("price_beg_y", prices)).toEqual({ plan: "beginner", interval: "year" });
    expect(planForPrice("price_clip", prices)).toEqual({ plan: "clipper", interval: "month" });
    expect(planForPrice("price_unknown", prices)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("downgrade", () => {
  it("Clipper → Beginner lowers limits; existing data over the limit is kept but blocks new items", () => {
    const clipper = applySnapshot(null, snap({}, { price: { id: "price_clip", recurring: { interval: "month" } } }), prices, T0).row!;
    const down = applySnapshot(clipper, snap({}, {}, at(5)), prices, at(5)).row!;
    expect(down.plan).toBe("beginner");
    const e = ent(down, at(5));
    // 30 saved channels from Clipper days: nothing is deleted, adding is blocked.
    const c = checkLimit(e.limits.saved_channels, 30);
    expect(c).toMatchObject({ allowed: false, level: "full", remaining: 0 });
    // Unlimited notes on Clipper → 100 on Beginner.
    expect(checkLimit(e.limits.notes, 250).allowed).toBe(false);
  });

  it("custom plan limits and seats come from the admin override", () => {
    const custom: SubscriptionRow = { ...mockStartSubscription("beginner", "month", false, T0), plan: "custom", source: "manual", currentPeriodEnd: null };
    const e = getEntitlements(custom, { customLimits: { clips_monthly: 5000, notes: null, saved_channels: 0 }, seats: 12 }, at(1));
    expect(e.limits).toMatchObject({ clips_monthly: 5000, notes: null, saved_channels: 0, seats: 12 });
    expect(e.access).toBe("full");
    // Overrides only apply to Custom.
    expect(getEntitlements(mockStartSubscription("beginner", "month", false, T0), { customLimits: { clips_monthly: 5000 }, seats: 9 }, at(1)).limits.clips_monthly).toBe(180);
  });

  it("an expired manual Custom plan ends access", () => {
    const custom: SubscriptionRow = { ...mockStartSubscription("beginner", "month", false, T0), plan: "custom", source: "manual", currentPeriodEnd: at(10) };
    expect(getEntitlements(custom, {}, at(9)).access).toBe("full");
    expect(getEntitlements(custom, {}, at(11)).access).toBe("none");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("cancel", () => {
  const active = applySnapshot(null, snap(), prices, T0).row!;

  it("cancel at period end keeps access until the period ends", () => {
    const c = applySnapshot(active, snap({ cancel_at_period_end: true, canceled_at: at(2).getTime() / 1000 }, {}, at(2)), prices, at(2)).row!;
    expect(ent(c, at(10))).toMatchObject({ access: "full", reason: "canceling" });
    // Webhook for the final deletion missed: still cut off after period end + leeway.
    expect(ent(c, new Date(at(30).getTime() + WEBHOOK_LEEWAY_MS + 1)).access).toBe("none");
  });

  it("treats cancel_at (newer portal behaviour) at period end as canceling", () => {
    const s = snap({ cancel_at: at(30).getTime() / 1000 }, {}, at(2));
    expect(s.cancelAtPeriodEnd).toBe(true);
  });

  it("customer.subscription.deleted → no plan; data stays, user is sent to pricing", () => {
    const gone = applySnapshot(active, snap({ status: "canceled", canceled_at: at(30).getTime() / 1000 }, {}, at(30)), prices, at(30)).row!;
    expect(ent(gone, at(30))).toMatchObject({ access: "none", canRead: false, plan: null });
  });

  it("resubscribing: a late cancel event for the OLD subscription doesn't kill the new one", () => {
    const fresh = applySnapshot(null, snap({ id: "sub_2" }, {}, at(40)), prices, at(40)).row!;
    const late = applySnapshot(fresh, snap({ id: "sub_1", status: "canceled" }, {}, at(41)), prices, at(41));
    expect(late.ignored).toBe(true);
    expect(late.row!.stripeSubscriptionId).toBe("sub_2");
  });

  it("ignores out-of-order (older) events for the same subscription", () => {
    const newer = applySnapshot(active, snap({ cancel_at_period_end: true }, {}, at(5)), prices, at(5)).row!;
    const stale = applySnapshot(newer, snap({ cancel_at_period_end: false }, {}, at(4)), prices, at(6));
    expect(stale.ignored).toBe(true);
    expect(stale.row!.cancelAtPeriodEnd).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("payment failure", () => {
  const active = applySnapshot(null, snap(), prices, T0).row!;

  it("invoice.payment_failed starts a 3-day grace period with full access", () => {
    const failed = applyPaymentFailed(active, at(30))!;
    const e = ent(failed, at(31));
    expect(e).toMatchObject({ access: "grace", reason: "payment_grace", canWrite: true });
    expect(e.graceEndsAt!.getTime()).toBe(at(33).getTime());
  });

  it("after 3 days access is restricted: read-only, nothing deleted", () => {
    const failed = applyPaymentFailed(active, at(30))!;
    const e = ent(failed, at(33.01));
    expect(e).toMatchObject({ access: "restricted", reason: "payment_failed", canWrite: false, canRead: true, plan: "beginner" });
  });

  it("Stripe retries don't restart the grace clock", () => {
    const first = applyPaymentFailed(active, at(30))!;
    const retry = applyPaymentFailed(first, at(32))!;
    expect(retry.pastDueSince!.getTime()).toBe(at(30).getTime());
    // subscription.updated with past_due also keeps the original date.
    const updated = applySnapshot(retry, snap({ status: "past_due" }, {}, at(32.5)), prices, at(32.5)).row!;
    expect(updated.pastDueSince!.getTime()).toBe(at(30).getTime());
  });

  it("past_due straight from a subscription.updated webhook also gets grace", () => {
    const pd = applySnapshot(active, snap({ status: "past_due" }, {}, at(30)), prices, at(30)).row!;
    expect(ent(pd, at(31)).access).toBe("grace");
    expect(ent(pd, at(34)).access).toBe("restricted");
  });

  it("paying (invoice.paid / status active) restores full access", () => {
    const failed = applyPaymentFailed(active, at(30))!;
    expect(ent(applyPaymentSucceeded(failed), at(35)).access).toBe("full");
    const viaUpdate = applySnapshot(failed, snap({ status: "active" }, {}, at(35)), prices, at(35)).row!;
    expect(viaUpdate.pastDueSince).toBeNull();
    expect(ent(viaUpdate, at(35)).access).toBe("full");
  });

  it("unpaid (Stripe gave up) is restricted", () => {
    expect(resolveAccess({ ...active, status: "unpaid" }, at(40)).access).toBe("restricted");
  });

  it("failing the first charge after the trial follows the same grace rules", () => {
    const trial = mockStartSubscription("beginner", "month", true, T0);
    const failed = mockTransition(trial, "payment_failed", at(3));
    expect(ent(failed, at(4)).access).toBe("grace");
    expect(ent(failed, at(6.5)).access).toBe("restricted");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("access basics", () => {
  it("no subscription = no access (there is no free plan)", () => {
    expect(ent(null, T0)).toMatchObject({ access: "none", plan: null, canRead: false, canWrite: false });
    expect(ent(null, T0).limits.clips_monthly).toBe(0);
  });
  it("incomplete checkout = no access", () => {
    expect(resolveAccess({ ...mockStartSubscription("beginner", "month", false, T0), status: "incomplete" }, T0).access).toBe("none");
  });
});

describe("usage period (counters reset on the billing date)", () => {
  it("rolls monthly from the anchor and clamps short months", () => {
    const anchor = new Date("2026-01-31T10:00:00Z");
    expect(usagePeriod(anchor, new Date("2026-02-10T00:00:00Z"))).toEqual({ start: new Date("2026-01-31T10:00:00Z"), end: new Date("2026-02-28T10:00:00Z") });
    expect(usagePeriod(anchor, new Date("2026-03-01T00:00:00Z")).start).toEqual(new Date("2026-02-28T10:00:00Z"));
    expect(usagePeriod(anchor, new Date("2026-03-31T10:00:00Z")).start).toEqual(new Date("2026-03-31T10:00:00Z"));
    expect(usagePeriod(anchor, new Date("2027-01-31T09:59:59Z")).start).toEqual(new Date("2026-12-31T10:00:00Z"));
  });
  it("annual plans still get monthly counters", () => {
    const annual = mockStartSubscription("beginner", "year", false, T0);
    const p = ent(annual, at(45)).usagePeriod!;
    expect(p.end.getTime() - p.start.getTime()).toBeLessThan(32 * DAY);
  });
});

describe("limit thresholds", () => {
  it("warns at 80%, blocks at 100%, unlimited never blocks", () => {
    expect(checkLimit(180, 143)).toMatchObject({ level: "ok", allowed: true });
    expect(checkLimit(180, 144)).toMatchObject({ level: "warn", allowed: true });
    expect(checkLimit(180, 179)).toMatchObject({ level: "warn", allowed: true });
    expect(checkLimit(180, 180)).toMatchObject({ level: "full", allowed: false });
    expect(checkLimit(null, 1_000_000)).toMatchObject({ level: "ok", allowed: true });
    expect(checkLimit(0, 0)).toMatchObject({ allowed: false });
  });
});

describe("stripe normalisation", () => {
  it("reads period from items (new API) or the subscription (old API)", () => {
    expect(snap().periodEnd!.getTime()).toBe(at(30).getTime());
    const old = normalizeStripeSubscription(
      { id: "sub_o", status: "active", customer: { id: "cus_o" }, current_period_start: T0.getTime() / 1000, current_period_end: at(31).getTime() / 1000, items: { data: [{ price: { id: "price_beg" } }] }, metadata: {} },
      T0.getTime() / 1000,
    );
    expect(old.periodEnd!.getTime()).toBe(at(31).getTime());
    expect(old.customerId).toBe("cus_o");
  });
});
