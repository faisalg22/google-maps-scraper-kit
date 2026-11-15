/**
 * Submitting with the clip file attached runs as a resumable job.
 * Needs a fresh demo server: `rm -rf .data && npm run build && ALLOW_DEMO=true npm start`.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
let browser;
before(async () => {
  browser = await require("playwright").chromium.launch();
});
after(async () => browser?.close());

async function setup(page) {
  await page.goto(BASE + "/");
  await page.click("text=Enter the demo");
  await page.waitForURL(/pricing|dashboard/);
  await page.waitForLoadState("networkidle");
  if (page.url().includes("pricing")) {
    const start = page.locator("button:has-text('Start 3-day free trial'), button:has-text('Subscribe for')").first();
    if (await start.count()) {
      await start.click();
      await page.click("button:has-text('(simulated)')");
      await page.waitForURL(/billing/);
    }
  }
}

async function newClipWithLink(page, title) {
  await page.goto(BASE + "/clips/new?campaign=demo_bnty_001");
  await page.setInputFiles("#file", { name: "c.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(4096, 1) });
  await page.fill("#title", title);
  await page.check('input[type="checkbox"]');
  await page.click("button:has-text('Upload clip')");
  await page.waitForURL(/\/clips\/[0-9a-f-]{36}$/);
  await page.fill("#url-tiktok", "https://www.tiktok.com/@demo/video/7312345678901234567");
  await page.locator("#url-tiktok").locator("xpath=..").locator("button").click();
  await page.waitForSelector("text=Loads publicly >> visible=true");
}

test("submitting with the file attached completes through the job steps", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await setup(page);
  await newClipWithLink(page, "Job clip");
  const steps = [];
  page.on("response", async (r) => {
    if (r.url().includes("/advance")) steps.push((await r.json().catch(() => ({}))).state);
  });
  await page.click("button:has-text('Submit (demo)')");
  await page.waitForSelector("text=Submitted >> visible=true", { timeout: 20_000 });
  // Response bodies are read asynchronously by the listener: give the last ones a moment.
  for (let i = 0; i < 50 && !steps.includes("done"); i++) await page.waitForTimeout(100);
  assert.deepEqual([...new Set(steps.filter(Boolean))], ["processing", "creating", "done"]);
  await page.goto(BASE + "/submissions");
  await page.waitForSelector("text=Pending review");
  await ctx.close();
});

test("a job interrupted by closing the tab resumes when the user comes back", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await setup(page);
  await newClipWithLink(page, "Resume clip");
  // Simulate the tab closing right after queueing: the browser never gets to advance the job.
  await page.route("**/advance", (r) => r.abort());
  await page.click("button:has-text('Submit (demo)')");
  await page.waitForSelector("text=Waiting to upload… >> visible=true");
  const clipUrl = page.url();
  await page.close();

  const back = await ctx.newPage();
  await back.goto(clipUrl);
  await back.waitForSelector("text=Submitted >> visible=true", { timeout: 20_000 });
  await ctx.close();
});
