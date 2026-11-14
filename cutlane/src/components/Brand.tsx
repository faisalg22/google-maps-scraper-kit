import Link from "next/link";

/**
 * CutLane logo. Light and dark variants are separate files (public/brand/*) so they also work
 * outside the app (emails, press); the right one shows via the html.dark class, with no
 * box behind the transparent mark.
 */
export function Logo({ href = "/dashboard", size = 28 }: { href?: string; size?: number }) {
  return (
    <Link href={href} className="flex items-center gap-2 rounded-lg font-bold tracking-tight text-fg" aria-label="CutLane home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/logo-mark-light.svg" alt="" width={size} height={size} className="dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/logo-mark-dark.svg" alt="" width={size} height={size} className="hidden dark:block" />
      <span>
        Cut<span className="text-primary-strong">Lane</span>
      </span>
    </Link>
  );
}
