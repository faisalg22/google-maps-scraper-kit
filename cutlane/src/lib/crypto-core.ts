import crypto from "node:crypto";

/** Pure crypto helpers (no env access) so they can be unit-tested. */

export function decodeKey(raw: string): Buffer {
  const trimmed = raw.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");
  if (key.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (base64 or hex).");
  }
  return key;
}

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext> (base64url parts). */
export function encryptWith(key: Buffer, plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptWith(key: Buffer, blob: string): string {
  const [version, iv, tag, ct] = blob.split(".");
  if (version !== "v1" || !iv || !tag || ct === undefined) throw new Error("Unrecognised ciphertext format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

export function hmacWith(key: Buffer, data: string): string {
  return crypto.createHmac("sha256", key).update(data).digest("base64url");
}
