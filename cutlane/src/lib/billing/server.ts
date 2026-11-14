import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { MONTHLY_METRICS, PLANS, type Feature, type Metric } from "@/config/plans";
import { env, modes } from "../env";
import { one, q } from "../db";
import { getCurrentUser, type User } from "../auth/session";
import {
  AccessBlockedError,
  FeatureUnavailableError,
  LimitReachedError,
  checkLimit,
  getEntitlements,
  type Entitlements,
  type WorkspaceOverrides,
} from "./entitlements";
import type { SubscriptionRow } from "./subscription-core";
import { consumeMonthly, readMonthly, readTotals, releaseMonthly } from "./usage-core";

/**
 * Server wrapper around the pure entitlements helper. Every page, server action and API
 * route goes through getBilling() / assertCanWrite() / consume() / assertTotalLimit().
 */

export interface Workspace {
  id: string;
  name: string;
  owner_user_id: string;
  stripe_customer_id: string | null;
  custom_limits: Partial<Record<Metric, number | null>>;
  seats: number | null;
  trial_consumed_at: Date | null;
}

const WS_COLS = `w.id, w.name, w.owner_user_id, w.stripe_customer_id, w.custom_limits, w.seats, w.trial_consumed_at`;

/** The user's workspace, created on first use (one per user; the owner holds the subscription). */
export async function ensureWorkspace(user: Pick<User, "id" | "name" | "username">): Promise<Workspace> {
  const find = () =>
    one<Workspace>(`select ${WS_COLS} from workspaces w join workspace_members m on m.workspace_id = w.id where m.user_id = $1`, [user.id]);
  const existing = await find();
  if (existing) return existing;
  // Single statement; unique(user_id) on members makes concurrent first requests safe.
  await q(
    `with ins as (insert into workspaces (owner_user_id, name) values ($1, $2) returning id)
     insert into workspace_members (workspace_id, user_id, role) select id, $1, 'owner' from ins on conflict do nothing`,
    [user.id, user.name ?? user.username ?? "My workspace"],
  );
  // A losing concurrent insert leaves an orphan workspace with no members; clean it up.
  await q(`delete from workspaces w where w.owner_user_id = $1 and not exists (select 1 from workspace_members m where m.workspace_id = w.id)`, [user.id]);
  const created = await find();
  if (!created) throw new Error("Could not create workspace");
  return created;
}

const d = (x: unknown) => (x ? new Date(x as string) : null);

export async function loadSubscription(workspaceId: string): Promise<SubscriptionRow | null> {
  const r = await one<Record<string, unknown>>(`select * from subscriptions where workspace_id = $1`, [workspaceId]);
  if (!r) return null;
  return {
    plan: r.plan as SubscriptionRow["plan"],
    status: String(r.status),
    source: r.source as SubscriptionRow["source"],
    interval: r.billing_interval as SubscriptionRow["interval"],
    stripeSubscriptionId: (r.stripe_subscription_id as string) ?? null,
    stripePriceId: (r.stripe_price_id as string) ?? null,
    trialStart: d(r.trial_start),
    trialEnd: d(r.trial_end),
    currentPeriodStart: d(r.current_period_start),
    currentPeriodEnd: d(r.current_period_end),
    billingAnchor: d(r.billing_anchor)!,
    cancelAtPeriodEnd: Boolean(r.cancel_at_period_end),
    canceledAt: d(r.canceled_at),
    pastDueSince: d(r.past_due_since),
    lastEventAt: d(r.last_event_at),
  };
}

const iso = (x: Date | null) => (x ? x.toISOString() : null);

