"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser, startSession, endSession, upsertUser } from "@/lib/auth/session";
import { one, q, pgTextArray } from "@/lib/db";
import { modes } from "@/lib/env";
import { getClip, linkIsSubmittable, listPostLinks } from "@/lib/repo";
import { createUploadTarget, keyBelongsTo, objectSize, deleteObject, MAX_CLIP_BYTES } from "@/lib/storage";
import { CHECKLISTS, validatePostUrl } from "@/lib/posting/platforms";
import { checkPublicLink } from "@/lib/posting/linkcheck";
import { PLATFORMS, type Platform } from "@/lib/whop/campaigns-core";
import { getCampaign } from "@/lib/whop/campaigns";
import { createSubmission, listMySubmissions, uploadClipToWhop } from "@/lib/whop/submissions";
import { revokeAndDelete } from "@/lib/whop/oauth";
import { toActionState, type ActionState } from "@/lib/action-errors";
import { assertCanWrite, assertMonthlyHeadroom, assertTotalLimit, consume } from "@/lib/billing/server";

export type { ActionState };


// ── Auth ─────────────────────────────────────────────────────────────────────

/** Demo sign-in: only available while Whop is not configured. */
export async function demoSignIn() {
  if (modes.whop) throw new Error("Demo sign-in is disabled because Whop is configured.");
  const user = await upsertUser({
    whopUserId: "user_demo_editor",
    username: "demo_editor",
    name: "Demo Editor",
    isDemo: true,
  });
  await startSession(user.id);
  redirect("/dashboard");
}

export async function signOut() {
  const userId = await endSession();
  if (userId && modes.whop) await revokeAndDelete(userId);
  redirect("/");
}

// ── Clips ────────────────────────────────────────────────────────────────────

const uploadReq = z.object({
  fileName: z.string().min(1).max(200),
  size: z.number().int().positive().max(MAX_CLIP_BYTES, "Clips must be 1 GB or smaller."),
  mime: z.literal("video/mp4", { message: "Only MP4 files are supported." }),
});

/** Step 1 of upload: a one-time signed PUT target scoped to this user. */
export async function requestClipUpload(
  input: z.infer<typeof uploadReq>,
): Promise<{ key: string; target: Awaited<ReturnType<typeof createUploadTarget>> } | NonNullable<ActionState>> {
  try {
    const user = await requireUser();
    const data = uploadReq.parse(input);
    // Check headroom before the upload so nobody uploads 1 GB only to hit the limit.
    await assertCanWrite("clip_import");
    await assertMonthlyHeadroom("clips_monthly");
    const key = `${user.id}/${crypto.randomUUID()}.mp4`;
    const target = await createUploadTarget(key, data.mime);
    return { key, target };
  } catch (err) {
    return toActionState(err);
  }
}

const createClipReq = z.object({
  key: z.string(),
  title: z.string().trim().min(1, "Give the clip a title.").max(200),
  fileName: z.string().min(1).max(200),
  campaignId: z.string().max(100).optional().nullable(),
  campaignTitle: z.string().max(300).optional().nullable(),
  rightsConfirmed: z.literal(true, { message: "Confirm the footage comes from the campaign or creator permission." }),
});

/** Step 2 of upload: record the clip once the bytes are in storage. */
export async function createClip(input: z.infer<typeof createClipReq>): Promise<{ id?: string } & NonNullable<ActionState>> {
  try {
    const user = await requireUser();
    const d = createClipReq.parse(input);
    if (!keyBelongsTo(d.key, user.id)) return { error: "Invalid upload." };
    const size = await objectSize(d.key);
    if (!size) return { error: "Upload not found. Please try again." };
    await assertCanWrite("clip_import");
    // Counts toward "clips per month"; deleting a clip later does not give the unit back.
    const unit = await consume("clips_monthly");
    const row = await one<{ id: string }>(
      `insert into clips (user_id, title, campaign_id, campaign_title, storage_key, file_name, size_bytes, rights_confirmed)
       values ($1, $2, $3, $4, $5, $6, $7, true) returning id`,
      [user.id, d.title, d.campaignId || null, d.campaignTitle || null, d.key, d.fileName, size],
    ).catch(async (e) => {
      await unit.release();
      throw e;
    });
    revalidatePath("/clips");
    return { id: row!.id };
  } catch (err) {
    return toActionState(err);
  }
}

