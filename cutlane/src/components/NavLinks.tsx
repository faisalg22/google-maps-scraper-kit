"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/campaigns", label: "Campaigns", short: "Campaigns", icon: "◎" },
  { href: "/research", label: "YouTube research", short: "Research", icon: "▶" },
  { href: "/swipe", label: "Swipe file", short: "Swipe", icon: "✎" },
  { href: "/clips", label: "Clip library", short: "Clips", icon: "▦" },
  { href: "/submissions", label: "Submissions", short: "Status", icon: "✓" },
];

export function NavLinks({ variant }: { variant: "sidebar" | "bottom" }) {
  const path = usePathname();
  const active = (href: string) => path === href || path.startsWith(`${href}/`);

  if (variant === "bottom") {
    return (
      <ul className="grid grid-cols-5">
        {items.map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${active(i.href) ? "text-lane-400" : "text-ink-400"}`}
            >
              <span aria-hidden className="text-base leading-none">
                {i.icon}
              </span>
              {i.short}
            </Link>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="space-y-1">
      {items.map((i) => (
        <li key={i.href}>
          <Link
            href={i.href}
            className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${
              active(i.href) ? "bg-ink-800 text-ink-100" : "text-ink-400 hover:bg-ink-850 hover:text-ink-100"
            }`}
          >
            <span aria-hidden className={`w-4 text-center ${active(i.href) ? "text-lane-400" : ""}`}>
              {i.icon}
            </span>
            {i.label}
          </Link>
        </li>
      ))}
      <li className="pt-4">
        <Link
          href="/status"
          className={`flex items-center gap-3 rounded-xl px-3 py-2 text-xs font-medium ${active("/status") ? "bg-ink-800 text-ink-100" : "text-ink-400 hover:text-ink-100"}`}
        >
          <span aria-hidden className="w-4 text-center">⚙</span>
          Integrations status
        </Link>
      </li>
    </ul>
  );
}
