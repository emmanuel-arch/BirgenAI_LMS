// ─────────────────────────────────────────────────────────────────────────────
// Vault crypto — AES-256-GCM for per-org integration configs.
//
// OrgIntegration.configEnc = base64( iv(12) || ciphertext || authTag(16) ).
// The master key is VAULT_MASTER_KEY (32-byte hex, platform env). Per-tenant
// secrets NEVER live in env vars or reach the client; they are decrypted
// server-side at the moment of use only.
// ─────────────────────────────────────────────────────────────────────────────
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALG = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function masterKey(): Buffer {
  const hex = process.env.VAULT_MASTER_KEY?.trim();
  if (!hex || hex.length !== 64) {
    throw new Error("VAULT_MASTER_KEY is not configured (expected 32 bytes hex).");
  }
  return Buffer.from(hex, "hex");
}

export function encryptJson(value: unknown): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, masterKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, enc, cipher.getAuthTag()]).toString("base64");
}

export function decryptJson<T = Record<string, unknown>>(payload: string): T {
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(raw.length - TAG_LEN);
  const data = raw.subarray(IV_LEN, raw.length - TAG_LEN);
  const decipher = createDecipheriv(ALG, masterKey(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(dec.toString("utf8")) as T;
}
