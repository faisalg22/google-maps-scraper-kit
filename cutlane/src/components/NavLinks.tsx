"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/dashboard", label: "Dashboard", short: "Home", icon: "⌂", bottom: true },
  { href: "/campaigns", label: "Campaigns", short: "Campaigns", icon: "◎", bottom: true },
  { href: "/research", label: "YouTube research", short: "Research", icon: "▶", bottom: true },
  { href: "/swipe", label: "Swipe file", short: "Swipe", icon: "✎", bottom: false },
  { href: "/clips", label: "Clip library", short: "Clips", icon: "▦", bottom: true },
  { href: "/submissions", label: "Submissions", short: "Status", icon: "✓", bottom: true },
];

const secondary = [
  { href: "/settings", label: "Settings", icon: "⚙" },
  { href: "/billing", label: "Billing & usage", icon: "$" },
  { href: "/settings/accounts", label: "Posting accounts", icon: "@" },
  { href: "/pricing", label: "Plans", icon: "★" },
  { href: "/status", label: "Integrations status", icon: "ⓘ" },
];

export function NavLinks({ variant, admin = false }: { variant: "sidebar" | "bottom"; admin?: boolean }) {
  const path = usePathname();
  const active = (href: string) => path === href || path.startsWith(`${href}/`);

  if (variant === "bottom") {
    return (
      <ul className="grid grid-cols-5">
        {items
          .filter((i) => i.bottom)
          .map((i) => (
            <li key={i.href}>
              <Link href={i.href} className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${active(i.href) ? "text-primary-strong" : "text-muted"}`}>
                <span aria-hidden className="text-base leading-none">{i.icon}</span>
                {i.short}
              </Link>
            </li>
          ))}
      </ul>
    );
  }
  const sec = admin ? [...secondary, { href: "/admin", label: "Admin", icon: "⛭" }] : secondary;
  return (
    <ul className="space-y-1">
      {items.map((i) => (
        <li key={i.href}>
          <Link
            href={i.href}
            className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${active(i.href) ? "bg-raised text-fg" : "text-muted hover:bg-card hover:text-fg"}`}
          >
            <span aria-hidden className={`w-4 text-center ${active(i.href) ? "text-primary-strong" : ""}`}>{i.icon}</span>
            {i.label}
          </Link>
        </li>
      ))}
      <li className="pt-4" />
      {sec.map((i) => (
        <li key={i.href}>
          <Link href={i.href} className={`flex items-center gap-3 rounded-xl px-3 py-1.5 text-xs font-medium ${active(i.href) ? "bg-raised text-fg" : "text-muted hover:text-fg"}`}>
            <span aria-hidden className="w-4 text-center">{i.icon}</span>
            {i.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
