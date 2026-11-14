import { NextResponse, type NextRequest } from "next/server";

/** Cheap gate: app pages need a session cookie. The real check (DB lookup) happens in the (app) layout. */
const PROTECTED = ["/campaigns", "/research", "/swipe", "/clips", "/submissions", "/status"];

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`)) && !req.cookies.get("cl_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = `?signin=1&returnTo=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!api|_next|favicon.ico|icon.svg).*)"] };
