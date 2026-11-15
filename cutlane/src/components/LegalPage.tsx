import Link from "next/link";
import { Logo } from "./Brand";
import { ThemeToggle } from "./theme";

export const LEGAL_UPDATED = "November 15, 2026";

export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-10 flex items-center justify-between">
        <Logo href="/" />
        <ThemeToggle compact />
      </header>
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted">Last updated {LEGAL_UPDATED}</p>
      <div className="legal mt-8 space-y-6 text-[15px] leading-relaxed text-fg-secondary [&_a]:text-primary-strong [&_a]:underline [&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-fg [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-fg">
        {children}
      </div>
      <footer className="mt-16 flex flex-wrap gap-4 border-t border-border pt-6 text-sm text-muted">
        <Link href="/terms" className="hover:text-fg">Terms</Link>
        <Link href="/privacy" className="hover:text-fg">Privacy</Link>
        <Link href="/pricing" className="hover:text-fg">Pricing</Link>
      </footer>
    </div>
  );
}

export function LegalFooterLinks({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex flex-wrap gap-x-4 gap-y-1 ${className}`}>
      <Link href="/terms" className="hover:text-fg">Terms</Link>
      <Link href="/privacy" className="hover:text-fg">Privacy</Link>
    </span>
  );
}
