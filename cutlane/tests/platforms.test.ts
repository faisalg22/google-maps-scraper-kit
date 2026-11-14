import { describe, expect, it } from "vitest";
import { validatePostUrl, checklistComplete, CHECKLISTS } from "@/lib/posting/platforms";

describe("validatePostUrl", () => {
  it("accepts and normalises Instagram reels", () => {
    expect(validatePostUrl("instagram", "https://www.instagram.com/reel/C9xYz_12aB/?igsh=abc")).toMatchObject({ ok: true, normalized: "https://www.instagram.com/reel/C9xYz_12aB/" });
    expect(validatePostUrl("instagram", "https://instagram.com/reels/C9xYz_12aB")).toMatchObject({ ok: true, normalized: "https://www.instagram.com/reel/C9xYz_12aB/" });
    expect(validatePostUrl("instagram", "https://www.instagram.com/someuser/reel/C9xYz_12aB/")).toMatchObject({ ok: true });
  });
  it("flags Instagram feed posts with a note", () => {
    const r = validatePostUrl("instagram", "https://www.instagram.com/p/C9xYz_12aB/");
    expect(r.ok).toBe(true);
    expect(r.note).toMatch(/Reel/);
  });
  it("rejects wrong hosts, http and profile links", () => {
    expect(validatePostUrl("instagram", "http://www.instagram.com/reel/C9xYz_12aB/").ok).toBe(false);
    expect(validatePostUrl("instagram", "https://instagram.com.evil.test/reel/C9xYz_12aB/").ok).toBe(false);
    expect(validatePostUrl("instagram", "https://www.instagram.com/someuser/").ok).toBe(false);
    expect(validatePostUrl("tiktok", "https://www.instagram.com/reel/C9xYz_12aB/").ok).toBe(false);
    expect(validatePostUrl("tiktok", "not a url").ok).toBe(false);
    expect(validatePostUrl("tiktok", "").ok).toBe(false);
  });
  it("accepts TikTok video and short links", () => {
    expect(validatePostUrl("tiktok", "https://www.tiktok.com/@clip.king/video/7312345678901234567?is_from_webapp=1")).toMatchObject({ ok: true, normalized: "https://www.tiktok.com/@clip.king/video/7312345678901234567" });
    expect(validatePostUrl("tiktok", "https://vm.tiktok.com/ZMabc123/").ok).toBe(true);
    expect(validatePostUrl("tiktok", "https://www.tiktok.com/t/ZTabc123/").ok).toBe(true);
    expect(validatePostUrl("tiktok", "https://www.tiktok.com/@clip.king").ok).toBe(false);
  });
  it("accepts YouTube Shorts and converts youtu.be/watch links", () => {
    expect(validatePostUrl("youtube_shorts", "https://youtube.com/shorts/AbCdEfGhIjK?feature=share")).toMatchObject({ ok: true, normalized: "https://www.youtube.com/shorts/AbCdEfGhIjK" });
    expect(validatePostUrl("youtube_shorts", "https://youtu.be/AbCdEfGhIjK")).toMatchObject({ ok: true, normalized: "https://www.youtube.com/shorts/AbCdEfGhIjK" });
    expect(validatePostUrl("youtube_shorts", "https://www.youtube.com/watch?v=AbCdEfGhIjK")).toMatchObject({ ok: true });
    expect(validatePostUrl("youtube_shorts", "https://www.youtube.com/shorts/short")).toMatchObject({ ok: false });
    expect(validatePostUrl("youtube_shorts", "https://www.youtube.com/@channel")).toMatchObject({ ok: false });
  });
});

describe("checklistComplete", () => {
  it("needs every step", () => {
    const all = Object.fromEntries(CHECKLISTS.tiktok.map((s) => [s.id, true]));
    expect(checklistComplete("tiktok", all)).toBe(true);
    expect(checklistComplete("tiktok", { ...all, copy: false })).toBe(false);
  });
});
