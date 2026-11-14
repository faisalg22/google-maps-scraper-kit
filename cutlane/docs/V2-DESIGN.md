# CutLane V2: design (not built)

V2 adds the two halves V1 leaves to other tools: **editing inside CutLane** and **automatic posting**. V1 is already shaped so both can plug in without a rewrite.

## What V1 already provides

| V2 need | Already in V1 |
| --- | --- |
| Clips made in-app | `clips.origin` enum has `'editor'` (V1 writes `'import'`) |
| Auto-posted links | `post_links.source` enum has `'auto'` (V1 writes `'manual'`) |
| Posting gates | Submission already only takes links that are saved and load publicly, whatever their source |
| Storage | Private bucket with server-issued signed URLs; an editor export lands in the same place |
| Whop submit | `uploadClipToWhop` + `createSubmission` don't care where the clip came from |

## 1. Embedded editor + AI cutting

**Interface** (`src/lib/v2/editor.ts`, to add):

```ts
export interface EditorProvider {
  /** Short-lived, user-scoped token minted server-side for the browser SDK. */
  createSession(userId: string, opts: { sourceKey?: string; campaignId?: string }): Promise<{ token: string; expiresAt: Date }>;
  /** Called from the provider's webhook when an export finishes; we copy it into our bucket. */
  handleExport(payload: unknown): Promise<{ userId: string; storageKey: string; durationSeconds: number }>;
}

export interface ClipCutter {
  /** Suggest highlight windows from campaign footage. Lengths: 4, 6, 8, 10, 20 s. */
  suggest(sourceKey: string, lengths: (4 | 6 | 8 | 10 | 20)[]): Promise<{ start: number; end: number; score: number; transcript: string }[]>;
  captions(storageKey: string, style: "word-pop" | "line" | "karaoke"): Promise<{ vttKey: string }>;
}
```

**Flow:** campaign page → "Edit from campaign footage" → the editor opens with the source (uploaded by the editor from the campaign's content folder; never pulled from YouTube) → AI suggests 4/6/8/10/20 s windows → trim, split, reframe to 9:16, speed, text, captions, audio (volume, music, voice cleanup) → export presets (IG / TikTok / Shorts) → the export webhook creates a `clips` row with `origin = 'editor'`.

**Schema additions:** `editor_projects (id, user_id, campaign_id, provider_project_id, source_key, state jsonb, updated_at)` for save/reopen, and `clip_cuts (clip_id, source_key, start_s, end_s, length_preset)` for analytics on which lengths get approved.

**Choosing a toolkit (open question):** compare embeddable editor SDKs on price per export or seat, licensing for commercial reselling, 9:16 templates, captions API, webhook exports and mobile web support. Keep AI cutting behind `ClipCutter` so the transcription and highlight model can be swapped.

**Rule:** the source must be campaign footage or creator-permitted. Keep the V1 rights checkbox and the copyright notice on every editor entry point.

## 2. Auto-post via a posting service

**Interface** (`src/lib/v2/autopost.ts`, to add):

```ts
export interface PostingProvider {
  /** Hosted connect flow for the editor's IG / TikTok / YouTube accounts; returns a provider profile id. */
  connectUrl(userId: string, returnTo: string): Promise<string>;
  publish(input: {
    profileId: string;
    platforms: ("instagram" | "tiktok" | "youtube_shorts")[];
    mediaUrl: string; // short-lived signed URL from our bucket
    caption: string;
    scheduleAt?: Date;
  }): Promise<{ jobId: string }>;
  /** Webhook or poll: returns the live post URLs once published. */
  result(jobId: string): Promise<{ platform: string; url: string | null; error?: string }[]>;
}
```

Implement it for **Ayrshare** and **Metricool**, then pick one after comparing per-profile pricing, TikTok direct-post support, whether the returned URL is the public post URL, and webhook reliability.

**Flow:** clip page → "Auto-post" → choose platforms + caption (prefilled with the campaign's required tags) → `publish` → `post_jobs` row → webhook → `post_links` upsert with `source = 'auto'` → the same public link check → the same submit button. Auto-posting never skips the "loads publicly" gate.

**Schema additions:** `posting_accounts (user_id, provider, profile_id_enc, platforms text[], connected_at)` (profile ids encrypted like Whop tokens) and `post_jobs (id, clip_id, provider, job_id, status, platforms, error, created_at)`.

**Constraints:** Instagram needs a Business or Creator account. TikTok direct posting needs app review on the provider's side. Posting providers' API keys stay server-side, like the Whop secret.

## 3. Later: direct platform APIs

Swap `PostingProvider` for direct Instagram Graph, TikTok Content Posting and YouTube Data API implementations once volume justifies the app reviews. Nothing else changes.

## 4. Nice-to-haves unlocked by V2 data

- Auto-detect newest posts through each platform's official login (manual posting, "detect my latest video").
- Approval-rate analytics by clip length, hook tag (from the swipe file) and platform.
- Webhook-driven status updates from Whop instead of manual sync, if Whop exposes bounty submission webhooks.
