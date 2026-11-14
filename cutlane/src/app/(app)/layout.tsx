import { publicModes } from "@/lib/env";
import { getBilling, isAdmin, planName, usageMeters } from "@/lib/billing/server";
import { METRIC_LABELS } from "@/config/plans";
import { AppShell } from "@/components/AppShell";
import type { PlanBannerData } from "@/components/billing";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const b = await getBilling();
  const meters = b.ent.canRead ? await usageMeters(b) : [];
  const banner: PlanBannerData = {
    access: b.ent.access,
    reason: b.ent.reason,
    planName: planName(b),
    trialEndsAt: b.ent.trialEndsAt?.toISOString() ?? null,
    graceEndsAt: b.ent.graceEndsAt?.toISOString() ?? null,
    periodEndsAt: b.ent.periodEndsAt?.toISOString() ?? null,
    warnMetrics: meters.filter((m) => m.level === "warn").map((m) => METRIC_LABELS[m.metric].label),
    fullMetrics: meters.filter((m) => m.level === "full").map((m) => METRIC_LABELS[m.metric].label),
    testMode: !publicModes().stripe,
  };
  return (
    <AppShell user={b.user} modes={publicModes()} banner={banner} planLabel={planName(b)} admin={isAdmin(b.user)}>
      {children}
    </AppShell>
  );
}
