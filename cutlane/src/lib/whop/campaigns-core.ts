/**
 * Campaign model + normaliser. Pure (no server imports) so it is unit-testable.
 *
 * Fields come in two groups:
 *  - CONFIRMED: documented on GET /bounties (docs.whop.com/api-reference/bounties/list-bounties).
 *  - UNVERIFIED: wanted on the card (per-1k-views rate, min/max payout, flat bonus, platforms,
 *    brand category) but NOT in Whop's docs. We never guess keys for these. They stay hidden
 *    for live data until someone inspects the logged raw response (/status) and fills in the
 *    exact key path in UNVERIFIED_FIELD_PATHS below.
 */

export const GOAL_TYPES = [
  "clipping",
  "post_engagement",
  "owned_account_growth",
  "ugc_content",
  "local_activation",
  "data_capture",
  "other",
] as const;
export type GoalType = (typeof GOAL_TYPES)[number];

export const STATUSES = ["open", "closed", "completed", "canceled", "scheduled"] as const;
export type CampaignStatus = (typeof STATUSES)[number];

export const PLATFORMS = ["instagram", "tiktok", "youtube_shorts"] as const;
export type Platform = (typeof PLATFORMS)[number];

export interface Campaign {
  id: string;
  isDemo: boolean;
  // confirmed
  title: string;
  description: string;
  goalType: GoalType | null;
  status: CampaignStatus | string;
  currency: string;
  rewardPerAccepted: number | null; // gross_reward_amount
  netRewardPerAccepted: number | null; // net_reward_amount
  budget: number | null; // budget_amount
  spotsRemaining: number | null;
  brand: { name: string; logoUrl: string | null; route: string | null } | null;
  countries: string[]; // empty = worldwide
  deliverableTypes: string[]; // accepted_deliverable_types
  createdAt: string | null;
  // unverified (present only when the source really has them)
  rewardPer1kViews?: number;
  minPayout?: number;
  maxPayout?: number;
  flatFeeBonus?: number;
  platforms?: Platform[];
  brandCategory?: string;
  // derived
  contentLinks: string[]; // URLs found in the description ("Available content" is often linked there)
  whopUrl: string | null;
}

/**
 * Fill these in ONLY after confirming the key in a real response (see /status → "Raw Whop sample").
 * Each entry is a list of dot-paths tried in order, e.g. ["cpm_amount"] or ["rates.per_1k_views"].
 */
export const UNVERIFIED_FIELD_PATHS: Record<
  "rewardPer1kViews" | "minPayout" | "maxPayout" | "flatFeeBonus" | "platforms" | "brandCategory",
  string[]
> = {
  rewardPer1kViews: [],
  minPayout: [],
  maxPayout: [],
  flatFeeBonus: [],
  platforms: [],
  brandCategory: [],
};

function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), obj);
}

function firstDefined(obj: unknown, paths: string[]): unknown {
  for (const p of paths) {
    const val = get(obj, p);
    if (val !== undefined && val !== null && val !== "") return val;
  }
  return undefined;
}

const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : typeof x === "string" && x.trim() !== "" && Number.isFinite(Number(x)) ? Number(x) : null);
const str = (x: unknown): string | null => (typeof x === "string" ? x : null);

export function extractUrls(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
  const cleaned = found.map((u) => u.replace(/[.,;:!?]+$/, ""));
  return Array.from(new Set(cleaned)).filter((u) => {
    try {
      const p = new URL(u);
      return p.protocol === "https:" || p.protocol === "http:";
    } catch {
      return false;
    }
  });
}

function normalisePlatform(x: unknown): Platform | null {
  const s = String(x).toLowerCase().replace(/[\s-]/g, "_");
  if (s.includes("insta")) return "instagram";
  if (s.includes("tiktok")) return "tiktok";
  if (s.includes("youtube") || s.includes("shorts")) return "youtube_shorts";
  return null;
}

