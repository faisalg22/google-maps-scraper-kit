import Link from "next/link";
import { GOAL_LABELS, PLATFORM_LABELS, formatMoney, type Campaign } from "@/lib/whop/campaigns-core";
import { Badge, DemoTag, Stat, StatusBadge } from "./ui";

function BrandMark({ c }: { c: Campaign }) {
  if (c.brand?.logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={c.brand.logoUrl} alt="" className="h-10 w-10 shrink-0 rounded-xl bg-subtle object-contain" loading="lazy" />;
  }
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-subtle-strong text-sm font-bold text-fg-secondary">
      {(c.brand?.name ?? c.title).replace(/^\[DEMO\]\s*/, "").slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Shows a field only when the data really has it (live data hides the unverified ones). */
export function CampaignCard({ c }: { c: Campaign }) {
  const money = (n: number | null | undefined) => formatMoney(n, c.currency);
  const stats: { label: string; value: string; hint?: string }[] = [];
  if (c.rewardPerAccepted !== null) stats.push({ label: "Per accepted clip", value: money(c.rewardPerAccepted), hint: "gross_reward_amount" });
  if (c.rewardPer1kViews !== undefined) stats.push({ label: "Per 1k views", value: money(c.rewardPer1kViews) });
  if (c.budget !== null) stats.push({ label: "Budget", value: money(c.budget) });
  if (c.spotsRemaining !== null) stats.push({ label: "Spots left", value: String(c.spotsRemaining) });
  if (c.minPayout !== undefined || c.maxPayout !== undefined) {
    stats.push({ label: "Payout range", value: `${money(c.minPayout)} – ${money(c.maxPayout)}` });
  }
  if (c.flatFeeBonus !== undefined) stats.push({ label: "Flat bonus", value: money(c.flatFeeBonus) });

  return (
    <Link href={`/campaigns/${encodeURIComponent(c.id)}`} className="card group flex flex-col p-4 transition hover:border-border-strong hover:bg-subtle/60 sm:p-5">
      <div className="flex items-start gap-3">
        <BrandMark c={c} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {c.isDemo && <DemoTag />}
            <StatusBadge status={c.status} />
            {c.goalType && <Badge>{GOAL_LABELS[c.goalType]}</Badge>}
          </div>
          <h3 className="mt-1.5 line-clamp-2 font-semibold leading-snug text-fg group-hover:text-fg">{c.title}</h3>
          {c.brand && (
            <p className="mt-0.5 truncate text-xs text-muted">
              {c.brand.name}
              {c.brandCategory ? ` · ${c.brandCategory}` : ""}
            </p>
          )}
        </div>
      </div>

      {stats.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-surface/70 p-3">
          {stats.map((s) => (
            <Stat key={s.label} label={s.label} value={s.value} hint={s.hint} />
          ))}
        </div>
      )}

      {c.description && <p className="mt-3 line-clamp-2 text-sm text-muted">{c.description.replace(/\s+/g, " ")}</p>}

      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-4">
        {c.platforms?.map((p) => (
          <span key={p} className="chip">
            {PLATFORM_LABELS[p]}
          </span>
        ))}
        <span className="chip">{c.countries.length ? c.countries.slice(0, 4).join(", ") + (c.countries.length > 4 ? ` +${c.countries.length - 4}` : "") : "Worldwide"}</span>
        {c.contentLinks.length > 0 && <span className="chip border-primary-strong/30 text-primary-strong">Content link</span>}
      </div>
    </Link>
  );
}
