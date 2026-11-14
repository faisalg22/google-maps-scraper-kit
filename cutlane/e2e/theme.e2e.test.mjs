/**
 * Theme end-to-end tests (real browser). Start the app first, then:
 *   npm run test:e2e            (E2E_BASE_URL defaults to http://localhost:3000)
 * Needs Playwright with Chromium: `npm i -D playwright && npx playwright install chromium`
 * (pre-installed in Claude Code cloud sessions). Runs in demo mode (no Whop keys).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// require() (unlike ESM import) honours NODE_PATH, so a globally installed Playwright works too.
const require = createRequire(import.meta.url);

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
let chromium;
let browser;

before(async () => {
  ({ chromium } = require("playwright"));
  browser = await chromium.launch();
});
after(async () => browser?.close());

/**
 * Records the <html> theme state at the earliest moments a user could see anything:
 * when <body> is inserted and on the first animation frame. If either is wrong, the page flashed.
 */
const FIRST_PAINT_PROBE = `
  window.__theme = {};
  new MutationObserver((_, obs) => {
    if (document.body && !window.__theme.atBody) {
      window.__theme.atBody = document.documentElement.classList.contains("dark") ? "dark" : "light";
      obs.disconnect();
    }
  }).observe(document, { childList: true, subtree: true });
  requestAnimationFrame(() => {
    window.__theme.firstFrame = document.documentElement.classList.contains("dark") ? "dark" : "light";
    window.__theme.firstFrameBg = getComputedStyle(document.body).backgroundColor;
  });
`;

async function open(ctx, path) {
  const page = await ctx.newPage();
  await page.addInitScript(FIRST_PAINT_PROBE);
  await page.goto(BASE + path, { waitUntil: "load" });
  await page.waitForFunction(() => window.__theme && window.__theme.firstFrame);
  return page;
}
const state = (page) => page.evaluate(() => ({ ...window.__theme, now: document.documentElement.classList.contains("dark") ? "dark" : "light", pref: document.documentElement.getAttribute("data-theme") }));

async function signInDemo(page) {
  await page.goto(BASE + "/");
  await page.click("text=Enter the demo");
  await page.waitForURL(/\/(pricing|dashboard)/);
}

test("default follows the system setting (dark and light)", async () => {
  for (const scheme of ["dark", "light"]) {
    const ctx = await browser.newContext({ colorScheme: scheme });
    const s = await state(await open(ctx, "/pricing"));
    assert.equal(s.pref, "system");
    assert.equal(s.now, scheme);
    await ctx.close();
  }
});

test("follows a live OS change while on System", async () => {
  const ctx = await browser.newContext({ colorScheme: "light" });
  const page = await open(ctx, "/pricing");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
  await ctx.close();
});

test("manual override persists after reload (signed out → localStorage)", async () => {
  const ctx = await browser.newContext({ colorScheme: "dark" });
  const page = await open(ctx, "/pricing");
  await page.getByRole("radio", { name: "Light theme" }).first().click();
  assert.equal((await state(page)).now, "light");
  await page.reload();
  await page.waitForFunction(() => window.__theme && window.__theme.firstFrame);
  const s = await state(page);
  assert.equal(s.pref, "light");
  assert.equal(s.atBody, "light", "theme was wrong when <body> appeared");
  await ctx.close();
});

test("no flash of the wrong theme on load", async () => {
  // OS is light but the visitor chose dark: the very first frame must already be dark.
  const ctx = await browser.newContext({ colorScheme: "light" });
  await ctx.addInitScript(() => localStorage.setItem("cl-theme", "dark"));
  const page = await open(ctx, "/");
  const s = await state(page);
  assert.equal(s.atBody, "dark", "html.dark must be set before <body> is parsed");
  assert.equal(s.firstFrame, "dark");
  assert.equal(s.firstFrameBg, "rgb(11, 13, 18)", "first frame painted with the dark background token");
  // And with JavaScript bundles blocked entirely, the inline head script still applies it.
  const ctx2 = await browser.newContext({ colorScheme: "light" });
  await ctx2.addInitScript(() => localStorage.setItem("cl-theme", "dark"));
  await ctx2.route("**/_next/static/**", (r) => r.abort());
  const p2 = await ctx2.newPage();
  await p2.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  assert.equal(await p2.evaluate(() => document.documentElement.classList.contains("dark")), true);
  await ctx.close();
  await ctx2.close();
});

test("saved preference syncs after sign-in and applies on another device", async () => {
  // Visitor picks Dark while signed out, then signs in: the account adopts it.
  const ctx = await browser.newContext({ colorScheme: "light" });
  const page = await open(ctx, "/");
  await page.getByRole("radio", { name: "Dark theme" }).first().click();
  await signInDemo(page);
  await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
  await page.waitForTimeout(500); // let the upload land

  // "Another device": same account (session cookie), empty localStorage, light OS.
  const cookies = await ctx.cookies();
  const other = await browser.newContext({ colorScheme: "light" });
  await other.addCookies(cookies);
  const p2 = await open(other, "/settings");
  const s = await state(p2);
  assert.equal(s.atBody, "dark", "server-rendered preference must apply before first paint");
  assert.equal(await p2.getAttribute("html", "data-theme-pref"), "dark");

  // Change it on device 2 → device 1 picks it up when its tab regains focus.
  await p2.getByRole("radiogroup", { name: "Theme" }).last().getByRole("radio", { name: "Light" }).click();
  await p2.waitForTimeout(500);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForFunction(() => !document.documentElement.classList.contains("dark"));

  // An account that already has a saved theme keeps it when a visitor with another local choice signs in.
  const ctx3 = await browser.newContext({ colorScheme: "light" });
  await ctx3.addInitScript(() => localStorage.setItem("cl-theme", "dark"));
  const p3 = await ctx3.newPage();
  await signInDemo(p3);
  await p3.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "light");
  await ctx.close();
  await other.close();
  await ctx3.close();
});

test("toggle is keyboard and screen-reader friendly", async () => {
  const ctx = await browser.newContext({ colorScheme: "light" });
  const page = await open(ctx, "/pricing");
  const group = page.getByRole("radiogroup", { name: "Theme" }).first();
  const radios = group.getByRole("radio");
  assert.equal(await radios.count(), 3);
  assert.equal(await group.getByRole("radio", { name: "System theme" }).getAttribute("aria-checked"), "true");
  await group.getByRole("radio", { name: "System theme" }).focus();
  await page.keyboard.press("ArrowLeft"); // System → Dark
  assert.equal(await group.getByRole("radio", { name: "Dark theme" }).getAttribute("aria-checked"), "true");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Dark theme");
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), true);
  // Visible focus ring.
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  assert.notEqual(outline, "none");
  await ctx.close();
});
