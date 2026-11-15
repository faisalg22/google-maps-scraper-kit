import "server-only";
import { q } from "../db";
import { getChannel, getVideo } from "./api";

/**
 * YouTube API Services policy: API data you store must be refreshed or deleted within 30 days
 * (IDs may be kept). Saved channels and swipe-note titles are refreshed after 25 days; anything
 * still stale at 30 days is stripped down to its IDs. Runs opportunistically after page views
 * and daily via /api/cron/youtube-retention.
 */
const REFRESH_AFTER = "25 days";
const EXPIRE_AFTER = "30 days";

export async function refreshStaleYouTubeData(opts: { workspaceId?: string; limit: number }): Promise<{ channels: number; notes: number }> {
  let channels = 0;
  let notes = 0;
  const chRows = await q<{ id: string; channel_id: string }>(
    `select id, channel_id from saved_channels where refreshed_at < now() - interval '${REFRESH_AFTER}' ${opts.workspaceId ? "and workspace_id = $2" : ""} order by refreshed_at limit $1`,
    opts.workspaceId ? [opts.limit, opts.workspaceId] : [opts.limit],
  );
  for (const r of chRows) {
    try {
      const ch = await getChannel(r.channel_id);
      if (ch) await q(`update saved_channels set title = $2, thumbnail = $3, subscribers = $4, refreshed_at = now() where id = $1`, [r.id, ch.title, ch.thumbnail, ch.subscribers]);
      else await q(`delete from saved_channels where id = $1`, [r.id]); // channel gone
      channels++;
    } catch {
      break; // quota or config problem: stop; expiry below keeps us compliant
    }
  }
  const noteRows = await q<{ video_id: string }>(
    `select distinct video_id from swipe_notes where yt_refreshed_at < now() - interval '${REFRESH_AFTER}' ${opts.workspaceId ? "and user_id in (select user_id from workspace_members where workspace_id = $2)" : ""} limit $1`,
    opts.workspaceId ? [opts.limit, opts.workspaceId] : [opts.limit],
  );
  for (const r of noteRows) {
    try {
      const v = await getVideo(r.video_id);
      await q(
        `update swipe_notes set video_title = $2, channel_title = $3, yt_refreshed_at = now() where video_id = $1`,
        [r.video_id, v ? v.title : "Unavailable YouTube video", v ? v.channelTitle : null],
      );
      notes++;
    } catch {
      break;
    }
  }
  return { channels, notes };
}

/** Anything not refreshed within 30 days keeps only its IDs (the user's own note text stays). */
export async function expireYouTubeData(): Promise<void> {
  await q(
    `update saved_channels set title = channel_id, thumbnail = null, subscribers = 0, refreshed_at = now()
      where refreshed_at < now() - interval '${EXPIRE_AFTER}'`,
  );
  await q(
    `update swipe_notes set video_title = 'YouTube video ' || video_id, channel_title = null, yt_refreshed_at = now()
      where yt_refreshed_at < now() - interval '${EXPIRE_AFTER}'`,
  );
}
