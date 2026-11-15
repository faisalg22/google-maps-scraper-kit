import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_ATTEMPTS, PROCESSING_TIMEOUT_MS, STALE_UPLOAD_MS, nextStep, type JobRow } from "@/lib/whop/submission-job-core";

const ORIGINAL = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.resetModules();
});

async function loadEnv(vars: Record<string, string | undefined>) {
  process.env = { ...ORIGINAL };
  for (const k of Object.keys(process.env)) if (/^(WHOP_|STRIPE_|SUPABASE_|YOUTUBE_|DATABASE_URL|TOKEN_ENCRYPTION_KEY|ALLOW_DEMO|APP_URL)/.test(k)) delete process.env[k];
  Object.assign(process.env, vars);
  vi.resetModules();
  return import("@/lib/env");
}

const FULL = {
  NODE_ENV: "production",
  APP_URL: "https://cutlane.io",
  DATABASE_URL: "postgres://x",
  TOKEN_ENCRYPTION_KEY: "k",
  WHOP_CLIENT_ID: "app_x",
  WHOP_CLIENT_SECRET: "s",
  WHOP_REDIRECT_URI: "https://cutlane.io/api/auth/whop/callback",
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_PRICE_BEGINNER: "price_x",
  STRIPE_WEBHOOK_SECRET: "whsec_x",
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "srk",
  YOUTUBE_API_KEY: "yt",
};

describe("production guard: no demo fallbacks on a real deploy", () => {
  it("development allows demo fallbacks", async () => {
    const e = await loadEnv({ NODE_ENV: "development" });
    expect(e.demoAllowed()).toBe(true);
    expect(() => e.requireLiveOrDemo(false, "Whop", "WHOP_*")).not.toThrow();
  });

  it("production blocks demo fallbacks (no free mock subscriptions, no demo admin)", async () => {
    const e = await loadEnv({ NODE_ENV: "production" });
    expect(e.demoAllowed()).toBe(false);
    expect(() => e.requireLiveOrDemo(false, "Clip storage", "SUPABASE_URL")).toThrow(/isn't configured/);
    expect(() => e.requireLiveOrDemo(true, "Clip storage", "SUPABASE_URL")).not.toThrow();
  });

  it("ALLOW_DEMO=true re-enables them for staging/review deploys only", async () => {
    const e = await loadEnv({ NODE_ENV: "production", ALLOW_DEMO: "true" });
    expect(e.demoAllowed()).toBe(true);
  });

  it("lists every missing production setting, and nothing when complete", async () => {
    const empty = await loadEnv({ NODE_ENV: "production" });
    const errs = empty.productionConfigErrors();
    for (const k of ["DATABASE_URL", "TOKEN_ENCRYPTION_KEY", "WHOP_CLIENT_ID", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "SUPABASE_URL", "YOUTUBE_API_KEY", "https"]) {
      expect(errs.join(" ")).toContain(k);
    }
    const full = await loadEnv(FULL);
    expect(full.productionConfigErrors()).toEqual([]);
    const http = await loadEnv({ ...FULL, APP_URL: "http://cutlane.io" });
    expect(http.productionConfigErrors().join(" ")).toContain("https");
  });
});

describe("submission job steps (each request does one short step)", () => {
  const now = new Date("2026-11-15T12:00:00Z");
  const row = (job_state: JobRow["job_state"], ageMs = 0, job_attempts = 0): JobRow => ({ job_state, job_updated_at: new Date(now.getTime() - ageMs), job_attempts });

  it("queued → upload, processing → check, creating → create, done/failed → nothing", () => {
    expect(nextStep(row("queued"), now)).toEqual({ kind: "upload" });
    expect(nextStep(row("processing", 5000), now)).toEqual({ kind: "check_file" });
    expect(nextStep(row("creating"), now)).toEqual({ kind: "create" });
    expect(nextStep(row("done"), now)).toEqual({ kind: "none" });
    expect(nextStep(row("failed"), now)).toEqual({ kind: "none" });
  });

  it("an upload in progress is not started twice; a dead one (tab closed, function killed) is restarted", () => {
    expect(nextStep(row("uploading", 60_000), now)).toEqual({ kind: "wait" });
    expect(nextStep(row("uploading", STALE_UPLOAD_MS + 1, 1), now)).toEqual({ kind: "upload" });
  });

  it("gives up after repeated upload failures or slow Whop processing", () => {
    expect(nextStep(row("queued", 0, MAX_ATTEMPTS), now).kind).toBe("fail");
    expect(nextStep(row("uploading", STALE_UPLOAD_MS + 1, MAX_ATTEMPTS), now).kind).toBe("fail");
    expect(nextStep(row("processing", PROCESSING_TIMEOUT_MS + 1), now).kind).toBe("fail");
  });
});
