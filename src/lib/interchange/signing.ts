// ─────────────────────────────────────────────────────────────────────────────
// Interchange request signing — the MEMBER NODE half.
//
// ⚠ WIRE FORMAT. This file is a deliberate port of the Registry's
// `lib/signing.ts` in github.com/emmanuel-arch/Interchange. The canonical string
// below is the exact byte sequence both sides hash, so ANY divergence — an extra
// field, a different separator, a lowercased method — shows up as
// "signature does not verify" with no clue why. If you change one, change both.
//
// It is duplicated rather than imported because the two live in separate
// repositories and separate deployments; that is the same reason the Registry
// cannot import ours. A published `@interchange/envelope` package is the right
// long-term home (blueprint §8.1 `packages/envelope`), and this file is what
// goes into it.
//
// WHY THE PRIVATE KEY LIVES HERE AND NOT THERE. Signing is what replaces "the
// caller told us who they are" with a claim only this member can make. The key
// never leaves this deployment; the Registry holds only the public half. A key
// generated centrally and handed out would defeat the entire mechanism, which is
// why the Registry's own generate-keys script is marked a development fixture.
// ─────────────────────────────────────────────────────────────────────────────
import { ed25519 } from "@noble/curves/ed25519.js";
import { createHash, randomBytes } from "node:crypto";

export type SignedHeaders = {
  "x-interchange-member": string;
  "x-interchange-timestamp": string;
  "x-interchange-nonce": string;
  "x-interchange-signature": string;
};

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function unhex(s: string): Uint8Array {
  const clean = s.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error("Interchange key material is not valid hex.");
  }
  return Uint8Array.from(clean.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
}

export function bodyDigest(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

/** METHOD \n PATH \n SHA-256(body) \n timestamp \n nonce \n caller-code */
export function canonicalString(parts: {
  method: string;
  path: string;
  bodyDigest: string;
  timestamp: string;
  nonce: string;
  memberCode: string;
}): string {
  return [
    parts.method.toUpperCase(),
    parts.path,
    parts.bodyDigest,
    parts.timestamp,
    parts.nonce,
    parts.memberCode,
  ].join("\n");
}

export function signRequest(opts: {
  method: string;
  path: string;
  body: string;
  memberCode: string;
  secretKeyHex: string;
}): SignedHeaders {
  const timestamp = new Date().toISOString();
  const nonce = randomBytes(16).toString("hex");
  const message = canonicalString({
    method: opts.method,
    path: opts.path,
    bodyDigest: bodyDigest(opts.body),
    timestamp,
    nonce,
    memberCode: opts.memberCode,
  });
  const sig = ed25519.sign(new TextEncoder().encode(message), unhex(opts.secretKeyHex));
  return {
    "x-interchange-member": opts.memberCode,
    "x-interchange-timestamp": timestamp,
    "x-interchange-nonce": nonce,
    "x-interchange-signature": hex(sig),
  };
}

/** Node side too: our own node endpoint verifies the callers who query us. */
export function verifyRequest(opts: {
  method: string;
  path: string;
  body: string;
  headers: Headers;
  publicKeyHex: string | null;
}):
  | { ok: true; memberCode: string; signature: string; digest: string }
  | { ok: false; failure: string; message: string } {
  const memberCode = opts.headers.get("x-interchange-member");
  const timestamp = opts.headers.get("x-interchange-timestamp");
  const nonce = opts.headers.get("x-interchange-nonce");
  const signature = opts.headers.get("x-interchange-signature");

  if (!memberCode || !timestamp || !nonce || !signature) {
    return {
      ok: false,
      failure: "MISSING_HEADERS",
      message: "Signed requests need x-interchange-member, -timestamp, -nonce and -signature.",
    };
  }
  if (!opts.publicKeyHex) {
    return { ok: false, failure: "NO_REGISTERED_KEY", message: `Member ${memberCode} has no registered public key.` };
  }

  const skew = Math.abs(Date.now() - Date.parse(timestamp));
  if (!Number.isFinite(skew) || skew > MAX_CLOCK_SKEW_MS) {
    return { ok: false, failure: "CLOCK_SKEW", message: `Timestamp is outside the ${MAX_CLOCK_SKEW_MS / 1000}s window.` };
  }

  const digest = bodyDigest(opts.body);
  const message = canonicalString({
    method: opts.method,
    path: opts.path,
    bodyDigest: digest,
    timestamp,
    nonce,
    memberCode,
  });

  let valid = false;
  try {
    valid = ed25519.verify(unhex(signature), new TextEncoder().encode(message), unhex(opts.publicKeyHex));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, failure: "BAD_SIGNATURE", message: "Signature does not verify." };

  return { ok: true, memberCode, signature, digest };
}

/** Requests older than this are refused, so a captured request cannot be replayed. */
export const MAX_CLOCK_SKEW_MS = 60_000;
