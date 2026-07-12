// END-TO-END against the REAL Supabase project and the REAL buckets.
//
//   npm run test:storage-live        (hits the network; writes and then deletes)
//
// test:storage proves our wire format against a fake bucket. It cannot prove that
// the buckets EXIST, that the key in .env actually opens them, or — the one that
// matters — that a bucket marked "Public: OFF" in the dashboard is genuinely
// refusing anonymous readers. Those are facts about a live system, and the only
// way to learn them is to ask it.
//
// So this uploads a real image, signs it, fetches it back through the signed URL,
// then tries to fetch the SAME object with no credentials at all and demands to be
// refused. A private bucket that isn't private is not a misconfiguration, it is a
// national-ID photograph served to anyone who can guess a path.
//
// Everything it writes, it deletes. Objects are keyed under a throwaway org id so
// nothing here can collide with a real lender's data.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import {
  KYC_BUCKET, DOCS_BUCKET, BRAND_BUCKET,
  storageMode, supabaseUrl, serviceKeyProblem,
  putKycObject, putDocumentObject, putBrandLogo, deleteBrandLogo,
  signedUrl, signedUrls, deleteObjects,
} from "../src/lib/storage/provider";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};
const section = (s: string) => console.log(`\n${s}`);

/** A real, minimal JPEG — magic bytes plus filler. The sniffer must accept it. */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(1024, 0x5a)]);
const jpegUrl = `data:image/jpeg;base64,${JPEG.toString("base64")}`;
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(512, 0x20), Buffer.from("\n%%EOF")]);

const ORG = randomUUID();      // a throwaway tenant: nothing real lives under this prefix
const SESSION = randomUUID();

