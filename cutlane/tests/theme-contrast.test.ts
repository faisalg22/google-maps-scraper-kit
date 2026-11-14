import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * WCAG AA contrast for the design tokens in globals.css, in BOTH themes.
 * Body text ≥ 4.5:1; UI components / graphics (borders of inputs, focus ring, meter bars) ≥ 3:1.
 * Tinted backgrounds (e.g. bg-success/10) are composited over the card like the browser does.
 */
const css = fs.readFileSync(path.join(__dirname, "..", "src", "app", "globals.css"), "utf8");

function block(selector: string): Record<string, string> {
  const m = css.match(new RegExp(`${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no ${selector} block`);
  return Object.fromEntries([...m[1].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((x) => [x[1], x[2]]));
}

type RGB = [number, number, number];
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const lum = ([r, g, b]: RGB) => {
  const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a: RGB, b: RGB) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const mix = (top: RGB, base: RGB, alpha: number): RGB => top.map((c, i) => Math.round(c * alpha + base[i] * (1 - alpha))) as RGB;

for (const [name, sel] of [["light", ":root"], ["dark", ".dark"]] as const) {
  const t = block(sel);
  const c = (k: string) => hex(t[k]);
  const surfaces = ["bg", "surface", "card", "subtle"];

  describe(`${name} theme contrast (WCAG AA)`, () => {
    it("defines every token", () => {
      for (const k of ["bg", "surface", "card", "subtle", "subtle-strong", "border", "border-strong", "fg", "fg-secondary", "muted", "primary", "primary-fg", "primary-strong", "success", "warning", "danger", "info", "ring"]) {
        expect(t[k], k).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    });

    for (const text of ["fg", "fg-secondary", "muted", "primary-strong", "success", "warning", "danger", "info"]) {
      for (const s of surfaces) {
        it(`${text} on ${s} ≥ 4.5`, () => expect(ratio(c(text), c(s))).toBeGreaterThanOrEqual(4.5));
      }
    }

    it("text on the lime accent ≥ 4.5", () => expect(ratio(c("primary-fg"), c("primary"))).toBeGreaterThanOrEqual(4.5));
    it("muted text on avatar/timestamp pills ≥ 4.5", () => expect(ratio(c("fg-secondary"), c("subtle-strong"))).toBeGreaterThanOrEqual(4.5));

    // Status badges and alerts: colored text on a 10% tint of itself, over cards AND the page.
    for (const status of ["success", "warning", "danger", "info", "primary-strong"]) {
      for (const base of ["card", "bg", "surface"]) {
        it(`${status} badge text on its 10% tint over ${base} ≥ 4.5`, () => {
          const tint = mix(c(status), c(base), 0.1);
          expect(ratio(c(status), tint)).toBeGreaterThanOrEqual(4.5);
        });
      }
    }

    for (const s of ["bg", "card", "surface"]) {
      it(`focus ring vs ${s} ≥ 3`, () => expect(ratio(c("ring"), c(s))).toBeGreaterThanOrEqual(3));
      it(`input border vs ${s} ≥ 3`, () => expect(ratio(c("border-strong"), c(s))).toBeGreaterThanOrEqual(3));
    }
    it("usage meter bars vs their track ≥ 3", () => {
      for (const bar of ["primary-strong", "warning", "danger"]) expect(ratio(c(bar), c("subtle")), bar).toBeGreaterThanOrEqual(3);
    });
  });
}
