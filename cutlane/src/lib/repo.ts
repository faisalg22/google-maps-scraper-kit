import "server-only";
import { one, q } from "./db";
import type { Platform } from "./whop/campaigns-core";

/** Typed reads. Every query is scoped to the owning user. */

export type ClipStatus = "draft" | "ready" | "posted" | "submitted" | "approved" | "rejected";

export interface Clip {
  id: string;
  title: string;
  campaign_id: string | null;
  campaign_title: string | null;
  storage_key: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  status: ClipStatus;
  origin: "import" | "editor";
  rights_confirmed: boolean;
  whop_file_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PostLink {
  id: string;
  clip_id: string;
  platform: Platform;
  url: string | null;
  checklist: Record<string, boolean>;
  source: "manual" | "auto";
  check_status: "unchecked" | "ok" | "blocked" | "failed";
  check_http_status: number | null;
  check_message: string | null;
  checked_at: string | null;
  manual_confirmed: boolean;
}

export interface Submission {
  id: string;
  clip_id: string | null;
  clip_title: string | null;
  bounty_id: string;
  campaign_title: string | null;
  whop_submission_id: string | null;
  status: string;
  denial_reason: string | null;
  caption: string | null;
  urls: string[];
  file_ids: string[];
  is_demo: boolean;
  job_state: "queued" | "uploading" | "processing" | "creating" | "done" | "failed";
  job_error: string | null;
  submitted_at: string;
  resolved_at: string | null;
}

export interface SwipeNote {
  id: string;
  video_id: string;
  video_title: string;
  channel_id: string | null;
  channel_title: string | null;
  timestamp_seconds: number;
  note: string;
  tags: string[];
  created_at: string;
}

const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : d === null || d === undefined ? null : String(d));

function mapClip(r: Record<string, unknown>): Clip {
  return {
    ...(r as unknown as Clip),
    size_bytes: Number(r.size_bytes),
    created_at: iso(r.created_at)!,
    updated_at: iso(r.updated_at)!,
  };
}

const CLIP_COLS = `id, title, campaign_id, campaign_title, storage_key, file_name, mime_type, size_bytes, status::text as status,
  origin::text as origin, rights_confirmed, whop_file_id, created_at, updated_at`;

export async function listClips(userId: string, status?: string): Promise<Clip[]> {
  const rows = status
    ? await q(`select ${CLIP_COLS} from clips where user_id = $1 and status::text = $2 order by created_at desc`, [userId, status])
    : await q(`select ${CLIP_COLS} from clips where user_id = $1 order by created_at desc`, [userId]);
  return rows.map(mapClip);
}

export async function getClip(userId: string, clipId: string): Promise<Clip | null> {
  if (!/^[0-9a-f-]{36}$/.test(clipId)) return null;
  const r = await one(`select ${CLIP_COLS} from clips where user_id = $1 and id = $2`, [userId, clipId]);
  return r ? mapClip(r) : null;
}

export async function listPostLinks(clipId: string): Promise<PostLink[]> {
  const rows = await q(
    `select id, clip_id, platform::text as platform, url, checklist, source::text as source, check_status::text as check_status,
            check_http_status, check_message, checked_at, manual_confirmed
       from post_links where clip_id = $1`,
    [clipId],
  );
  return rows.map((r) => ({ ...(r as unknown as PostLink), checked_at: iso(r.checked_at) }));
}

export function linkIsSubmittable(l: PostLink): boolean {
  return Boolean(l.url) && (l.check_status === "ok" || (l.check_status === "blocked" && l.manual_confirmed));
}

const SUB_COLS = `s.id, s.clip_id, c.title as clip_title, s.bounty_id, c.campaign_title, s.whop_submission_id, s.status, s.denial_reason,
  s.caption, s.urls, s.file_ids, s.is_demo, s.job_state, s.job_error, s.submitted_at, s.resolved_at`;

function mapSub(r: Record<string, unknown>): Submission {
  return { ...(r as unknown as Submission), submitted_at: iso(r.submitted_at)!, resolved_at: iso(r.resolved_at) };
}

export async function listSubmissions(userId: string): Promise<Submission[]> {
  const rows = await q(
    `select ${SUB_COLS} from submissions s left join clips c on c.id = s.clip_id where s.user_id = $1 order by s.submitted_at desc`,
    [userId],
  );
  return rows.map(mapSub);
}

export async function listClipSubmissions(userId: string, clipId: string): Promise<Submission[]> {
  const rows = await q(
    `select ${SUB_COLS} from submissions s left join clips c on c.id = s.clip_id where s.user_id = $1 and s.clip_id = $2 order by s.submitted_at desc`,
    [userId, clipId],
  );
  return rows.map(mapSub);
}

export async function listSwipeNotes(userId: string, opts: { videoId?: string; search?: string } = {}): Promise<SwipeNote[]> {
  const params: unknown[] = [userId];
  let where = "user_id = $1";
  if (opts.videoId) {
    params.push(opts.videoId);
    where += ` and video_id = $${params.length}`;
  }
  if (opts.search) {
    params.push(`%${opts.search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    where += ` and (note ilike $${params.length} or video_title ilike $${params.length} or coalesce(channel_title,'') ilike $${params.length} or array_to_string(tags, ' ') ilike $${params.length})`;
  }
  const order = opts.videoId ? "timestamp_seconds asc" : "created_at desc";
  const rows = await q(
    `select id, video_id, video_title, channel_id, channel_title, timestamp_seconds, note, tags, created_at
       from swipe_notes where ${where} order by ${order} limit 500`,
    params,
  );
  return rows.map((r) => ({ ...(r as unknown as SwipeNote), created_at: iso(r.created_at)! }));
}

export async function dashboardCounts(userId: string) {
  const r = await one<{ clips: number; notes: number; pending: number; approved: number }>(
    `select
       (select count(*)::int from clips where user_id = $1) as clips,
       (select count(*)::int from swipe_notes where user_id = $1) as notes,
       (select count(*)::int from submissions where user_id = $1 and status in ('submitted','in_progress')) as pending,
       (select count(*)::int from submissions where user_id = $1 and status = 'approved') as approved`,
    [userId],
  );
  return r ?? { clips: 0, notes: 0, pending: 0, approved: 0 };
}
