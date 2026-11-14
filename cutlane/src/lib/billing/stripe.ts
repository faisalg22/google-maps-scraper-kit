import "server-only";
import Stripe from "stripe";
import type { PlanId } from "@/config/plans";
import { env, modes } from "../env";
import { one, q } from "../db";
import {
  applyPaymentFailed,
  applyPaymentSucceeded,
  applySnapshot,
  normalizeStripeSubscription,
  priceFor,
  type PriceMap,
} from "./subscription-core";
import { loadSubscription, markTrialConsumed, saveSubscription, type Workspace } from "./server";

let client: Stripe | null = null;
export function stripe(): Stripe {
  if (!env.stripe.secretKey) throw new Error("Stripe is not configured");
  client ??= new Stripe(env.stripe.secretKey, { appInfo: { name: "CutLane", url: "https://cutlane.io" }, maxNetworkRetries: 2 });
  return client;
}

export const prices = (): PriceMap => env.stripe.prices;

export function annualAvailable(): boolean {
  if (!env.flags.annualBilling) return false;
  return !modes.stripe || Boolean(env.stripe.prices.beginnerAnnual);
}

async function ensureCustomer(ws: Workspace, email: string | null): Promise<string> {
  if (ws.stripe_customer_id) return ws.stripe_customer_id;
  const c = await stripe().customers.create(
    { name: ws.name, email: email ?? undefined, metadata: { workspace_id: ws.id } },
    { idempotencyKey: `customer:${ws.id}` },
  );
  // Keep whichever customer was stored first if two requests raced.
  const row = await one<{ stripe_customer_id: string }>(
    `update workspaces set stripe_customer_id = coalesce(stripe_customer_id, $2) where id = $1 returning stripe_customer_id`,
    [ws.id, c.id],
  );
  return row!.stripe_customer_id;
}

export async function createCheckoutSession(opts: {
  ws: Workspace;
  email: string | null;
  plan: PlanId;
  interval: "month" | "year";
  withTrial: boolean;
}): Promise<string> {
  const price = priceFor(opts.plan, opts.interval, prices());
  if (!price) throw new Error("This plan isn't available for checkout.");
  const customer = await ensureCustomer(opts.ws, opts.email);
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: opts.ws.id,
    line_items: [{ price, quantity: 1 }],
    // Card required up front, even for the trial.
    payment_method_collection: "always",
    subscription_data: {
      metadata: { workspace_id: opts.ws.id, plan: opts.plan },
      ...(opts.withTrial
        ? { trial_period_days: 3, trial_settings: { end_behavior: { missing_payment_method: "cancel" } } }
        : {}),
    },
    metadata: { workspace_id: opts.ws.id, plan: opts.plan },
    allow_promotion_codes: true,
    success_url: `${env.appUrl}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.appUrl}/pricing?checkout=canceled`,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL.");
  return session.url;
}

export async function createPortalSession(ws: Workspace): Promise<string> {
  if (!ws.stripe_customer_id) throw new Error("No Stripe customer for this workspace yet.");
  const s = await stripe().billingPortal.sessions.create({ customer: ws.stripe_customer_id, return_url: `${env.appUrl}/billing` });
  return s.url;
}

async function workspaceForStripe(customerId: string | null, metadataWorkspaceId: string | null): Promise<string | null> {
  if (metadataWorkspaceId) {
    const r = await one<{ id: string }>(`select id from workspaces where id::text = $1`, [metadataWorkspaceId]);
    if (r) return r.id;
  }
  if (customerId) {
    const r = await one<{ id: string }>(`select id from workspaces where stripe_customer_id = $1`, [customerId]);
    if (r) return r.id;
  }
  return null;
}

/** Apply a Stripe Subscription object to its workspace (shared by webhooks and the post-checkout sync). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function syncSubscriptionObject(sub: any, eventCreated: number): Promise<"applied" | "ignored" | "unknown_workspace"> {
  const snap = normalizeStripeSubscription(sub, eventCreated);
  const wsId = await workspaceForStripe(snap.customerId, snap.workspaceId);
  if (!wsId) return "unknown_workspace";
  if (snap.customerId) await q(`update workspaces set stripe_customer_id = coalesce(stripe_customer_id, $2) where id = $1`, [wsId, snap.customerId]);
  const prev = await loadSubscription(wsId);
  const res = applySnapshot(prev, snap, prices(), new Date());
  if (res.ignored || !res.row) return "ignored";
  await saveSubscription(wsId, res.row);
  if (res.trialUsed) await markTrialConsumed(wsId);
  return "applied";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function invoiceSubscriptionId(inv: any): string | null {
  const s = inv.parent?.subscription_details?.subscription ?? inv.subscription ?? null;
  return typeof s === "string" ? s : (s?.id ?? null);
}

/**
 * Webhook entry point (signature already verified). Idempotent per event id.
 * Handles: checkout.session.completed, customer.subscription.created/updated/deleted
 * (incl. trial_will_end), invoice.payment_failed, invoice.paid.
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<string> {
  const fresh = await q(`insert into stripe_events (id, type) values ($1, $2) on conflict (id) do nothing returning id`, [event.id, event.type]);
  if (!fresh.length) return "duplicate";

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.paused":
      case "customer.subscription.resumed":
        return await syncSubscriptionObject(event.data.object, event.created);

      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.mode !== "subscription" || !s.subscription) return "ignored";
        const wsId = s.client_reference_id;
        if (wsId && typeof s.customer === "string") {
          await q(`update workspaces set stripe_customer_id = coalesce(stripe_customer_id, $2) where id::text = $1`, [wsId, s.customer]);
        }
        const sub = typeof s.subscription === "string" ? await stripe().subscriptions.retrieve(s.subscription) : s.subscription;
        return await syncSubscriptionObject(sub, event.created);
      }

      case "invoice.payment_failed":
      case "invoice.paid": {
        const inv = event.data.object;
        const subId = invoiceSubscriptionId(inv);
        if (!subId) return "ignored";
        const r = await one<{ workspace_id: string }>(`select workspace_id from subscriptions where stripe_subscription_id = $1`, [subId]);
        if (!r) return "unknown_workspace";
        const prev = await loadSubscription(r.workspace_id);
        const next = event.type === "invoice.payment_failed" ? applyPaymentFailed(prev, new Date(event.created * 1000)) : applyPaymentSucceeded(prev);
        if (next) await saveSubscription(r.workspace_id, next);
        return "applied";
      }
      default:
        return "ignored";
    }
  } catch (err) {
    // Let Stripe retry: forget the event id so the retry isn't treated as a duplicate.
    await q(`delete from stripe_events where id = $1`, [event.id]);
    throw err;
  }
}

/** After Checkout redirects back: apply the subscription right away instead of waiting for the webhook. */
export async function syncFromCheckoutSession(sessionId: string, workspaceId: string): Promise<void> {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return;
  const s = await stripe().checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
  if (s.client_reference_id !== workspaceId || !s.subscription || typeof s.subscription === "string") return;
  await syncSubscriptionObject(s.subscription, Math.floor(Date.now() / 1000));
}
