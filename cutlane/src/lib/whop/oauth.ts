import "server-only";
import crypto from "node:crypto";
import { env } from "../env";
import { decrypt, encrypt, randomToken } from "../crypto";
import { one, q } from "../db";

/** PKCE + state + nonce, kept in a short-lived encrypted httpOnly cookie between /start and /callback. */
export interface PkceState {
  verifier: string;
  state: string;
  nonce: string;
  returnTo: string;
  createdAt: number;
}

export const PKCE_COOKIE = "cl_oauth";
export const PKCE_MAX_AGE_SECONDS = 600;

export function newPkce(returnTo: string): { cookieValue: string; authorizeUrl: string } {
  const pkce: PkceState = {
    verifier: randomToken(48),
    state: randomToken(16),
    nonce: randomToken(16),
    returnTo: safeReturnTo(returnTo),
    createdAt: Date.now(),
  };
  const challenge = crypto.createHash("sha256").update(pkce.verifier).digest("base64url");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.whop.clientId!,
    redirect_uri: env.whop.redirectUri!,
    scope: env.whop.scopes,
    state: pkce.state,
    nonce: pkce.nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return {
    cookieValue: encrypt(JSON.stringify(pkce)),
    authorizeUrl: `${env.whop.oauthBase}/authorize?${params}`,
  };
}

export function readPkce(cookieValue: string | undefined): PkceState | null {
  if (!cookieValue) return null;
  try {
    const parsed = JSON.parse(decrypt(cookieValue)) as PkceState;
    if (Date.now() - parsed.createdAt > PKCE_MAX_AGE_SECONDS * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Only allow same-origin relative paths as post-login destinations. */
export function safeReturnTo(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/dashboard";
  return raw;
}

export interface WhopTokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<WhopTokenResponse> {
  const res = await fetch(`${env.whop.oauthBase}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: env.whop.clientId,
      // Confidential server-side client: the secret is sent from the server only.
      ...(env.whop.clientSecret ? { client_secret: env.whop.clientSecret } : {}),
      ...body,
    }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = new Error(`Whop token request failed (${res.status}): ${json.error_description ?? json.error ?? "unknown"}`);
    (err as Error & { oauthError?: unknown }).oauthError = json.error;
    throw err;
  }
  return json as unknown as WhopTokenResponse;
}

export function exchangeCode(code: string, verifier: string) {
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: env.whop.redirectUri!,
    code_verifier: verifier,
  });
}

export function refreshTokens(refreshToken: string) {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
}

export interface WhopUserInfo {
  sub: string;
  name?: string;
  preferred_username?: string;
  picture?: string;
  email?: string;
}

export async function fetchUserInfo(accessToken: string): Promise<WhopUserInfo> {
  const res = await fetch(`${env.whop.oauthBase}/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Whop userinfo failed (${res.status})`);
  return (await res.json()) as WhopUserInfo;
}

export async function saveTokens(userId: string, t: WhopTokenResponse, previousRefresh?: string | null) {
  const expiresAt = new Date(Date.now() + Math.max(60, t.expires_in ?? 3600) * 1000);
  // Refresh tokens rotate on every use; keep the old one only if Whop didn't send a new one.
  const refresh = t.refresh_token ?? previousRefresh ?? null;
  await q(
    `insert into oauth_tokens (user_id, access_token_enc, refresh_token_enc, scope, expires_at)
     values ($1, $2, $3, $4, $5::timestamptz)
     on conflict (user_id) do update set access_token_enc = excluded.access_token_enc,
       refresh_token_enc = excluded.refresh_token_enc, scope = excluded.scope,
       expires_at = excluded.expires_at, updated_at = now()`,
    [userId, encrypt(t.access_token), refresh ? encrypt(refresh) : null, t.scope ?? env.whop.scopes, expiresAt.toISOString()],
  );
}

export async function loadTokens(userId: string) {
  const row = await one<{ access_token_enc: string; refresh_token_enc: string | null; expires_at: Date | string }>(
    `select access_token_enc, refresh_token_enc, expires_at from oauth_tokens where user_id = $1`,
    [userId],
  );
  if (!row) return null;
  return {
    accessToken: decrypt(row.access_token_enc),
    refreshToken: row.refresh_token_enc ? decrypt(row.refresh_token_enc) : null,
    expiresAt: new Date(row.expires_at),
  };
}

/** Revoke the refresh token on Whop and delete stored tokens (logout). */
export async function revokeAndDelete(userId: string) {
  const tokens = await loadTokens(userId).catch(() => null);
  if (tokens?.refreshToken) {
    await fetch(`${env.whop.oauthBase}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: tokens.refreshToken, client_id: env.whop.clientId }),
    }).catch(() => undefined);
  }
  await q(`delete from oauth_tokens where user_id = $1`, [userId]);
}
