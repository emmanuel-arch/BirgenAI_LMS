// Creates the private buckets that hold borrower ID photos and borrower paperwork,
// then asserts that neither is public.
//
//   npm run storage:init        (idempotent)
//
// Needs SUPABASE_SERVICE_ROLE_KEY (Supabase dashboard → Project Settings → API →
// service_role). That key bypasses storage authorization entirely, so it belongs
// in the server environment and nowhere near a browser.
//
// Without the key this exits cleanly: storage stays in simulation and the funnel
// keeps working, it just never persists a file.
//
// Two buckets rather than one. A fee structure and a national-ID photograph are
// both private, but they are not the same class of data — separate buckets let a
// retention or erasure policy apply to one without touching the other.
import "dotenv/config";
import { KYC_BUCKET, DOCS_BUCKET, BRAND_BUCKET, MAX_IMAGE_BYTES, MAX_LOGO_BYTES, storageMode, supabaseUrl } from "../src/lib/storage/provider";
import { MAX_DOCUMENT_BYTES } from "../src/lib/documents/parse";

const SPECS = [
  { id: KYC_BUCKET, public: false, limit: MAX_IMAGE_BYTES, mimes: ["image/jpeg", "image/png", "image/webp"], holds: "borrower ID photos" },
  { id: DOCS_BUCKET, public: false, limit: MAX_DOCUMENT_BYTES, mimes: ["application/pdf", "image/jpeg", "image/png", "image/webp"], holds: "borrower paperwork" },
  // The one deliberate exception: logos are meant to be world-readable. Nothing
  // but brand assets can be written here — putObject enforces the key shape.
  { id: BRAND_BUCKET, public: true, limit: MAX_LOGO_BYTES, mimes: ["image/jpeg", "image/png", "image/webp"], holds: "lender logos" },
];

async function main() {
  if (storageMode() === "simulation") {
    console.log("SUPABASE_SERVICE_ROLE_KEY is not set — storage stays in simulation.");
    console.log("KYC images and documents will not be persisted. Set the key and re-run to go live.");
    return;
  }

  const url = supabaseUrl()!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!.trim();
  const auth = { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" };
  console.log(`project ${url}`);

  for (const spec of SPECS) {
    const existing = await fetch(`${url}/storage/v1/bucket/${spec.id}`, { headers: auth });
    if (existing.status === 404) {
      const created = await fetch(`${url}/storage/v1/bucket`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          id: spec.id,
          name: spec.id,
          public: spec.public,
          file_size_limit: spec.limit,
          allowed_mime_types: spec.mimes,
        }),
      });
      if (!created.ok) throw new Error(`create bucket failed (${created.status}): ${await created.text()}`);
      console.log(`created ${spec.public ? "PUBLIC" : "private"} bucket "${spec.id}"`);
    } else if (existing.ok) {
      console.log(`bucket "${spec.id}" already exists`);
    } else {
      throw new Error(`bucket lookup failed (${existing.status}): ${await existing.text()}`);
    }

    // The one property that must never drift: visibility must match the spec.
    // A private bucket gone public serves national-ID photos to anyone who can
    // guess a path; the brand bucket gone private breaks every lender's logo.
    const check = await fetch(`${url}/storage/v1/bucket/${spec.id}`, { headers: auth });
    const bucket = (await check.json()) as { public?: boolean; file_size_limit?: number };
    if (!!bucket.public !== spec.public) {
      throw new Error(`"${spec.id}" is ${bucket.public ? "PUBLIC" : "private"} but must be ${spec.public ? "public" : "private"} (${spec.holds}).`);
    }
    console.log(`  ${spec.public ? "public" : "private"} ✓  (${spec.holds}, limit ${Math.round((bucket.file_size_limit ?? 0) / 1024 / 1024)} MB)`);
  }

  console.log("\nReads are served only through short-lived signed URLs (kyc/asset, documents/[id]).");
}

main().catch((e) => { console.error(e); process.exit(1); });
