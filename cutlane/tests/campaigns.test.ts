import { describe, expect, it } from "vitest";
import { applyFilters, extractUrls, normaliseBounty } from "@/lib/whop/campaigns-core";
import { MOCK_CAMPAIGNS } from "@/lib/mock/campaigns";

const raw = {
  id: "bnty_123",
  title: "Clip my podcast",
  description: "Rules...\nAvailable content: https://drive.google.com/drive/folders/abc. Thanks!",
  business_goal_type: "clipping",
  status: "open",
  currency: "usd",
  gross_reward_amount: 100,
  net_reward_amount: 90,
  budget_amount: 5000,
  spots_remaining: 49,
  hosting_account: { id: "biz_1", title: "Pod Co", logo_url: null, route: "podco" },
  allowed_country_codes: ["US"],
  accepted_deliverable_types: ["content_url", "media"],
  created_at: "2026-11-01T00:00:00Z",
  // keys that LOOK like unverified fields must not be picked up by guessing
  cpm: 3,
  platforms: ["tiktok"],
};

describe("normaliseBounty", () => {
  it("maps confirmed fields", () => {
    const c = normaliseBounty(raw);
    expect(c).toMatchObject({
      id: "bnty_123",
      title: "Clip my podcast",
      goalType: "clipping",
      rewardPerAccepted: 100,
      netRewardPerAccepted: 90,
      budget: 5000,
      spotsRemaining: 49,
      countries: ["US"],
      brand: { name: "Pod Co", route: "podco" },
      whopUrl: "https://whop.com/podco",
      isDemo: false,
    });
  });
  it("never invents unverified fields", () => {
    const c = normaliseBounty(raw);
    expect(c.rewardPer1kViews).toBeUndefined();
    expect(c.platforms).toBeUndefined();
    expect(c.minPayout).toBeUndefined();
    expect(c.brandCategory).toBeUndefined();
  });
  it("extracts content links from the description", () => {
    expect(normaliseBounty(raw).contentLinks).toEqual(["https://drive.google.com/drive/folders/abc"]);
  });
  it("tolerates missing/null values", () => {
    const c = normaliseBounty({ id: "bnty_x", hosting_account: null, business_goal_type: "weird" });
    expect(c.brand).toBeNull();
    expect(c.goalType).toBeNull();
    expect(c.rewardPerAccepted).toBeNull();
    expect(c.countries).toEqual([]);
  });
});

describe("applyFilters", () => {
  it("filters mock campaigns by type, reward, country and platform", () => {
    expect(applyFilters(MOCK_CAMPAIGNS, { type: "ugc_content" }).map((c) => c.id)).toEqual(["demo_bnty_005"]);
    expect(applyFilters(MOCK_CAMPAIGNS, { minReward: 150 }).every((c) => (c.rewardPerAccepted ?? 0) >= 150)).toBe(true);
    // Worldwide campaigns match any country.
    expect(applyFilters(MOCK_CAMPAIGNS, { country: "de" }).every((c) => c.countries.length === 0)).toBe(true);
    expect(applyFilters(MOCK_CAMPAIGNS, { platform: "tiktok" }).every((c) => c.platforms?.includes("tiktok"))).toBe(true);
  });
  it("extractUrls strips trailing punctuation and dedupes", () => {
    expect(extractUrls("see https://a.example/x, and https://a.example/x.")).toEqual(["https://a.example/x"]);
  });
});
