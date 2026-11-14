import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env, modes } from "./env";
import { decodeKey, encryptWith, decryptWith, hmacWith } from "./crypto-core";

let cachedKey: Buffer | null = null;

/**
 * 32-byte key for AES-256-GCM + HMAC.
 * - Live: TOKEN_ENCRYPTION_KEY (required once Whop is live).
 * - Demo: a random key generated on first run and kept in ./.data (never committed).
 */
export function masterKey(): Buffer {
  if (cachedKey) return cachedKey;
  if (env.tokenEncryptionKey) {
    cachedKey = decodeKey(env.tokenEncryptionKey);
    return cachedKey;
  }
  if (modes.whop) {
    throw new Error("TOKEN_ENCRYPTION_KEY is required when Whop is configured. Generate one with `npm run keygen`.");
  }
  const dir = path.join(process.cwd(), ".data");
  const file = path.join(dir, "dev-secret.key");
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, crypto.randomBytes(32).toString("base64"), { mode: 0o600 });
  }
  cachedKey = decodeKey(fs.readFileSync(file, "utf8").trim());
  return cachedKey;
}

/** Separate sub-keys for encryption and signing, derived with HKDF. */
function subKey(purpose: "enc" | "mac"): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", masterKey(), Buffer.alloc(0), `cutlane:${purpose}`, 32));
}

export const encrypt = (plain: string) => encryptWith(subKey("enc"), plain);
export const decrypt = (blob: string) => decryptWith(subKey("enc"), blob);
export const hmac = (data: string) => hmacWith(subKey("mac"), data);

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
