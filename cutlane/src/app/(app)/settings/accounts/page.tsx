import { requirePageAccess } from "@/lib/billing/server";
import { q } from "@/lib/db";
import { PLATFORM_LABELS, PLATFORMS } from "@/lib/whop/campaigns-core";
import { removeSocialAccount } from "@/app/billing-actions";
import { AddAccountForm } from "@/components/billing-client";
import { Alert, PageHeader } from "@/components/ui";

export const metadata = { title: "Posting accounts" };

export default async function AccountsPage() {
  const b = await requirePageAccess("read");
  const rows = await q<{ id: string; platform: string; handle: string; profile_url: string | null }>(
    `select id, platform::text as platform, handle, profile_url from social_accounts where workspace_id = $1 order by platform, created_at`,
    [b.workspace.id],
  );
  const limit = b.ent.limits.accounts_per_platform;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Posting accounts" subtitle={`The Instagram, TikTok and YouTube accounts you post clips from. Your plan allows ${limit ?? "unlimited"} per platform.`} />
      <div className="mb-4">
        <Alert kind="info">V1 stores your handles for manual posting. Official account connection and auto-post come with Clipper (V2).</Alert>
      </div>
      {b.ent.canWrite && (
        <div className="card mb-6 p-4">
          <AddAccountForm platforms={PLATFORMS.map((p) => ({ id: p, label: PLATFORM_LABELS[p] }))} />
        </div>
      )}
      <div className="space-y-3">
        {PLATFORMS.map((p) => {
          const list = rows.filter((r) => r.platform === p);
          return (
            <section key={p} className="card p-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold">{PLATFORM_LABELS[p]}</p>
                <p className={`font-mono text-xs ${limit !== null && list.length >= limit ? "text-warning" : "text-muted"}`}>
                  {list.length} / {limit ?? "∞"}
                </p>
              </div>
              {list.length === 0 ? (
                <p className="mt-2 text-sm text-muted">No account added.</p>
              ) : (
                <ul className="mt-2 divide-y divide-border">
                  {list.map((a) => (
                    <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                      <a href={a.profile_url ?? "#"} target="_blank" rel="noopener noreferrer" className="hover:underline">@{a.handle}</a>
                      <form action={removeSocialAccount.bind(null, a.id)}>
                        <button className="text-xs text-muted hover:text-danger">Remove</button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
              {limit !== null && list.length > limit && <p className="mt-2 text-xs text-warning">Over your plan&apos;s limit after a plan change. Nothing was removed, but you can&apos;t add more.</p>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
