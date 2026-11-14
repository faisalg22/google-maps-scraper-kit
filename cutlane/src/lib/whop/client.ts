import "server-only";
import { env } from "../env";
import { q } from "../db";
import { loadTokens, refreshTokens, saveTokens } from "./oauth";

export class WhopApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public type?: string,
    public code?: string,
  ) {
    super(message);
  }
}

export class WhopAuthRequired extends Error {
  constructor() {
    super("Your Whop session expired. Please sign in again.");
  }
}

// One in-flight refresh per user: Whop rotates refresh tokens, so concurrent refreshes would race.
const refreshing = new Map<string, Promise<string>>();

async function validAccessToken(userId: string, force = false): Promise<string> {
  const tokens = await loadTokens(userId);
  if (!tokens) throw new WhopAuthRequired();
  const fresh = tokens.expiresAt.getTime() - Date.now() > 5 * 60_000;
  if (fresh && !force) return tokens.accessToken;
  if (!tokens.refreshToken) throw new WhopAuthRequired();

  const pending = refreshing.get(userId);
  if (pending) return pending;
  const p = (async () => {
    try {
      const t = await refreshTokens(tokens.refreshToken!);
      await saveTokens(userId, t, tokens.refreshToken);
      return t.access_token;
    } catch (err) {
      const oauthError = (err as { oauthError?: string }).oauthError;
      if (oauthError === "invalid_grant") {
        await q(`delete from oauth_tokens where user_id = $1`, [userId]);
        throw new WhopAuthRequired();
      }
      throw err;
    } finally {
      refreshing.delete(userId);
    }
  })();
  refreshing.set(userId, p);
  return p;
}

export interface WhopRequest {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Record<string, string | number | undefined | null>;
  body?: unknown;
  idempotencyKey?: string;
}

/** Authenticated call to https://api.whop.com/api/v1 with the user's own token. Server-side only. */
export async function whopFetch<T>(userId: string, path: string, req: WhopRequest = {}): Promise<T> {
  const url = new URL(env.whop.apiBase + path);
  for (const [k, val] of Object.entries(req.query ?? {})) {
    if (val !== undefined && val !== null && val !== "") url.searchParams.set(k, String(val));
  }

  const send = async (token: string) =>
    fetch(url, {
      method: req.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Api-Version-Date": env.whop.apiVersionDate,
        ...(req.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(req.idempotencyKey ? { "Idempotency-Key": req.idempotencyKey } : {}),
      },
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });

  let res = await send(await validAccessToken(userId));
  if (res.status === 401) res = await send(await validAccessToken(userId, true));

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const e = (json as { error?: { message?: string; type?: string; code?: string } } | null)?.error;
    if (res.status === 401) throw new WhopAuthRequired();
    throw new WhopApiError(e?.message ?? `Whop API error ${res.status}`, res.status, e?.type, e?.code);
  }
  return json as T;
}

/**
 * Store the first raw response per endpoint so unconfirmed campaign fields can be
 * checked against reality on /status. Also printed to the server log once.
 */
export async function captureSampleOnce(endpoint: string, payload: unknown) {
  const rows = await q<{ endpoint: string }>(
    `insert into api_samples (endpoint, payload) values ($1, $2::jsonb) on conflict (endpoint) do nothing returning endpoint`,
    [endpoint, JSON.stringify(payload)],
  );
  if (rows.length) {
    console.log(`[cutlane] First raw Whop response for ${endpoint}:\n${JSON.stringify(payload, null, 2).slice(0, 20_000)}`);
  }
}
