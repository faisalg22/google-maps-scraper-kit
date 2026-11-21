import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

export const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-import-secret",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

/** Service-role client. Bypasses RLS, so only ever used after the caller is authorised. */
export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

/** Constant-time string comparison for shared secrets. */
export function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

/**
 * Accepts a request only from a signed-in Supabase user whose email is in ADMIN_EMAILS
 * (comma-separated). The anon key alone is NOT enough.
 */
export async function requireAdmin(req: Request): Promise<{ email: string } | Response> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sign in required" }, 401);
  const { data, error } = await adminClient().auth.getUser(token);
  const email = data?.user?.email?.toLowerCase();
  if (error || !email) return json({ error: "Sign in required" }, 401);
  const allowed = (Deno.env.get("ADMIN_EMAILS") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(email)) return json({ error: "Not allowed" }, 403);
  return { email };
}

/** Accepts machine callers (Apify webhook, cron) that send x-import-secret. */
export function hasImportSecret(req: Request): boolean {
  const expected = Deno.env.get("IMPORT_SECRET");
  const got = req.headers.get("x-import-secret");
  return !!expected && !!got && safeEqual(got, expected);
}
