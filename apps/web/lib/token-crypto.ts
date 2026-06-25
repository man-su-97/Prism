/**
 * AES-256-GCM encryption for OAuth tokens stored in the account table.
 *
 * Encrypted format:  v1:<nonce_b64>:<ciphertext_b64>
 *   - nonce     : 12 random bytes (96-bit, standard for GCM)
 *   - ciphertext: plaintext bytes + 16-byte GCM authentication tag
 *
 * Key source: OAUTH_TOKEN_ENCRYPTION_KEY env var — 64 hex chars (32 bytes).
 * Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * If the env var is unset, encryptToken() returns the value unchanged. This
 * lets the app boot without the key; tokens are stored plaintext (same as
 * before). Set the key in prod to enable encryption.
 *
 * Must match the Python implementation in apps/api/app/services/token_crypto.py.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const KEY_ENV = "OAUTH_TOKEN_ENCRYPTION_KEY";
const V1_PREFIX = "v1:";

function getKey(): Buffer | null {
  const hex = process.env[KEY_ENV];
  if (!hex) return null;
  if (hex.length !== 64) {
    throw new Error(
      `${KEY_ENV} must be a 64-char hex string (32 bytes). ` +
      'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return Buffer.from(hex, "hex");
}

export function encryptToken(plaintext: string): string {
  const key = getKey();
  if (!key) return plaintext; // key not configured — pass through
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag(); // always 16 bytes for GCM
  const ctWithTag = Buffer.concat([encrypted, tag]);
  return `${V1_PREFIX}${nonce.toString("base64")}:${ctWithTag.toString("base64")}`;
}

export function decryptToken(value: string): string {
  if (!value.startsWith(V1_PREFIX)) return value; // legacy plaintext
  const key = getKey();
  if (!key) throw new Error(`${KEY_ENV} not set — cannot decrypt token`);
  const rest = value.slice(V1_PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep < 0) throw new Error("invalid encrypted token format");
  const nonce = Buffer.from(rest.slice(0, sep), "base64");
  const ctWithTag = Buffer.from(rest.slice(sep + 1), "base64");
  const tag = ctWithTag.subarray(ctWithTag.length - 16);
  const ct = ctWithTag.subarray(0, ctWithTag.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
