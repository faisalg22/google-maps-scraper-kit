"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { saveThemePreference } from "@/app/theme-actions";
import { THEME_STORAGE_KEY, initialPref, isThemePref, resolveTheme, syncAfterSignIn, type ResolvedTheme, type ThemePref } from "@/lib/theme";

interface ThemeCtx {
  pref: ThemePref;
  resolved: ResolvedTheme;
  setPref: (p: ThemePref) => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

const systemDark = () => typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;

function readLocal(): string | null {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}
function writeLocal(p: ThemePref) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, p);
  } catch {
    /* private mode */
  }
}

/** Apply to <html>. The head script did this already on load; this handles changes. */
function apply(p: ThemePref, animate: boolean): ResolvedTheme {
  const r = resolveTheme(p, systemDark());
  const d = document.documentElement;
  if (animate && d.getAttribute("data-resolved-theme") !== r) {
    d.classList.add("theme-transition");
    window.setTimeout(() => d.classList.remove("theme-transition"), 250);
  }
  d.classList.toggle("dark", r === "dark");
  d.style.colorScheme = r;
  d.setAttribute("data-theme", p);
  d.setAttribute("data-resolved-theme", r);
  return r;
}

export function ThemeProvider({ serverPref, signedIn, children }: { serverPref: ThemePref | null; signedIn: boolean; children: React.ReactNode }) {
  // Start from what the server knows (same on server and client: no hydration mismatch),
  // then adopt what the <head> script actually applied. The page itself never flashes:
  // only the toggle's highlight can update after mount.
  const [pref, setPrefState] = useState<ThemePref>(serverPref ?? "system");
  const [resolved, setResolved] = useState<ResolvedTheme>("light");
  const prefRef = useRef(pref);
  prefRef.current = pref;

  useEffect(() => {
    const d = document.documentElement;
    const applied = d.getAttribute("data-theme");
    setPrefState(isThemePref(applied) ? applied : initialPref(serverPref, readLocal()));
    setResolved(d.getAttribute("data-resolved-theme") === "dark" ? "dark" : "light");
  }, [serverPref]);

  const commit = useCallback((p: ThemePref, opts: { animate: boolean; persist: boolean }) => {
    setPrefState(p);
    setResolved(apply(p, opts.animate));
    writeLocal(p);
    if (opts.persist && signedIn) saveThemePreference(p).catch(() => undefined);
  }, [signedIn]);

  // Sign-in sync: a signed-out choice becomes the account's preference if it has none yet.
  useEffect(() => {
    if (!signedIn) return;
    const { apply: p, upload } = syncAfterSignIn(serverPref, readLocal());
    if (upload) saveThemePreference(upload).catch(() => undefined);
    if (p !== prefRef.current || readLocal() !== p) commit(p, { animate: false, persist: false });
  }, [signedIn, serverPref, commit]);

  // Follow the OS while on "system".
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => prefRef.current === "system" && setResolved(apply("system", true));
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Other tabs on this device (localStorage) …
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY && isThemePref(e.newValue) && e.newValue !== prefRef.current) commit(e.newValue, { animate: true, persist: false });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [commit]);

  // … and other devices: re-read the saved preference when the tab regains focus.
  useEffect(() => {
    if (!signedIn) return;
    const onVisible = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/theme", { cache: "no-store" });
        const { theme } = (await res.json()) as { theme: string | null };
        if (isThemePref(theme) && theme !== prefRef.current) commit(theme, { animate: true, persist: false });
      } catch {
        /* offline */
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [signedIn, commit]);

  const setPref = useCallback((p: ThemePref) => commit(p, { animate: true, persist: true }), [commit]);
  return <Ctx.Provider value={{ pref, resolved, setPref }}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTheme must be used inside ThemeProvider");
  return c;
}

const OPTIONS: { value: ThemePref; label: string; icon: React.ReactNode }[] = [
  {
    value: "light",
    label: "Light",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    ),
  },
  {
    value: "dark",
    label: "Dark",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    ),
  },
  {
    value: "system",
    label: "System",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </svg>
    ),
  },
];

/**
 * Accessible 3-way toggle (WAI-ARIA radio group): Tab focuses the selected option,
 * arrow keys move and select, each option has a text label for screen readers.
 * `compact` shows icons only (labels stay available to assistive tech) with 40px tap targets.
 */
export function ThemeToggle({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const { pref, setPref } = useTheme();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = OPTIONS.findIndex((o) => o.value === pref);

  const onKey = (e: React.KeyboardEvent, i: number) => {
    const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (e.key === "Home" || e.key === "End" || delta) {
      e.preventDefault();
      const n = e.key === "Home" ? 0 : e.key === "End" ? OPTIONS.length - 1 : (i + delta + OPTIONS.length) % OPTIONS.length;
      setPref(OPTIONS[n].value);
      refs.current[n]?.focus();
    }
  };

  return (
    <div role="radiogroup" aria-label="Theme" className={`inline-flex rounded-xl border border-border bg-subtle p-0.5 ${className}`}>
      {OPTIONS.map((o, i) => {
        const checked = o.value === pref;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={compact ? `${o.label} theme` : undefined}
            title={compact ? `${o.label} theme` : undefined}
            tabIndex={checked || (idx === -1 && i === 0) ? 0 : -1}
            onClick={() => setPref(o.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={`inline-flex items-center justify-center gap-1.5 rounded-[10px] text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring ${
              compact ? "h-10 w-10" : "h-10 px-3.5"
            } ${checked ? "bg-card text-fg shadow-[var(--shadow-card)] ring-1 ring-border" : "text-muted hover:text-fg"}`}
          >
            {o.icon}
            {!compact && <span>{o.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
