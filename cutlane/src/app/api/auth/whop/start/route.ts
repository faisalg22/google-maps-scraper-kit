import { NextResponse, type NextRequest } from "next/server";
import { env, modes } from "@/lib/env";
import { newPkce, PKCE_COOKIE, PKCE_MAX_AGE_SECONDS } from "@/lib/whop/oauth";

export const dynamic = "force-dynamic";

/** Step 1 of Sign in with Whop: create PKCE verifier + state, then redirect to Whop's consent screen. */
export async function GET(req: NextRequest) {
  if (!modes.whop) return NextResponse.redirect(new URL("/?demo=1", env.appUrl));
  if (!env.tokenEncryptionKey) {
    return NextResponse.redirect(new URL("/?error=missing_encryption_key", env.appUrl));
  }
  const { cookieValue, authorizeUrl } = newPkce(req.nextUrl.searchParams.get("returnTo") ?? "/campaigns");
  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set(PKCE_COOKIE, cookieValue, {
    httpOnly: true,
    secure: env.appUrl.startsWith("https://"),
    sameSite: "lax",
    path: "/api/auth/whop",
    maxAge: PKCE_MAX_AGE_SECONDS,
  });
  return res;
}
