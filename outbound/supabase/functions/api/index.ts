// /functions/v1/api/* — the backend the dashboard (and you) call. Admin users only.
//
//   GET   /api/summary                 pipeline totals (leads, sent, replied, booked, bounces...)
//   GET   /api/daily                   per-day counts for the last 90 days
//   GET   /api/leads?stage=&q=&limit=&offset=
//   PATCH /api/leads/:id               { stage?, notes?, title?, full_name? }
//   POST  /api/events                  { lead_id, type, message_id?, detail?, occurred_at? }  (sent, reply, bounce, unsubscribe...)
//   POST  /api/meetings                { lead_id, scheduled_for, booking_provider?, booking_ref? }
//   PATCH /api/meetings/:id            { status, outcome? }
//   GET   /api/settings                kill switch state
//   PATCH /api/settings                { sending_paused: boolean }
//   GET   /api/runs                    recent Apify imports
//   POST  /api/import/apollo           { rows: [...] }  Apollo CSV export as JSON objects keyed by header
import { adminClient, cors, json, requireAdmin } from "../_shared/auth.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAGES = ["new", "verified", "queued", "emailed", "replied", "booked", "held", "won", "lost", "unsubscribed", "bounced", "do_not_contact"];
const EVENTS = ["sent", "opened", "bounce", "reply", "unsubscribe", "complaint", "out_of_office"];
const MEETING_STATUS = ["booked", "held", "no_show", "cancelled", "rescheduled"];

function pick<T extends Record<string, unknown>>(o: T, keys: string[]): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in o) out[k] = o[k];
  return out as Partial<T>;
}

function isoOrNow(v: unknown): string {
  const d = typeof v === "string" ? new Date(v) : new Date();
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const i = parts.indexOf("api");
  const [resource, id] = parts.slice(i + 1);
  const db = adminClient();
  let body: Record<string, any> = {};
  if (req.method === "POST" || req.method === "PATCH") {
    try { body = await req.json(); } catch { return json({ error: "Body must be JSON" }, 400); }
  }

  try {
    // ---- summary / daily
    if (req.method === "GET" && resource === "summary") {
      const { data, error } = await db.rpc("pipeline_summary");
      if (error) throw error;
      return json(data);
    }
    if (req.method === "GET" && resource === "daily") {
      const { data, error } = await db.from("pipeline_daily").select("*").order("day");
      if (error) throw error;
      return json(data);
    }

    // ---- leads
    if (resource === "leads" && req.method === "GET" && !id) {
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 500);
      const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
      let q = db.from("leads")
        .select("id, email, full_name, title, stage, is_role_address, email_status, scraped_at, first_emailed_at, replied_at, booked_at, notes, company:companies(id, name, website, city, province, category, phone, rating)", { count: "exact" })
        .order("scraped_at", { ascending: false })
        .range(offset, offset + limit - 1);
      const stage = url.searchParams.get("stage");
      if (stage) {
        if (!STAGES.includes(stage)) return json({ error: "Unknown stage" }, 400);
        q = q.eq("stage", stage);
      }
      const search = url.searchParams.get("q")?.trim();
      if (search) {
        // Strip characters PostgREST treats as filter syntax.
        const s = search.replace(/[,()*%\\]/g, " ").slice(0, 80);
        q = q.or(`email.ilike.%${s}%,full_name.ilike.%${s}%,title.ilike.%${s}%`);
      }
      const { data, error, count } = await q;
      if (error) throw error;
      return json({ total: count, limit, offset, leads: data });
    }
    if (resource === "leads" && req.method === "PATCH" && id) {
      if (!UUID.test(id)) return json({ error: "Bad lead id" }, 400);
      const patch = pick(body, ["stage", "notes", "title", "full_name", "first_name", "last_name"]);
      if (patch.stage && !STAGES.includes(String(patch.stage))) return json({ error: "Unknown stage" }, 400);
      if (patch.stage === "won") (patch as Record<string, unknown>).won_at = new Date().toISOString();
      const { data, error } = await db.from("leads").update(patch).eq("id", id).select().single();
      if (error) return json({ error: error.message }, 400); // e.g. CASL gate, 2-per-company limit
      return json(data);
    }

    // ---- events
    if (resource === "events" && req.method === "POST") {
      if (!UUID.test(String(body.lead_id))) return json({ error: "lead_id required" }, 400);
      if (!EVENTS.includes(String(body.type))) return json({ error: "Unknown event type" }, 400);
      const { data, error } = await db.from("events").insert({
        lead_id: body.lead_id,
        type: body.type,
        message_id: UUID.test(String(body.message_id)) ? body.message_id : null,
        detail: body.detail ?? null,
        occurred_at: isoOrNow(body.occurred_at),
      }).select().single();
      if (error) return json({ error: error.message }, 400);
      return json(data, 201);
    }

    // ---- meetings
    if (resource === "meetings" && req.method === "POST") {
      if (!UUID.test(String(body.lead_id))) return json({ error: "lead_id required" }, 400);
      const { data, error } = await db.from("meetings").insert({
        lead_id: body.lead_id,
        scheduled_for: isoOrNow(body.scheduled_for),
        booking_provider: body.booking_provider ?? "manual",
        booking_ref: body.booking_ref ?? null,
        qualification: body.qualification ?? null,
      }).select().single();
      if (error) return json({ error: error.message }, 400);
      return json(data, 201);
    }
    if (resource === "meetings" && req.method === "PATCH" && id) {
      if (!UUID.test(id)) return json({ error: "Bad meeting id" }, 400);
      if (body.status && !MEETING_STATUS.includes(String(body.status))) return json({ error: "Unknown status" }, 400);
      const { data, error } = await db.from("meetings").update(pick(body, ["status", "outcome", "pre_call_brief", "scheduled_for"])).eq("id", id).select().single();
      if (error) return json({ error: error.message }, 400);
      return json(data);
    }

    // ---- settings (kill switch)
    if (resource === "settings" && req.method === "GET") {
      const { data, error } = await db.from("app_settings").select("*").single();
      if (error) throw error;
      return json(data);
    }
    if (resource === "settings" && req.method === "PATCH") {
      if (typeof body.sending_paused !== "boolean") return json({ error: "sending_paused must be true or false" }, 400);
      const { data, error } = await db.from("app_settings").update({ sending_paused: body.sending_paused }).eq("id", true).select().single();
      if (error) throw error;
      return json(data);
    }

    // ---- contact list import (Apollo CSV export converted to JSON rows)
    if (resource === "import" && req.method === "POST") {
      const source = id ?? "apollo";
      if (!/^[a-z_]{2,40}$/.test(source)) return json({ error: "Bad source" }, 400);
      if (!Array.isArray(body.rows) || body.rows.length === 0) return json({ error: "Send { rows: [...] }" }, 400);
      if (body.rows.length > 5000) return json({ error: "At most 5000 rows per request" }, 400);
      const total: Record<string, number> = {};
      for (let i = 0; i < body.rows.length; i += 500) {
        const { data, error } = await db.rpc("import_apollo_contacts", { items: body.rows.slice(i, i + 500), p_source: source });
        if (error) return json({ error: error.message }, 400);
        for (const [k, v] of Object.entries(data ?? {})) total[k] = (total[k] ?? 0) + Number(v);
      }
      return json({ ok: true, ...total });
    }

    // ---- import history
    if (resource === "runs" && req.method === "GET") {
      const { data, error } = await db.from("scrape_runs").select("*").order("started_at", { ascending: false }).limit(50);
      if (error) throw error;
      return json(data);
    }

    return json({ error: "Not found" }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: "Server error" }, 500);
  }
});
