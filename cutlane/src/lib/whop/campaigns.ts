import "server-only";
import { modes, requireLiveOrDemo } from "../env";
import { MOCK_CAMPAIGNS } from "../mock/campaigns";
import { applyFilters, normaliseBounty, type Campaign, type CampaignFilters } from "./campaigns-core";
import { captureSampleOnce, whopFetch } from "./client";

interface BountyList {
  data: Record<string, unknown>[];
  page_info: { end_cursor: string | null; has_next_page: boolean };
}

export interface CampaignPage {
  campaigns: Campaign[];
  nextCursor: string | null;
  source: "whop" | "demo";
}

export async function listCampaigns(userId: string, filters: CampaignFilters, after?: string): Promise<CampaignPage> {
  requireLiveOrDemo(modes.whop, "Whop", "WHOP_CLIENT_ID, WHOP_CLIENT_SECRET, WHOP_REDIRECT_URI");
  if (!modes.whop) {
    return { campaigns: applyFilters(MOCK_CAMPAIGNS, { ...filters, status: filters.status ?? "open" }), nextCursor: null, source: "demo" };
  }
  const res = await whopFetch<BountyList>(userId, "/bounties", {
    query: {
      status: filters.status || "open",
      business_goal_type: filters.type,
      country: filters.country?.toUpperCase(),
      query: filters.query,
      order: "created_at",
      direction: "desc",
      first: 30,
      after,
    },
  });
  await captureSampleOnce("GET /bounties", res);
  const campaigns = (res.data ?? []).map(normaliseBounty);
  // Server already filtered status/type/country/query; reward and platform are filtered here.
  return {
    campaigns: applyFilters(campaigns, { minReward: filters.minReward, platform: filters.platform }),
    nextCursor: res.page_info?.has_next_page ? res.page_info.end_cursor : null,
    source: "whop",
  };
}

export async function getCampaign(userId: string, id: string): Promise<Campaign | null> {
  requireLiveOrDemo(modes.whop, "Whop", "WHOP_CLIENT_ID, WHOP_CLIENT_SECRET, WHOP_REDIRECT_URI");
  if (!modes.whop) return MOCK_CAMPAIGNS.find((c) => c.id === id) ?? null;
  if (!/^bnty_[A-Za-z0-9]+$/.test(id)) return null;
  try {
    const raw = await whopFetch<Record<string, unknown>>(userId, `/bounties/${id}`);
    await captureSampleOnce("GET /bounties/:id", raw);
    return normaliseBounty(raw);
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null;
    throw err;
  }
}
