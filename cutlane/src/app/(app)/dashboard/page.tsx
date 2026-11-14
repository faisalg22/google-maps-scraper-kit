import Link from "next/link";
import { PLANS } from "@/config/plans";
import { requirePageAccess, usageMeters } from "@/lib/billing/server";
import { dashboardCounts } from "@/lib/repo";
import { UsageMeter } from "@/components/billing";
import { Alert, PageHeader } from "@/components/ui";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const b = await requirePageAccess("read");
  const [meters, counts] = await Promise.all([usageMeters(b), dashboardCounts(b.user.id)]);
  const warn = meters.filter((m) => m.level === "warn");
  const full = meters.filter((m) => m.level === "full");
  const plan = b.ent.plan ? PLANS[b.ent.plan] : null;

  return (
    <>
      <PageHeader
        title={`Hi${b.user.name ? `, ${b.user.name.split(" ")[0]}` : ""}`}
        subtitle={<>{plan?.name} plan · monthly limits reset {b.ent.usagePeriod ? b.ent.usagePeriod.end.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}</>}
        actions={<Link href="/billing" className="btn-secondary">Billing</Link>}
      />

      <div className="mb-6 space-y-2">
        {full.length > 0 && (
          <Alert kind="error">
            Limit reached for {full.length} item{full.length > 1 ? "s" : ""}. New ones are blocked; nothing was deleted.{" "}
            <Link href="/pricing" className="font-semibold underline">Upgrade</Link>
          </Alert>
        )}
        {warn.length > 0 && <Alert kind="warn">You&apos;ve used 80% or more of {warn.length} limit{warn.length > 1 ? "s" : ""}.</Alert>}
      </div>

      <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Campaigns", "/campaigns", "Find paid work"],
          ["Research", "/research", "Hooks that work"],
          ["Import clip", "/clips/new", "Upload an MP4"],
          ["Submissions", "/submissions", `${counts.pending} pending · ${counts.approved} approved`],
        ].map(([t, href, sub]) => (
          <Link key={href} href={href} className="card p-4 transition hover:border-border-strong">
            <p className="font-semibold">{t}</p>
            <p className="mt-0.5 text-xs text-muted">{sub}</p>
          </Link>
        ))}
      </section>

      <h2 className="mb-3 text-lg font-semibold">Usage</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {meters.map((m) => (
          <UsageMeter key={m.metric} metric={m.metric} used={m.used} limit={m.limit} detail={m.detail} />
        ))}
      </div>
    </>
  );
}
