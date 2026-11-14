import Link from "next/link";
import { Ratio, SwatchHex } from "@/components/design-measure";
import { Logo } from "@/components/Brand";
import { ThemeToggle } from "@/components/theme";

export const metadata = { title: "Design tokens" };

const LEVELS = [
  ["bg", "bg-bg", "App background"],
  ["surface", "bg-surface", "Sidebar, panels"],
  ["card", "bg-card", "Cards, tables, modals"],
  ["raised", "bg-raised", "Hover, chips, inset"],
  ["raised-hover", "bg-raised-hover", "Hover on raised"],
] as const;

const TEXT = [
  ["fg", "text-fg"],
  ["fg-secondary", "text-fg-secondary"],
  ["muted", "text-muted"],
  ["primary-strong", "text-primary-strong"],
  ["success-fg", "text-success-fg"],
  ["warning-fg", "text-warning-fg"],
  ["danger-fg", "text-danger-fg"],
  ["info-fg", "text-info-fg"],
] as const;

// Literal class strings so Tailwind can see them (no string-built class names).
const STATUS_TILE = {
  success: { box: "border-success/30 bg-success-soft", text: "text-success-fg" },
  warning: { box: "border-warning/30 bg-warning-soft", text: "text-warning-fg" },
  danger: { box: "border-danger/30 bg-danger-soft", text: "text-danger-fg" },
  info: { box: "border-info/30 bg-info-soft", text: "text-info-fg" },
} as const;
const METERS = [
  ["bg-accent", "64 / 180", "45%"],
  ["bg-warning-fg", "150 / 180", "83%"],
  ["bg-danger-fg", "180 / 180", "100%"],
] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  );
}

