import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { modes } from "@/lib/env";
import { safeReturnTo } from "@/lib/whop/oauth";
import { demoSignIn } from "./actions";
import { Alert, CopyrightNotice, DemoTag } from "@/components/ui";

const ERRORS: Record<string, string> = {
  access_denied: "You cancelled the Whop sign-in.",
  invalid_state: "The sign-in link expired or was tampered with. Please try again.",
  token_exchange_failed: "Whop sign-in failed while exchanging the code. Please try again.",
  missing_encryption_key: "Server misconfiguration: TOKEN_ENCRYPTION_KEY is not set.",
  oauth_error: "Whop returned an error during sign-in.",
  no_user: "Whop didn't return a user profile.",
};

const steps = [
  ["Browse", "Open Whop Content Rewards campaigns with rates, budget and requirements."],
  ["Research", "Find 50k+ subscriber channels and save the hooks that work."],
  ["Import", "Upload your finished MP4 clips and link them to a campaign."],
  ["Post", "Follow a checklist for Instagram, TikTok and YouTube Shorts."],
  ["Capture", "Paste each live post link. We check the format and that it loads."],
  ["Submit", "Send the links (and the file) to Whop and track approval."],
];

export default async function Landing({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const returnTo = safeReturnTo(sp.returnTo);
  if (user) redirect(returnTo);
  const error = sp.error ? (ERRORS[sp.error] ?? "Sign-in failed.") : null;

  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-lane-400/10 blur-3xl" />
      <div className="relative mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-16">
        <header className="flex items-center justify-between">
          <span className="text-lg font-bold tracking-tight">
            Cut<span className="text-lane-400">Lane</span>
          </span>
          {!modes.whop && <DemoTag label="Demo mode" />}
        </header>

        <section className="mt-14 max-w-2xl sm:mt-20">
          <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
            From campaign to <span className="text-lane-400">approved clip</span> in one lane.
          </h1>
          <p className="mt-5 text-lg text-ink-300">
            CutLane is the workspace for editors clipping Whop Content Rewards campaigns: research hooks on YouTube, import your clips, post them,
            capture the links and submit them to Whop without switching tabs.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            {modes.whop ? (
              <a href={`/api/auth/whop/start?returnTo=${encodeURIComponent(returnTo)}`} className="btn-primary px-6 py-3 text-base">
                Sign in with Whop
              </a>
            ) : (
              <form action={demoSignIn}>
                <button className="btn-primary w-full px-6 py-3 text-base sm:w-auto">Enter the demo</button>
              </form>
            )}
            <span className="text-sm text-ink-400">
              {modes.whop ? "Uses your own Whop account (OAuth 2.1 + PKCE). Tokens stay on our server." : "Whop isn't configured yet, so you'll use mock campaigns."}
            </span>
          </div>
          {sp.signin && !error && (
            <div className="mt-4">
              <Alert kind="info">Sign in to continue.</Alert>
            </div>
          )}
          {error && (
            <div className="mt-4">
              <Alert kind="error">{error}</Alert>
            </div>
          )}
        </section>

        <section className="mt-16 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map(([title, body], i) => (
            <div key={title} className="card p-5">
              <p className="font-mono text-xs text-lane-400">0{i + 1}</p>
              <p className="mt-2 font-semibold">{title}</p>
              <p className="mt-1 text-sm text-ink-400">{body}</p>
            </div>
          ))}
        </section>

        <section className="mt-10 max-w-2xl">
          <CopyrightNotice />
        </section>

        <footer className="mt-16 border-t border-ink-800 pt-6 text-xs text-ink-400">
          CutLane is not affiliated with Whop, YouTube, Instagram or TikTok. <Link href="/status" className="underline">Integrations status</Link>
        </footer>
      </div>
    </div>
  );
}
