import Link from "next/link";
import { FEATURE_LABELS, PLANS, type Feature, type Metric } from "@/config/plans";
import { getCurrentUser } from "@/lib/auth/session";
import { demoAllowed, env, modes } from "@/lib/env";
import { ensureWorkspace, loadSubscription, trialEligible } from "@/lib/billing/server";
import { annualAvailable } from "@/lib/billing/stripe";
import { startCheckout } from "../billing-actions";
import { ContactSalesForm, WaitlistForm } from "@/components/billing-client";
import { Alert, DemoTag } from "@/components/ui";
import { Logo } from "@/components/Brand";
import { ThemeToggle } from "@/components/theme";
import { LegalFooterLinks } from "@/components/LegalPage";

export const metadata = { title: "Pricing" };
export const dynamic = "force-dynamic";

const fmtLimit = (n: number | null) => (n === null ? "Unlimited" : n.toLocaleString());

const ROWS: { label: string; metric?: Metric; feature?: Feature; custom?: string }[] = [
  { label: "Saved YouTube channels", metric: "saved_channels" },
  { label: "Clip uploads / month", metric: "clips_monthly" },
  { label: "Whop submissions / month", metric: "submissions_monthly" },
  { label: "Swipe-file notes", metric: "notes" },
  { label: "Accounts per platform (IG, TikTok, Shorts)", metric: "accounts_per_platform" },
  { label: "Seats", metric: "seats" },
  { label: FEATURE_LABELS.campaigns, feature: "campaigns" },
  { label: FEATURE_LABELS.youtube_research, feature: "youtube_research" },
  { label: FEATURE_LABELS.manual_posting, feature: "manual_posting" },
  { label: FEATURE_LABELS.whop_submit, feature: "whop_submit" },
  { label: FEATURE_LABELS.editor, feature: "editor" },
  { label: FEATURE_LABELS.ai_cuts, feature: "ai_cuts" },
  { label: FEATURE_LABELS.captions, feature: "captions" },
  { label: FEATURE_LABELS.auto_post, feature: "auto_post" },
  { label: FEATURE_LABELS.saved_projects, feature: "saved_projects" },
  { label: "Render minutes / month", metric: "render_minutes_monthly" },
  { label: "AI cuts / month", metric: "ai_cuts_monthly" },
];

const FAQ: [string, React.ReactNode][] = [
  [
    "How does the 3-day free trial work?",
    <>Beginner includes a 3-day free trial. You add a card at checkout but aren&apos;t charged during the trial. If you don&apos;t cancel, the trial converts to $29/month on day 3. Each account can use the trial once.</>,
  ],
  ["Can I cancel anytime?", <>Yes. Cancel from Billing in one click. You keep access until the end of the period you paid for (or the trial), and you won&apos;t be charged again.</>],
  [
    "What happens when I hit a limit?",
    <>You&apos;ll see a warning at 80%. At 100%, the action is blocked and you&apos;re offered an upgrade. Nothing is ever deleted. Monthly limits (uploads, submissions) reset on your billing date.</>,
  ],
  [
    "What if a payment fails?",
    <>You get a 3-day grace period with full access while you update your card. After that your account is read-only (you can still see your data) until the payment goes through.</>,
  ],
  ["Is there a free plan?", <>No. Every plan is paid, and Beginner&apos;s trial lets you try everything first.</>],
  ["When is Clipper available?", <>Clipper comes with the in-app editor and auto-post. Join the waitlist and we&apos;ll email you. You won&apos;t be charged until it launches.</>],
];

