import fs from "node:fs";
import { Readable } from "node:stream";
import { NextResponse, type NextRequest } from "next/server";
import { modes } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth/session";
import { getClip } from "@/lib/repo";
import { localPath, signedReadUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Owner-only clip playback. Live: short-lived signed Supabase URL. Demo: streamed from disk with Range support. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const clip = await getClip(user.id, id);
  if (!clip) return new NextResponse("Not found", { status: 404 });

  if (modes.storage) {
    const url = await signedReadUrl(clip.storage_key, 300);
    return url ? NextResponse.redirect(url) : new NextResponse("Not found", { status: 404 });
  }

  const file = localPath(clip.storage_key);
  let size: number;
  try {
    size = (await fs.promises.stat(file)).size;
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
  };
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const stream = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
    return new NextResponse(stream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  const stream = Readable.toWeb(fs.createReadStream(file)) as ReadableStream;
  return new NextResponse(stream, { status: 200, headers: { ...headers, "Content-Length": String(size) } });
}
