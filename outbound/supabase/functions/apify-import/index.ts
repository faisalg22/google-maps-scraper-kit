// POST /functions/v1/apify-import
// Pulls a finished Apify run's dataset and upserts it into companies + leads.
//
// Callers:
//   - Apify webhook (ACTOR.RUN.SUCCEEDED) with header x-import-secret, body = Apify's default payload
//     ({ resource: { id, defaultDatasetId, actId } })
//   - An admin (signed-in user in ADMIN_EMAILS) or a script with x-import-secret, body = { runId } or { datasetId }
import { adminClient, cors, hasImportSecret, json, requireAdmin } from "../_shared/auth.ts";
import { importPlaces } from "../_shared/import.ts";

const APIFY = "https://api.apify.com/v2";
const ID = /^[A-Za-z0-9~_-]{1,64}$/;

async function apify(path: string): Promise<Response> {
  const token = Deno.env.get("APIFY_TOKEN");
  if (!token) throw new Error("APIFY_TOKEN is not set");
  return fetch(`${APIFY}${path}`, { headers: { Authorization: `Bearer ${token}` } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  if (!hasImportSecret(req)) {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;
  }

  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { /* empty body */ }

  let runId: string | undefined = body.runId ?? body.resource?.id;
  let datasetId: string | undefined = body.datasetId ?? body.resource?.defaultDatasetId;
  if (runId && !ID.test(runId)) return json({ error: "Bad runId" }, 400);
  if (datasetId && !ID.test(datasetId)) return json({ error: "Bad datasetId" }, 400);

  try {
    let actor = body.resource?.actId ?? "compass/crawler-google-places";
    if (runId && !datasetId) {
      const r = await apify(`/actor-runs/${runId}`);
      if (!r.ok) return json({ error: `Apify run lookup failed (${r.status})` }, 502);
      const run = (await r.json()).data;
      if (run.status !== "SUCCEEDED") return json({ error: `Run is ${run.status}, not SUCCEEDED` }, 409);
      datasetId = run.defaultDatasetId;
      actor = run.actId ?? actor;
    }
    if (!datasetId) return json({ error: "Send runId or datasetId" }, 400);

    const db = adminClient();
    const { data: runRow, error: runErr } = await db.from("scrape_runs").upsert(
      { actor, run_id: runId ?? `dataset:${datasetId}`, dataset_id: datasetId, status: "importing" },
      { onConflict: "run_id" },
    ).select("id").single();
    if (runErr) throw runErr;

    // Page through the dataset.
    const items: unknown[] = [];
    for (let offset = 0; ; offset += 1000) {
      const r = await apify(`/datasets/${datasetId}/items?clean=true&format=json&limit=1000&offset=${offset}`);
      if (!r.ok) throw new Error(`Apify dataset fetch failed (${r.status})`);
      const page = await r.json() as unknown[];
      items.push(...page);
      if (page.length < 1000) break;
    }

    const result = await importPlaces(db, items, runRow.id);
    await db.from("scrape_runs").update({
      status: "imported", finished_at: new Date().toISOString(),
      items_received: result.items_received, companies_upserted: result.companies_upserted, leads_created: result.leads_created,
    }).eq("id", runRow.id);

    return json({ ok: true, ...result });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : "Import failed" }, 500);
  }
});
