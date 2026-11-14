/**
 * Usage counting. SQL takes an injected query function so it runs against the app DB and
 * against PGlite in tests. No server-only import.
 */
import type { Metric } from "@/config/plans";

export type Query = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

/**
 * Atomically add `amount` to a monthly counter if it stays within `limit` (null = unlimited).
 * Returns the new count, or null when the limit would be exceeded (nothing is changed).
 * Race-safe: the check and the increment are one statement.
 */
export async function consumeMonthly(q: Query, workspaceId: string, metric: Metric, periodStart: Date, limit: number | null, amount = 1): Promise<number | null> {
  if (limit !== null && amount > limit) return null;
  const rows = await q(
    `insert into usage_counters (workspace_id, metric, period_start, count) values ($1, $2, $3::timestamptz, $4::int)
     on conflict (workspace_id, metric, period_start) do update set count = usage_counters.count + excluded.count
       where $5::int is null or usage_counters.count + excluded.count <= $5::int
     returning count`,
    [workspaceId, metric, periodStart.toISOString(), amount, limit],
  );
  return rows.length ? Number(rows[0].count) : null;
}

/** Give a unit back when the action it was reserved for failed (e.g. Whop rejected the call). */
export async function releaseMonthly(q: Query, workspaceId: string, metric: Metric, periodStart: Date, amount = 1): Promise<void> {
  await q(
    `update usage_counters set count = greatest(count - $4::int, 0) where workspace_id = $1 and metric = $2 and period_start = $3::timestamptz`,
    [workspaceId, metric, periodStart.toISOString(), amount],
  );
}

export async function readMonthly(q: Query, workspaceId: string, periodStart: Date): Promise<Partial<Record<Metric, number>>> {
  const rows = await q(`select metric, count from usage_counters where workspace_id = $1 and period_start = $2::timestamptz`, [workspaceId, periodStart.toISOString()]);
  return Object.fromEntries(rows.map((r) => [String(r.metric), Number(r.count)]));
}

/** Live totals for non-monthly metrics. accounts_per_platform reports the highest platform. */
export async function readTotals(q: Query, workspaceId: string): Promise<{ saved_channels: number; notes: number; seats: number; accounts: Record<string, number> }> {
  const [r] = await q(
    `select
       (select count(*)::int from saved_channels where workspace_id = $1) as saved_channels,
       (select count(*)::int from swipe_notes where user_id in (select user_id from workspace_members where workspace_id = $1)) as notes,
       (select count(*)::int from workspace_members where workspace_id = $1) as seats`,
    [workspaceId],
  );
  const acc = await q(`select platform::text as platform, count(*)::int as n from social_accounts where workspace_id = $1 group by platform`, [workspaceId]);
  return {
    saved_channels: Number(r?.saved_channels ?? 0),
    notes: Number(r?.notes ?? 0),
    seats: Number(r?.seats ?? 0),
    accounts: Object.fromEntries(acc.map((a) => [String(a.platform), Number(a.n)])),
  };
}
