import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { decodeKey, decryptWith, encryptWith } from "@/lib/crypto-core";
import { formatDuration, parseIsoDuration, parseTimestamp } from "@/lib/youtube/core";
import { mockSearchChannels } from "@/lib/mock/youtube";

describe("token encryption", () => {
  const key = crypto.randomBytes(32);
  it("round-trips and uses a fresh IV each time", () => {
    const a = encryptWith(key, "secret-token");
    const b = encryptWith(key, "secret-token");
    expect(a).not.toEqual(b);
    expect(a).not.toContain("secret-token");
    expect(decryptWith(key, a)).toBe("secret-token");
  });
  it("rejects tampering and wrong keys", () => {
    const blob = encryptWith(key, "x");
    const parts = blob.split(".");
    const ct = Buffer.from(parts[3], "base64url");
    ct[0] ^= 0x01; // flip one bit of the ciphertext
    parts[3] = ct.toString("base64url");
    expect(() => decryptWith(key, parts.join("."))).toThrow();
    expect(() => decryptWith(crypto.randomBytes(32), blob)).toThrow();
  });
  it("decodes base64 and hex keys, rejects short ones", () => {
    const k = crypto.randomBytes(32);
    expect(decodeKey(k.toString("base64")).equals(k)).toBe(true);
    expect(decodeKey(k.toString("hex")).equals(k)).toBe(true);
    expect(() => decodeKey("short")).toThrow();
  });
});

describe("youtube helpers", () => {
  it("parses ISO durations", () => {
    expect(parseIsoDuration("PT1H2M3S")).toBe(3723);
    expect(parseIsoDuration("PT45M")).toBe(2700);
    expect(parseIsoDuration("P1DT1S")).toBe(86401);
    expect(parseIsoDuration("garbage")).toBe(0);
  });
  it("formats and parses timestamps", () => {
    expect(formatDuration(3723)).toBe("1:02:03");
    expect(formatDuration(65)).toBe("1:05");
    expect(parseTimestamp("1:02:03")).toBe(3723);
    expect(parseTimestamp("2:05")).toBe(125);
    expect(parseTimestamp("45")).toBe(45);
    expect(parseTimestamp("1:75")).toBeNull();
    expect(parseTimestamp("abc")).toBeNull();
  });
  it("mock search enforces the subscriber floor", () => {
    expect(mockSearchChannels("influencers", "", 50_000).every((c) => c.subscribers >= 50_000)).toBe(true);
    expect(mockSearchChannels("influencers", "", 0).some((c) => c.subscribers < 50_000)).toBe(true);
  });
});
