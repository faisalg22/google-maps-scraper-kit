import Link from "next/link";
import { getBilling, planName } from "@/lib/billing/server";
import { signOut } from "@/app/actions";
import { ThemeToggle } from "@/components/theme";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const b = await getBilling();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Settings" subtitle="Appearance, account and billing." />

      <section className="card p-5" aria-labelledby="appearance">
        <h2 id="appearance" className="text-base font-semibold">Appearance</h2>
        <p className="mt-1 text-sm text-muted">
          Choose Light, Dark, or System to follow your device. Saved to your account, so it applies on every device you sign in on.
        </p>
        <ThemeToggle className="mt-4" />
      </section>

      <section className="card divide-y divide-border p-0" aria-label="Account">
        {[
          ["/billing", "Billing & usage", planName(b)],
          ["/settings/accounts", "Posting accounts", "Instagram, TikTok and YouTube handles"],
          ["/pricing", "Plans", "Compare Beginner, Clipper and Custom"],
          ["/status", "Integrations status", "What's live and what's in demo mode"],
        ].map(([href, label, sub]) => (
          <Link key={href} href={href} className="flex items-center justify-between gap-3 px-5 py-4 hover:bg-subtle">
            <span>
              <span className="block text-sm font-medium">{label}</span>
              <span className="block text-xs text-muted">{sub}</span>
            </span>
            <span aria-hidden className="text-muted">›</span>
          </Link>
        ))}
      </section>

      <section className="card flex items-center justify-between gap-3 p-5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{b.user.name ?? b.user.username ?? "Editor"}</p>
          <p className="truncate text-xs text-muted">{b.user.is_demo ? "Demo account" : `@${b.user.username ?? b.user.whop_user_id}`}</p>
        </div>
        <form action={signOut}>
          <button className="btn-secondary">Sign out</button>
        </form>
      </section>
    </div>
  );
}