export async function saveSubscription(workspaceId: string, s: SubscriptionRow): Promise<void> {
  await q(
    `insert into subscriptions (workspace_id, plan, status, source, billing_interval, stripe_subscription_id, stripe_price_id, trial_start, trial_end,
        current_period_start, current_period_end, billing_anchor, cancel_at_period_end, canceled_at, past_due_since, last_event_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz,$10::timestamptz,$11::timestamptz,$12::timestamptz,$13,$14::timestamptz,$15::timestamptz,$16::timestamptz, now())
     on conflict (workspace_id) do update set plan = excluded.plan, status = excluded.status, source = excluded.source,
        billing_interval = excluded.billing_interval, stripe_subscription_id = excluded.stripe_subscription_id, stripe_price_id = excluded.stripe_price_id,
        trial_start = excluded.trial_start, trial_end = excluded.trial_end, current_period_start = excluded.current_period_start,
        current_period_end = excluded.current_period_end, billing_anchor = excluded.billing_anchor, cancel_at_period_end = excluded.cancel_at_period_end,
        canceled_at = excluded.canceled_at, past_due_since = excluded.past_due_since, last_event_at = excluded.last_event_at, updated_at = now()`,
    [
      workspaceId, s.plan, s.status, s.source, s.interval, s.stripeSubscriptionId, s.stripePriceId, iso(s.trialStart), iso(s.trialEnd),
      iso(s.currentPeriodStart), iso(s.currentPeriodEnd), s.billingAnchor.toISOString(), s.cancelAtPeriodEnd, iso(s.canceledAt), iso(s.pastDueSince), iso(s.lastEventAt),
    ],
  );
}

/** One trial per account: mark both the workspace and its owner. */
export async function markTrialConsumed(workspaceId: string): Promise<void> {
  await q(`update workspaces set trial_consumed_at = coalesce(trial_consumed_at, now()) where id = $1`, [workspaceId]);
  await q(`update users set trial_consumed_at = coalesce(trial_consumed_at, now()) where id = (select owner_user_id from workspaces where id = $1)`, [workspaceId]);
}

export async function trialEligible(user: { id: string }, ws: Workspace): Promise<boolean> {
  if (ws.trial_consumed_at) return false;
  const u = await one<{ trial_consumed_at: Date | null }>(`select trial_consumed_at from users where id = $1`, [user.id]);
  return !u?.trial_consumed_at;
}

export function overridesOf(ws: Workspace): WorkspaceOverrides {
  return { customLimits: ws.custom_limits ?? {}, seats: ws.seats };
}

export function isAdmin(user: User): boolean {
  if (env.adminWhopUserIds.includes(user.whop_user_id)) return true;
  // In demo mode (Whop not configured) the demo account can open /admin for review.
  return !modes.whop && user.is_demo;
}

export interface Billing {
  user: User;
  workspace: Workspace;
  subscription: SubscriptionRow | null;
  ent: Entitlements;
}

/** Memoised per request. */
export const getBillingFor = cache(async (userId: string): Promise<Billing> => {
  const user = await getCurrentUser();
  if (!user || user.id !== userId) throw new Error("Not signed in");
  const workspace = await ensureWorkspace(user);
  const subscription = await loadSubscription(workspace.id);
  const ent = getEntitlements(subscription, overridesOf(workspace), new Date(), { v2Released: env.flags.clipperAvailable });
  return { user, workspace, subscription, ent };
});

export async function getBilling(): Promise<Billing> {
  const user = await getCurrentUser();
  if (!user) redirect("/?signin=1");
  return getBillingFor(user.id);
}

/**
 * Page gate. "write" pages (campaigns, research, import) need full/grace access.
 * "read" pages (library, swipe file, submissions) stay open while restricted so data is never
 * locked away. No plan at all → pricing.
 */
export async function requirePageAccess(level: "read" | "write"): Promise<Billing> {
  const b = await getBilling();
  if (b.ent.access === "none") redirect("/pricing?required=1");
  if (level === "write" && !b.ent.canWrite) redirect(`/billing?blocked=${b.ent.reason}`);
  return b;
}

