import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getCampaign } from "@/lib/whop/campaigns";
import { GOAL_LABELS, PLATFORM_LABELS, formatMoney } from "@/lib/whop/campaigns-core";
import { listClips } from "@/lib/repo";
import { Alert, BackLink, Badge, CopyrightNotice, DemoTag, StatusBadge, formatDate } from "@/components/ui";

function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"')\]]+)/g);
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-300">
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p.replace(/[.,;:!?]+$/, "")} target="_blank" rel="noopener noreferrer nofollow" className="text-lane-400 underline underline-offset-2">
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </p>
  );
}

export default async function CampaignDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const c = await getCampaign(user.id, decodeURIComponent(id));
  if (!c) notFound();
  const clips = (await listClips(user.id)).filter((x) => x.campaign_id === c.id);
  const money = (n: number | null | undefined) => formatMoney(n, c.currency);

  const rows: [string, React.ReactNode][] = [];
  if (c.goalType) rows.push(["Campaign type", GOAL_LABELS[c.goalType]]);
  if (c.brandCategory) rows.push(["Brand category", c.brandCategory]);
  if (c.rewardPerAccepted !== null) rows.push(["Reward per accepted clip", <>{money(c.rewardPerAccepted)}{c.netRewardPerAccepted !== null && <span className="text-ink-400"> · ≈ {money(c.netRewardPerAccepted)} after Whop fee</span>}</>]);
  if (c.rewardPer1kViews !== undefined) rows.push(["Reward per 1,000 views", money(c.rewardPer1kViews)]);
  if (c.minPayout !== undefined) rows.push(["Minimum payout", money(c.minPayout)]);
  if (c.maxPayout !== undefined) rows.push(["Maximum payout", money(c.maxPayout)]);
  if (c.flatFeeBonus !== undefined) rows.push(["Flat fee bonus", money(c.flatFeeBonus)]);
  if (c.budget !== null) rows.push(["Total budget", money(c.budget)]);
  if (c.spotsRemaining !== null) rows.push(["Spots left", String(c.spotsRemaining)]);
  if (c.platforms?.length) rows.push(["Platforms accepted", c.platforms.map((p) => PLATFORM_LABELS[p]).join(", ")]);
  rows.push(["Allowed countries", c.countries.length ? c.countries.join(", ") : "Worldwide"]);
  if (c.deliverableTypes.length) rows.push(["Accepts", c.deliverableTypes.map((d) => (d === "content_url" ? "Post links" : d === "media" ? "Uploaded files" : d)).join(" + ")]);
  if (c.createdAt) rows.push(["Posted", formatDate(c.createdAt)]);

  return (
    <div className="mx-auto max-w-5xl">
      <BackLink href="/campaigns">All campaigns</BackLink>
      <div className="flex flex-wrap items-center gap-2">
        {c.isDemo && <DemoTag />}
        <StatusBadge status={c.status} />
        {c.goalType && <Badge>{GOAL_LABELS[c.goalType]}</Badge>}
      </div>
      <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{c.title}</h1>
      {c.brand && <p className="mt-1 text-sm text-ink-400">by {c.brand.name}</p>}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">Requirements &amp; guidelines</h2>
            {c.description ? <Linkified text={c.description} /> : <p className="text-sm text-ink-400">No description provided.</p>}
          </section>

          <section className="card p-5">
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-ink-400">Available content</h2>
            <p className="mb-3 text-xs text-ink-400">Links found in the campaign description. Clip only from these sources.</p>
            {c.contentLinks.length ? (
              <ul className="space-y-2">
                {c.contentLinks.map((u) => (
                  <li key={u}>
                    <a href={u} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center justify-between gap-3 rounded-xl border border-ink-700 bg-ink-900 px-3 py-2.5 text-sm hover:border-lane-400/50">
                      <span className="truncate text-lane-400">{u}</span>
                      <span aria-hidden className="text-ink-400">↗</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <Alert kind="warn">No content link found. Check the campaign on Whop before you start clipping.</Alert>
            )}
          </section>

          <CopyrightNotice />
        </div>

        <aside className="space-y-4">
          <section className="card p-5">
            <dl className="space-y-3">
              {rows.map(([k, val]) => (
                <div key={k}>
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-400">{k}</dt>
                  <dd className="text-sm font-medium text-ink-100">{val}</dd>
                </div>
              ))}
            </dl>
            {!c.isDemo && (
              <p className="mt-4 border-t border-ink-700 pt-3 text-xs text-ink-400">
                Fields Whop doesn&apos;t document (per-1k-views rate, payout range, bonus, platforms, category) are hidden until confirmed in the API.
              </p>
            )}
          </section>

          <section className="card space-y-2 p-5">
            <Link href={`/research`} className="btn-secondary w-full">Research hooks on YouTube</Link>
            <Link href={`/clips/new?campaign=${encodeURIComponent(c.id)}`} className="btn-primary w-full">Import a clip for this campaign</Link>
            {c.whopUrl && (
              <a href={c.whopUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost w-full">Open {c.brand?.name ?? "brand"} on Whop ↗</a>
            )}
          </section>

          {clips.length > 0 && (
            <section className="card p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">Your clips</h2>
              <ul className="space-y-2">
                {clips.map((x) => (
                  <li key={x.id}>
                    <Link href={`/clips/${x.id}`} className="flex items-center justify-between gap-2 text-sm hover:text-white">
                      <span className="truncate">{x.title}</span>
                      <StatusBadge status={x.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
