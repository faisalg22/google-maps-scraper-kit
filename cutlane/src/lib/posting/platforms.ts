import type { Platform } from "../whop/campaigns-core";

/**
 * Per-platform post URL validation + manual posting checklists. Pure, unit-tested.
 * Validation is format-only; whether the post loads publicly is checked server-side in linkcheck.ts.
 */

export interface UrlCheck {
  ok: boolean;
  normalized?: string;
  error?: string;
  note?: string;
}

const IG_HOSTS = ["instagram.com", "www.instagram.com"];
const TT_HOSTS = ["tiktok.com", "www.tiktok.com", "m.tiktok.com"];
const TT_SHORT_HOSTS = ["vm.tiktok.com", "vt.tiktok.com"];
const YT_HOSTS = ["youtube.com", "www.youtube.com", "m.youtube.com"];

export const PLATFORM_HOSTS: Record<Platform, string[]> = {
  instagram: IG_HOSTS,
  tiktok: [...TT_HOSTS, ...TT_SHORT_HOSTS],
  youtube_shorts: [...YT_HOSTS, "youtu.be"],
};

export function validatePostUrl(platform: Platform, input: string): UrlCheck {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Paste the link to your live post." };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, error: "That isn't a valid URL. It should start with https://" };
  }
  if (u.protocol !== "https:") return { ok: false, error: "Use the https:// link." };
  const host = u.hostname.toLowerCase();
  const pathName = u.pathname.replace(/\/+$/, "");

  switch (platform) {
    case "instagram": {
      if (!IG_HOSTS.includes(host)) return { ok: false, error: "Instagram links must be on instagram.com." };
      const m = pathName.match(/^\/(?:[A-Za-z0-9._]+\/)?(reel|reels|p|tv)\/([A-Za-z0-9_-]{5,})$/);
      if (!m) return { ok: false, error: "Use the link to a Reel or post, e.g. https://www.instagram.com/reel/ABC123/" };
      const kind = m[1] === "reels" ? "reel" : m[1];
      return {
        ok: true,
        normalized: `https://www.instagram.com/${kind}/${m[2]}/`,
        note: kind === "p" ? "This is a feed post link. Campaigns usually expect a Reel." : undefined,
      };
    }
    case "tiktok": {
      if (TT_SHORT_HOSTS.includes(host)) {
        if (!/^\/[A-Za-z0-9]+$/.test(pathName)) return { ok: false, error: "That TikTok short link looks incomplete." };
        return { ok: true, normalized: `https://${host}${pathName}/`, note: "Short link. Opening the post and copying the full link is safer for review." };
      }
      if (!TT_HOSTS.includes(host)) return { ok: false, error: "TikTok links must be on tiktok.com." };
      const t = pathName.match(/^\/t\/([A-Za-z0-9]+)$/);
      if (t) return { ok: true, normalized: `https://www.tiktok.com/t/${t[1]}/`, note: "Short link. The full /@user/video/… link is safer for review." };
      const m = pathName.match(/^\/@([A-Za-z0-9._-]+)\/video\/(\d{8,25})$/);
      if (!m) return { ok: false, error: "Use the video link, e.g. https://www.tiktok.com/@you/video/1234567890123456789" };
      return { ok: true, normalized: `https://www.tiktok.com/@${m[1]}/video/${m[2]}` };
    }
    case "youtube_shorts": {
      if (host === "youtu.be") {
        const m = pathName.match(/^\/([A-Za-z0-9_-]{11})$/);
        if (!m) return { ok: false, error: "That youtu.be link doesn't contain a video ID." };
        return { ok: true, normalized: `https://www.youtube.com/shorts/${m[1]}`, note: "Converted to a /shorts/ link." };
      }
      if (!YT_HOSTS.includes(host)) return { ok: false, error: "YouTube links must be on youtube.com." };
      const s = pathName.match(/^\/shorts\/([A-Za-z0-9_-]{11})$/);
      if (s) return { ok: true, normalized: `https://www.youtube.com/shorts/${s[1]}` };
      if (pathName === "/watch" && /^[A-Za-z0-9_-]{11}$/.test(u.searchParams.get("v") ?? "")) {
        return { ok: true, normalized: `https://www.youtube.com/shorts/${u.searchParams.get("v")}`, note: "Converted a watch link to a /shorts/ link. Make sure it was uploaded as a Short." };
      }
      return { ok: false, error: "Use the Shorts link, e.g. https://www.youtube.com/shorts/AbCdEfGhIjK" };
    }
  }
}

export interface ChecklistStep {
  id: string;
  label: string;
}

const common: ChecklistStep[] = [
  { id: "rights", label: "Footage is from the campaign's content folder or I have the creator's permission" },
  { id: "requirements", label: "Clip meets the campaign requirements (length, captions, tags, hashtags)" },
];

export const CHECKLISTS: Record<Platform, ChecklistStep[]> = {
  instagram: [
    ...common,
    { id: "account", label: "Posting from a public Business or Creator account" },
    { id: "format", label: "Uploaded as a Reel, 9:16 (1080×1920)" },
    { id: "caption", label: "Caption includes the required @mentions and #hashtags" },
    { id: "copy", label: "Copied the Reel link (⋯ → Copy link)" },
  ],
  tiktok: [
    ...common,
    { id: "account", label: "Account is public (not private)" },
    { id: "format", label: "Uploaded 9:16 video, visibility set to Everyone" },
    { id: "caption", label: "Caption includes the required @mentions and #hashtags" },
    { id: "copy", label: "Copied the video link (Share → Copy link)" },
  ],
  youtube_shorts: [
    ...common,
    { id: "format", label: "Vertical video uploaded as a Short" },
    { id: "visibility", label: "Visibility is Public (not Unlisted or Private)" },
    { id: "caption", label: "Title/description include the required tags" },
    { id: "copy", label: "Copied the Short link (Share → Copy link)" },
  ],
};

export function checklistComplete(platform: Platform, state: Record<string, boolean>): boolean {
  return CHECKLISTS[platform].every((s) => state[s.id]);
}
