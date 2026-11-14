import "server-only";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { env, modes } from "./env";
import { hmac, safeEqual } from "./crypto";

/**
 * Clip file storage.
 * - LIVE: private Supabase Storage bucket. The browser uploads straight to a one-time signed URL
 *   (the service-role key never leaves the server).
 * - DEMO: local disk under ./.data/uploads via a signed, expiring PUT URL served by this app.
 */

export const MAX_CLIP_BYTES = 1024 * 1024 * 1024; // 1 GB
export const ALLOWED_MIME = ["video/mp4"];

const LOCAL_ROOT = path.join(process.cwd(), ".data", "uploads");
const KEY_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.mp4$/;

export function isValidKey(key: string): boolean {
  return KEY_RE.test(key);
}

export function keyBelongsTo(key: string, userId: string): boolean {
  return isValidKey(key) && key.startsWith(`${userId}/`);
}

async function supabase() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(env.supabase.url!, env.supabase.serviceRoleKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

let bucketChecked = false;
async function ensureBucket() {
  if (bucketChecked) return;
  const sb = await supabase();
  const { data } = await sb.storage.getBucket(env.supabase.bucket);
  if (!data) {
    const { error } = await sb.storage.createBucket(env.supabase.bucket, {
      public: false,
      fileSizeLimit: MAX_CLIP_BYTES,
      allowedMimeTypes: ALLOWED_MIME,
    });
    if (error && !/already exists/i.test(error.message)) throw error;
  }
  bucketChecked = true;
}

export interface UploadTarget {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
}

export async function createUploadTarget(key: string, mime: string): Promise<UploadTarget> {
  if (modes.storage) {
    await ensureBucket();
    const sb = await supabase();
    const { data, error } = await sb.storage.from(env.supabase.bucket).createSignedUploadUrl(key);
    if (error || !data) throw new Error(`Could not create upload URL: ${error?.message}`);
    return { url: data.signedUrl, method: "PUT", headers: { "Content-Type": mime, "x-upsert": "false" } };
  }
  const exp = Date.now() + 30 * 60_000;
  const sig = hmac(`upload:${key}:${exp}`);
  const qs = new URLSearchParams({ key, exp: String(exp), sig });
  return { url: `/api/uploads/local?${qs}`, method: "PUT", headers: { "Content-Type": mime } };
}

export function verifyLocalUploadSignature(key: string, exp: string, sig: string): boolean {
  if (!isValidKey(key) || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  return safeEqual(hmac(`upload:${key}:${exp}`), sig);
}

export function localPath(key: string): string {
  if (!isValidKey(key)) throw new Error("Invalid storage key");
  return path.join(LOCAL_ROOT, key);
}

/** Size of the stored object, or null when it does not exist. */
export async function objectSize(key: string): Promise<number | null> {
  if (modes.storage) {
    const sb = await supabase();
    const [folder, file] = key.split("/");
    const { data } = await sb.storage.from(env.supabase.bucket).list(folder, { search: file, limit: 1 });
    const hit = data?.find((o) => o.name === file);
    return hit ? Number((hit.metadata as { size?: number } | null)?.size ?? 0) || null : null;
  }
  try {
    return (await fs.promises.stat(localPath(key))).size;
  } catch {
    return null;
  }
}

/** Short-lived URL for playback (live) — demo playback is streamed by /api/clips/[id]/file. */
export async function signedReadUrl(key: string, seconds = 300): Promise<string | null> {
  if (!modes.storage) return null;
  const sb = await supabase();
  const { data } = await sb.storage.from(env.supabase.bucket).createSignedUrl(key, seconds);
  return data?.signedUrl ?? null;
}

/** Readable stream of the object, for forwarding the bytes to Whop's presigned upload URL. */
export async function openObjectStream(key: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number }> {
  if (modes.storage) {
    const url = await signedReadUrl(key, 600);
    if (!url) throw new Error("Clip file not found in storage");
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`Could not read clip from storage (${res.status})`);
    return { stream: res.body, size: Number(res.headers.get("content-length") ?? 0) };
  }
  const p = localPath(key);
  const { size } = await fs.promises.stat(p);
  return { stream: Readable.toWeb(fs.createReadStream(p)) as ReadableStream<Uint8Array>, size };
}

export async function deleteObject(key: string): Promise<void> {
  if (modes.storage) {
    const sb = await supabase();
    await sb.storage.from(env.supabase.bucket).remove([key]);
    return;
  }
  await fs.promises.rm(localPath(key), { force: true });
}
