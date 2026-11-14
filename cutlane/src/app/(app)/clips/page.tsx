import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { listClips } from "@/lib/repo";
import { EmptyState, PageHeader, StatusBadge, formatBytes, formatDate } from "@/components/ui";

export const metadata = { title: "Clip library" };

const FILTERS = ["all", "ready", "posted", "submitted", "approved", "rejected"] as const;

export default async function ClipsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const status = FILTERS.includes(sp.status as (typeof FILTERS)[number]) && sp.status !== "all" ? sp.status : undefined;
  const clips = await listClips(user.id, status);

  return (
    <>
      <PageHeader title="Clip library" subtitle="Finished clips, ready to post and submit." actions={<Link href="/clips/new" className="btn-primary">Import clip</Link>} />
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link key={f} href={f === "all" ? "/clips" : `/clips?status=${f}`} className={`chip px-3 py-1 ${(status ?? "all") === f ? "border-lane-400 text-lane-400" : ""}`}>
            {f[0].toUpperCase() + f.slice(1)}
          </Link>
        ))}
      </div>
      {clips.length === 0 ? (
        <EmptyState title={status ? `No ${status} clips` : "No clips yet"} body="Import a finished MP4 and link it to a campaign to start the post → submit flow." action={<Link href="/clips/new" className="btn-primary">Import your first clip</Link>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {clips.map((c) => (
            <Link key={c.id} href={`/clips/${c.id}`} className="card flex gap-3 p-3 transition hover:border-ink-600">
              <div className="flex aspect-[9/16] w-16 shrink-0 items-center justify-center rounded-lg bg-gradient-to-b from-ink-700 to-ink-900 text-ink-400">▶</div>
              <div className="min-w-0 flex-1 py-0.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="line-clamp-2 text-sm font-semibold">{c.title}</p>
                  <StatusBadge status={c.status} />
                </div>
                <p className="mt-1 truncate text-xs text-ink-400">{c.campaign_title ?? "No campaign linked"}</p>
                <p className="mt-1 text-xs text-ink-400">
                  {formatBytes(c.size_bytes)} · {formatDate(c.created_at)}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