function Badge({ tone, children }: { tone: "success" | "warning" | "danger" | "info" | "accent" | "neutral"; children: React.ReactNode }) {
  const cls = {
    success: "border-success/30 bg-success-soft text-success-fg",
    warning: "border-warning/30 bg-warning-soft text-warning-fg",
    danger: "border-danger/30 bg-danger-soft text-danger-fg",
    info: "border-info/30 bg-info-soft text-info-fg",
    accent: "border-accent/30 bg-accent-soft text-primary-strong",
    neutral: "border-border bg-raised text-fg-secondary",
  }[tone];
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

function Panel({ theme }: { theme: "light" | "dark" }) {
  return (
    <div className={`${theme} min-w-0 rounded-3xl border border-border bg-bg p-4 text-fg sm:p-6`} data-preview-theme={theme}>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-bold capitalize">{theme} theme</h2>
        <span className="rounded-md border border-border bg-raised px-2 py-0.5 font-mono text-xs text-muted">.{theme}</span>
      </div>

      <div className="space-y-8">
        <Section title="Background levels  ·  bg < surface < card < raised">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {LEVELS.map(([name, cls, use]) => (
              <div key={name} className={`${cls} rounded-xl border border-border p-3`}>
                <p className="text-sm font-semibold">{name}</p>
                <p className="text-[11px] text-muted">{use}</p>
                <p className="mt-2 text-fg-secondary"><SwatchHex /></p>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-border bg-surface p-3">
            <p className="mb-2 text-[11px] text-muted">Layering: surface → card → raised (3 levels max)</p>
            <div className="card p-3">
              <p className="text-sm font-medium">Card</p>
              <div className="mt-2 rounded-xl bg-raised p-3 text-sm text-fg-secondary">Raised block inside a card</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            <div className="rounded-xl border-2 border-border bg-card p-2">border</div>
            <div className="rounded-xl border-2 border-border-strong bg-card p-2">border-strong</div>
            <div className="rounded-xl border-2 border-ring bg-card p-2">ring</div>
          </div>
        </Section>

        <Section title="Text contrast on every level (measured live)">
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead>
                <tr className="bg-card text-muted">
                  <th className="p-2 font-medium">token</th>
                  {LEVELS.map(([n]) => (
                    <th key={n} className="p-2 font-medium">{n}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TEXT.map(([name, cls]) => (
                  <tr key={name} className="border-t border-border">
                    <td className="bg-card p-2 font-mono text-fg-secondary">{name}</td>
                    {LEVELS.map(([n, bg]) => (
                      <td key={n} className={`${bg} p-2`}>
                        <span className={`${cls} block font-semibold`}>Aa</span>
                        <span className={cls}><Ratio /></span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Accent">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl border border-border bg-card p-3">
              <div className="h-6 rounded-md bg-accent" aria-hidden />
              <p className="mt-2 text-sm font-semibold">accent <SwatchHex from="prev" /></p>
              <p className="text-[11px] text-muted">Ring, glow, meters, selection. Not for text: white on it is 4.34:1.</p>
            </div>
            <div className="rounded-xl bg-primary p-3 text-primary-fg"><p className="text-sm font-semibold">primary</p><Ratio /></div>
            <div className="rounded-xl bg-primary-hover p-3 text-primary-fg"><p className="text-sm font-semibold">primary-hover</p><Ratio /></div>
            <div className="rounded-xl bg-accent-soft p-3 text-primary-strong"><p className="text-sm font-semibold">accent-soft</p><Ratio /></div>
          </div>
        </Section>

        <Section title="Buttons">
          <div className="flex flex-wrap gap-2">
            <button className="btn-cta">Start 3-day free trial</button>
            <button className="btn-primary">Primary</button>
            <button className="btn-secondary">Secondary</button>
            <button className="btn-ghost">Ghost</button>
            <button className="btn-danger">Delete</button>
            <button className="btn-primary" disabled>Disabled</button>
            <button className="btn-secondary outline-2 outline-offset-2 outline-ring">Focused</button>
          </div>
        </Section>

        <Section title="Status badges (base · soft · AA text)">
          <div className="flex flex-wrap gap-2">
            <Badge tone="success"><span className="h-1.5 w-1.5 rounded-full bg-success" />Approved</Badge>
            <Badge tone="warning"><span className="h-1.5 w-1.5 rounded-full bg-warning" />Pending review</Badge>
            <Badge tone="danger"><span className="h-1.5 w-1.5 rounded-full bg-danger" />Rejected</Badge>
            <Badge tone="info"><span className="h-1.5 w-1.5 rounded-full bg-info" />Info</Badge>
            <Badge tone="accent">Trial</Badge>
            <Badge tone="neutral">Clipping</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(["success", "warning", "danger", "info"] as const).map((s) => (
              <div key={s} className={`rounded-xl border p-3 ${STATUS_TILE[s].box}`}>
                <p className={`text-sm font-semibold ${STATUS_TILE[s].text}`}>{s}</p>
                <p className={STATUS_TILE[s].text}><Ratio /></p>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Campaign card">
          <div className="card flex flex-col p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-raised text-sm font-bold text-fg-secondary">L</span>
              <div className="min-w-0">
                <div className="flex flex-wrap gap-1.5"><Badge tone="success">Open</Badge><Badge tone="neutral">Clipping</Badge></div>
                <p className="mt-1.5 font-semibold">Late Night Mic: best podcast moments</p>
                <p className="text-xs text-muted">Late Night Mic · Podcast</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-raised/60 p-3 text-sm">
              <div><p className="text-[11px] uppercase text-muted">Per clip</p><p className="font-semibold">$150</p></div>
              <div><p className="text-[11px] uppercase text-muted">Per 1k</p><p className="font-semibold">$1.50</p></div>
              <div><p className="text-[11px] uppercase text-muted">Spots</p><p className="font-semibold">64</p></div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5"><span className="chip">TikTok</span><span className="chip">Shorts</span><span className="chip border-accent/30 text-primary-strong">Content link</span></div>
          </div>
        </Section>

        <Section title="Table">
          <div className="card overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="text-muted"><tr className="border-b border-border"><th className="p-3 font-medium">Clip</th><th className="p-3 font-medium">Status</th></tr></thead>
              <tbody>
                <tr className="border-b border-border hover:bg-raised"><td className="p-3">Worst date cold open</td><td className="p-3"><Badge tone="success">Approved</Badge></td></tr>
                <tr className="border-b border-border bg-raised"><td className="p-3">Clutch 1v5 (hover row)</td><td className="p-3"><Badge tone="warning">Pending</Badge></td></tr>
                <tr><td className="p-3">Science in 30s</td><td className="p-3"><Badge tone="danger">Rejected</Badge></td></tr>
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Form">
          <div className="card space-y-3 p-4">
            <div><label className="label">Title</label><input className="input" placeholder="Placeholder text" /></div>
            <div><label className="label">Campaign</label><select className="input"><option>Late Night Mic</option></select></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" defaultChecked className="h-4 w-4 accent-accent" /> I have the rights to this footage</label>
          </div>
        </Section>

        <Section title="Modal + toast">
          <div className="relative overflow-hidden rounded-2xl border border-border bg-bg p-4">
            <div className="absolute inset-0 bg-overlay/40" aria-hidden />
            <div role="dialog" aria-label="Example dialog" className="card relative mx-auto max-w-xs p-4">
              <p className="font-semibold">Submit to Whop?</p>
              <p className="mt-1 text-sm text-muted">2 links and the clip file will be sent for review.</p>
              <div className="mt-4 flex justify-end gap-2"><button className="btn-ghost px-3 py-1.5">Cancel</button><button className="btn-primary px-3 py-1.5">Submit</button></div>
            </div>
          </div>
          <div role="status" className="card flex items-center gap-3 p-3 text-sm">
            <span className="h-2 w-2 rounded-full bg-success" aria-hidden />
            <span className="flex-1">Submitted. Pending review.</span>
            <button className="text-xs text-muted hover:text-fg">Dismiss</button>
          </div>
        </Section>

        <Section title="Usage meters">
          {METERS.map(([bar, label, w]) => (
            <div key={bar} className="card p-3">
              <div className="flex justify-between text-sm"><span>Clip uploads</span><span className="font-mono text-muted">{label}</span></div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-raised"><div className={`h-full ${bar}`} style={{ width: w }} /></div>
            </div>
          ))}
        </Section>

        <Section title="Video research area + clip library">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_120px]">
            <div className="dark flex aspect-video flex-col justify-between rounded-2xl border border-border bg-player p-3 text-fg">
              <span className="w-fit rounded-md border border-warning/40 bg-warning-soft px-1.5 py-0.5 text-[10px] font-bold uppercase text-warning-fg">Player</span>
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-fg">▶</span>
              <span className="font-mono text-[11px] text-fg-secondary">0:42 / 45:35</span>
            </div>
            <div className="card flex flex-col gap-2 p-2">
              <div className="flex aspect-[9/16] items-center justify-center rounded-lg bg-raised text-muted">▶</div>
              <p className="truncate text-xs font-medium">Cold open</p>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

export default function DesignPage() {
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <Logo href="/" />
          <span className="text-sm text-muted">Design tokens · <code className="font-mono">src/styles/tokens.css</code></span>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/pricing" className="btn-ghost">Pricing</Link>
          <ThemeToggle compact />
        </div>
      </header>
      <p className="mb-6 max-w-3xl text-sm text-fg-secondary">
        Every color in CutLane comes from these tokens. Both themes are rendered side by side; hex values and contrast ratios are measured live
        from the CSS. AA = WCAG 2.1 AA (4.5:1 for text).
      </p>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel theme="light" />
        <Panel theme="dark" />
      </div>
    </div>
  );
}
