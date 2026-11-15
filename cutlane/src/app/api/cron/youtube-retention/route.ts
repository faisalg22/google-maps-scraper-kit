import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { expireYouTubeData, refreshStaleYouTubeData } from "@/lib/youtube/retention";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/** Daily job (vercel.json cron, or any scheduler): `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const refreshed = await refreshStaleYouTubeData({ limit: 500 }).catch(() => ({ channels: 0, notes: 0 }));
  await expireYouTubeData();
  return NextResponse.json({ ok: true, refreshed });
}
