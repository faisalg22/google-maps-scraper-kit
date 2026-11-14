"use client";

import { useEffect, useRef, useState } from "react";

/** Reads the element's real computed colors (from the CSS tokens), so the preview can't drift from tokens.css. */

function parse(c: string): [number, number, number, number] | null {
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  const s = c.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/);
  if (s) return [Number(s[1]) * 255, Number(s[2]) * 255, Number(s[3]) * 255, s[4] ? Number(s[4]) : 1];
  return null;
}
const hex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
const lum = (r: number, g: number, b: number) => {
  const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

/** The effective (opaque) background behind an element, compositing translucent layers. */
function effectiveBg(el: Element | null): [number, number, number] {
  const stack: [number, number, number, number][] = [];
  for (let n = el; n; n = n.parentElement) {
    const c = parse(getComputedStyle(n).backgroundColor);
    if (c && c[3] > 0) {
      stack.push(c);
      if (c[3] >= 1) break;
    }
  }
  let out: [number, number, number] = [255, 255, 255];
  for (const [r, g, b, a] of stack.reverse()) out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a)];
  return out;
}

/** Hex of the parent's background, or of the previous sibling of the parent (`from="prev"`) for color chips. */
export function SwatchHex({ from = "parent" }: { from?: "parent" | "prev" }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [v, setV] = useState("");
  useEffect(() => {
    const el = from === "prev" ? ref.current?.parentElement?.previousElementSibling : ref.current?.parentElement;
    if (el) setV(hex(...effectiveBg(el)));
  }, [from]);
  return <span ref={ref} className="font-mono text-[11px]">{v}</span>;
}

/** Shows "4.86 · AA" for its own text color against whatever is behind it. */
export function Ratio({ large = false }: { large?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [r, setR] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fg = parse(getComputedStyle(el).color);
    if (!fg) return;
    const bg = effectiveBg(el);
    const a = lum(fg[0], fg[1], fg[2]);
    const b = lum(...bg);
    setR((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05));
  }, []);
  const pass = r !== null && r >= (large ? 3 : 4.5);
  return (
    <span ref={ref} className="font-mono text-[11px]" data-ratio={r?.toFixed(2)}>
      {r === null ? "…" : `${r.toFixed(2)}:1 ${pass ? "AA" : "FAIL"}`}
    </span>
  );
}
