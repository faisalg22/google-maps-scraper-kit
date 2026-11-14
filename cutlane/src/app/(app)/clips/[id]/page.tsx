import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageAccess } from "@/lib/billing/server";
import { modes } from "@/lib/env";
import { getClip, linkIsSubmittable, listClipSubmissions, listPostLinks } from "@/lib/repo";
import { getCampaign } from "@/lib/whop/campaigns";
import { PLATFORMS } from "@/lib/whop/campaigns-core";
import { deleteClip } from "@/app/actions";
import { PostingPanel } from "@/components/PostingPanel";
import { SubmitPanel } from "@/components/SubmitPanel";
import { ClipSettings } from "@/components/ClipSettings";
import { BackLink, CopyrightNotice, StatusBadge, formatBytes, formatDate } from "@/components/ui";

export default async function ClipPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, ent } = await requirePageAccess("read");
  const { id } = await params;
  const clip = await getClip(user.id, id);
  if (!clip) notFound();
  const [links, subs] = await Promise.all([listPostLinks(clip.id), listClipSubmissions(user.id, clip.id)]);
  const campaign = clip.campaign_id ? await getCampaign(user.id, clip.campaign_id).catch(() => null) : null;

  const urls = links.filter(linkIsSubmittable).map((l) => l.url!);
  const activeSub = subs.find((s) => ["submitted", "in_progress", "approved"].includes(s.status));
  const blockers: string[] = [];
  if (!clip.campaign_id) blockers.push("Link the clip to a campaign (re-import from the campaign page).");
  else if (campaign && campaign.status !== "open") blockers.push(`The campaign is ${campaign.status}.`);
  if (!urls.length) blockers.push("Save at least one live post link that loads publicly.");
  for (const l of links) {
    if (l.url && l.check_status === "blocked" && !l.manual_confirmed) blockers.push(`Confirm the ${l.platform.replace("_", " ")} link loads when logged out.`);
    if (l.url && l.check_status === "failed") blockers.push(`Fix the ${l.platform.replace("_", " ")} link: it doesn't load.`);
  }
  if (activeSub) blockers.push(activeSub.status === "approved" ? "Already approved." : "Already submitted and waiting for review.");
  const canAttach = !campaign || campaign.deliverableTypes.length === 0 || campaign.deliverableTypes.includes("media");
  if (!ent.canWrite) blockers.unshift("Your plan is restricted. Update billing to post and submit.");
  const locked = Boolean(activeSub) || !ent.canWrite;

  return (
    <div className="mx-auto max-w-6xl">
      <BackLink href="/clips">Clip library</BackLink>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={clip.status} />
        <span className="text-xs text-ink-400">Imported {formatDate(clip.created_at)} · {formatBytes(clip.size_bytes)}</span>
      </div>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">{clip.title}</h1>
      {clip.campaign_id && (
        <p className="mt-1 text-sm text-ink-400">
          For{" "}
          <Link href={`/campaigns/${encodeURIComponent(clip.campaign_id)}`} className="text-lane-400 hover:underline">
            {clip.campaign_title ?? clip.campaign_id}
          </Link>
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <video src={`/api/clips/${clip.id}/file`} controls playsInline preload="metadata" className="mx-auto aspect-[9/16] w-full max-w-[220px] sm:max-w-[300px] rounded-2xl border border-ink-700 bg-black object-contain" />
          <div className="card space-y-4 p-4">
            <ClipSettings clipId={clip.id} title={clip.title} />
            <form action={deleteClip.bind(null, clip.id)}>
              <button className="btn-danger w-full text-xs">Delete clip</button>
            </form>
          </div>
        </aside>

        <div className="space-y-6">
          <section>
            <h2 className="mb-1 text-lg font-semibold">1 · Post it</h2>
            <p className="mb-3 text-sm text-ink-400">Post manually on each platform, then paste the live link. We check the format and that the post loads publicly.</p>
            <div className="space-y-3">
              {PLATFORMS.map((p) => (
                <PostingPanel key={p} clipId={clip.id} platform={p} link={links.find((l) => l.platform === p) ?? null} locked={locked} />
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold">2 · Submit to Whop</h2>
            <SubmitPanel clipId={clip.id} urls={urls} blockers={blockers} canAttach={canAttach} isDemo={!modes.whop} />
          </section>

          {subs.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold">3 · Track review</h2>
              <ul className="space-y-2">
                {subs.map((s) => (
                  <li key={s.id} className="card flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                    <span className="text-ink-300">Submitted {formatDate(s.submitted_at)} · {s.urls.length} link{s.urls.length === 1 ? "" : "s"}</span>
                    <StatusBadge status={s.status} />
                    {s.denial_reason && <p className="w-full text-xs text-red-300">Reason: {s.denial_reason}</p>}
                  </li>
                ))}
              </ul>
              <Link href="/submissions" className="mt-2 inline-block text-sm text-lane-400 hover:underline">All submissions →</Link>
            </section>
          )}

          <CopyrightNotice compact />
        </div>
      </div>
    </div>
  );
}
