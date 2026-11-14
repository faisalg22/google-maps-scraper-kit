import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageAccess } from "@/lib/billing/server";
import { getChannel, getChannelVideos } from "@/lib/youtube/api";
import { compactNumber, formatDuration, isChannelId } from "@/lib/youtube/core";
import { Alert, BackLink, DemoTag, EmptyState, formatDate } from "@/components/ui";
import { SaveChannelButton } from "@/components/billing-client";
import { one } from "@/lib/db";

const SORTS = { views: "Most viewed", recent: "Newest", likes: "Most liked", ratio: "Best like rate" } as const;
type Sort = keyof typeof SORTS;
const LENGTHS = [10, 20, 40, 60];

export default async function ChannelPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const billing = await requirePageAccess("write");
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  if (!id.startsWith("demo-") && !isChannelId(id)) notFound();
  const sp = await searchParams;
  const sort: Sort = sp.sort && sp.sort in SORTS ? (sp.sort as Sort) : "views";
  const minMin = LENGTHS.includes(Number(sp.len)) ? Number(sp.len) : 10;

  let error: string | null = null;
  const channel = await getChannel(id).catch((e) => {
    error = (e as Error).message;
    return null;
  });
  if (!channel && !error) notFound();
  const videos = channel ? await getChannelVideos(channel, minMin * 60).catch((e) => ((error = (e as Error).message), [])) : [];
  const sorted = [...videos].sort((a, b) => {
    if (sort === "recent") return b.publishedAt.localeCompare(a.publishedAt);
    if (sort === "likes") return (b.likes ?? 0) - (a.likes ?? 0);
    if (sort === "ratio") return (b.likes ?? 0) / Math.max(1, b.views) - (a.likes ?? 0) / Math.max(1, a.views);
    return b.views - a.views;
  });
  const isSaved = channel
    ? Boolean(await one(`select 1 from saved_channels where workspace_id = $1 and channel_id = $2`, [billing.workspace.id, channel.id]))
    : false;
  const qs = (patch: Record<string, string>) => `?${new URLSearchParams({ sort, len: String(minMin), ...patch })}`;

  return (
    <div className="mx-auto max-w-5xl">
      <BackLink href="/research">Research</BackLink>
      {error && <Alert kind="error">{error}</Alert>}
      {channel && (
        <>
          <div className="flex items-center gap-4">
            {channel.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={channel.thumbnail} alt="" className="h-16 w-16 rounded-full" />
            ) : (
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-ink-600 to-ink-800 text-xl font-bold">{channel.title.slice(0, 1)}</span>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-2xl font-bold">{channel.title}</h1>
                {channel.isDemo && <DemoTag />}
              </div>
              <p className="text-sm text-ink-400">
                {compactNumber(channel.subscribers)} subscribers · {compactNumber(channel.videoCount)} videos · {compactNumber(channel.viewCount)} views
              </p>
            </div>
            {!channel.isDemo && (
              <a href={`https://www.youtube.com/channel/${channel.id}`} target="_blank" rel="noopener noreferrer" className="btn-ghost ml-auto hidden sm:inline-flex">
                YouTube ↗
              </a>
            )}
          </div>

          <div className="mt-4">
            <SaveChannelButton
              channel={{ channelId: channel.id, title: channel.title, thumbnail: channel.thumbnail, subscribers: channel.subscribers }}
              saved={isSaved}
            />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-ink-400">Sort:</span>
            {(Object.keys(SORTS) as Sort[]).map((s) => (
              <Link key={s} href={qs({ sort: s })} className={`chip ${s === sort ? "border-lane-400 text-lane-400" : ""}`}>{SORTS[s]}</Link>
            ))}
            <span className="ml-2 text-ink-400">Length:</span>
            {LENGTHS.map((l) => (
              <Link key={l} href={qs({ len: String(l) })} className={`chip ${l === minMin ? "border-lane-400 text-lane-400" : ""}`}>{l}+ min</Link>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-400">From the channel&apos;s latest 50 uploads, long videos only.</p>

          <div className="mt-4 space-y-2">
            {sorted.length === 0 && <EmptyState title="No long videos in recent uploads" body="Try a shorter minimum length." />}
            {sorted.map((v) => (
              <Link key={v.id} href={`/research/video/${encodeURIComponent(v.id)}`} className="card flex gap-3 p-3 transition hover:border-ink-600">
                <div className="relative aspect-video w-36 shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-ink-700 to-ink-900 sm:w-48">
                  {v.thumbnail && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={v.thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" />
                  )}
                  <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 font-mono text-[11px]">{formatDuration(v.durationSeconds)}</span>
                </div>
                <div className="min-w-0 py-0.5">
                  <p className="line-clamp-2 text-sm font-semibold">{v.title}</p>
                  <p className="mt-1 text-xs text-ink-400">
                    {compactNumber(v.views)} views · {v.likes !== null ? `${compactNumber(v.likes)} likes · ` : ""}
                    {formatDate(v.publishedAt)}
                  </p>
                  {v.likes !== null && v.views > 0 && <p className="mt-1 text-xs text-lane-400">{((v.likes / v.views) * 100).toFixed(1)}% like rate</p>}
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
