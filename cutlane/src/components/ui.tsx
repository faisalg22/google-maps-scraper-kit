import Link from "next/link";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function DemoTag({ label = "Demo data" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-warning/40 bg-warning-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-warning-fg">
      {label}
    </span>
  );
}

const tone: Record<string, string> = {
  neutral: "border-border-strong bg-raised text-fg-secondary",
  green: "border-success/40 bg-success-soft text-success-fg",
  red: "border-danger/40 bg-danger-soft text-danger-fg",
  amber: "border-warning/40 bg-warning-soft text-warning-fg",
  blue: "border-info/40 bg-info-soft text-info-fg",
  lane: "border-accent/40 bg-accent-soft text-primary-strong",
};

export function Badge({ children, color = "neutral" }: { children: React.ReactNode; color?: keyof typeof tone }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tone[color]}`}>{children}</span>;
}

const statusColor: Record<string, keyof typeof tone> = {
  open: "green",
  closed: "amber",
  completed: "blue",
  canceled: "red",
  scheduled: "neutral",
  draft: "neutral",
  ready: "blue",
  posted: "lane",
  submitted: "amber",
  queued: "blue",
  failed: "red",
  in_progress: "amber",
  approved: "green",
  rejected: "red",
  denied: "red",
};

const statusLabel: Record<string, string> = {
  submitted: "Pending review",
  queued: "Sending to Whop…",
  failed: "Failed to send",
  in_progress: "In progress",
  denied: "Rejected",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge color={statusColor[status] ?? "neutral"}>{statusLabel[status] ?? status.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}</Badge>;
}

export function EmptyState({ title, body, action }: { title: string; body?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-12 text-center">
      <p className="text-base font-semibold text-fg">{title}</p>
      {body ? <p className="mt-1 max-w-md text-sm text-muted">{body}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function CopyrightNotice({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex gap-3 rounded-xl border border-warning/30 bg-warning-soft p-3.5 text-sm text-fg-secondary" role="note">
      <span aria-hidden className="mt-0.5 text-warning-fg">©</span>
      <div>
        <p className="font-semibold text-warning-fg">Use only footage you're allowed to use</p>
        {!compact && (
          <p className="mt-0.5 text-fg-secondary">
            Clip from the campaign&apos;s provided content or with the creator&apos;s written permission. Editing someone else&apos;s video
            doesn&apos;t remove their copyright, and Whop reviewers check. YouTube in CutLane is for research only: nothing is downloaded.
          </p>
        )}
      </div>
    </div>
  );
}

export function Alert({ kind = "info", children }: { kind?: "info" | "error" | "success" | "warn"; children: React.ReactNode }) {
  const cls = {
    info: "border-info/30 bg-info-soft text-info-fg",
    error: "border-danger/30 bg-danger-soft text-danger-fg",
    success: "border-success/30 bg-success-soft text-success-fg",
    warn: "border-warning/30 bg-warning-soft text-warning-fg",
  }[kind];
  return <div className={`rounded-xl border px-3.5 py-2.5 text-sm ${cls}`}>{children}</div>;
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="truncate text-sm font-semibold text-fg" title={hint}>
        {value}
      </p>
    </div>
  );
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
      <span aria-hidden>←</span> {children}
    </Link>
  );
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
