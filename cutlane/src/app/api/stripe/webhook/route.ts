import { NextResponse, type NextRequest } from "next/server";
import Stripe from "stripe";
import { env } from "@/lib/env";
import { handleStripeEvent } from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Stripe webhook. Verifies the signature against the raw body, then applies the event. */
export async function POST(req: NextRequest) {
  if (!env.stripe.webhookSecret) return NextResponse.json({ error: "Webhooks not configured" }, { status: 503 });
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  const body = await req.text();

  let event: Stripe.Event;
  try {
    // Signature verification needs no API key; the secret key is only used for API calls.
    event = Stripe.webhooks.constructEvent(body, sig, env.stripe.webhookSecret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    const result = await handleStripeEvent(event);
    return NextResponse.json({ received: true, result });
  } catch (err) {
    console.error(`[cutlane] Stripe webhook ${event.type} (${event.id}) failed:`, (err as Error).message);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
