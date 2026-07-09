// ─────────────────────────────────────────────────────────────────────────────
// Private object storage for KYC artifacts — the borrower's ID photo, their
// selfie, and the canonical white-background portrait.
//
// Until now these were strings. `portraitKeyFrom("selfie/123")` returned
// "portrait/123", nothing was ever uploaded, and the images the borrower took
// died in the browser. This puts the bytes somewhere real.
//
// SIMULATION-FIRST, like kycMode/crbMode/llmMode: with no service-role key the
// keys are synthesised (prefixed `sim/`) and nothing leaves the process, so the
// demo org and local dev keep working untouched. Set SUPABASE_SERVICE_ROLE_KEY
// and the same call sites start writing to a private bucket.
//
// THE BUCKET IS PRIVATE AND STAYS PRIVATE. A national ID photo must never be
// fetchable by URL. Nothing here ever returns a public link: reads go through
// `signedUrl()`, which mints a short-lived token, and the service-role key never
// leaves the server. `npm run storage:init` creates the bucket and asserts it is
// not public.
//
// Implemented over Supabase Storage's REST API rather than @supabase/supabase-js
// — we need four verbs, and the client library is a large dependency to carry
// for them.
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from "node:crypto";

export type StorageMode = "simulation" | "live";

export const KYC_BUCKET = "kyc-private";
/** Long enough to render an <img>, short enough that a leaked URL is stale. */
export const SIGNED_URL_TTL_SEC = 120;
/**
 * Decoded image ceiling. Images arrive base64'd inside a JSON body, which inflates
 * them by a third, and Vercel caps a serverless request body at 4.5 MB — so this
 * must stay comfortably under ~3.3 MB. The capture surface downscales to a 1600px
 * long edge, which lands well under 1 MB; this is the backstop, not the target.
 */
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

export type KycAssetKind = "id-front" | "id-back" | "selfie" | "portrait";

function serviceKey(): string | null {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || null;
}

/**
 * The project URL. Derived from the database connection's `<role>.<projectref>`
 * username when not set explicitly, so the only manual secret is the key.
 */
export function supabaseUrl(): string | null {
  const explicit = process.env.SUPABASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  try {
    const user = decodeURIComponent(new URL(process.env.DATABASE_URL!).username);
    const ref = user.split(".")[1];
    return ref ? `https://${ref}.supabase.co` : null;
  } catch {
    return null;
  }
}

export function storageMode(): StorageMode {
  return serviceKey() && supabaseUrl() ? "live" : "simulation";
}

function headers(extra?: Record<string, string>): Record<string, string> {
  const key = serviceKey()!;
  return { Authorization: `Bearer ${key}`, apikey: key, ...extra };
}

// ── Image validation ──────────────────────────────────────────────────────────

const SNIFFERS: { type: string; test: (b: Buffer) => boolean }[] = [
  { type: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: "image/png", test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { type: "image/webp", test: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP" },
];

export class InvalidImageError extends Error {}

/**
 * Decode a `data:image/...;base64,...` URL into bytes.
 *
 * The declared MIME type is discarded and the real one sniffed from the magic
 * bytes — a client that says "image/jpeg" is making a claim, not a statement of
 * fact, and this content ends up in a bucket an officer will later open.
 */
export function decodeImageDataUrl(dataUrl: string): { buffer: Buffer; contentType: string } {
  const m = /^data:image\/[a-z+]+;base64,(.+)$/i.exec((dataUrl ?? "").trim());
  if (!m) throw new InvalidImageError("Expected a base64 image data URL.");

  const buffer = Buffer.from(m[1], "base64");
  if (buffer.length === 0) throw new InvalidImageError("Empty image.");
  if (buffer.length > MAX_IMAGE_BYTES) throw new InvalidImageError("That image is too large — retake it.");

  const sniffed = SNIFFERS.find((s) => s.test(buffer));
  if (!sniffed) throw new InvalidImageError("That file is not a JPEG, PNG or WebP image.");
  return { buffer, contentType: sniffed.type };
}

// ── Object operations ─────────────────────────────────────────────────────────

/**
 * Store one KYC image. The key is `<orgId>/<sessionId>/<kind>-<uuid>.<ext>`:
 * the org prefix makes tenancy checkable from the key alone, the uuid makes the
 * path unguessable even if the bucket were ever misconfigured as public.
 */
export async function putKycObject(
  orgId: string,
  sessionId: string,
  kind: KycAssetKind,
  dataUrl: string,
): Promise<string> {
  const { buffer, contentType } = decodeImageDataUrl(dataUrl);
  const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const key = `${orgId}/${sessionId}/${kind}-${randomUUID()}.${ext}`;

  if (storageMode() === "simulation") return `sim/${key}`;

  const res = await fetch(`${supabaseUrl()}/storage/v1/object/${KYC_BUCKET}/${key}`, {
    method: "POST",
    headers: headers({ "Content-Type": contentType, "Cache-Control": "no-store" }),
    body: new Uint8Array(buffer),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`storage upload failed (${res.status}): ${await res.text().catch(() => "")}`);
  return key;
}

/** A short-lived read URL, or null when the key was never really uploaded. */
export async function signedUrl(key: string, ttlSec = SIGNED_URL_TTL_SEC): Promise<string | null> {
  if (!key || key.startsWith("sim/") || storageMode() === "simulation") return null;

  const res = await fetch(`${supabaseUrl()}/storage/v1/object/sign/${KYC_BUCKET}/${key}`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ expiresIn: ttlSec }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const { signedURL } = (await res.json()) as { signedURL?: string };
  return signedURL ? `${supabaseUrl()}/storage/v1${signedURL}` : null;
}

/** Erasure (DPA right to deletion). Best-effort, never throws. */
export async function deleteKycObjects(keys: string[]): Promise<number> {
  const real = keys.filter((k) => k && !k.startsWith("sim/"));
  if (real.length === 0 || storageMode() === "simulation") return 0;
  try {
    const res = await fetch(`${supabaseUrl()}/storage/v1/object/${KYC_BUCKET}`, {
      method: "DELETE",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: real }),
      signal: AbortSignal.timeout(20_000),
    });
    return res.ok ? real.length : 0;
  } catch {
    return 0;
  }
}

/** Does this key belong to this tenant? Cheap check before we hit the DB. */
export function keyBelongsToOrg(key: string, orgId: string): boolean {
  if (!key || key.includes("..")) return false;
  const path = key.startsWith("sim/") ? key.slice(4) : key;
  return path.startsWith(`${orgId}/`);
}
