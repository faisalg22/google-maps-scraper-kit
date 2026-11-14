import Link from "next/link";
import { requirePageAccess } from "@/lib/billing/server";
import { modes } from "@/lib/env";
import { DAILY_QUOTA, quotaUsedToday, searchChannels } from "@/lib/youtube/api";
import { CATEGORIES, MIN_SUBSCRIBERS, compactNumber, isCategory, type Category } from "@/lib/youtube/core";
import { Alert, DemoTag, EmptyState, PageHeader } from "@/components/ui";
import { q } from "@/lib/db";

export const metadata = { title: "YouTube research" };

const SUB_OPTIONS = [50_000, 100_000, 500_000, 1_000_000];

export default async function ResearchPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const billing = await requirePageAccess("write");
  const sp = await searchParams;
  const cat: Category | null = sp.cat && isCategory(sp.cat) ? sp.cat : null;
  const query = (sp.q ?? "").slice(0, 100);
  const minSubs = Math.max(MIN_SUBSCRIBERS, SUB_OPTIONS.includes(Number(sp.min)) ? Number(sp.min) : MIN_SUBSCRIBERS);

  let result: Awaited<ReturnType<typeof searchChannels>> | null = null;
  let error: string | null = null;
  if (cat) {
    try {
      result = await searchChannels(cat, query, minSubs);
    } catch (err) {
      error = (err as Error).message;
    }
  }
  const used = modes.youtube ? await quotaUsedToday() : 0;
  const saved = await q<{ channel_id: string; title: string; subscribers: number }>(
    `select channel_id, title, subscribers::float8 as subscribers from saved_channels where workspace_id = $1 order by created_at desc`,
    [billing.workspace.id],
  );
  const savedLimit = billing.ent.limits.saved_channels;

  return (
    <>
      <PageHeader
        title="YouTube research"
        subtitle={<>Find long-form channels with {compactNumber(MIN_SUBSCRIBERS)}+ subscribers and study their hooks. Reference only: nothing is downloaded. {!modes.youtube && <DemoTag label="Mock YouTube" />}</>}
        actions={<Link href="/swipe" className="btn-secondary">Open swipe file</Link>}
      />

      <form method="get" className="card mb-6 space-y-4 p-4">
        <fieldset>
          <legend className="label">Category</legend>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(CATEGORIES) as Category[]).map((k) => (
              <label key={k} className="cursor-pointer">
                <input type="radio" name="cat" value={k} defaultChecked={(cat ?? "podcasts") === k} className="peer sr-only" />
                <span className="chip px-3.5 py-1.5 text-sm peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:text-primary-strong peer-focus-visible:outline-2 peer-focus-visible:outline-ring">
                  {CATEGORIES[k].label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px_auto]">
          <div>
            <label className="label" htmlFor="q">Topic or niche (optional)</label>
            <input id="q" name="q" defaultValue={query} placeholder="e.g. comedy, fitness, finance, Valorant" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="min">Min subscribers</label>
            <select id="min" name="min" defaultValue={String(minSubs)} className="input">
              {SUB_OPTIONS.map((n) => (
                <option key={n} value={n}>{compactNumber(n)}+</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button className="btn-primary w-full sm:w-auto">Search channels</button>
          </div>
        </div>
        {modes.youtube && (
          <p className="text-xs text-muted">
            YouTube quota today: {used.toLocaleString()} / {DAILY_QUOTA.toLocaleString()} units. A new search costs about 101 units; results are cached for 24 hours.
          </p>
        )}
      </form>

      <section className="mb-6">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Saved channels</h2>
          <span className={`font-mono text-xs ${savedLimit !== null && saved.length >= savedLimit ? "text-danger-fg" : savedLimit !== null && saved.length >= savedLimit * 0.8 ? "text-warning-fg" : "text-muted"}`}>
            {saved.length} / {savedLimit ?? "∞"}
          </span>
        </div>
        {saved.length === 0 ? (
          <p className="text-sm text-muted">Save channels you study often. Open a channel and tap “Save channel”.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {saved.map((c) => (
              <Link key={c.channel_id} href={`/research/channel/${encodeURIComponent(c.channel_id)}`} className="chip px-3 py-1.5 text-sm hover:text-fg">
                ★ {c.title} <span className="text-muted">{compactNumber(Number(c.subscribers))}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {error && <Alert kind="error">{error}</Alert>}

      {!cat && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.keys(CATEGORIES) as Category[]).map((k) => (
            <Link key={k} href={`/research?cat=${k}`} className="card p-5 transition hover:border-border-strong">
              <p className="font-semibold">{CATEGORIES[k].label}</p>
              <p className="mt-1 text-sm text-muted">Browse top {CATEGORIES[k].label.toLowerCase()} channels →</p>
            </Link>
          ))}
        </div>
      )}

      {result && result.channels.length === 0 && (
        <EmptyState title="No channels found" body={`No ${cat ? CATEGORIES[cat].label.toLowerCase() : ""} channels with ${compactNumber(minSubs)}+ subscribers matched. Try a broader topic.`} />
      )}

      {result && result.channels.length > 0 && (
        <>
          <p className="mb-3 text-sm text-muted">
            {result.channels.length} channel{result.channels.length === 1 ? "" : "s"}
            {result.hiddenOrSmall > 0 && ` · ${result.hiddenOrSmall} hidden (under ${compactNumber(minSubs)} or subscriber count hidden)`}
            {result.fromCache && " · from cache"}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {result.channels.map((ch) => (
              <Link key={ch.id} href={`/research/channel/${encodeURIComponent(ch.id)}`} className="card flex gap-3 p-4 transition hover:border-border-strong">
                {ch.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ch.thumbnail} alt="" className="h-14 w-14 shrink-0 rounded-full bg-raised object-cover" loading="lazy" />
                ) : (
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-raised text-lg font-bold">{ch.title.slice(0, 1)}</span>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate font-semibold">{ch.title}</p>
                    {ch.isDemo && <DemoTag label="Demo" />}
                  </div>
                  <p className="text-sm text-primary-strong">{compactNumber(ch.subscribers)} subscribers</p>
                  <p className="mt-1 line-clamp-2 text-xs text-muted">{ch.description || "No description."}</p>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}
