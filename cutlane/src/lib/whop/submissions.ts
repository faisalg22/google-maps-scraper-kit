import "server-only";
import { modes } from "../env";
import { openObjectStream } from "../storage";
import { captureSampleOnce, whopFetch, WhopApiError } from "./client";

export type SubmissionStatus = "in_progress" | "submitted" | "approved" | "denied";

export interface WhopSubmission {
  id: string;
  bounty_id: string;
  status: SubmissionStatus | null;
  denial_reason: string | null;
  deliverable_urls: string[] | null;
  submitted_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

interface WhopFile {
  id: string;
  upload_status: "pending" | "processing" | "ready" | "failed";
  upload_url?: string | null;
  upload_headers?: Record<string, string>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Upload a stored clip to Whop Files: create file record → PUT bytes to the presigned URL
 * (server-to-server, the browser never sees it) → poll until `ready`.
 */
export async function uploadClipToWhop(userId: string, storageKey: string, fileName: string, idempotencyKey: string): Promise<string> {
  const { stream, size } = await openObjectStream(storageKey);
  const file = await whopFetch<WhopFile>(userId, "/files", {
    method: "POST",
    body: { filename: fileName.replace(/[^\w.\- ]/g, "_").slice(0, 120) || "clip.mp4", byte_size: size || undefined, visibility: "private" },
    idempotencyKey: `${idempotencyKey}:file`,
  });
  if (!file.upload_url) throw new Error("Whop did not return an upload URL (multipart uploads are not supported yet).");

  const put = await fetch(file.upload_url, {
    method: "PUT",
    headers: { ...(file.upload_headers ?? {}), ...(size ? { "Content-Length": String(size) } : {}) },
    body: stream,
    // Node fetch requires half-duplex for streamed request bodies.
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  if (!put.ok) throw new Error(`Uploading the clip to Whop failed (HTTP ${put.status}).`);

  // Poll for readiness: ~2 minutes max with gentle backoff.
  let delay = 1000;
  for (let i = 0; i < 20; i++) {
    const f = await whopFetch<WhopFile>(userId, `/files/${file.id}`);
    if (f.upload_status === "ready") return f.id;
    if (f.upload_status === "failed") throw new Error("Whop could not process the uploaded clip.");
    await sleep(delay);
    delay = Math.min(delay * 1.5, 8000);
  }
  throw new Error("Whop is still processing the clip. Try submitting again in a minute.");
}

export async function createSubmission(
  userId: string,
  input: { bountyId: string; urls: string[]; fileIds: string[]; caption?: string | null; idempotencyKey: string },
): Promise<WhopSubmission> {
  if (!modes.whop) throw new Error("createSubmission called in demo mode");
  if (input.urls.length > 10 || input.fileIds.length > 10) throw new WhopApiError("Whop accepts up to 10 links and 10 files.", 400);
  const res = await whopFetch<WhopSubmission>(userId, "/bounty_submissions", {
    method: "POST",
    idempotencyKey: input.idempotencyKey,
    body: {
      bounty_id: input.bountyId,
      deliverable: {
        urls: input.urls,
        file_ids: input.fileIds,
        caption: input.caption || null,
      },
    },
  });
  await captureSampleOnce("POST /bounty_submissions", res);
  return res;
}

export async function listMySubmissions(userId: string): Promise<WhopSubmission[]> {
  const res = await whopFetch<{ data: WhopSubmission[] }>(userId, "/bounty_submissions", {
    query: { order: "updated_at", direction: "desc", first: 50 },
  });
  await captureSampleOnce("GET /bounty_submissions", res);
  return res.data ?? [];
}
