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

/** Step 1 of a file submission: create the Whop file record and PUT the bytes (server to server). */
export async function createAndUploadFile(userId: string, storageKey: string, fileName: string, idempotencyKey: string): Promise<string> {
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
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  if (!put.ok) throw new Error(`Uploading the clip to Whop failed (HTTP ${put.status}).`);
  return file.id;
}

/** Step 2: one quick status check (the caller polls). */
export async function fileUploadStatus(userId: string, fileId: string): Promise<WhopFile["upload_status"]> {
  const f = await whopFetch<WhopFile>(userId, `/files/${encodeURIComponent(fileId)}`);
  return f.upload_status;
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
