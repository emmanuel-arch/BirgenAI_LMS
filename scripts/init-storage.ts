// Creates the private bucket that holds borrower ID photos, selfies and
// portraits, then asserts it is not public.
//
//   npm run storage:init        (idempotent)
//
// Needs SUPABASE_SERVICE_ROLE_KEY (Supabase dashboard → Project Settings → API →
// service_role). That key bypasses storage authorization entirely, so it belongs
// in the server environment and nowhere near a browser.
//
// Without the key this exits cleanly: storage stays in simulation and the funnel
// keeps working, it just never persists an image.
import "dotenv/config";
import { KYC_BUCKET, MAX_IMAGE_BYTES, storageMode, supabaseUrl } from "../src/lib/storage/provider";

async function main() {
  if (storageMode() === "simulation") {
    console.log("SUPABASE_SERVICE_ROLE_KEY is not set — storage stays in simulation.");
    console.log("KYC images will not be persisted. Set the key and re-run to go live.");
    return;
  }

  const url = supabaseUrl()!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!.trim();
  const auth = { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" };
  console.log(`project ${url}`);

  const existing = await fetch(`${url}/storage/v1/bucket/${KYC_BUCKET}`, { headers: auth });
  if (existing.status === 404) {
    const created = await fetch(`${url}/storage/v1/bucket`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        id: KYC_BUCKET,
        name: KYC_BUCKET,
        public: false,
        file_size_limit: MAX_IMAGE_BYTES,
        allowed_mime_types: ["image/jpeg", "image/png", "image/webp"],
      }),
    });
    if (!created.ok) throw new Error(`create bucket failed (${created.status}): ${await created.text()}`);
    console.log(`created private bucket "${KYC_BUCKET}"`);
  } else if (existing.ok) {
    console.log(`bucket "${KYC_BUCKET}" already exists`);
  } else {
    throw new Error(`bucket lookup failed (${existing.status}): ${await existing.text()}`);
  }

  // The one property that must never drift: a public bucket serves a national ID
  // photo to anyone who can guess the path.
  const check = await fetch(`${url}/storage/v1/bucket/${KYC_BUCKET}`, { headers: auth });
  const bucket = (await check.json()) as { public?: boolean; file_size_limit?: number };
  if (bucket.public) throw new Error(`"${KYC_BUCKET}" is PUBLIC — borrower ID photos would be world-readable.`);
  console.log(`bucket is private ✓  (limit ${Math.round((bucket.file_size_limit ?? 0) / 1024 / 1024)} MB)`);
  console.log("\nReads are served only through short-lived signed URLs (GET /api/console/kyc/asset).");
}

main().catch((e) => { console.error(e); process.exit(1); });
