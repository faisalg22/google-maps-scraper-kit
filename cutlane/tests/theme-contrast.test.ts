import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * WCAG AA contrast for src/styles/tokens.css, in BOTH themes.
 * - Text: ≥ 4.5:1 on every background level (bg, surface, card, raised, raised-hover)
 * - Status/accent text on its own tinted badge background (soft token composited over each level)
 * - UI components & graphics (form borders, focus ring, meter bars): ≥ 3:1
 */
const css = fs.readFileSync(path.join(__dirname, "..", "src", "styles", "tokens.css"), "utf8");

function block(header: RegExp): string {
  const m = css.match(header);
  if (!m || m.index === undefined) throw new Error(`block not found: ${header}`);
  const start = css.indexOf("{", m.index) + 1;
  return css.slice(start, css.indexOf("}", start));
}
const palette = Object.fromEntries([...block(/:root\s*\{/).matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((x) => [x[1], x[2].toLowerCase()]));

type RGB = [number, number, number];
interface Theme {
  hex: (k: string) => RGB;
  soft: (k: string) => { base: RGB; pct: number };
}
function theme(body: string): Theme {
  const raw = Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((x) => [x[1], x[2].trim()]));
  const resolve = (v: string): string => {
    const ref = v.match(/^var\(--([\w-]+)\)$/);
    if (ref) return palette[ref[1]] ?? resolve(raw[ref[1]]);
    return v;
  };
  return {
    hex: (k) => {
      const v = resolve(raw[k] ?? "");
      if (!/^#[0-9a-fA-F]{6}$/.test(v)) throw new Error(`--${k} is not a hex color: ${raw[k]}`);
      return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)) as RGB;
    },
    soft: (k) => {
      const m = (raw[k] ?? "").match(/color-mix\(in srgb, var\(--([\w-]+)\) (\d+)%, transparent\)/);
      if (!m) throw new Error(`--${k} is not a color-mix tint`);
      const h = palette[m[1]];
      return { base: [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB, pct: Number(m[2]) / 100 };
    },
  };
}

const lum = ([r, g, b]: RGB) => {
  const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
export const ratio = (a: RGB, b: RGB) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const over = (top: RGB, base: RGB, a: number): RGB => top.map((c, i) => Math.round(c * a + base[i] * (1 - a))) as RGB;

const LEVELS = ["bg", "surface", "card", "raised", "raised-hover"];
const THEMES = { light: theme(block(/:root,\s*\.light\s*\{/)), dark: theme(block(/\.dark\s*\{/)) };

describe("requested brand values are kept exactly", () => {
  it("dark palette", () => {
    const t = THEMES.dark;
    const expectHex = (k: string, h: string) => expect(t.hex(k)).toEqual([1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
    expectHex("bg", "#0B0D12");
    expectHex("surface", "#12151C");
    expectHex("card", "#171B24");
    expectHex("raised", "#1E2330");
    expectHex("border", "#262C3A");
    expectHex("fg", "#E8EAF0");
    expectHex("muted", "#9AA3B5");
  });
  it("light palette", () => {
    const t = THEMES.light;
    const expectHex = (k: string, h: string) => expect(t.hex(k)).toEqual([1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
    expectHex("bg", "#F6F7FB");
    expectHex("surface", "#FFFFFF");
    expectHex("card", "#FFFFFF");
    expectHex("raised", "#EEF0F6");
    expectHex("border", "#E1E4EC");
    expectHex("fg", "#12151C");
    expectHex("muted", "#5B6475");
  });
  it("accent + status bases", () => {
    for (const t of Object.values(THEMES)) {
      expect(t.hex("accent")).toEqual([0x7c, 0x5c, 0xff]);
      expect(t.hex("primary")).toEqual([0x6a, 0x49, 0xf0]);
      expect(t.hex("success")).toEqual([0x22, 0xc5, 0x5e]);
      expect(t.hex("warning")).toEqual([0xf5, 0x9e, 0x0b]);
      expect(t.hex("danger")).toEqual([0xef, 0x44, 0x44]);
      expect(t.hex("info")).toEqual([0x38, 0xbd, 0xf8]);
    }
  });
  it("layering gets lighter in dark (bg < surface < card < raised)", () => {
    const t = THEMES.dark;
    const L = LEVELS.slice(0, 4).map((k) => lum(t.hex(k)));
    expect([...L].sort((a, b) => a - b)).toEqual(L);
  });
});

for (const [name, t] of Object.entries(THEMES)) {
  describe(`${name} theme (WCAG AA)`, () => {
    for (const text of ["fg", "fg-secondary", "muted", "primary-strong", "success-fg", "warning-fg", "danger-fg", "info-fg"]) {
      for (const lvl of LEVELS) {
        it(`${text} on ${lvl} ≥ 4.5`, () => expect(ratio(t.hex(text), t.hex(lvl))).toBeGreaterThanOrEqual(4.5));
      }
    }

    it("button label on primary ≥ 4.5 (and hover)", () => {
      expect(ratio(t.hex("primary-fg"), t.hex("primary"))).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t.hex("primary-fg"), t.hex("primary-hover"))).toBeGreaterThanOrEqual(4.5);
    });

    for (const [status, fg] of [["success-soft", "success-fg"], ["warning-soft", "warning-fg"], ["danger-soft", "danger-fg"], ["info-soft", "info-fg"], ["accent-soft", "primary-strong"]]) {
      for (const lvl of LEVELS) {
        it(`${fg} on ${status} over ${lvl} ≥ 4.5`, () => {
          const { base, pct } = t.soft(status);
          expect(ratio(t.hex(fg), over(base, t.hex(lvl), pct))).toBeGreaterThanOrEqual(4.5);
        });
      }
    }

    for (const lvl of ["bg", "surface", "card", "raised"]) {
      it(`focus ring vs ${lvl} ≥ 3`, () => expect(ratio(t.hex("ring"), t.hex(lvl))).toBeGreaterThanOrEqual(3));
      it(`form border vs ${lvl} ≥ 3`, () => expect(ratio(t.hex("border-strong"), t.hex(lvl === "raised" ? "card" : lvl))).toBeGreaterThanOrEqual(3));
    }
    it("meter bars vs their track (raised) ≥ 3", () => {
      for (const bar of ["accent", "warning-fg", "danger-fg"]) expect(ratio(t.hex(bar), t.hex("raised")), bar).toBeGreaterThanOrEqual(3);
    });
  });
}
