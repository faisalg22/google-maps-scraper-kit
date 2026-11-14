import "server-only";
import type { Platform } from "../whop/campaigns-core";
import { PLATFORM_HOSTS } from "./platforms";
import { modes } from "../env";

export interface LinkCheckResult {
  status: "ok" | "blocked" | "failed";
  httpStatus: number | null;
  message: string;
}

/**
 * Checks that a post URL loads publicly. Only ever requests hosts on the platform's allow-list
 * (redirects are followed manually and re-checked), so it cannot be used to reach internal hosts.
 *
 * Social platforms often answer bots with 403/429 or a login wall. Those come back as "blocked":
 * we couldn't prove it either way, and the editor confirms by opening the link logged-out.
 */
export async function checkPublicLink(platform: Platform, url: string): Promise<LinkCheckResult> {
  if (!modes.whop) {
    return { status: "ok", httpStatus: 200, message: "Demo mode: link check simulated (no request sent)." };
  }
  const allowed = new Set([...PLATFORM_HOSTS[platform], "www.instagram.com", "www.tiktok.com", "www.youtube.com", "consent.youtube.com"]);
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    let host: string;
    try {
      const parsed = new URL(current);
      if (parsed.protocol !== "https:") return { status: "failed", httpStatus: null, message: "Redirected to a non-https URL." };
      host = parsed.hostname.toLowerCase();
    } catch {
      return { status: "failed", httpStatus: null, message: "Invalid redirect URL." };
    }
    if (!allowed.has(host)) return { status: "failed", httpStatus: null, message: `Redirected off-platform to ${host}.` };

    let res: Response;
    try {
      res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; CutLaneLinkCheck/1.0)", Accept: "text/html" },
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
    } catch (err) {
      return { status: "blocked", httpStatus: null, message: `Couldn't reach the platform (${(err as Error).name}). Open it yourself to confirm.` };
    }
    // Don't download the page body.
    res.body?.cancel().catch(() => undefined);

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return { status: "failed", httpStatus: res.status, message: "Redirect without a destination." };
      const next = new URL(loc, current).toString();
      if (/\/accounts\/login|\/login/i.test(next)) {
        return { status: "blocked", httpStatus: res.status, message: "The platform redirected to a login page. Open the link logged-out to confirm it's public." };
      }
      current = next;
      continue;
    }
    if (res.status >= 200 && res.status < 300) return { status: "ok", httpStatus: res.status, message: "Link loads publicly." };
    if (res.status === 404 || res.status === 410) return { status: "failed", httpStatus: res.status, message: "Post not found. Is it deleted, private or still processing?" };
    if ([401, 403, 429].includes(res.status)) {
      return { status: "blocked", httpStatus: res.status, message: `The platform blocked the automatic check (HTTP ${res.status}). Open it logged-out to confirm.` };
    }
    return { status: "failed", httpStatus: res.status, message: `Unexpected response (HTTP ${res.status}).` };
  }
  return { status: "failed", httpStatus: null, message: "Too many redirects." };
}
