import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { listCampaigns } from "@/lib/whop/campaigns";
import { GOAL_LABELS, GOAL_TYPES, PLATFORM_LABELS, PLATFORMS, type CampaignFilters } from "@/lib/whop/campaigns-core";
import { WhopAuthRequired } from "@/lib/whop/client";
import { CampaignCard } from "@/components/CampaignCard";
import { Alert, DemoTag, EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Campaigns" };

type SP = Record<string, string | undefined>;

function parseFilters(sp: SP): CampaignFilters {
  const minReward = sp.minReward && Number.isFinite(Number(sp.minReward)) ? Number(sp.minReward) : undefined;
  return {
    query: sp.q?.slice(0, 100) || undefined,
    type: sp.type && (GOAL_TYPES as readonly string[]).includes(sp.type) ? sp.type : undefined,
    country: sp.country && /^[A-Za-z]{2}$/.test(sp.country) ? sp.country.toUpperCase() : undefined,
    status: sp.status && ["open", "closed", "completed"].includes(sp.status) ? sp.status : undefined,
    minReward,
    platform: sp.platform && (PLATFORMS as readonly string[]).includes(sp.platform) ? sp.platform : undefined,
  };
}

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const filters = parseFilters(sp);

  let page: Awaited<ReturnType<typeof listCampaigns>> | null = null;
  let error: string | null = null;
  try {
    page = await listCampaigns(user.id, filters, sp.after);
  } catch (err) {
    error = err instanceof WhopAuthRequired ? err.message : `Couldn't load campaigns from Whop: ${(err as Error).message}`;
  }
  const isDemo = page?.source === "demo";
  const showPlatformFilter = isDemo || page?.campaigns.some((c) => c.platforms);
  const nextHref = page?.nextCursor ? `/campaigns?${new URLSearchParams({ ...(sp as Record<string, string>), after: page.nextCursor })}` : null;

  return (
    <>
      <PageHeader
        title="Campaigns"
        subtitle={
          <>
            Open Whop Content Rewards campaigns. {isDemo && <DemoTag label="Mock campaigns" />}
          </>
        }
      />

      <form className="card mb-6 grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6" method="get">
        <div className="col-span-2 sm:col-span-3 lg:col-span-2">
          <label className="label" htmlFor="q">Search</label>
          <input id="q" name="q" defaultValue={filters.query} placeholder="Title, brand or ID" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="type">Type</label>
          <select id="type" name="type" defaultValue={filters.type ?? ""} className="input">
            <option value="">All types</option>
            {GOAL_TYPES.map((t) => (
              <option key={t} value={t}>{GOAL_LABELS[t]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="country">Country</label>
          <input id="country" name="country" defaultValue={filters.country} placeholder="e.g. US" maxLength={2} className="input uppercase" />
        </div>
        <div>
          <label className="label" htmlFor="minReward">Min reward ($)</label>
          <input id="minReward" name="minReward" type="number" min={0} step={1} defaultValue={filters.minReward} placeholder="0" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={filters.status ?? "open"} className="input">
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="completed">Completed</option>
          </select>
        </div>
        {showPlatformFilter && (
          <div>
            <label className="label" htmlFor="platform">Platform</label>
            <select id="platform" name="platform" defaultValue={filters.platform ?? ""} className="input">
              <option value="">Any</option>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>
              ))}
            </select>
          </div>
        )}
        <div className="col-span-2 flex items-end gap-2 sm:col-span-1 lg:col-span-1">
          <button className="btn-primary flex-1">Filter</button>
          <Link href="/campaigns" className="btn-ghost">Reset</Link>
        </div>
      </form>

      {error && (
        <div className="mb-6">
          <Alert kind="error">
            {error}{" "}
            <a className="underline" href="/api/auth/whop/start?returnTo=/campaigns">Sign in again</a>
          </Alert>
        </div>
      )}

      {page && page.campaigns.length === 0 && (
        <EmptyState title="No campaigns match these filters" body="Try a different type or country, or lower the minimum reward." action={<Link href="/campaigns" className="btn-secondary">Clear filters</Link>} />
      )}

      {page && page.campaigns.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {page.campaigns.map((c) => (
            <CampaignCard key={c.id} c={c} />
          ))}
        </div>
      )}

      {nextHref && (
        <div className="mt-8 flex justify-center">
          <Link href={nextHref} className="btn-secondary">Next page →</Link>
        </div>
      )}
    </>
  );
}
