import { notFound } from "next/navigation";
import { PLANS, type Metric } from "@/config/plans";
import { getBilling, isAdmin } from "@/lib/billing/server";
import { q } from "@/lib/db";
import { adminEndCustomPlan } from "@/app/billing-actions";
import { AdminPlanForm } from "@/components/AdminPlanForm";
import { Badge, PageHeader, formatDate } from "@/components/ui";

export const metadata = { title: "Admin" };

export default async function AdminPage() {
  const b = await getBilling();
  if (!isAdmin(b.user)) notFound();

  const workspaces = await q<{
    id: string; name: string; owner: string | null; custom_limits: Record<string, number | null>; seats: number | null;
    plan: string | null; status: string | null; source: string | null; members: number; created_at: Date;
  }>(
    `select w.id, w.name, coalesce(u.username, u.name, u.whop_user_id) as owner, w.custom_limits, w.seats, s.plan, s.status, s.source,
            (select count(*)::int from workspace_members m where m.workspace_id = w.id) as members, w.created_at
       from workspaces w join users u on u.id = w.owner_user_id left join subscriptions s on s.workspace_id = w.id
      order by w.created_at desc limit 200`,
  );
  const leads = await q<{ id: string; name: string; email: string; team_size: string; accounts_needed: string; message: string | null; email_status: string; created_at: Date }>(
    `select id, name, email, team_size, accounts_needed, message, email_status, created_at from sales_leads order by created_at desc limit 50`,
  );
  const waitlist = await q<{ n: number }>(`select count(*)::int as n from waitlist where plan = 'clipper'`);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader title="Admin" subtitle={`Workspaces, Custom plans and sales leads. Clipper waitlist: ${waitlist[0]?.n ?? 0}.`} />

      <section>
        <h2 className="mb-3 text-lg font-semibold">Workspaces</h2>
        <div className="space-y-3">
          {workspaces.map((w) => {
            const defaults = PLANS.custom.limits;
            const current = Object.fromEntries(
              (Object.keys(defaults) as Metric[]).map((m) => [m, m in (w.custom_limits ?? {}) ? w.custom_limits[m] : defaults[m]]),
            );
            return (
              <details key={w.id} className="card p-4">
                <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="font-semibold">{w.name}</span> <span className="text-xs text-muted">@{w.owner} · {w.members} member{w.members === 1 ? "" : "s"} · since {formatDate(w.created_at.toString())}</span>
                  </span>
                  <span className="flex gap-1.5">
                    <Badge color={w.plan ? "lane" : "neutral"}>{w.plan ? PLANS[w.plan as keyof typeof PLANS].name : "No plan"}</Badge>
                    {w.status && <Badge>{w.status}{w.source ? ` · ${w.source}` : ""}</Badge>}
                  </span>
                </summary>
                <div className="mt-4 border-t border-border pt-4">
                  <AdminPlanForm workspaceId={w.id} current={current} seats={w.seats ?? 1} />
                  {w.source === "manual" && w.status === "active" && (
                    <form action={adminEndCustomPlan.bind(null, w.id)} className="mt-3">
                      <button className="btn-danger px-3 py-1.5 text-xs">End Custom plan</button>
                    </form>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Sales leads</h2>
        {leads.length === 0 ? (
          <p className="text-sm text-muted">No leads yet.</p>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-muted">
                <tr className="border-b border-border">
                  <th className="p-3 font-medium">Date</th><th className="p-3 font-medium">Name</th><th className="p-3 font-medium">Email</th>
                  <th className="p-3 font-medium">Team</th><th className="p-3 font-medium">Accounts</th><th className="p-3 font-medium">Email sent</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id} className="border-b border-border-subtle align-top last:border-0">
                    <td className="p-3 text-muted">{formatDate(l.created_at.toString())}</td>
                    <td className="p-3">{l.name}{l.message && <p className="mt-1 max-w-xs text-xs text-muted">{l.message}</p>}</td>
                    <td className="p-3"><a href={`mailto:${l.email}`} className="text-primary-strong hover:underline">{l.email}</a></td>
                    <td className="p-3">{l.team_size}</td>
                    <td className="p-3">{l.accounts_needed}</td>
                    <td className="p-3"><Badge color={l.email_status === "sent" ? "green" : l.email_status === "failed" ? "red" : "neutral"}>{l.email_status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
