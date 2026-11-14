/**
 * CutLane plan catalog: the single source of truth for prices, limits and features.
 * Pure data (no env, no server imports) so the pricing page, the entitlements helper
 * and the tests all read the same numbers. Stripe price IDs live in env (lib/env.ts).
 *
 * null limit = unlimited.
 */

export type PlanId = "beginner" | "clipper" | "custom";

export type Metric =
  | "saved_channels"
  | "clips_monthly"
  | "submissions_monthly"
  | "notes"
  | "accounts_per_platform"
  | "seats"
  | "render_minutes_monthly"
  | "ai_cuts_monthly";

export type Feature =
  | "campaigns"
  | "youtube_research"
  | "clip_import"
  | "manual_posting"
  | "whop_submit"
  | "editor"
  | "ai_cuts"
  | "captions"
  | "auto_post"
  | "saved_projects";

export type Limits = Record<Metric, number | null>;

/** Counters that reset every month on the billing date. Others are totals (counted live). */
export const MONTHLY_METRICS: Metric[] = ["clips_monthly", "submissions_monthly", "render_minutes_monthly", "ai_cuts_monthly"];

/** V2 features: part of Clipper/Custom, but not usable until the editor + auto-post ship. */
export const V2_FEATURES: Feature[] = ["editor", "ai_cuts", "captions", "auto_post", "saved_projects"];

const CORE_FEATURES: Feature[] = ["campaigns", "youtube_research", "clip_import", "manual_posting", "whop_submit"];

/** Monthly caps for Clipper's V2 features. Change them here. */
export const CLIPPER_CAPS = {
  render_minutes_monthly: 600,
  ai_cuts_monthly: 300,
};

export interface PlanDef {
  id: PlanId;
  name: string;
  tagline: string;
  /** USD per month; null = custom pricing. */
  monthlyPrice: number | null;
  /** USD per year when annual billing is enabled (2 months free = 10× monthly). */
  annualPrice: number | null;
  trialDays: number;
  selfServe: boolean;
  limits: Limits;
  features: Feature[];
}

export const PLANS: Record<PlanId, PlanDef> = {
  beginner: {
    id: "beginner",
    name: "Beginner",
    tagline: "Everything you need to research, post and submit clips by hand.",
    monthlyPrice: 29,
    annualPrice: 290,
    trialDays: 3,
    selfServe: true,
    limits: {
      saved_channels: 10,
      clips_monthly: 180,
      submissions_monthly: 180,
      notes: 100,
      accounts_per_platform: 1,
      seats: 1,
      render_minutes_monthly: 0,
      ai_cuts_monthly: 0,
    },
    features: CORE_FEATURES,
  },
  clipper: {
    id: "clipper",
    name: "Clipper",
    tagline: "Higher limits plus the full editor, AI cuts, captions and auto-post.",
    monthlyPrice: 79,
    annualPrice: 790,
    trialDays: 0,
    selfServe: true,
    limits: {
      saved_channels: 50,
      clips_monthly: 600,
      submissions_monthly: 600,
      notes: null,
      accounts_per_platform: 3,
      seats: 1,
      ...CLIPPER_CAPS,
    },
    features: [...CORE_FEATURES, ...V2_FEATURES],
  },
  custom: {
    id: "custom",
    name: "Custom",
    tagline: "For teams and agencies: custom limits, seats and pricing.",
    monthlyPrice: null,
    annualPrice: null,
    trialDays: 0,
    selfServe: false,
    // Defaults; an admin overrides any of these per workspace.
    limits: {
      saved_channels: 50,
      clips_monthly: 600,
      submissions_monthly: 600,
      notes: null,
      accounts_per_platform: 3,
      seats: 1,
      ...CLIPPER_CAPS,
    },
    features: [...CORE_FEATURES, ...V2_FEATURES],
  },
};

export const METRIC_LABELS: Record<Metric, { label: string; unit?: string; monthly: boolean }> = {
  saved_channels: { label: "Saved YouTube channels", monthly: false },
  clips_monthly: { label: "Clip uploads this month", monthly: true },
  submissions_monthly: { label: "Whop submissions this month", monthly: true },
  notes: { label: "Swipe-file notes", monthly: false },
  accounts_per_platform: { label: "Accounts per platform", monthly: false },
  seats: { label: "Seats", monthly: false },
  render_minutes_monthly: { label: "Render minutes this month", unit: "min", monthly: true },
  ai_cuts_monthly: { label: "AI cuts this month", monthly: true },
};

export const FEATURE_LABELS: Record<Feature, string> = {
  campaigns: "Whop campaign browser",
  youtube_research: "YouTube channel & hook research",
  clip_import: "Import finished clips",
  manual_posting: "Manual posting with link capture",
  whop_submit: "Submit to Whop + status tracking",
  editor: "Full video editor",
  ai_cuts: "AI clip cuts (4–20 s)",
  captions: "AI captions",
  auto_post: "Auto-post to IG, TikTok, Shorts",
  saved_projects: "Saved editor projects",
};

export const GRACE_DAYS = 3;