async function main() {
  section("0. The environment is actually configured");

  const problem = serviceKeyProblem();
  if (problem) {
    console.log(`  FAIL  the service-role key is usable\n\n        ${problem}\n`);
    process.exit(1);
  }
  ok("the service-role key is a real service_role key", true);

  const url = supabaseUrl();
  ok("a project URL resolves", !!url, url ?? "null");
  ok("storage reports itself LIVE, not simulation", storageMode() === "live",
    "if this says simulation, KYC photos are not being stored at all");
  if (storageMode() !== "live" || !url) {
    console.log("\nCannot continue without live storage.");
    process.exit(1);
  }

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!.trim();
  const auth = { Authorization: `Bearer ${key}`, apikey: key };

  // ── 1. The three buckets, and their visibility ────────────────────────────
  section("1. The buckets exist, and are what they claim to be");

  const specs = [
    { id: KYC_BUCKET, public: false, holds: "borrower ID photos and faces" },
    { id: DOCS_BUCKET, public: false, holds: "borrower paperwork" },
    { id: BRAND_BUCKET, public: true, holds: "lender logos" },
  ];

  for (const spec of specs) {
    const res = await fetch(`${url}/storage/v1/bucket/${spec.id}`, { headers: auth });
    if (!res.ok) {
      ok(`bucket "${spec.id}" exists`, false, `HTTP ${res.status} — run: npm run storage:init`);
      continue;
    }
    const bucket = (await res.json()) as { public?: boolean; file_size_limit?: number | null };
    ok(`bucket "${spec.id}" exists`, true, spec.holds);
    ok(`  …and is ${spec.public ? "PUBLIC" : "PRIVATE"}, as it must be`, !!bucket.public === spec.public,
      !!bucket.public === spec.public ? "" : `it is ${bucket.public ? "PUBLIC" : "private"} — fix this before storing anything`);
  }

  // ── 2. A borrower's face: write, sign, read, and refuse the public ────────
  section("2. kyc-private — a real round trip");

  const portraitKey = await putKycObject(ORG, SESSION, "portrait", jpegUrl);
  ok("an image uploads and returns a real key (not sim/)", !portraitKey.startsWith("sim/"), portraitKey);
  ok("…keyed under the org, so tenancy is checkable from the key alone", portraitKey.startsWith(`${ORG}/`));

  const signed = await signedUrl(portraitKey);
  ok("a signed URL is minted", !!signed);

  const viaSigned = signed ? await fetch(signed) : null;
  ok("the signed URL actually serves the object", viaSigned?.ok === true, `HTTP ${viaSigned?.status}`);

  const bytes = viaSigned?.ok ? Buffer.from(await viaSigned.arrayBuffer()) : Buffer.alloc(0);
  ok("…and the bytes that come back are the bytes that went in", bytes.equals(JPEG), `${bytes.length} of ${JPEG.length} bytes`);

  // THE SECURITY ASSERTION. Same object, no credentials.
  const naked = await fetch(`${url}/storage/v1/object/public/${KYC_BUCKET}/${portraitKey}`);
  ok("the SAME object is refused to an anonymous caller", !naked.ok,
    naked.ok ? "⚠ THIS BUCKET IS SERVING BORROWER ID PHOTOS TO THE PUBLIC INTERNET" : `HTTP ${naked.status} — private means private`);

  // ── 3. Batch signing, against real objects ───────────────────────────────
  section("3. Many faces, one round trip");

  const second = await putKycObject(ORG, SESSION, "id-front", jpegUrl);
  const many = await signedUrls([portraitKey, second, `sim/${ORG}/x/never-written.jpg`], 600);
  ok("both real keys are signed in a single batch call", many.size === 2, `${many.size} of 2`);
  ok("…and the sim/ key is not asked for", !many.has(`sim/${ORG}/x/never-written.jpg`));

  const batched = many.get(portraitKey) ? await fetch(many.get(portraitKey)!) : null;
  ok("a batch-signed URL serves the object too", batched?.ok === true, `HTTP ${batched?.status}`);

  // ── 4. Paperwork ─────────────────────────────────────────────────────────
  section("4. docs-private — borrower paperwork");

  const docKey = await putDocumentObject(ORG, "statement.pdf", PDF, "application/pdf");
  ok("a PDF uploads to its own bucket", !docKey.startsWith("sim/"), docKey);

  const docUrl = await signedUrl(docKey, 120, DOCS_BUCKET);
  const docRes = docUrl ? await fetch(docUrl) : null;
  ok("…and comes back through a signed URL", docRes?.ok === true, `HTTP ${docRes?.status}`);

  const nakedDoc = await fetch(`${url}/storage/v1/object/public/${DOCS_BUCKET}/${docKey}`);
  ok("…and is refused to an anonymous caller", !nakedDoc.ok, `HTTP ${nakedDoc.status}`);

  // ── 5. The logo — the bug the founder actually reported ──────────────────
  section("5. brand-public — the logo upload that was failing");

  let logoUrl: string | null = null;
  try {
    logoUrl = await putBrandLogo(ORG, jpegUrl);
    ok("a logo uploads", !!logoUrl, logoUrl ?? "");
  } catch (e) {
    ok("a logo uploads", false, e instanceof Error ? e.message : String(e));
  }

  if (logoUrl) {
    ok("…to a PUBLIC url (a logo on a login page has no session to sign with)", logoUrl.includes("/object/public/"));
    // No auth header at all — this is how a borrower's browser will ask for it.
    const anon = await fetch(logoUrl);
    ok("…which an anonymous browser can actually load", anon.ok, `HTTP ${anon.status}`);
    const logoBytes = anon.ok ? Buffer.from(await anon.arrayBuffer()) : Buffer.alloc(0);
    ok("…and it is the image we uploaded", logoBytes.equals(JPEG), `${logoBytes.length} bytes`);
  }

  // ── 6. Clean up after ourselves ──────────────────────────────────────────
  section("6. Cleanup");

  const removed = await deleteObjects([portraitKey, second], KYC_BUCKET);
  ok("the KYC objects are deleted", removed === 2, `${removed} of 2`);
  const removedDocs = await deleteObjects([docKey], DOCS_BUCKET);
  ok("the document is deleted", removedDocs === 1);

  const stillThere = await signedUrl(portraitKey);
  const check = stillThere ? await fetch(stillThere) : null;
  ok("a deleted object is really gone from the bucket", !check || !check.ok, `HTTP ${check?.status ?? "no url"}`);

  /**
   * Ask the BUCKET, not the edge.
   *
   * This assertion originally fetched the logo's public URL and expected a 404. It
   * got a 200 — and the object was already gone. The public bucket is served through
   * a CDN, and the test had itself warmed that cache seconds earlier by loading the
   * logo to check the bytes. It was measuring Cloudflare, not Supabase.
   *
   * Worth knowing operationally, and not only for the test: a lender who changes
   * their logo may keep seeing the old one at the edge for a little while. The DB row
   * is right, the bucket is right, and the cache catches up. Nothing to fix — but
   * something to be able to answer when a founder asks why.
   */
  const objectsUnderOrg = async (bucket: string) => {
    const res = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: ORG, limit: 100 }),
    });
    return res.ok ? ((await res.json()) as unknown[]).length : -1;
  };

  if (logoUrl) {
    await deleteBrandLogo(logoUrl);
    ok("the logo is gone from the bucket", (await objectsUnderOrg(BRAND_BUCKET)) === 0);
  }
  ok("nothing this test wrote is left behind", (await objectsUnderOrg(KYC_BUCKET)) === 0 && (await objectsUnderOrg(DOCS_BUCKET)) === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