export async function assertCanWrite(feature?: Feature): Promise<Billing> {
  const b = await getBilling();
  if (!b.ent.canWrite) throw new AccessBlockedError(b.ent.reason);
  if (feature && !b.ent.features.includes(feature)) throw new FeatureUnavailableError(feature);
  return b;
}

/** Reserve one unit of a monthly metric. Call release() if the action then fails. */
export async function consume(metric: Metric, amount = 1): Promise<{ release: () => Promise<void> }> {
  if (!MONTHLY_METRICS.includes(metric)) throw new Error(`${metric} is not a monthly metric`);
  const b = await assertCanWrite();
  const period = b.ent.usagePeriod!;
  const limit = b.ent.limits[metric];
  const n = await consumeMonthly(q, b.workspace.id, metric, period.start, limit, amount);
  if (n === null) {
    const used = (await readMonthly(q, b.workspace.id, period.start))[metric] ?? 0;
    throw new LimitReachedError(metric, limit ?? 0, used);
  }
  return { release: () => releaseMonthly(q, b.workspace.id, metric, period.start, amount) };
}

/** Pre-check a monthly metric without consuming (e.g. before a big upload). */
export async function assertMonthlyHeadroom(metric: Metric, amount = 1): Promise<void> {
  const b = await assertCanWrite();
  const used = (await readMonthly(q, b.workspace.id, b.ent.usagePeriod!.start))[metric] ?? 0;
  const limit = b.ent.limits[metric];
  if (!checkLimit(limit, used, amount).allowed) throw new LimitReachedError(metric, limit ?? 0, used);
}

/** Check a total (non-monthly) limit before creating one more. Existing data is never removed. */
export async function assertTotalLimit(metric: "saved_channels" | "notes" | "accounts_per_platform" | "seats", platform?: string): Promise<Billing> {
  const b = await assertCanWrite();
  const totals = await readTotals(q, b.workspace.id);
  const used = metric === "accounts_per_platform" ? (totals.accounts[platform ?? ""] ?? 0) : totals[metric];
  const limit = b.ent.limits[metric];
  if (!checkLimit(limit, used).allowed) throw new LimitReachedError(metric, limit ?? 0, used);
  return b;
}

export interface Meter {
  metric: Metric;
  used: number;
  limit: number | null;
  level: "ok" | "warn" | "full";
  pct: number;
  detail?: string;
}

export async function usageMeters(b: Billing): Promise<Meter[]> {
  if (!b.ent.plan) return [];
  const monthly = b.ent.usagePeriod ? await readMonthly(q, b.workspace.id, b.ent.usagePeriod.start) : {};
  const totals = await readTotals(q, b.workspace.id);
  const worstPlatform = Object.entries(totals.accounts).sort((a, c) => c[1] - a[1])[0];
  const used: Record<Metric, number> = {
    saved_channels: totals.saved_channels,
    clips_monthly: monthly.clips_monthly ?? 0,
    submissions_monthly: monthly.submissions_monthly ?? 0,
    notes: totals.notes,
    accounts_per_platform: worstPlatform?.[1] ?? 0,
    seats: totals.seats,
    render_minutes_monthly: monthly.render_minutes_monthly ?? 0,
    ai_cuts_monthly: monthly.ai_cuts_monthly ?? 0,
  };
  const show: Metric[] = ["clips_monthly", "submissions_monthly", "saved_channels", "notes", "accounts_per_platform", "seats"];
  if (b.ent.features.includes("editor")) show.push("render_minutes_monthly", "ai_cuts_monthly");
  return show.map((metric) => {
    const limit = b.ent.limits[metric];
    const c = checkLimit(limit, used[metric], 0);
    return {
      metric,
      used: used[metric],
      limit,
      level: c.level,
      pct: c.pct,
      detail: metric === "accounts_per_platform" && worstPlatform ? `Most used: ${worstPlatform[0].replace("_", " ")}` : undefined,
    };
  });
}

export function planName(b: Billing): string {
  return b.ent.plan ? PLANS[b.ent.plan].name : "No plan";
}
