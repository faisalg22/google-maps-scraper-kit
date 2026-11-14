import { requireUser } from "@/lib/auth/session";
import { publicModes } from "@/lib/env";
import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <AppShell user={user} modes={publicModes()}>
      {children}
    </AppShell>
  );
}
