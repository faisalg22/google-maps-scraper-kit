import Link from "next/link";
import { redirect } from "next/navigation";
import { PLANS } from "@/config/plans";
import { modes } from "@/lib/env";
import { getBilling, trialEligible } from "@/lib/billing/server";
import { mockCompleteCheckout } from "@/app/billing-actions";
import { DemoTag } from "@/components/ui";

export const metadata = { title: "Checkout (test mode)" };

/** Stand-in for Stripe Checkout while STRIPE_SECRET_KEY is not set. */
export default async function MockCheckout({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (modes.stripe) redirect("/pricing");
  const sp = await searchParams;
  const plan = sp.plan === "clipper" ? "clipper" : "beginner";
  const interval = sp.interval === "year" ? "year" : "month";
  const b = await getBilling();
  const withTrial = PLANS[plan].trialDays > 0 && (await trialEligible(b.user, b.workspace));
  const p = PLANS[plan];
  const amount = interval === "year" ? p.annualPrice : p.monthlyPrice;

  return (
    <div className="mx-auto max-w-md">
      <div className="card p-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted">Checkout</p>
          <DemoTag label="Test mode: no charge" />
        </div>
        <h1 className="mt-3 text-2xl font-bold">CutLane {p.name}</h1>
        <p className="mt-1 text-fg-secondary">
          {withTrial ? (
            <>3 days free, then <strong>${amount}/{interval === "year" ? "year" : "month"}</strong></>
          ) : (
            <><strong>${amount}</strong> per {interval === "year" ? "year" : "month"}</>
          )}
        </p>
        <div className="mt-5 rounded-xl border border-dashed border-border-strong bg-surface p-4 text-sm text-muted">
          In live mode this is Stripe Checkout, which asks for a card up front{withTrial ? " (not charged until the trial ends)" : ""}. No card details are collected in test mode.
        </div>
        <form action={mockCompleteCheckout} className="mt-5 space-y-2">
          <input type="hidden" name="plan" value={plan} />
          <input type="hidden" name="interval" value={interval} />
          <button className="btn-primary w-full py-3">{withTrial ? "Start free trial (simulated)" : "Subscribe (simulated)"}</button>
        </form>
        <Link href="/pricing?checkout=canceled" className="btn-ghost mt-2 w-full">Cancel</Link>
      </div>
    </div>
  );
}
