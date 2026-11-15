import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageAccess } from "@/lib/billing/server";
import { getVideo } from "@/lib/youtube/api";
import { compactNumber, formatDuration, isYouTubeId } from "@/lib/youtube/core";
import { listSwipeNotes } from "@/lib/repo";
import { PlayerWithNotes } from "@/components/PlayerWithNotes";
import { BackLink, DemoTag, formatDate } from "@/components/ui";

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requirePageAccess("write");
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  if (!id.startsWith("demo-") && !isYouTubeId(id)) notFound();
  const video = await getVideo(id);
  if (!video) notFound();
  const notes = await listSwipeNotes(user.id, { videoId: id });

  return (
    <div className="mx-auto max-w-6xl">
      <BackLink href={`/research/channel/${encodeURIComponent(video.channelId)}`}>{video.channelTitle}</BackLink>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          {video.isDemo && <DemoTag />}
          <h1 className="text-xl font-bold leading-tight sm:text-2xl">{video.title}</h1>
        </div>
        <p className="mt-1 text-sm text-muted">
          {compactNumber(video.views)} views · {video.likes !== null ? `${compactNumber(video.likes)} likes · ` : ""}
          {formatDuration(video.durationSeconds)} · {formatDate(video.publishedAt)}
          {!video.isDemo && (
            <>
              {" · "}
              <a href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noopener noreferrer" className="underline">Watch on YouTube ↗</a>
            </>
          )}
        </p>
      </div>
      <PlayerWithNotes
        video={{ id: video.id, title: video.title, channelId: video.channelId, channelTitle: video.channelTitle, durationSeconds: video.durationSeconds, isDemo: video.isDemo }}
        notes={notes}
      />
      <p className="mt-6 text-xs text-muted">
        Research only. CutLane plays YouTube through the official embedded player and never downloads videos. Uses YouTube API Services; see the{" "}
        <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer" className="underline">YouTube Terms of Service</a> and{" "}
        <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="underline">Google Privacy Policy</a>. Saved notes are in your{" "}
        <Link href="/swipe" className="underline">swipe file</Link>.
      </p>
    </div>
  );
}
