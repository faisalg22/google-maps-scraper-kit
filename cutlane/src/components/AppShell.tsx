import Link from "next/link";
import type { User } from "@/lib/auth/session";
import type { PublicModes } from "@/lib/env";
import { signOut } from "@/app/actions";
import { NavLinks } from "./NavLinks";
import { PlanBanner, type PlanBannerData } from "./billing";
import { Logo } from "./Brand";
import { ThemeToggle } from "./theme";

export { Logo };

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
        <div className="border-b border-warning/30 bg-warning/10 px-4 py-1.5 text-center text-xs text-warning">
          <strong className="font-semibold">Demo mode</strong>: some integrations use mock data (
          {[!modes.stripe && "billing", !modes.whop && "Whop", !modes.youtube && "YouTube", !modes.database && "database", !modes.storage && "storage"].filter(Boolean).join(", ")}
          ).{" "}
          <Link href="/status" className="underline underline-offset-2 hover:text-warning">
            See status
          </Link>
        </div>
      )}
      <PlanBanner b={banner} />
      <div className="mx-auto flex max-w-7xl">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-border-subtle px-4 py-5 md:flex">
          <div className="flex items-center justify-between gap-2">
            <Logo />
            <ThemeToggle compact className="scale-90 origin-right" />
          </div>
          <nav className="mt-8 flex-1 overflow-y-auto">
            <NavLinks variant="sidebar" admin={admin} />
          </nav>
          <div className="flex items-center gap-3 rounded-xl border border-border-subtle p-2.5">
            {user.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.avatar_url} alt="" className="h-8 w-8 rounded-full bg-subtle object-cover" />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-subtle-strong text-sm font-bold">{initials}</span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user.name ?? user.username ?? "Editor"}</p>
              <Link href="/billing" className="block truncate text-xs text-muted hover:text-primary-strong">
                {planLabel}
                {user.is_demo ? " · demo" : ""}
              </Link>
            </div>
            <form action={signOut}>
              <button className="rounded-lg p-1.5 text-muted hover:bg-subtle hover:text-fg" title="Sign out" aria-label="Sign out">
                ⎋
              </button>
            </form>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          {/* Mobile top bar */}
          <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border-subtle bg-bg/90 px-4 py-3 backdrop-blur md:hidden">
            <Logo />
            <div className="flex items-center gap-1.5">
              <ThemeToggle compact />
              <Link href="/settings" className="flex h-10 w-10 items-center justify-center rounded-xl text-fg-secondary hover:bg-subtle hover:text-fg" aria-label="Settings">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
                </svg>
              </Link>
            </div>
          </header>
          <main className="px-4 pb-28 pt-6 sm:px-6 md:pb-12 lg:px-10">{children}</main>
        </div>
      </div>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border-subtle bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <NavLinks variant="bottom" />
      </nav>
    </div>
  );
}
