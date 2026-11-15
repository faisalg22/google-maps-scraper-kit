import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth/session";
import { advanceSubmissionJob } from "@/lib/whop/submission-job";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** The upload step streams up to 1 GB to Whop; every other step takes well under a second. */
export const maxDuration = 300;

/** Performs ONE step of a queued submission. The browser calls it until the job is done. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // Cookie-authenticated POST: only accept same-origin requests (CSRF protection).
  const origin = req.headers.get("origin");
  const allowed = [new URL(env.appUrl).origin, req.nextUrl.origin];
  if (!origin || !allowed.includes(origin)) return NextResponse.json({ error: "Bad origin" }, { status: 403 });

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const result = await advanceSubmissionJob(user.id, id);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
