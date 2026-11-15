import "server-only";
import { env, modes, requireLiveOrDemo } from "../env";
import { one, q } from "../db";
import { mockChannel, mockChannelVideos, mockSearchChannels, mockVideo } from "../mock/youtube";
import { CATEGORIES, LONG_VIDEO_SECONDS, parseIsoDuration, type Category, type Channel, type Video } from "./core";

/**
 * YouTube Data API v3 — read-only metadata for research. No downloading, no scraping.
 * Every response is cached in Postgres (yt_cache) and quota units are counted per day (yt_quota).
 *
 * Unit costs (YouTube docs): search.list = 100, channels/videos/playlistItems.list = 1.
 */

const BASE = "https://www.googleapis.com/youtube/v3";
export const DAILY_QUOTA = 10_000;

const TTL = {
  search: 24 * 3600,
  channel: 24 * 3600,
  videos: 6 * 3600,
  video: 24 * 3600,
};

async function cached<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  const hit = await one<{ payload: T }>(`select payload from yt_cache where cache_key = $1 and expires_at > now()`, [key]);
  if (hit) return hit.payload;
  const value = await load();
  await q(
    `insert into yt_cache (cache_key, payload, expires_at) values ($1, $2::jsonb, now() + ($3 || ' seconds')::interval)
     on conflict (cache_key) do update set payload = excluded.payload, expires_at = excluded.expires_at, created_at = now()`,
    [key, JSON.stringify(value), String(ttlSeconds)],
  );
  // Opportunistic cleanup of expired rows.
  if (Math.random() < 0.05) await q(`delete from yt_cache where expires_at < now()`);
  return value;
}

async function countUnits(units: number) {
  await q(
    `insert into yt_quota (day, units) values (current_date, $1::int) on conflict (day) do update set units = yt_quota.units + excluded.units`,
    [units],
  );
}

export async function quotaUsedToday(): Promise<number> {
  const row = await one<{ units: number }>(`select units from yt_quota where day = current_date`);
  return Number(row?.units ?? 0);
}

class QuotaExceeded extends Error {}

async function yt<T>(endpoint: string, params: Record<string, string>, units: number): Promise<T> {
  if ((await quotaUsedToday()) + units > DAILY_QUOTA * 0.95) {
    throw new QuotaExceeded("YouTube daily quota nearly used up. Cached results still work; new searches resume tomorrow (Pacific time).");
  }
  const url = new URL(`${BASE}/${endpoint}`);
  for (const [k, val] of Object.entries(params)) url.searchParams.set(k, val);
  url.searchParams.set("key", env.youtube.apiKey!);
  await countUnits(units);
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[] } } & T;
  if (!res.ok) {
    const reason = json.error?.errors?.[0]?.reason;
    if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
      throw new QuotaExceeded("YouTube daily quota exceeded. Cached results still work.");
    }
    // Never echo the URL (it contains the API key).
    throw new Error(`YouTube API error (${res.status}): ${json.error?.message ?? "unknown"}`);
  }
  return json;
}

type Thumbs = { default?: { url: string }; medium?: { url: string }; high?: { url: string } };
const thumb = (t?: Thumbs) => t?.medium?.url ?? t?.high?.url ?? t?.default?.url ?? null;

interface ChannelItem {
  id: string;
  snippet: { title: string; description: string; customUrl?: string; thumbnails?: Thumbs };
  statistics: { subscriberCount?: string; hiddenSubscriberCount?: boolean; videoCount?: string; viewCount?: string };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
}

function toChannel(c: ChannelItem): Channel {
  return {
    id: c.id,
    title: c.snippet.title,
    description: c.snippet.description,
    thumbnail: thumb(c.snippet.thumbnails),
    subscribers: Number(c.statistics.subscriberCount ?? 0),
    videoCount: Number(c.statistics.videoCount ?? 0),
    viewCount: Number(c.statistics.viewCount ?? 0),
    uploadsPlaylistId: c.contentDetails?.relatedPlaylists?.uploads ?? null,
    customUrl: c.snippet.customUrl ?? null,
    isDemo: false,
  };
}

interface VideoItem {
  id: string;
  snippet: { title: string; channelId: string; channelTitle: string; publishedAt: string; thumbnails?: Thumbs };
  statistics: { viewCount?: string; likeCount?: string };
  contentDetails: { duration: string };
}

