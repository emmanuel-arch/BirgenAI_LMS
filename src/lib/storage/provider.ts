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
/** Borrower paperwork: fee structures, invoices, permits, statements. Also private. */
export const DOCS_BUCKET = "docs-private";
/**
 * Lender brand assets — logos. THE ONE PUBLIC BUCKET: a logo is meant to be seen
 * by every visitor to the lender's portal, so it is served by plain URL. Nothing
 * but brand assets may be written here — `putObject` enforces the pairing below.
 */
export const BRAND_BUCKET = "brand-public";
export const BUCKETS = [KYC_BUCKET, DOCS_BUCKET] as const;
/** Which buckets exist at all, and whether the world may read them. */
export const BUCKET_VISIBILITY: Record<string, "private" | "public"> = {
  [KYC_BUCKET]: "private",
  [DOCS_BUCKET]: "private",
  [BRAND_BUCKET]: "public",
};
/** Simulation stores the logo data-URL directly on Org.logoUrl — keep it small. */
export const MAX_SIM_LOGO_BYTES = 64 * 1024;
/** Live logo ceiling (the studio downscales to 512px, this is the backstop). */
export const MAX_LOGO_BYTES = 1024 * 1024;
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

/** A misconfigured key, not a bad image and not a bug. Carries the fix in its message. */
export class StorageConfigError extends Error {}

/**
 * Why the configured key cannot work — in words that name the fix. Null when it can.
 *
 * This exists because of a real 40-minute debugging session: `SUPABASE_SERVICE_ROLE_KEY`
 * held a 31-character string that was not a key at all, `storageMode()` saw *a* value
 * and cheerfully declared itself live, and the first sign of trouble was Supabase
 * refusing an upload with `{"statusCode":"403","message":"Invalid Compact JWS"}` —
 * which tells you nothing about which of your environment variables is wrong.
 *
 * A credential we can recognise as broken should be rejected where it is READ, with a
 * sentence that says what to paste and where to get it. Note we deliberately do NOT
 * fall back to simulation on a bad key: silently degrading would mean a lender's KYC
 * photographs quietly stop being persisted while every screen still says "verified".
 */
export function serviceKeyProblem(): string | null {
  const key = serviceKey();
  if (!key) return null; // Absent is a legitimate state: simulation mode.

  // New-style Supabase API keys.
  if (key.startsWith("sb_secret_")) return null;
  if (key.startsWith("sb_publishable_")) {
    return "SUPABASE_SERVICE_ROLE_KEY holds the PUBLISHABLE key (sb_publishable_…), which is the browser-safe one and cannot write to storage. Copy the SECRET key (sb_secret_…) from Supabase → Project Settings → API keys.";
  }

  // Legacy JWT keys: readable, so we can tell service_role from anon before Supabase does.
  const parts = key.split(".");
  if (parts.length === 3 && key.startsWith("eyJ")) {
    try {
      const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { role?: string };
      if (!claims.role || claims.role === "service_role") return null;
      return `SUPABASE_SERVICE_ROLE_KEY holds the "${claims.role}" key, not the service_role key. The anon key cannot write to a private bucket. Copy the service_role key from Supabase → Project Settings → API.`;
    } catch {
      return "SUPABASE_SERVICE_ROLE_KEY looks like a JWT but its payload cannot be read. Re-copy the service_role key from Supabase → Project Settings → API.";
    }
  }

  return (
    `SUPABASE_SERVICE_ROLE_KEY is not a Supabase key — it is ${key.length} characters with no JWT structure ` +
    `(a service_role key is a long "eyJ…" JWT, or an "sb_secret_…" key). This is most often the database password ` +
    `pasted into the wrong variable. Get the right value from Supabase → Project Settings → API.`
  );
}

/** The one choke point every live storage call passes through. */
function headers(extra?: Record<string, string>): Record<string, string> {
  const problem = serviceKeyProblem();
  if (problem) throw new StorageConfigError(problem);
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
  return putObject(KYC_BUCKET, `${orgId}/${sessionId}/${kind}-${randomUUID()}.${ext}`, buffer, contentType);
}

/**
 * Store one borrower document. Same key shape as KYC — org prefix so tenancy is
 * checkable from the key, uuid so the path is unguessable — in its own bucket, so a
 * retention policy for paperwork never touches a national-ID photo.
 */
export async function putDocumentObject(
  orgId: string,
  documentId: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const ext = contentType === "application/pdf" ? "pdf" : contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  return putObject(DOCS_BUCKET, `${orgId}/${documentId}/source-${randomUUID()}.${ext}`, buffer, contentType);
}

