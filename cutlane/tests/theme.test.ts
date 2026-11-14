import { describe, expect, it } from "vitest";
import vm from "node:vm";
import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY, initialPref, resolveTheme, syncAfterSignIn } from "@/lib/theme";

/** Runs the real <head> script against a minimal fake browser and returns what it set on <html>. */
function runHeadScript(opts: { systemDark: boolean; local?: string | null; serverPref?: string | null; storageThrows?: boolean }) {
  const classes = new Set<string>();
  const attrs: Record<string, string> = {};
  if (opts.serverPref) attrs["data-theme-pref"] = opts.serverPref;
  const html = {
    classList: { toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)) },
    style: { colorScheme: "" },
    getAttribute: (k: string) => attrs[k] ?? null,
    setAttribute: (k: string, v: string) => (attrs[k] = v),
  };
  const ctx = {
    document: { documentElement: html },
    localStorage: {
      getItem: (k: string) => {
        if (opts.storageThrows) throw new Error("SecurityError");
        return k === THEME_STORAGE_KEY ? (opts.local ?? null) : null;
      },
    },
    window: { matchMedia: (q: string) => ({ matches: q.includes("dark") && opts.systemDark }) },
  };
  vm.runInNewContext(THEME_INIT_SCRIPT, ctx);
  return { dark: classes.has("dark"), colorScheme: html.style.colorScheme, pref: attrs["data-theme"], resolved: attrs["data-resolved-theme"] };
}

describe("default follows the system", () => {
  it("dark OS → dark, light OS → light, when nothing is saved", () => {
    expect(runHeadScript({ systemDark: true })).toMatchObject({ dark: true, pref: "system", colorScheme: "dark" });
    expect(runHeadScript({ systemDark: false })).toMatchObject({ dark: false, pref: "system", colorScheme: "light" });
  });
  it("an explicit 'system' choice also follows the OS", () => {
    expect(runHeadScript({ systemDark: true, local: "system" }).dark).toBe(true);
  });
  it("resolveTheme", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("manual override", () => {
  it("localStorage choice beats the OS (signed-out visitor)", () => {
    expect(runHeadScript({ systemDark: true, local: "light" })).toMatchObject({ dark: false, pref: "light" });
    expect(runHeadScript({ systemDark: false, local: "dark" })).toMatchObject({ dark: true, pref: "dark" });
  });
  it("the signed-in user's saved choice beats localStorage and the OS", () => {
    expect(runHeadScript({ systemDark: false, local: "light", serverPref: "dark" })).toMatchObject({ dark: true, pref: "dark" });
  });
  it("ignores garbage values and blocked storage", () => {
    expect(runHeadScript({ systemDark: true, local: "purple" }).pref).toBe("system");
    expect(runHeadScript({ systemDark: true, serverPref: "<script>" }).pref).toBe("system");
    expect(runHeadScript({ systemDark: true, storageThrows: true })).toMatchObject({ dark: true, pref: "system" });
  });
  it("initialPref order: server → local → system", () => {
    expect(initialPref("light", "dark")).toBe("light");
    expect(initialPref(null, "dark")).toBe("dark");
    expect(initialPref(undefined, "nope")).toBe("system");
  });
});

describe("sync after sign-in", () => {
  it("adopts the signed-out choice when the account has none", () => {
    expect(syncAfterSignIn(null, "dark")).toEqual({ apply: "dark", upload: "dark" });
  });
  it("the account's saved choice wins (and nothing is uploaded)", () => {
    expect(syncAfterSignIn("light", "dark")).toEqual({ apply: "light", upload: null });
  });
  it("nothing to sync when the visitor never chose", () => {
    expect(syncAfterSignIn(null, null)).toEqual({ apply: "system", upload: null });
    expect(syncAfterSignIn(null, "system")).toEqual({ apply: "system", upload: null });
  });
});