/** Normalise one raw Whop bounty object. Never invents values. */
export function normaliseBounty(raw: Record<string, unknown>): Campaign {
  const hosting = raw.hosting_account as Record<string, unknown> | null | undefined;
  const description = str(raw.description) ?? "";
  const route = hosting ? str(hosting.route) : null;
  const goal = str(raw.business_goal_type);

  const c: Campaign = {
    id: String(raw.id),
    isDemo: false,
    title: str(raw.title) ?? "Untitled campaign",
    description,
    goalType: goal && (GOAL_TYPES as readonly string[]).includes(goal) ? (goal as GoalType) : null,
    status: str(raw.status) ?? "unknown",
    currency: (str(raw.currency) ?? "usd").toLowerCase(),
    rewardPerAccepted: num(raw.gross_reward_amount),
    netRewardPerAccepted: num(raw.net_reward_amount),
    budget: num(raw.budget_amount),
    spotsRemaining: num(raw.spots_remaining),
    brand: hosting
      ? { name: str(hosting.title) ?? "Unknown brand", logoUrl: str(hosting.logo_url), route }
      : null,
    countries: Array.isArray(raw.allowed_country_codes) ? (raw.allowed_country_codes as unknown[]).map(String) : [],
    deliverableTypes: Array.isArray(raw.accepted_deliverable_types) ? (raw.accepted_deliverable_types as unknown[]).map(String) : [],
    createdAt: str(raw.created_at),
    contentLinks: extractUrls(description),
    whopUrl: route ? `https://whop.com/${encodeURIComponent(route)}` : null,
  };

  const P = UNVERIFIED_FIELD_PATHS;
  const r1k = num(firstDefined(raw, P.rewardPer1kViews));
  if (r1k !== null) c.rewardPer1kViews = r1k;
  const minP = num(firstDefined(raw, P.minPayout));
  if (minP !== null) c.minPayout = minP;
  const maxP = num(firstDefined(raw, P.maxPayout));
  if (maxP !== null) c.maxPayout = maxP;
  const flat = num(firstDefined(raw, P.flatFeeBonus));
  if (flat !== null) c.flatFeeBonus = flat;
  const plats = firstDefined(raw, P.platforms);
  if (Array.isArray(plats)) {
    const list = plats.map(normalisePlatform).filter((p): p is Platform => p !== null);
    if (list.length) c.platforms = Array.from(new Set(list));
  }
  const cat = str(firstDefined(raw, P.brandCategory));
  if (cat) c.brandCategory = cat;
  return c;
}

export interface CampaignFilters {
  query?: string;
  type?: string;
  country?: string;
  status?: string;
  minReward?: number;
  platform?: string;
}

/** Client-side filters applied on top of what the API already filtered. */
export function applyFilters(list: Campaign[], f: CampaignFilters): Campaign[] {
  return list.filter((c) => {
    if (f.query && !`${c.title} ${c.id} ${c.brand?.name ?? ""}`.toLowerCase().includes(f.query.toLowerCase())) return false;
    if (f.type && c.goalType !== f.type) return false;
    if (f.status && c.status !== f.status) return false;
    if (f.country && c.countries.length > 0 && !c.countries.includes(f.country.toUpperCase())) return false;
    if (f.minReward !== undefined && (c.rewardPerAccepted ?? 0) < f.minReward) return false;
    if (f.platform && c.platforms && !c.platforms.includes(f.platform as Platform)) return false;
    return true;
  });
}

export const GOAL_LABELS: Record<GoalType, string> = {
  clipping: "Clipping",
  post_engagement: "Post engagement",
  owned_account_growth: "Account growth",
  ugc_content: "UGC content",
  local_activation: "Local activation",
  data_capture: "Data capture",
  other: "Other",
};

export const PLATFORM_LABELS: Record<Platform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube_shorts: "YouTube Shorts",
};

export function formatMoney(amount: number | null | undefined, currency = "usd"): string {
  if (amount === null || amount === undefined) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount} ${currency.toUpperCase()}`;
  }
}
