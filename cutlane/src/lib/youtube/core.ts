/** Pure YouTube helpers + types (unit-tested). */

export const CATEGORIES = {
  streamers: { label: "Streamers", keywords: "stream highlights" },
  podcasts: { label: "Podcasts", keywords: "podcast" },
  influencers: { label: "Influencers", keywords: "vlog" },
  educational: { label: "Educational", keywords: "explained" },
} as const;
export type Category = keyof typeof CATEGORIES;
export const isCategory = (x: string): x is Category => x in CATEGORIES;

export const MIN_SUBSCRIBERS = 50_000;
/** "Long video" = at least this many seconds. */
export const LONG_VIDEO_SECONDS = 10 * 60;

export interface Channel {
  id: string;
  title: string;
  description: string;
  thumbnail: string | null;
  subscribers: number;
  videoCount: number;
  viewCount: number;
  uploadsPlaylistId: string | null;
  customUrl: string | null;
  isDemo: boolean;
}

export interface Video {
  id: string;
  channelId: string;
  channelTitle: string;
  title: string;
  thumbnail: string | null;
  publishedAt: string;
  durationSeconds: number;
  views: number;
  likes: number | null;
  isDemo: boolean;
}

/** ISO-8601 duration (PT1H2M3S, P1DT2H) → seconds. */
export function parseIsoDuration(iso: string | null | undefined): number {
  if (!iso) return 0;
  const m = iso.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (!m) return 0;
  const [, d, h, min, s] = m;
  return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Math.floor(Number(s ?? 0));
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

/** "1:02:03" | "2:03" | "45" → seconds, or null. */
export function parseTimestamp(input: string): number | null {
  const t = input.trim();
  if (!/^\d{1,3}(:\d{1,2}){0,2}$/.test(t)) return null;
  const parts = t.split(":").map(Number);
  if (parts.slice(1).some((p) => p >= 60)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

export function compactNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export const isYouTubeId = (id: string) => /^[A-Za-z0-9_-]{11}$/.test(id);
export const isChannelId = (id: string) => /^UC[A-Za-z0-9_-]{22}$/.test(id);
