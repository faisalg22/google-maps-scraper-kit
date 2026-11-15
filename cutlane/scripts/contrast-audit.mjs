/**
 * Contrast + layout audit: every page, light and dark, mobile and desktop.
 * Uses axe-core's WCAG AA `color-contrast` rule (4.5:1 text, 3:1 large text) and checks for
 * horizontal overflow. Run against a fresh demo-mode server:
 *   rm -rf .data && npm run build && ALLOW_DEMO=true npm start   (another terminal)
 *   node scripts/contrast-audit.mjs [--shots <dir>]
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const shotsDir = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch();
const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await desktop.newPage();

// ── Seed: demo sign-in, trial, a clip with links, a submission, a note, a saved channel ──
await page.goto(`${BASE}/`);
await page.click("text=Enter the demo");
await page.waitForURL(/pricing|dashboard/);
await page.waitForLoadState("networkidle"); // /dashboard redirects to /pricing when there's no plan
if (page.url().includes("pricing")) {
  const trial = page.locator("button:has-text('Start 3-day free trial'), button:has-text('Subscribe for')").first();
  if (await trial.count()) {
    await trial.click();
    await page.click("button:has-text('(simulated)')");
    await page.waitForURL(/billing/);
  }
}
await page.goto(`${BASE}/research/channel/demo-ch-latenightmic`);
const save = page.locator("button:has-text('Save channel')");
if (await save.count()) await save.click();
await page.goto(`${BASE}/research/video/demo-latenightmic-00`);
await page.fill('textarea[aria-label="Note"]', "Cold open: guest laughs at 0:02");
await page.click("text=Save to swipe file");
await page.waitForTimeout(500);
let clipPath = null;
const tmpMp4 = path.join(process.cwd(), ".data", "audit.mp4");
if (!fs.existsSync(tmpMp4)) fs.writeFileSync(tmpMp4, Buffer.alloc(2048, 1));
await page.goto(`${BASE}/clips/new?campaign=demo_bnty_001`);
await page.setInputFiles("#file", { name: "audit.mp4", mimeType: "video/mp4", buffer: fs.readFileSync(tmpMp4) });
await page.fill("#title", "Audit clip");
await page.check('input[type="checkbox"]');
await page.click("button:has-text('Upload clip')");
await page.waitForURL(/\/clips\/[0-9a-f-]{36}$/);
clipPath = new URL(page.url()).pathname;
await page.fill("#url-tiktok", "https://www.tiktok.com/@demo/video/7312345678901234567");
await page.locator("#url-tiktok").locator("xpath=..").locator("button").click();
await page.waitForTimeout(800);
await page.click("button:has-text('Submit (demo)')");
await page.waitForTimeout(800);

const PAGES = [
  "/",
  "/pricing",
  "/dashboard",
  "/campaigns",
  "/campaigns/demo_bnty_001",
  "/research",
  "/research?cat=podcasts",
  "/research/channel/demo-ch-latenightmic",
  "/research/video/demo-latenightmic-00",
  "/swipe",
  "/clips",
  "/clips/new",
  clipPath,
  "/submissions",
  "/billing",
  "/settings",
  "/settings/accounts",
  "/admin",
  "/status",
  "/design",
  "/terms",
  "/privacy",
  "/does-not-exist",
];

async function setTheme(ctx, theme) {
  const p = await ctx.newPage();
  await p.goto(`${BASE}/settings`);
  await p.getByRole("radiogroup", { name: "Theme" }).last().getByRole("radio", { name: theme === "dark" ? "Dark" : "Light" }).click();
  await p.waitForTimeout(400);
  await p.close();
}

const results = [];
for (const [vpName, ctxOpts] of [["desktop", { viewport: { width: 1280, height: 900 } }], ["mobile", { ...devices["iPhone 13"] }]]) {
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addCookies(await desktop.cookies());
  for (const theme of ["light", "dark"]) {
    await setTheme(ctx, theme);
    for (const pth of PAGES) {
      const p = await ctx.newPage();
      await p.goto(BASE + pth, { waitUntil: "networkidle" });
      await p.waitForTimeout(250); // let the theme transition (if any) settle
      await p.addScriptTag({ content: axeSource });
      const axe = await p.evaluate(async () => {
        // eslint-disable-next-line no-undef
        const r = await axe.run(document, { runOnly: { type: "rule", values: ["color-contrast"] } });
        return r.violations.flatMap((v) =>
          v.nodes.map((n) => ({ target: n.target.join(" "), summary: n.any?.[0]?.message ?? n.failureSummary, html: n.html.slice(0, 120) })),
        );
      });
      const overflow = await p.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        return [...document.querySelectorAll("body *")]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            if (style.position === "fixed" || r.width === 0) return false;
            let a = el.parentElement;
            while (a) {
              const o = getComputedStyle(a).overflowX;
              if (o === "auto" || o === "scroll" || o === "hidden") return false;
              a = a.parentElement;
            }
            return r.right > vw + 1;
          })
          .slice(0, 3)
          .map((el) => el.tagName.toLowerCase() + (el.className ? "." + String(el.className).split(" ").slice(0, 3).join(".") : ""));
      });
      const actual = await p.evaluate(() => (document.documentElement.classList.contains("dark") ? "dark" : "light"));
      results.push({ page: pth, theme, viewport: vpName, applied: actual, contrast: axe, overflow });
      if (shotsDir) await p.screenshot({ path: path.join(shotsDir, `${vpName}-${theme}-${pth.replace(/[^\w]+/g, "_") || "home"}.png`), fullPage: vpName === "desktop" });
      await p.close();
    }
  }
  await ctx.close();
}
await browser.close();

let failures = 0;
for (const r of results) {
  const bad = r.contrast.length || r.overflow.length || r.applied !== r.theme;
  if (bad) failures++;
  console.log(`${bad ? "✗" : "✓"} ${r.viewport.padEnd(7)} ${r.theme.padEnd(5)} ${r.page}${r.applied !== r.theme ? `  [theme not applied: ${r.applied}]` : ""}`);
  for (const c of r.contrast) console.log(`    contrast: ${c.target} — ${c.summary}`);
  for (const o of r.overflow) console.log(`    overflow: ${o}`);
}
console.log(`\n${results.length} page renders checked, ${failures} with problems.`);
process.exit(failures ? 1 : 0);