/** Write bytes. Simulation prefixes the key with `sim/` and stores nothing. */
async function putObject(bucket: string, key: string, buffer: Buffer, contentType: string): Promise<string> {
  // The allowlist that keeps sensitive bytes out of the public bucket: only a
  // known bucket may be written, and only logo-shaped keys may enter the public
  // one. A new code path cannot "accidentally" publish a national ID.
  if (!BUCKET_VISIBILITY[bucket]) throw new Error(`unknown bucket "${bucket}"`);
  if (BUCKET_VISIBILITY[bucket] === "public" && !/^[^/]+\/logo-[0-9a-f-]+\.(png|jpg|webp)$/.test(key)) {
    throw new Error(`refusing to write non-brand key "${key}" to the public bucket`);
  }
  if (storageMode() === "simulation") return `sim/${key}`;

  // Private artifacts are never cached; public brand assets cache forever —
  // safe because every upload takes a fresh uuid key, never overwriting.
  const cache = BUCKET_VISIBILITY[bucket] === "public" ? "public, max-age=31536000, immutable" : "no-store";
  const res = await fetch(`${supabaseUrl()}/storage/v1/object/${bucket}/${key}`, {
    method: "POST",
    headers: headers({ "Content-Type": contentType, "Cache-Control": cache }),
    body: new Uint8Array(buffer),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`storage upload failed (${res.status}): ${await res.text().catch(() => "")}`);
  return key;
}

/**
 * Store an org's logo and return the value to put on `Org.logoUrl`.
 *
 * Live: uploads to the public brand bucket and returns its permanent public URL
 * (immutable cache headers — a re-upload gets a fresh uuid, never overwrites).
 * Simulation: returns the data URL itself, size-capped, so the logo still
 * renders everywhere with zero infrastructure.
 */
export async function putBrandLogo(orgId: string, dataUrl: string): Promise<string> {
  const { buffer, contentType } = decodeImageDataUrl(dataUrl);
  if (buffer.length > MAX_LOGO_BYTES) throw new InvalidImageError("That logo is too large — use an image under 1 MB.");
  if (storageMode() === "simulation") {
    if (buffer.length > MAX_SIM_LOGO_BYTES) {
      throw new InvalidImageError("That logo is too large to store without object storage — use an image under 64 KB or connect storage.");
    }
    return dataUrl.trim();
  }
  const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const key = await putObjectPublicBrand(orgId, ext, buffer, contentType);
  return `${supabaseUrl()}/storage/v1/object/public/${BRAND_BUCKET}/${key}`;
}

async function putObjectPublicBrand(orgId: string, ext: string, buffer: Buffer, contentType: string): Promise<string> {
  return putObject(BRAND_BUCKET, `${orgId}/logo-${randomUUID()}.${ext}`, buffer, contentType);
}

/** Best-effort removal of a previous logo (accepts the stored Org.logoUrl value). */
export async function deleteBrandLogo(logoUrl: string | null | undefined): Promise<void> {
  if (!logoUrl || logoUrl.startsWith("data:")) return; // simulation logos live in the DB row
  const marker = `/storage/v1/object/public/${BRAND_BUCKET}/`;
  const at = logoUrl.indexOf(marker);
  if (at < 0) return; // not ours (e.g. a hand-set path) — leave it alone
  await deleteObjects([logoUrl.slice(at + marker.length)], BRAND_BUCKET);
}

/** A short-lived read URL, or null when the key was never really uploaded. */
export async function signedUrl(key: string, ttlSec = SIGNED_URL_TTL_SEC, bucket: string = KYC_BUCKET): Promise<string | null> {
  if (!key || key.startsWith("sim/") || storageMode() === "simulation") return null;

  const res = await fetch(`${supabaseUrl()}/storage/v1/object/sign/${bucket}/${key}`, {
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
export async function deleteObjects(keys: string[], bucket: string = KYC_BUCKET): Promise<number> {
  const real = keys.filter((k) => k && !k.startsWith("sim/"));
  if (real.length === 0 || storageMode() === "simulation") return 0;
  try {
    const res = await fetch(`${supabaseUrl()}/storage/v1/object/${bucket}`, {
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

/** @deprecated Use deleteObjects. Kept so existing erasure call sites keep working. */
export const deleteKycObjects = (keys: string[]) => deleteObjects(keys, KYC_BUCKET);

/** Does this key belong to this tenant? Cheap check before we hit the DB. */
export function keyBelongsToOrg(key: string, orgId: string): boolean {
  if (!key || key.includes("..")) return false;
  const path = key.startsWith("sim/") ? key.slice(4) : key;
  return path.startsWith(`${orgId}/`);
}
