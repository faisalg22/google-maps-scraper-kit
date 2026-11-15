"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PLANS, type Metric } from "@/config/plans";
import { getCurrentUser, requireUser } from "@/lib/auth/session";
import { one, q } from "@/lib/db";
import { demoAllowed, env, modes } from "@/lib/env";
import { sha256 } from "@/lib/crypto";
import { salesInbox, sendEmail } from "@/lib/email";
import { toActionState, type ActionState } from "@/lib/action-errors";
import {
  assertTotalLimit,
  ensureWorkspace,
  getBilling,
  isAdmin,
  loadSubscription,
  markTrialConsumed,
  saveSubscription,
  trialEligible,
} from "@/lib/billing/server";
import { annualAvailable, createCheckoutSession, createPortalSession } from "@/lib/billing/stripe";
import { mockStartSubscription, mockTransition, type MockEvent, type SubscriptionRow } from "@/lib/billing/subscription-core";
import { PLATFORMS } from "@/lib/whop/campaigns-core";

// ── Checkout / portal ─────────────────────────────────────────────────────────

const checkoutReq = z.object({ plan: z.enum(["beginner", "clipper"]), interval: z.enum(["month", "year"]) });

export async function startCheckout(form: FormData) {
  const user = await getCurrentUser();
  const plan = String(form.get("plan") ?? "beginner");
  const interval = String(form.get("interval") ?? "month");
  if (!user) redirect(`/?signin=1&returnTo=${encodeURIComponent(`/pricing?start=${plan}&interval=${interval}`)}`);

  const d = checkoutReq.parse({ plan, interval });
  if (d.plan === "clipper" && !env.flags.clipperAvailable) redirect("/pricing?clipper=soon");
  if (d.interval === "year" && !annualAvailable()) redirect("/pricing");

  const ws = await ensureWorkspace(user);
  const current = await loadSubscription(ws.id);
  if (current && !["canceled", "incomplete_expired", "incomplete"].includes(current.status)) redirect("/billing?already=1");

  const withTrial = PLANS[d.plan].trialDays > 0 && (await trialEligible(user, ws));

  if (!modes.stripe) {
    if (!demoAllowed()) redirect("/pricing?checkout=unavailable");
    redirect(`/billing/mock-checkout?plan=${d.plan}&interval=${d.interval}&trial=${withTrial ? 1 : 0}`);
  }
  const url = await createCheckoutSession({ ws, email: user.email, plan: d.plan, interval: d.interval, withTrial });
  redirect(url);
}

export async function openPortal() {
  const b = await getBilling();
  if (!modes.stripe || b.subscription?.source !== "stripe") redirect("/billing");
  redirect(await createPortalSession(b.workspace));
}

// ── Test mode (no Stripe keys) ──────────────────────────────────────────────

function assertTestMode() {
  if (modes.stripe) throw new Error("Test-mode billing controls are disabled when Stripe is live.");
  if (!demoAllowed()) throw new Error("Test-mode billing is disabled in production.");
}

export async function mockCompleteCheckout(form: FormData) {
  assertTestMode();
  const user = await requireUser();
  const d = checkoutReq.parse({ plan: form.get("plan"), interval: form.get("interval") });
  if (d.plan === "clipper" && !env.flags.clipperAvailable) redirect("/pricing?clipper=soon");
  const ws = await ensureWorkspace(user);
  const current = await loadSubscription(ws.id);
  if (current && !["canceled", "incomplete_expired"].includes(current.status)) redirect("/billing?already=1");
  // Trial eligibility is re-checked server-side (never trust the query string).
  const withTrial = PLANS[d.plan].trialDays > 0 && (await trialEligible(user, ws));
  await saveSubscription(ws.id, mockStartSubscription(d.plan, d.interval, withTrial, new Date()));
  if (withTrial) await markTrialConsumed(ws.id);
  redirect("/billing?checkout=success");
}

const MOCK_EVENTS: MockEvent[] = [
  "trial_converts",
  "payment_failed",
  "grace_expires",
  "payment_recovered",
  "cancel_at_period_end",
  "resume",
  "period_ends",
  "cancel_now",
  "change_plan_clipper",
  "change_plan_beginner",
];

export async function mockSimulate(event: MockEvent) {
  assertTestMode();
  if (!MOCK_EVENTS.includes(event)) throw new Error("Unknown event");
  const b = await getBilling();
  if (!b.subscription || b.subscription.source !== "mock") return;
  if (event === "change_plan_clipper" && !env.flags.clipperAvailable) return;
  await saveSubscription(b.workspace.id, mockTransition(b.subscription, event, new Date()));
  revalidatePath("/", "layout");
}