export async function updateClip(clipId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    await assertCanWrite();
    const clip = await getClip(user.id, clipId);
    if (!clip) return { error: "Clip not found." };
    const title = z.string().trim().min(1).max(200).parse(form.get("title"));
    const status = z.enum(["draft", "ready"]).optional().parse(form.get("status") || undefined);
    await q(
      `update clips set title = $3, status = case when $4::text is not null and status in ('draft','ready') then $4::clip_status else status end, updated_at = now()
        where id = $1 and user_id = $2`,
      [clipId, user.id, title, status ?? null],
    );
    revalidatePath(`/clips/${clipId}`);
    return { ok: true, message: "Saved." };
  } catch (err) {
    return toActionState(err);
  }
}

export async function deleteClip(clipId: string) {
  const user = await requireUser();
  const clip = await getClip(user.id, clipId);
  if (!clip) return;
  await q(`delete from clips where id = $1 and user_id = $2`, [clipId, user.id]);
  await deleteObject(clip.storage_key).catch(() => undefined);
  revalidatePath("/clips");
  redirect("/clips");
}

// ── Manual posting ───────────────────────────────────────────────────────────

const platformSchema = z.enum(PLATFORMS);

async function ownClipOrThrow(clipId: string, feature: "manual_posting" | "whop_submit" = "manual_posting") {
  const user = await requireUser();
  await assertCanWrite(feature);
  const clip = await getClip(user.id, clipId);
  if (!clip) throw new Error("Clip not found.");
  return { user, clip };
}

async function ensurePostRow(clipId: string, platform: Platform) {
  await q(`insert into post_links (clip_id, platform) values ($1, $2::post_platform) on conflict (clip_id, platform) do nothing`, [clipId, platform]);
}

export async function toggleChecklist(clipId: string, platform: Platform, stepId: string, checked: boolean) {
  await ownClipOrThrow(clipId);
  const p = platformSchema.parse(platform);
  if (!CHECKLISTS[p].some((s) => s.id === stepId)) throw new Error("Unknown step");
  await ensurePostRow(clipId, p);
  await q(
    `update post_links set checklist = checklist || jsonb_build_object($3::text, $4::boolean), updated_at = now()
      where clip_id = $1 and platform = $2::post_platform`,
    [clipId, p, stepId, checked],
  );
  revalidatePath(`/clips/${clipId}`);
}

/** Save a post URL: validate the format, then check it loads publicly. */
export async function savePostUrl(clipId: string, platform: Platform, _prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { clip } = await ownClipOrThrow(clipId);
    const p = platformSchema.parse(platform);
    const raw = String(form.get("url") ?? "");
    if (!raw.trim()) {
      await q(
        `update post_links set url = null, check_status = 'unchecked', check_message = null, check_http_status = null, manual_confirmed = false, updated_at = now()
          where clip_id = $1 and platform = $2::post_platform`,
        [clipId, p],
      );
      revalidatePath(`/clips/${clipId}`);
      return { ok: true, message: "Link removed." };
    }
    const v = validatePostUrl(p, raw);
    if (!v.ok) return { error: v.error };
    await ensurePostRow(clipId, p);
    const check = await checkPublicLink(p, v.normalized!);
    await q(
      `update post_links set url = $3, check_status = $4::link_check, check_http_status = $5, check_message = $6,
              checked_at = now(), manual_confirmed = false, updated_at = now()
        where clip_id = $1 and platform = $2::post_platform`,
      [clipId, p, v.normalized, check.status, check.httpStatus, check.message],
    );
    if (clip.status === "ready" || clip.status === "draft") {
      await q(`update clips set status = 'posted', updated_at = now() where id = $1`, [clipId]);
    }
    revalidatePath(`/clips/${clipId}`);
    return { ok: check.status !== "failed", message: [check.message, v.note].filter(Boolean).join(" "), error: check.status === "failed" ? check.message : undefined };
  } catch (err) {
    return toActionState(err);
  }
}

