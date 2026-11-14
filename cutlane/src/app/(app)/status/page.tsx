import { requireUser } from "@/lib/auth/session";
import { configWarnings, env, modes } from "@/lib/env";
import { getDb, q } from "@/lib/db";
import { pendingMigrations } from "@/lib/db/migrate-core";
import { DAILY_QUOTA, quotaUsedToday } from "@/lib/youtube/api";
import { UNVERIFIED_FIELD_PATHS } from "@/lib/whop/campaigns-core";
import { Alert, Badge, PageHeader } from "@/components/ui";

export const metadata = { title: "Integrations status" };

const CONFIRMED = ["title", "description", "business_goal_type", "gross_reward_amount", "budget_amount", "spots_remaining", "hosting_account", "allowed_country_codes", "status"];

function Row({ name, live, detail, vars }: { name: string; live: boolean; detail: string; vars: string }) {
  return (
    <li className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-medium">{name}</p>
        <p className="text-xs text-muted">{detail}</p>
        <p className="mt-0.5 font-mono text-[11px] text-muted">{vars}</p>
      </div>
      <Badge color={live ? "green" : "amber"}>{live ? "LIVE" : "DEMO"}</Badge>
    </li>
  );
}

export default async function StatusPage() {
  await requireUser();
  const db = await getDb();
  const pending = await pendingMigrations(db).catch(() => ["(could not read)"]);
  const samples = await q<{ endpoint: string; payload: unknown; captured_at: Date }>(`select endpoint, payload, captured_at from api_samples order by captured_at`);
  const quota = modes.youtube ? await quotaUsedToday() : 0;
  const warnings = configWarnings();

  const bountySample = samples.find((s) => s.endpoint === "GET /bounties");
  const firstBounty = (bountySample?.payload as { data?: Record<string, unknown>[] } | undefined)?.data?.[0];
  const keys = firstBounty ? Object.keys(firstBounty).sort() : [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Integrations status" subtitle="What runs on real APIs and what's mocked. Secret values are never shown." />

      {warnings.map((w) => (
        <Alert key={w} kind="warn">{w}</Alert>
      ))}

      <section className="card px-5">
        <ul className="divide-y divide-border">
          <Row name="Stripe billing" live={modes.stripe} detail={modes.stripe ? `Checkout, Customer Portal and webhooks${env.stripe.webhookSecret ? "" : " (webhook secret missing!)"}. Annual: ${env.flags.annualBilling ? "on" : "off"}. Clipper checkout: ${env.flags.clipperAvailable ? "on" : "off"}.` : "Test mode: simulated checkout and billing events, no charges."} vars="STRIPE_SECRET_KEY · STRIPE_WEBHOOK_SECRET · STRIPE_PRICE_BEGINNER · STRIPE_PRICE_CLIPPER" />
          <Row name="Sales email" live={modes.email} detail={modes.email ? "Contact-sales leads are emailed via Resend." : "Leads are saved to the database; email isn't sent."} vars="RESEND_API_KEY · SALES_NOTIFY_EMAIL" />
          <Row name="Whop" live={modes.whop} detail={modes.whop ? `Sign in with Whop, bounties and submissions. API version ${env.whop.apiVersionDate}. Scopes: ${env.whop.scopes}` : "Mock campaigns, demo sign-in and simulated submissions."} vars="WHOP_CLIENT_ID · WHOP_CLIENT_SECRET · WHOP_REDIRECT_URI" />
          <Row name="YouTube Data API" live={modes.youtube} detail={modes.youtube ? `Quota today: ${quota.toLocaleString()} / ${DAILY_QUOTA.toLocaleString()} units.` : "Mock channels and videos with a simulated player."} vars="YOUTUBE_API_KEY" />
          <Row name="Database" live={modes.database} detail={modes.database ? "Supabase Postgres via DATABASE_URL." : "Local embedded Postgres (PGlite) in ./.data/pglite."} vars="DATABASE_URL" />
          <Row name="Clip storage" live={modes.storage} detail={modes.storage ? `Private Supabase Storage bucket "${env.supabase.bucket}".` : "Local disk in ./.data/uploads."} vars="SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY" />
          <Row name="Token encryption" live={Boolean(env.tokenEncryptionKey)} detail={env.tokenEncryptionKey ? "AES-256-GCM with TOKEN_ENCRYPTION_KEY." : "Using an auto-generated local dev key (.data/dev-secret.key)."} vars="TOKEN_ENCRYPTION_KEY" />
        </ul>
      </section>

      <section className="card p-5">
        <h2 className="font-semibold">Database migrations</h2>
        <p className="mt-1 text-sm text-muted">
          {pending.length === 0 ? "All migrations applied." : `Pending: ${pending.join(", ")}. Run npm run db:migrate.`}
        </p>
      </section>

      <section className="card p-5">
        <h2 className="font-semibold">Campaign fields check</h2>
        <p className="mt-1 text-sm text-muted">
          The first real <code className="font-mono">GET /bounties</code> response is saved here (and printed in the server log) so the unconfirmed card fields can be checked against what Whop really returns.
        </p>
        {!firstBounty ? (
          <p className="mt-3 text-sm text-muted">{modes.whop ? "No live response captured yet. Open Campaigns once." : "Whop isn't live, so nothing has been captured."}</p>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="label">Confirmed fields</p>
                <ul className="space-y-1 text-sm">
                  {CONFIRMED.map((k) => (
                    <li key={k} className="font-mono text-xs">{k in firstBounty ? "✓" : "✗ missing"} {k}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="label">All keys in the first bounty</p>
                <p className="font-mono text-xs leading-relaxed text-fg-secondary">{keys.join(", ")}</p>
              </div>
            </div>
            <p className="mt-4 text-xs text-muted">
              To show an unverified field (per-1k-views, payout range, bonus, platforms, category), add its exact key to <code className="font-mono">UNVERIFIED_FIELD_PATHS</code> in <code className="font-mono">src/lib/whop/campaigns-core.ts</code>. Currently mapped:{" "}
              {Object.entries(UNVERIFIED_FIELD_PATHS).filter(([, v]) => v.length).map(([k]) => k).join(", ") || "none"}.
            </p>
          </>
        )}
        {samples.map((s) => (
          <details key={s.endpoint} className="mt-4">
            <summary className="cursor-pointer text-sm text-primary-strong">Raw sample: {s.endpoint} ({new Date(s.captured_at).toLocaleString()})</summary>
            <pre className="mt-2 max-h-96 overflow-auto rounded-xl bg-bg p-3 text-[11px] leading-relaxed text-fg-secondary">{JSON.stringify(s.payload, null, 2)}</pre>
          </details>
        ))}
      </section>
    </div>
  );
}