// ── Contact sales (public) ───────────────────────────────────────────────────

const leadReq = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(120),
  email: z.string().trim().email("Enter a valid email.").max(200),
  teamSize: z.enum(["1", "2-5", "6-20", "21-50", "50+"], { message: "Choose a team size." }),
  accountsNeeded: z.string().trim().min(1, "How many accounts do you need?").max(200),
  message: z.string().trim().max(2000).optional(),
});

export async function submitSalesLead(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    // Honeypot: real users never fill this hidden field.
    if (String(form.get("company_website") ?? "")) return { ok: true, message: "Thanks! We'll be in touch." };
    const d = leadReq.parse({
      name: form.get("name"),
      email: form.get("email"),
      teamSize: form.get("teamSize"),
      accountsNeeded: form.get("accountsNeeded"),
      message: (form.get("message") as string) || undefined,
    });
    const h = await headers();
    const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
    const ipHash = sha256(`lead:${ip}`);
    const recent = await one<{ n: number }>(`select count(*)::int as n from sales_leads where ip_hash = $1 and created_at > now() - interval '1 hour'`, [ipHash]);
    if ((recent?.n ?? 0) >= 5) return { error: "Too many requests. Please try again later." };

    const user = await getCurrentUser();
    const lead = await one<{ id: string }>(
      `insert into sales_leads (name, email, team_size, accounts_needed, message, user_id, ip_hash) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [d.name, d.email, d.teamSize, d.accountsNeeded, d.message ?? null, user?.id ?? null, ipHash],
    );
    const inbox = salesInbox();
    const status = inbox
      ? await sendEmail({
          to: inbox,
          replyTo: d.email,
          subject: `CutLane Custom plan inquiry: ${d.name} (${d.teamSize})`,
          text: `Name: ${d.name}\nEmail: ${d.email}\nTeam size: ${d.teamSize}\nAccounts needed: ${d.accountsNeeded}\n\n${d.message ?? ""}\n\nLead ID: ${lead!.id}`,
        })
      : "skipped";
    await q(`update sales_leads set email_status = $2 where id = $1`, [lead!.id, status]);
    if (status !== "sent") console.log(`[cutlane] Sales lead ${lead!.id} saved; email ${status}${inbox ? "" : " (RESEND_API_KEY / SALES_NOTIFY_EMAIL not set)"}.`);
    return { ok: true, message: "Thanks! We'll get back to you within one business day." };
  } catch (err) {
    return toActionState(err);
  }
}

// ── Clipper waitlist (public) ────────────────────────────────────────────────

export async function joinWaitlist(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await getCurrentUser();
    const email = z.string().trim().email("Enter a valid email.").max(200).parse(form.get("email") || user?.email || "");
    await q(`insert into waitlist (plan, email, user_id) values ('clipper', lower($1), $2) on conflict (plan, email) do nothing`, [email, user?.id ?? null]);
    return { ok: true, message: "You're on the Clipper waitlist. We'll email you when it launches." };
  } catch (err) {
    return toActionState(err);
  }
}

// ── Admin: Custom plans ──────────────────────────────────────────────────────

const limitField = z.preprocess((x) => (x === "" || x === null || x === undefined ? null : Number(x)), z.number().int().min(0).max(1_000_000).nullable());

export async function adminSetCustomPlan(workspaceId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    if (!isAdmin(user)) return { error: "Admins only." };
    const metrics: Metric[] = ["saved_channels", "clips_monthly", "submissions_monthly", "notes", "accounts_per_platform", "render_minutes_monthly", "ai_cuts_monthly"];
    const custom: Partial<Record<Metric, number | null>> = {};
    for (const m of metrics) custom[m] = limitField.parse(form.get(m));
    const seats = z.coerce.number().int().min(1).max(1000).parse(form.get("seats"));
    const endsRaw = String(form.get("ends_at") ?? "");
    const endsAt = endsRaw ? new Date(`${endsRaw}T23:59:59Z`) : null;
    if (endsAt && Number.isNaN(endsAt.getTime())) return { error: "Invalid end date." };

    const ws = await one<{ id: string }>(`update workspaces set custom_limits = $2::jsonb, seats = $3 where id = $1 returning id`, [workspaceId, JSON.stringify(custom), seats]);
    if (!ws) return { error: "Workspace not found." };

    const prev = await loadSubscription(workspaceId);
    if (prev?.source === "stripe" && !["canceled", "incomplete_expired"].includes(prev.status)) {
      return { error: "This workspace has an active Stripe subscription. Cancel it in Stripe before assigning a Custom plan." };
    }
    const now = new Date();
    const row: SubscriptionRow = {
      plan: "custom",
      status: "active",
      source: "manual",
      interval: "month",
      stripeSubscriptionId: null,
      stripePriceId: null,
      trialStart: null,
      trialEnd: null,
      currentPeriodStart: prev?.source === "manual" ? prev.currentPeriodStart : now,
      currentPeriodEnd: endsAt,
      billingAnchor: prev?.source === "manual" ? prev.billingAnchor : now,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      pastDueSince: null,
      lastEventAt: now,
    };
    await saveSubscription(workspaceId, row);
    revalidatePath("/admin");
    return { ok: true, message: "Custom plan saved." };
  } catch (err) {
    return toActionState(err);
  }
}

export async function adminEndCustomPlan(workspaceId: string) {
  const user = await requireUser();
  if (!isAdmin(user)) throw new Error("Admins only.");
  const prev = await loadSubscription(workspaceId);
  if (prev?.source !== "manual") return;
  await saveSubscription(workspaceId, { ...prev, status: "canceled", canceledAt: new Date(), currentPeriodEnd: new Date() });
  revalidatePath("/admin");
}

// ── Saved YouTube channels (limit: saved_channels) ───────────────────────────

const channelReq = z.object({
  channelId: z.string().min(1).max(64),
  title: z.string().min(1).max(300),
  thumbnail: z.string().url().max(500).nullable(),
  subscribers: z.number().int().min(0),
});

export async function saveChannel(input: z.infer<typeof channelReq>): Promise<ActionState> {
  try {
    const d = channelReq.parse(input);
    const b = await assertTotalLimit("saved_channels");
    await q(
      `insert into saved_channels (workspace_id, user_id, channel_id, title, thumbnail, subscribers) values ($1,$2,$3,$4,$5,$6)
       on conflict (workspace_id, channel_id) do nothing`,
      [b.workspace.id, b.user.id, d.channelId, d.title, d.thumbnail, d.subscribers],
    );
    revalidatePath(`/research/channel/${d.channelId}`);
    revalidatePath("/research");
    return { ok: true, message: "Channel saved." };
  } catch (err) {
    return toActionState(err);
  }
}

/** Removing is always allowed, even while restricted. */
export async function unsaveChannel(channelId: string): Promise<void> {
  const b = await getBilling();
  await q(`delete from saved_channels where workspace_id = $1 and channel_id = $2`, [b.workspace.id, channelId]);
  revalidatePath(`/research/channel/${channelId}`);
  revalidatePath("/research");
}

// ── Social accounts (limit: accounts_per_platform) ───────────────────────────

const accountReq = z.object({
  platform: z.enum(PLATFORMS),
  handle: z
    .string()
    .trim()
    .transform((h) => h.replace(/^@/, ""))
    .pipe(z.string().regex(/^[A-Za-z0-9._-]{1,60}$/, "Handles use letters, numbers, dots, dashes and underscores.")),
});

const profileUrl = (platform: string, handle: string) =>
  platform === "instagram" ? `https://www.instagram.com/${handle}/` : platform === "tiktok" ? `https://www.tiktok.com/@${handle}` : `https://www.youtube.com/@${handle}`;

export async function addSocialAccount(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const d = accountReq.parse({ platform: form.get("platform"), handle: form.get("handle") });
    const b = await assertTotalLimit("accounts_per_platform", d.platform);
    await q(
      `insert into social_accounts (workspace_id, user_id, platform, handle, profile_url) values ($1,$2,$3::post_platform,$4,$5)
       on conflict (workspace_id, platform, handle) do nothing`,
      [b.workspace.id, b.user.id, d.platform, d.handle, profileUrl(d.platform, d.handle)],
    );
    revalidatePath("/settings/accounts");
    return { ok: true, message: `Added @${d.handle}.` };
  } catch (err) {
    return toActionState(err);
  }
}

export async function removeSocialAccount(id: string): Promise<void> {
  const b = await getBilling();
  await q(`delete from social_accounts where id::text = $1 and workspace_id = $2`, [id, b.workspace.id]);
  revalidatePath("/settings/accounts");
}