export async function recheckPostUrl(clipId: string, platform: Platform) {
  await ownClipOrThrow(clipId);
  const p = platformSchema.parse(platform);
  const row = await one<{ url: string | null }>(`select url from post_links where clip_id = $1 and platform = $2::post_platform`, [clipId, p]);
  if (!row?.url) return;
  const check = await checkPublicLink(p, row.url);
  await q(
    `update post_links set check_status = $3::link_check, check_http_status = $4, check_message = $5, checked_at = now(), updated_at = now()
      where clip_id = $1 and platform = $2::post_platform`,
    [clipId, p, check.status, check.httpStatus, check.message],
  );
  revalidatePath(`/clips/${clipId}`);
}

/** When a platform blocks the automatic check, the editor confirms they opened it logged-out. */
export async function confirmLinkManually(clipId: string, platform: Platform, confirmed: boolean) {
  await ownClipOrThrow(clipId);
  const p = platformSchema.parse(platform);
  await q(
    `update post_links set manual_confirmed = $3, updated_at = now() where clip_id = $1 and platform = $2::post_platform and check_status = 'blocked'`,
    [clipId, p, confirmed],
  );
  revalidatePath(`/clips/${clipId}`);
}

// ── Submit to Whop ───────────────────────────────────────────────────────────

const submitReq = z.object({
  caption: z.string().trim().max(2000).optional(),
  attachFile: z.boolean(),
});

export async function submitClip(clipId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, clip } = await ownClipOrThrow(clipId, "whop_submit");
    const { caption, attachFile } = submitReq.parse({
      caption: (form.get("caption") as string | null) ?? undefined,
      attachFile: form.get("attachFile") === "on",
    });
    if (!clip.campaign_id) return { error: "Link this clip to a campaign first." };
    if (!clip.rights_confirmed) return { error: "Confirm the footage rights first." };

    const links = await listPostLinks(clipId);
    const urls = links.filter(linkIsSubmittable).map((l) => l.url!);
    if (!urls.length) return { error: "Add at least one live post link that loads publicly before submitting." };

    const active = await one(
      `select id from submissions where clip_id = $1 and status in ('submitted','in_progress','approved') limit 1`,
      [clipId],
    );
    if (active) return { error: "This clip already has an active or approved submission." };

    const campaign = await getCampaign(user.id, clip.campaign_id);
    if (!campaign) return { error: "Campaign not found on Whop." };
    if (campaign.status !== "open") return { error: `This campaign is ${campaign.status} and no longer accepts submissions.` };
    const canAttach = campaign.deliverableTypes.length === 0 || campaign.deliverableTypes.includes("media");

    const idempotencyKey = crypto.randomUUID();
    // Reserve one "submission this month"; given back if Whop rejects the call.
    const unit = await consume("submissions_monthly");
    try {
    if (!modes.whop) {
      await q(
        `insert into submissions (user_id, clip_id, bounty_id, whop_submission_id, status, caption, urls, file_ids, idempotency_key, is_demo)
         values ($1, $2, $3, $4, 'submitted', $5, $6::text[], $7::text[], $8, true)`,
        [user.id, clipId, clip.campaign_id, `demo_btys_${idempotencyKey.slice(0, 8)}`, caption || null, pgTextArray(urls), pgTextArray(attachFile && canAttach ? ["demo_file"] : []), idempotencyKey],
      );
    } else {
      let fileIds: string[] = [];
      if (attachFile && canAttach) {
        const fileId = clip.whop_file_id ?? (await uploadClipToWhop(user.id, clip.storage_key, clip.file_name, idempotencyKey));
        if (!clip.whop_file_id) await q(`update clips set whop_file_id = $2 where id = $1`, [clipId, fileId]);
        fileIds = [fileId];
      }
      const sub = await createSubmission(user.id, { bountyId: clip.campaign_id, urls, fileIds, caption, idempotencyKey });
      await q(
        `insert into submissions (user_id, clip_id, bounty_id, whop_submission_id, status, caption, urls, file_ids, idempotency_key, raw)
         values ($1, $2, $3, $4, $5, $6, $7::text[], $8::text[], $9, $10::jsonb)`,
        [user.id, clipId, clip.campaign_id, sub.id, sub.status ?? "submitted", caption || null, pgTextArray(urls), pgTextArray(fileIds), idempotencyKey, JSON.stringify(sub)],
      );
    }
    } catch (e) {
      await unit.release();
      throw e;
    }
    await q(`update clips set status = 'submitted', updated_at = now() where id = $1`, [clipId]);
    revalidatePath(`/clips/${clipId}`);
    revalidatePath("/submissions");
    return { ok: true, message: modes.whop ? "Submitted to Whop. It's now pending review." : "Demo submission recorded (nothing was sent to Whop)." };
  } catch (err) {
    return toActionState(err);
  }
}

