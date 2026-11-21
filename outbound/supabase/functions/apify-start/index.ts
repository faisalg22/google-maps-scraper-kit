// POST /functions/v1/apify-start
// Starts a Google Maps pull on Apify. When the run succeeds, Apify calls apify-import (webhook),
// so new leads land in the database without anyone polling.
//
// Body (all optional): { searchStrings: string[], location: string, maxPerSearch: number, maxChargeUsd: number }
// Auth: admin user, or x-import-secret (for pg_cron / scheduled pulls).
import { cors, hasImportSecret, json, requireAdmin } from "../_shared/auth.ts";

const ACTOR = "compass~crawler-google-places";
const DEFAULT_TERMS = [
  "manufacturing company", "metal fabrication", "plastics manufacturer",
  "food processing plant", "industrial machinery manufacturer",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  if (!hasImportSecret(req)) {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;
  }

  const token = Deno.env.get("APIFY_TOKEN");
  const secret = Deno.env.get("IMPORT_SECRET");
  if (!token || !secret) return json({ error: "APIFY_TOKEN and IMPORT_SECRET must be set" }, 500);

  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { /* defaults */ }

  const terms: string[] = Array.isArray(body.searchStrings) && body.searchStrings.length
    ? body.searchStrings.slice(0, 20).map((s: unknown) => String(s).slice(0, 100))
    : DEFAULT_TERMS;
  const location = String(body.location ?? "Ontario, Canada").slice(0, 100);
  const maxPerSearch = Math.min(Math.max(Number(body.maxPerSearch) || 40, 1), 500);
  const maxChargeUsd = Math.min(Math.max(Number(body.maxChargeUsd) || 3, 0.5), 50);

  const importUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/apify-import`;
  const webhooks = btoa(JSON.stringify([{
    eventTypes: ["ACTOR.RUN.SUCCEEDED"],
    requestUrl: importUrl,
    headersTemplate: JSON.stringify({ "x-import-secret": secret }),
  }]));

  const input = {
    searchStringsArray: terms,
    locationQuery: location,
    maxCrawledPlacesPerSearch: maxPerSearch,
    language: "en",
    scrapeContacts: true,
    maxReviews: 0,
    maxImages: 0,
  };

  const r = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR}/runs?maxTotalChargeUsd=${maxChargeUsd}&webhooks=${encodeURIComponent(webhooks)}`,
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(input) },
  );
  if (!r.ok) return json({ error: `Apify refused the run (${r.status})`, detail: await r.text() }, 502);
  const run = (await r.json()).data;
  return json({ ok: true, runId: run.id, datasetId: run.defaultDatasetId, status: run.status, terms, location, maxPerSearch });
});
