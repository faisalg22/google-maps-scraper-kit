import Link from "next/link";
import { requirePageAccess } from "@/lib/billing/server";
import { listSwipeNotes } from "@/lib/repo";
import { formatDuration } from "@/lib/youtube/core";
import { EmptyState, PageHeader, formatDate } from "@/components/ui";

export const metadata = { title: "Swipe file" };

export default async function SwipePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user } = await requirePageAccess("read");
  const sp = await searchParams;
  const search = (sp.q ?? "").slice(0, 100);
  const notes = await listSwipeNotes(user.id, { search: search || undefined });

  const groups = new Map<string, { title: string; channel: string | null; notes: typeof notes }>();
  for (const n of notes) {
    const g = groups.get(n.video_id) ?? { title: n.video_title, channel: n.channel_title, notes: [] };
    g.notes.push(n);
    groups.set(n.video_id, g);
  }

  return (
    <>
      <PageHeader title="Swipe file" subtitle="Your timestamped hook notes from YouTube research." actions={<Link href="/research" className="btn-secondary">Find more hooks</Link>} />
      <form method="get" className="mb-6 flex gap-2">
        <input name="q" defaultValue={search} placeholder="Search notes, tags, videos or channels" className="input" aria-label="Search swipe file" />
        <button className="btn-primary">Search</button>
      </form>

      {groups.size === 0 ? (
        <EmptyState
          title={search ? "No notes match your search" : "Your swipe file is empty"}
          body="Open a video in YouTube research, pause on a strong hook and save a note with its timestamp."
          action={<Link href="/research" className="btn-primary">Start researching</Link>}
        />
      ) : (
        <div className="space-y-4">
          {[...groups.entries()].map(([videoId, g]) => (
            <section key={videoId} className="card p-4">
              <Link href={`/research/video/${encodeURIComponent(videoId)}`} className="group block">
                <p className="font-semibold group-hover:text-white">{g.title}</p>
                {g.channel && <p className="text-xs text-ink-400">{g.channel}</p>}
              </Link>
              <ul className="mt-3 space-y-2">
                {g.notes
                  .sort((a, b) => a.timestamp_seconds - b.timestamp_seconds)
                  .map((n) => (
                    <li key={n.id} className="flex gap-3 rounded-xl bg-ink-900/70 p-3">
                      <span className="h-fit rounded-md bg-ink-700 px-1.5 py-0.5 font-mono text-xs text-lane-400">{formatDuration(n.timestamp_seconds)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="whitespace-pre-wrap break-words text-sm">{n.note}</p>
                        <p className="mt-1 text-xs text-ink-400">
                          {n.tags.map((t) => `#${t.replace(/\s+/g, "-")}`).join(" ")} {n.tags.length > 0 && "· "}
                          {formatDate(n.created_at)}
                        </p>
                      </div>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
