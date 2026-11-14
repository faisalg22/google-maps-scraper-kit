import Link from "next/link";
import type { User } from "@/lib/auth/session";
import type { PublicModes } from "@/lib/env";
import { signOut } from "@/app/actions";
import { NavLinks } from "./NavLinks";
import { PlanBanner, type PlanBannerData } from "./billing";

export function Logo() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2 font-bold tracking-tight text-ink-100">
      <svg viewBox="0 0 64 64" className="h-7 w-7" aria-hidden>
        <rect width="64" height="64" rx="14" fill="#12151c" />
        <path d="M14 44 L30 20 L36 28 L50 14" stroke="#c8f560" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M14 50 H50" stroke="#2e3546" strokeWidth="4" strokeLinecap="round" />
      </svg>
      <span>
        Cut<span className="text-lane-400">Lane</span>
      </span>
    </Link>
  );
}

export function AppShell({
  user,
  modes,
  banner,
  planLabel,
  admin,
  children,
}: {
  user: User;
  modes: PublicModes;
  banner: PlanBannerData;
  planLabel: string;
  admin: boolean;
  children: React.ReactNode;
}) {
  const initials = (user.name ?? user.username ?? "?").slice(0, 1).toUpperCase();
  return (
    <div className="min-h-dvh">
      {modes.anyDemo && (
        <div className="border-b border-amber-400/30 bg-amber-400/10 px-4 py-1.5 text-center text-xs text-amber-200">
          <strong className="font-semibold">Demo mode</strong>: some integrations use mock data (
          {[!modes.stripe && "billing", !modes.whop && "Whop", !modes.youtube && "YouTube", !modes.database && "database", !modes.storage && "storage"].filter(Boolean).join(", ")}
          ).{" "}
          <Link href="/status" className="underline underline-offset-2 hover:text-amber-100">
            See status
          </Link>
        </div>
      )}
      <PlanBanner b={banner} />
      <div className="mx-auto flex max-w-7xl">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-ink-800 px-4 py-5 md:flex">
          <Logo />
          <nav className="mt-8 flex-1">
            <NavLinks variant="sidebar" admin={admin} />
          </nav>
          <div className="flex items-center gap-3 rounded-xl border border-ink-800 p-2.5">
            {user.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.avatar_url} alt="" className="h-8 w-8 rounded-full" />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-700 text-sm font-bold">{initials}</span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user.name ?? user.username ?? "Editor"}</p>
              <Link href="/billing" className="block truncate text-xs text-ink-400 hover:text-lane-400">
                {planLabel}
                {user.is_demo ? " · demo" : ""}
              </Link>
            </div>
            <form action={signOut}>
              <button className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-800 hover:text-ink-100" title="Sign out" aria-label="Sign out">
                ⎋
              </button>
            </form>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          {/* Mobile top bar */}
          <header className="sticky top-0 z-20 flex items-center justify-between border-b border-ink-800 bg-ink-950/90 px-4 py-3 backdrop-blur md:hidden">
            <Logo />
            <div className="flex items-center gap-1">
              <Link href="/billing" className="btn-ghost px-2 py-1 text-xs">Billing</Link>
              <form action={signOut}>
                <button className="btn-ghost px-2 py-1 text-xs">Sign out</button>
              </form>
            </div>
          </header>
          <main className="px-4 pb-28 pt-6 sm:px-6 md:pb-12 lg:px-10">{children}</main>
        </div>
      </div>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-800 bg-ink-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <NavLinks variant="bottom" />
      </nav>
    </div>
  );
}