export default async function PricingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const annualOn = annualAvailable();
  const interval: "month" | "year" = annualOn && (sp.billing === "annual" || sp.interval === "year") ? "year" : "month";

  let eligible = true;
  let current: { plan: string; status: string } | null = null;
  if (user) {
    const ws = await ensureWorkspace(user);
    eligible = await trialEligible(user, ws);
    const s = await loadSubscription(ws.id);
    if (s && !["canceled", "incomplete_expired", "incomplete"].includes(s.status)) current = { plan: s.plan, status: s.status };
  }
  const b = PLANS.beginner;
  const c = PLANS.clipper;
  const price = (p: typeof b) => (interval === "year" ? p.annualPrice! : p.monthlyPrice!);

  return (
    <div className="hero-glow bg-no-repeat">
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex items-center justify-between">
        <Logo href="/" />
        <div className="flex items-center gap-2">
          {!modes.stripe && demoAllowed() && <DemoTag label="Test mode" />}
          <ThemeToggle compact />
          {user ? <Link href="/dashboard" className="btn-ghost">Back to app</Link> : <Link href="/?returnTo=/pricing" className="btn-ghost">Sign in</Link>}
        </div>
      </header>

      <section className="mx-auto mt-10 max-w-2xl text-center">
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">Simple plans for serious clippers</h1>
        <p className="mt-3 text-fg-secondary">Research hooks, post clips and submit to Whop from one place. Start with a 3-day free trial.</p>
      </section>

      <div className="mx-auto mt-6 max-w-2xl space-y-2">
        {sp.required && <Alert kind="info">CutLane has no free plan. Pick a plan (or start your trial) to continue. Your data is kept either way.</Alert>}
        {sp.checkout === "canceled" && <Alert kind="warn">Checkout canceled. You weren&apos;t charged.</Alert>}
        {sp.clipper === "soon" && <Alert kind="info">Clipper isn&apos;t available yet. Join the waitlist below.</Alert>}
        {!modes.stripe && demoAllowed() && <Alert kind="warn">Test mode: Stripe keys aren&apos;t set, so checkout is simulated and no card is charged.</Alert>}
        {(sp.checkout === "unavailable" || (!modes.stripe && !demoAllowed())) && <Alert kind="error">Checkout is temporarily unavailable. Please try again later.</Alert>}
      </div>

      {annualOn && (
        <div className="mt-6 flex justify-center">
          <div className="inline-flex rounded-xl border border-border bg-card p-1 text-sm">
            <Link href="/pricing" className={`rounded-lg px-4 py-1.5 ${interval === "month" ? "bg-raised-hover text-fg" : "text-muted"}`}>Monthly</Link>
            <Link href="/pricing?billing=annual" className={`rounded-lg px-4 py-1.5 ${interval === "year" ? "bg-raised-hover text-fg" : "text-muted"}`}>
              Annual <span className="text-primary-strong">· 2 months free</span>
            </Link>
          </div>
        </div>
      )}

      <section className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Beginner */}
        <div className={`card relative flex flex-col p-6 ${sp.start === "beginner" ? "border-accent" : "border-accent/50"}`}>
          <span className="absolute -top-3 left-6 rounded-full bg-primary px-2.5 py-0.5 text-xs font-bold text-primary-fg">3-day free trial</span>
          <h2 className="text-xl font-bold">{b.name}</h2>
          <p className="mt-1 text-sm text-muted">{b.tagline}</p>
          <p className="mt-5">
            <span className="text-4xl font-extrabold">${price(b)}</span>
            <span className="text-muted">/{interval === "year" ? "year" : "month"}</span>
          </p>
          {interval === "year" && <p className="text-xs text-primary-strong">That&apos;s ${(b.annualPrice! / 12).toFixed(2)}/mo: 2 months free</p>}
          <ul className="mt-5 space-y-2 text-sm text-fg-secondary">
            <li>✓ {b.limits.clips_monthly} clip uploads / month</li>
            <li>✓ {b.limits.submissions_monthly} Whop submissions / month</li>
            <li>✓ {b.limits.saved_channels} saved YouTube channels</li>
            <li>✓ {b.limits.notes} swipe-file notes</li>
            <li>✓ {b.limits.accounts_per_platform} account per platform</li>
            <li>✓ Manual posting with link capture</li>
            <li className="text-muted">✗ Editor &amp; auto-post</li>
          </ul>
          <div className="mt-auto pt-6">
            {current ? (
              <Link href="/billing" className="btn-secondary w-full">{current.plan === "beginner" ? "Current plan · Manage" : "Manage billing"}</Link>
            ) : (
              <form action={startCheckout}>
                <input type="hidden" name="plan" value="beginner" />
                <input type="hidden" name="interval" value={interval} />
                <button className="btn-cta w-full py-3 text-base">{eligible ? "Start 3-day free trial" : `Subscribe for $${price(b)}`}</button>
              </form>
            )}
            <p className="mt-2 text-center text-xs text-muted">
              {eligible ? `Card required. Then $${price(b)}/${interval === "year" ? "yr" : "mo"} unless you cancel. One trial per account.` : "You've already used your free trial."}{" "}
              By continuing you agree to the <Link href="/terms" className="underline">Terms</Link> and <Link href="/privacy" className="underline">Privacy Policy</Link>.
            </p>
          </div>
        </div>

        {/* Clipper */}
        <div className="card relative flex flex-col p-6">
          <span className="absolute -top-3 left-6 rounded-full border border-border-strong bg-raised px-2.5 py-0.5 text-xs font-bold text-fg-secondary">Coming soon</span>
          <h2 className="text-xl font-bold">{c.name}</h2>
          <p className="mt-1 text-sm text-muted">{c.tagline}</p>
          <p className="mt-5">
            <span className="text-4xl font-extrabold">${price(c)}</span>
            <span className="text-muted">/{interval === "year" ? "year" : "month"}</span>
          </p>
          <ul className="mt-5 space-y-2 text-sm text-fg-secondary">
            <li>✓ Everything in Beginner, plus:</li>
            <li>✓ {c.limits.clips_monthly} uploads &amp; {c.limits.submissions_monthly} submissions / month</li>
            <li>✓ {c.limits.saved_channels} saved channels, unlimited notes</li>
            <li>✓ {c.limits.accounts_per_platform} accounts per platform</li>
            <li>✓ Full editor, AI cuts &amp; captions</li>
            <li>✓ Auto-post + saved projects</li>
            <li>✓ {c.limits.render_minutes_monthly} render min &amp; {c.limits.ai_cuts_monthly} AI cuts / month</li>
          </ul>
          <div className="mt-auto pt-6">
            {env.flags.clipperAvailable ? (
              current ? (
                <Link href="/billing" className="btn-secondary w-full">Manage billing</Link>
              ) : (
                <form action={startCheckout}>
                  <input type="hidden" name="plan" value="clipper" />
                  <input type="hidden" name="interval" value={interval} />
                  <button className="btn-primary w-full">Subscribe</button>
                </form>
              )
            ) : (
              <>
                <WaitlistForm signedInEmail={user?.email} />
                <p className="mt-2 text-center text-xs text-muted">Not charged until launch.</p>
              </>
            )}
          </div>
        </div>

        {/* Custom */}
        <div className="card flex flex-col p-6">
          <h2 className="text-xl font-bold">Custom</h2>
          <p className="mt-1 text-sm text-muted">{PLANS.custom.tagline}</p>
          <p className="mt-5 text-4xl font-extrabold">Let&apos;s talk</p>
          <ul className="mt-5 space-y-2 text-sm text-fg-secondary">
            <li>✓ Custom limits for every metric</li>
            <li>✓ Multiple seats for your team</li>
            <li>✓ More accounts per platform</li>
            <li>✓ Invoiced billing</li>
          </ul>
          <div className="mt-auto pt-6">
            <a href="#custom" className="btn-secondary w-full">Contact sales</a>
          </div>
        </div>
      </section>

      <section className="mt-14">
        <h2 className="mb-4 text-2xl font-bold">Compare plans</h2>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="p-3 font-medium">Feature</th>
                <th className="p-3 font-medium">Beginner</th>
                <th className="p-3 font-medium">Clipper <span className="text-xs">(soon)</span></th>
                <th className="p-3 font-medium">Custom</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.label} className="border-b border-border-subtle last:border-0">
                  <td className="p-3 text-fg-secondary">{r.label}</td>
                  {(["beginner", "clipper", "custom"] as const).map((p) => (
                    <td key={p} className="p-3">
                      {r.metric
                        ? p === "custom"
                          ? "Custom"
                          : PLANS[p].limits[r.metric] === 0
                            ? <span className="text-muted">—</span>
                            : fmtLimit(PLANS[p].limits[r.metric])
                        : PLANS[p].features.includes(r.feature!)
                          ? <span className="text-primary-strong">✓</span>
                          : <span className="text-muted">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-14 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div>
          <h2 className="mb-4 text-2xl font-bold">FAQ</h2>
          <div className="space-y-2">
            {FAQ.map(([qn, a]) => (
              <details key={qn} className="card group p-4">
                <summary className="cursor-pointer list-none font-medium">
                  <span className="mr-2 inline-block text-primary-strong transition group-open:rotate-90">›</span>
                  {qn}
                </summary>
                <p className="mt-2 text-sm text-fg-secondary">{a}</p>
              </details>
            ))}
          </div>
        </div>
        <div id="custom" className="scroll-mt-6">
          <h2 className="mb-1 text-2xl font-bold">Contact sales</h2>
          <p className="mb-4 text-sm text-muted">Tell us about your team and we&apos;ll set up a Custom plan.</p>
          <div className="card p-5">
            <ContactSalesForm defaultName={user?.name ?? undefined} defaultEmail={user?.email ?? undefined} />
          </div>
        </div>
      </section>

      <footer className="mt-16 border-t border-border-subtle pt-6 text-xs text-muted">Prices in USD. Taxes may apply. CutLane is not affiliated with Whop. <LegalFooterLinks className="ml-3" /></footer>
    </div>
    </div>
  );
}
