import Link from "next/link";
import { requirePageAccess } from "@/lib/billing/server";
import { modes } from "@/lib/env";
import { dashboardCounts, listSubmissions } from "@/lib/repo";
import { SimulateReview, SyncButton } from "@/components/SubmissionControls";
import { DemoTag, EmptyState, PageHeader, StatusBadge, formatDate } from "@/components/ui";

export const metadata = { title: "Submissions" };

export default async function SubmissionsPage() {
  const { user } = await requirePageAccess("read");
  const [subs, counts] = await Promise.all([listSubmissions(user.id), dashboardCounts(user.id)]);

  return (
    <>
      <PageHeader title="Submissions" subtitle="Everything you've sent to Whop and where it stands." actions={<SyncButton isDemo={!modes.whop} />} />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Pending review", counts.pending],
          ["Approved", counts.approved],
          ["Clips", counts.clips],
          ["Hook notes", counts.notes],
        ].map(([label, n]) => (
          <div key={label} className="card p-4">
            <p className="text-2xl font-bold">{n}</p>
            <p className="text-xs text-muted">{label}</p>
          </div>
        ))}
      </div>

      {subs.length === 0 ? (
        <EmptyState title="No submissions yet" body="Post a clip, save its live links and submit it from the clip page." action={<Link href="/clips" className="btn-primary">Go to clips</Link>} />
      ) : (
        <ul className="space-y-3">
          {subs.map((s) => (
            <li key={s.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {s.is_demo && <DemoTag label="Demo" />}
                    <p className="truncate font-semibold">{s.clip_title ?? "Deleted clip"}</p>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {s.campaign_title ?? s.bounty_id} · submitted {formatDate(s.submitted_at)}
                    {s.resolved_at ? ` · resolved ${formatDate(s.resolved_at)}` : ""}
                  </p>
                </div>
                <StatusBadge status={s.status} />
              </div>
              {s.urls.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {s.urls.map((u) => (
                    <li key={u}>
                      <a href={u} target="_blank" rel="noopener noreferrer" className="chip max-w-[260px] truncate hover:text-fg">{new URL(u).hostname.replace("www.", "")} ↗</a>
                    </li>
                  ))}
                  {s.file_ids.length > 0 && <li className="chip">+ clip file</li>}
                </ul>
              )}
              {s.denial_reason && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">Reason: {s.denial_reason}</p>}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                {s.clip_id ? <Link href={`/clips/${s.clip_id}`} className="text-sm text-primary-strong hover:underline">Open clip →</Link> : <span />}
                {s.is_demo && s.status === "submitted" && !modes.whop && <SimulateReview submissionId={s.id} />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
