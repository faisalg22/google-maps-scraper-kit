import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Stripe from "stripe";
import { PGlite } from "@electric-sql/pglite";
import { consumeMonthly, readMonthly, readTotals, releaseMonthly, type Query } from "@/lib/billing/usage-core";
import { applySnapshot, normalizeStripeSubscription } from "@/lib/billing/subscription-core";

let pg: PGlite;
let q: Query;
let ws: string;
const P1 = new Date("2026-11-14T00:00:00Z");
const P2 = new Date("2026-12-14T00:00:00Z");

beforeAll(async () => {
  pg = new PGlite();
  const dir = path.join(__dirname, "..", "supabase", "migrations");
  for (const f of fs.readdirSync(dir).sort()) await pg.exec(fs.readFileSync(path.join(dir, f), "utf8"));
  q = async (text, params) => (await pg.query<Record<string, unknown>>(text, params as unknown[])).rows;
  const [u] = await q(`insert into users (whop_user_id) values ('user_t') returning id`);
  const [w] = await q(`insert into workspaces (name, owner_user_id) values ('T', $1) returning id`, [u.id]);
  await q(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [w.id, u.id]);
  ws = String(w.id);
}, 30_000);

describe("monthly usage counters (Postgres)", () => {
  it("allows up to the limit, then blocks without changing the count", async () => {
    for (let i = 1; i <= 3; i++) expect(await consumeMonthly(q, ws, "clips_monthly", P1, 3)).toBe(i);
    expect(await consumeMonthly(q, ws, "clips_monthly", P1, 3)).toBeNull();
    expect((await readMonthly(q, ws, P1)).clips_monthly).toBe(3);
  });

  it("resets on the next billing period (new key, old row kept)", async () => {
    expect(await consumeMonthly(q, ws, "clips_monthly", P2, 3)).toBe(1);
    expect((await readMonthly(q, ws, P1)).clips_monthly).toBe(3);
  });

  it("release gives a unit back (failed Whop submission)", async () => {
    await consumeMonthly(q, ws, "submissions_monthly", P1, 2);
    await consumeMonthly(q, ws, "submissions_monthly", P1, 2);
    expect(await consumeMonthly(q, ws, "submissions_monthly", P1, 2)).toBeNull();
    await releaseMonthly(q, ws, "submissions_monthly", P1);
    expect(await consumeMonthly(q, ws, "submissions_monthly", P1, 2)).toBe(2);
  });

  it("never exceeds the limit under concurrent requests", async () => {
    const results = await Promise.all(Array.from({ length: 25 }, () => consumeMonthly(q, ws, "ai_cuts_monthly", P1, 10)));
    expect(results.filter((r) => r !== null)).toHaveLength(10);
    expect((await readMonthly(q, ws, P1)).ai_cuts_monthly).toBe(10);
  });

  it("unlimited (null) always succeeds", async () => {
    for (let i = 0; i < 5; i++) expect(await consumeMonthly(q, ws, "render_minutes_monthly", P1, null)).not.toBeNull();
  });

  it("limit 0 blocks immediately", async () => {
    expect(await consumeMonthly(q, ws, "render_minutes_monthly", P2, 0)).toBeNull();
  });

  it("counts totals for saved channels and accounts per platform", async () => {
    const [m] = await q(`select user_id from workspace_members where workspace_id = $1`, [ws]);
    await q(`insert into saved_channels (workspace_id, user_id, channel_id, title) values ($1,$2,'UC1','A'), ($1,$2,'UC2','B')`, [ws, m.user_id]);
    await q(`insert into social_accounts (workspace_id, user_id, platform, handle) values ($1,$2,'tiktok','a'), ($1,$2,'tiktok','b'), ($1,$2,'instagram','c')`, [ws, m.user_id]);
    const t = await readTotals(q, ws);
    expect(t).toMatchObject({ saved_channels: 2, seats: 1, accounts: { tiktok: 2, instagram: 1 } });
  });
});

describe("stripe webhook signature + payload", () => {
  const secret = "whsec_test_secret";
  const sub = {
    id: "sub_w",
    object: "subscription",
    customer: "cus_w",
    status: "trialing",
    metadata: { workspace_id: "ws_w", plan: "beginner" },
    trial_start: 1763121600,
    trial_end: 1763380800,
    billing_cycle_anchor: 1763380800,
    cancel_at_period_end: false,
    items: { data: [{ price: { id: "price_beg", recurring: { interval: "month" } }, current_period_start: 1763121600, current_period_end: 1763380800 }] },
  };
  const payload = JSON.stringify({ id: "evt_1", object: "event", type: "customer.subscription.created", created: 1763121601, data: { object: sub } });

  it("accepts a correctly signed event and rejects tampering", () => {
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    const ev = Stripe.webhooks.constructEvent(payload, header, secret);
    expect(ev.type).toBe("customer.subscription.created");
    expect(() => Stripe.webhooks.constructEvent(payload.replace("trialing", "active"), header, secret)).toThrow();
    expect(() => Stripe.webhooks.constructEvent(payload, header, "whsec_wrong")).toThrow();
  });

  it("turns the event into a trialing Beginner subscription linked to its workspace", () => {
    const ev = JSON.parse(payload);
    const s = normalizeStripeSubscription(ev.data.object, ev.created);
    expect(s).toMatchObject({ workspaceId: "ws_w", customerId: "cus_w", status: "trialing", priceId: "price_beg" });
    const r = applySnapshot(null, s, { beginner: "price_beg" }, new Date(1763121601000));
    expect(r.row).toMatchObject({ plan: "beginner", status: "trialing", interval: "month" });
    expect(r.trialUsed).toBe(true);
  });
});