function toVideo(v: VideoItem): Video {
  return {
    id: v.id,
    channelId: v.snippet.channelId,
    channelTitle: v.snippet.channelTitle,
    title: v.snippet.title,
    thumbnail: thumb(v.snippet.thumbnails),
    publishedAt: v.snippet.publishedAt,
    durationSeconds: parseIsoDuration(v.contentDetails.duration),
    views: Number(v.statistics.viewCount ?? 0),
    likes: v.statistics.likeCount !== undefined ? Number(v.statistics.likeCount) : null,
    isDemo: false,
  };
}

export interface ChannelSearchResult {
  channels: Channel[];
  hiddenOrSmall: number;
  fromCache: boolean;
}

const requireYouTube = () => requireLiveOrDemo(modes.youtube, "YouTube research", "YOUTUBE_API_KEY");

export async function searchChannels(category: Category, query: string, minSubs: number): Promise<ChannelSearchResult> {
  requireYouTube();
  if (!modes.youtube) {
    const all = mockSearchChannels(category, query, 0);
    const channels = all.filter((c) => c.subscribers >= minSubs);
    return { channels, hiddenOrSmall: all.length - channels.length, fromCache: false };
  }
  const term = `${query.trim()} ${CATEGORIES[category].keywords}`.trim().slice(0, 200);
  const key = `search:v1:${category}:${term.toLowerCase()}`;
  let fromCache = true;
  const items = await cached(key, TTL.search, async () => {
    fromCache = false;
    const search = await yt<{ items: { id: { channelId: string } }[] }>(
      "search",
      { part: "snippet", type: "channel", q: term, maxResults: "25", relevanceLanguage: "en" },
      100,
    );
    const ids = search.items.map((i) => i.id.channelId).filter(Boolean);
    if (!ids.length) return [] as Channel[];
    const details = await yt<{ items: ChannelItem[] }>(
      "channels",
      { part: "snippet,statistics,contentDetails", id: ids.join(","), maxResults: "50" },
      1,
    );
    return details.items.filter((c) => !c.statistics.hiddenSubscriberCount).map(toChannel);
  });
  const channels = items.filter((c) => c.subscribers >= minSubs).sort((a, b) => b.subscribers - a.subscribers);
  return { channels, hiddenOrSmall: items.length - channels.length, fromCache };
}

export async function getChannel(channelId: string): Promise<Channel | null> {
  requireYouTube();
  if (!modes.youtube) return mockChannel(channelId);
  return cached(`channel:v1:${channelId}`, TTL.channel, async () => {
    const res = await yt<{ items?: ChannelItem[] }>("channels", { part: "snippet,statistics,contentDetails", id: channelId }, 1);
    return res.items?.[0] ? toChannel(res.items[0]) : null;
  });
}

/** Latest ~50 uploads, keeping only long videos (default ≥ 10 min). */
export async function getChannelVideos(channel: Channel, minSeconds = LONG_VIDEO_SECONDS): Promise<Video[]> {
  if (!modes.youtube) return mockChannelVideos(channel.id).filter((v) => v.durationSeconds >= minSeconds);
  if (!channel.uploadsPlaylistId) return [];
  const all = await cached(`uploads:v1:${channel.id}`, TTL.videos, async () => {
    const pl = await yt<{ items: { contentDetails: { videoId: string } }[] }>(
      "playlistItems",
      { part: "contentDetails", playlistId: channel.uploadsPlaylistId!, maxResults: "50" },
      1,
    );
    const ids = pl.items.map((i) => i.contentDetails.videoId);
    if (!ids.length) return [] as Video[];
    const vids = await yt<{ items: VideoItem[] }>("videos", { part: "snippet,statistics,contentDetails", id: ids.join(",") }, 1);
    return vids.items.map(toVideo);
  });
  return all.filter((v) => v.durationSeconds >= minSeconds);
}

export async function getVideo(videoId: string): Promise<Video | null> {
  requireYouTube();
  if (!modes.youtube || videoId.startsWith("demo-")) return mockVideo(videoId);
  return cached(`video:v1:${videoId}`, TTL.video, async () => {
    const res = await yt<{ items?: VideoItem[] }>("videos", { part: "snippet,statistics,contentDetails", id: videoId }, 1);
    return res.items?.[0] ? toVideo(res.items[0]) : null;
  });
}

export { QuotaExceeded };