/** Pull the latest statuses from GET /bounty_submissions and update local rows + clip statuses. */
export async function syncSubmissions(): Promise<ActionState> {
  try {
    const user = await requireUser();
    if (!modes.whop) return { ok: true, message: "Demo mode: use “Simulate review” to change a status." };
    const remote = await listMySubmissions(user.id);
    let updated = 0;
    for (const s of remote) {
      const rows = await q<{ clip_id: string | null }>(
        `update submissions set status = coalesce($3, status), denial_reason = $4, resolved_at = $5::timestamptz, raw = $6::jsonb, updated_at = now()
          where user_id = $1 and whop_submission_id = $2 returning clip_id`,
        [user.id, s.id, s.status, s.denial_reason, s.resolved_at, JSON.stringify(s)],
      );
      for (const r of rows) {
        updated++;
        if (r.clip_id && (s.status === "approved" || s.status === "denied")) {
          await q(`update clips set status = $2::clip_status, updated_at = now() where id = $1`, [r.clip_id, s.status === "approved" ? "approved" : "rejected"]);
        }
      }
    }
    revalidatePath("/submissions");
    return { ok: true, message: `Synced ${updated} submission${updated === 1 ? "" : "s"} with Whop.` };
  } catch (err) {
    return toActionState(err);
  }
}

/** DEMO ONLY: lets reviewers see approved/rejected states without Whop. */
export async function simulateReview(submissionId: string, outcome: "approved" | "denied") {
  if (modes.whop) throw new Error("Not available when Whop is live.");
  const user = await requireUser();
  const row = await one<{ clip_id: string | null }>(
    `update submissions set status = $3, denial_reason = $4, resolved_at = now(), updated_at = now()
      where id = $1 and user_id = $2 and is_demo returning clip_id`,
    [submissionId, user.id, outcome, outcome === "denied" ? "Demo: hook too slow, and the required hashtag is missing." : null],
  );
  if (row?.clip_id) {
    await q(`update clips set status = $2::clip_status, updated_at = now() where id = $1`, [row.clip_id, outcome === "approved" ? "approved" : "rejected"]);
  }
  revalidatePath("/submissions");
}

// ── Swipe file ───────────────────────────────────────────────────────────────

const noteReq = z.object({
  videoId: z.string().min(1).max(64),
  videoTitle: z.string().min(1).max(300),
  channelId: z.string().max(64).optional().nullable(),
  channelTitle: z.string().max(300).optional().nullable(),
  seconds: z.number().int().min(0).max(24 * 3600),
  note: z.string().trim().min(1, "Write a note.").max(2000),
  tags: z.array(z.string().trim().min(1).max(30)).max(8),
});

export async function addSwipeNote(input: z.infer<typeof noteReq>): Promise<NonNullable<ActionState>> {
  try {
    const user = await requireUser();
    const d = noteReq.parse(input);
    await assertTotalLimit("notes");
    await q(
      `insert into swipe_notes (user_id, video_id, video_title, channel_id, channel_title, timestamp_seconds, note, tags)
       values ($1, $2, $3, $4, $5, $6, $7, $8::text[])`,
      [user.id, d.videoId, d.videoTitle, d.channelId ?? null, d.channelTitle ?? null, d.seconds, d.note, pgTextArray(d.tags.map((t) => t.toLowerCase()))],
    );
    revalidatePath(`/research/video/${d.videoId}`);
    revalidatePath("/swipe");
    return {};
  } catch (err) {
    return toActionState(err);
  }
}

export async function deleteSwipeNote(noteId: string) {
  const user = await requireUser();
  const row = await one<{ video_id: string }>(`delete from swipe_notes where id = $1 and user_id = $2 returning video_id`, [noteId, user.id]);
  if (row) revalidatePath(`/research/video/${row.video_id}`);
  revalidatePath("/swipe");
}
