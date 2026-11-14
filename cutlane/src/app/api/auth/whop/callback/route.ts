import { NextResponse, type NextRequest } from "next/server";
import { env, modes } from "@/lib/env";
import { exchangeCode, fetchUserInfo, PKCE_COOKIE, readPkce, saveTokens } from "@/lib/whop/oauth";
import { safeEqual } from "@/lib/crypto";
import { startSession, upsertUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

function fail(code: string) {
  const res = NextResponse.redirect(new URL(`/?error=${encodeURIComponent(code)}`, env.appUrl));
  res.cookies.delete({ name: PKCE_COOKIE, path: "/api/auth/whop" });
  return res;
}

/** Step 2: verify state, exchange the code (with the PKCE verifier) server-side, store tokens encrypted. */
export async function GET(req: NextRequest) {
  if (!modes.whop) return NextResponse.redirect(new URL("/", env.appUrl));
  const params = req.nextUrl.searchParams;
  if (params.get("error")) return fail(params.get("error") === "access_denied" ? "access_denied" : "oauth_error");

  const pkce = readPkce(req.cookies.get(PKCE_COOKIE)?.value);
  const state = params.get("state") ?? "";
  const code = params.get("code");
  if (!pkce || !code || !safeEqual(state, pkce.state)) return fail("invalid_state");

  try {
    const tokens = await exchangeCode(code, pkce.verifier);
    const info = await fetchUserInfo(tokens.access_token);
    if (!info.sub) return fail("no_user");
    const user = await upsertUser({
      whopUserId: info.sub,
      username: info.preferred_username ?? null,
      name: info.name ?? null,
      avatarUrl: info.picture ?? null,
      email: info.email ?? null,
    });
    await saveTokens(user.id, tokens);
    await startSession(user.id);
  } catch (err) {
    console.error("[cutlane] Whop OAuth callback failed:", (err as Error).message);
    return fail("token_exchange_failed");
  }
  const res = NextResponse.redirect(new URL(pkce.returnTo, env.appUrl));
  res.cookies.delete({ name: PKCE_COOKIE, path: "/api/auth/whop" });
  return res;
}
