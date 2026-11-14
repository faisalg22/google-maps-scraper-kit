import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NextResponse, type NextRequest } from "next/server";
import { modes } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth/session";
import { getBillingFor } from "@/lib/billing/server";
import { keyBelongsTo, localPath, MAX_CLIP_BYTES, verifyLocalUploadSignature } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** DEMO storage only: receives the PUT for a signed upload target and streams it to ./.data/uploads. */
export async function PUT(req: NextRequest) {
  if (modes.storage) return NextResponse.json({ error: "Local uploads are disabled" }, { status: 404 });
  const user = await getCurrentUser();
  const sp = req.nextUrl.searchParams;
  const key = sp.get("key") ?? "";
  if (!user || !keyBelongsTo(key, user.id) || !verifyLocalUploadSignature(key, sp.get("exp") ?? "", sp.get("sig") ?? "")) {
    return NextResponse.json({ error: "Invalid or expired upload URL" }, { status: 403 });
  }
  // Same entitlements gate as the server actions.
  if (!(await getBillingFor(user.id)).ent.canWrite) return NextResponse.json({ error: "Plan inactive" }, { status: 402 });
  if (req.headers.get("content-type") !== "video/mp4") return NextResponse.json({ error: "Only video/mp4" }, { status: 415 });
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_CLIP_BYTES) return NextResponse.json({ error: "File too large" }, { status: 413 });
  if (!req.body) return NextResponse.json({ error: "Empty body" }, { status: 400 });

  const dest = localPath(key);
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  let received = 0;
  const body = Readable.fromWeb(req.body as never);
  body.on("data", (chunk: Buffer) => {
    received += chunk.length;
    if (received > MAX_CLIP_BYTES) body.destroy(new Error("File too large"));
  });
  try {
    await pipeline(body, fs.createWriteStream(dest, { flags: "wx" }));
  } catch (err) {
    await fs.promises.rm(dest, { force: true });
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, size: received });
}
