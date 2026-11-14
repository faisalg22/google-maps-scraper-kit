/**
 * Theme preference logic. Pure (no React, no server imports) so it's unit-tested and the
 * same rules run in the inline <head> script, the client provider and the server.
 */

export const THEME_PREFS = ["light", "dark", "system"] as const;
export type ThemePref = (typeof THEME_PREFS)[number];
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "cl-theme";

export function isThemePref(x: unknown): x is ThemePref {
  return typeof x === "string" && (THEME_PREFS as readonly string[]).includes(x);
}

/** System follows prefers-color-scheme. */
export function resolveTheme(pref: ThemePref, systemDark: boolean): ResolvedTheme {
  return pref === "dark" || (pref === "system" && systemDark) ? "dark" : "light";
}

/**
 * Which preference applies on page load:
 * signed-in user's saved choice (database) → this browser's choice (localStorage) → system.
 */
export function initialPref(serverPref: string | null | undefined, localPref: string | null | undefined): ThemePref {
  if (isThemePref(serverPref)) return serverPref;
  if (isThemePref(localPref)) return localPref;
  return "system";
}

/**
 * After sign-in: if the account has no saved preference yet, adopt what the visitor picked
 * while signed out (upload it). If the account already has one, it wins everywhere.
 */
export function syncAfterSignIn(serverPref: string | null | undefined, localPref: string | null | undefined): { apply: ThemePref; upload: ThemePref | null } {
  if (isThemePref(serverPref)) return { apply: serverPref, upload: null };
  if (isThemePref(localPref) && localPref !== "system") return { apply: localPref, upload: localPref };
  return { apply: "system", upload: null };
}

/**
 * Inline script for <head>: runs before first paint, so the right theme class is on <html>
 * before any content renders (no flash). Reads the server-provided preference from
 * data-theme-pref, falling back to localStorage, then the OS setting.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var d=document.documentElement,k=${JSON.stringify(THEME_STORAGE_KEY)},s=d.getAttribute("data-theme-pref"),l=null;try{l=localStorage.getItem(k)}catch(e){}var ok=function(v){return v==="light"||v==="dark"||v==="system"};var p=ok(s)?s:ok(l)?l:"system";var m=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches;var r=p==="dark"||(p==="system"&&m)?"dark":"light";d.classList.toggle("dark",r==="dark");d.style.colorScheme=r;d.setAttribute("data-theme",p);d.setAttribute("data-resolved-theme",r)}catch(e){}})();`;
