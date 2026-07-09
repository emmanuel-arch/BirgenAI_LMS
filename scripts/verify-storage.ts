// Tests for the KYC object store.
//
//   npm run test:storage
//
// Runs entirely offline. The live code path is exercised against an embedded
// fake bucket that speaks Supabase Storage's REST dialect, so what is verified is
// OUR wire format, OUR authorization headers and OUR key layout — not Supabase's
// uptime. The simulation path is verified against nothing at all, which is the
// point of it.
import "dotenv/config";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};

const b64 = (b: Buffer) => b.toString("base64");
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(600, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(600, 7)]);
const jpegUrl = `data:image/jpeg;base64,${b64(JPEG)}`;

type Received = { method: string; path: string; auth: string | undefined; contentType: string | undefined; body: Buffer };

/** A stand-in for Supabase Storage: PUT object, POST sign, DELETE object. */
function fakeBucket(received: Received[]): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        received.push({
          method: req.method!,
          path: req.url!,
          auth: req.headers.authorization,
          contentType: req.headers["content-type"] as string | undefined,
          body: Buffer.concat(chunks),
        });
        if (req.method === "POST" && req.url!.startsWith("/storage/v1/object/sign/")) {
          const objectPath = req.url!.replace("/storage/v1/object/sign/", "");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ signedURL: `/object/sign/${objectPath}?token=fake.jwt.token` }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ Key: req.url }));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

async function main() {
  const ORG = "11111111-1111-1111-1111-111111111111";
  const OTHER = "22222222-2222-2222-2222-222222222222";
  const SESSION = "33333333-3333-3333-3333-333333333333";

  // ── Simulation (no service-role key) ────────────────────────────────────────
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  const sim = await import("../src/lib/storage/provider");

  console.log("1. Image validation refuses anything that is not really an image");
  ok("a real JPEG decodes", sim.decodeImageDataUrl(jpegUrl).contentType === "image/jpeg");
  ok("a real PNG decodes", sim.decodeImageDataUrl(`data:image/png;base64,${b64(PNG)}`).contentType === "image/png");
  // The declared MIME type is a claim; the magic bytes are the fact.
  const lying = `data:image/jpeg;base64,${b64(Buffer.from("<html><script>alert(1)</script>"))}`;
  ok("HTML claiming to be a JPEG is rejected", (() => { try { sim.decodeImageDataUrl(lying); return false; } catch { return true; } })());
  ok("a non-data-URL is rejected", (() => { try { sim.decodeImageDataUrl("https://evil.example/x.jpg"); return false; } catch { return true; } })());
  ok("an oversized image is rejected", (() => {
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(sim.MAX_IMAGE_BYTES + 1)]);
    try { sim.decodeImageDataUrl(`data:image/jpeg;base64,${b64(big)}`); return false; } catch { return true; }
  })());

  console.log("\n2. Keys are tenant-scoped and untraversable");
  ok("own-org key accepted", sim.keyBelongsToOrg(`${ORG}/${SESSION}/selfie-a.jpg`, ORG));
  ok("other-org key refused", !sim.keyBelongsToOrg(`${OTHER}/${SESSION}/selfie-a.jpg`, ORG));
  ok("traversal refused", !sim.keyBelongsToOrg(`${ORG}/../${OTHER}/selfie-a.jpg`, ORG));
  ok("prefix-collision refused", !sim.keyBelongsToOrg(`${ORG}-evil/${SESSION}/selfie-a.jpg`, ORG));
  ok("sim/ key still checked against the org", sim.keyBelongsToOrg(`sim/${ORG}/${SESSION}/x.jpg`, ORG) && !sim.keyBelongsToOrg(`sim/${OTHER}/${SESSION}/x.jpg`, ORG));

  console.log("\n3. Simulation persists nothing");
  ok("storageMode() is simulation without a key", sim.storageMode() === "simulation");
  const simKey = await sim.putKycObject(ORG, SESSION, "portrait", jpegUrl);
  ok("putKycObject returns a sim/ key", simKey.startsWith(`sim/${ORG}/${SESSION}/portrait-`), simKey);
  ok("signedUrl for a sim key is null", (await sim.signedUrl(simKey)) === null);

  // ── Live (service-role key + a bucket that answers) ──────────────────────────
  const received: Received[] = [];
  const { server, url } = await fakeBucket(received);
  process.env.SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  // Fresh module instance so nothing from the simulation run is cached.
  const live = await import(`../src/lib/storage/provider?live=${Date.now()}`) as typeof sim;

  try {
    console.log("\n4. Live mode writes real bytes to the private bucket");
    ok("storageMode() is live with a key", live.storageMode() === "live");

    const key = await live.putKycObject(ORG, SESSION, "id-front", jpegUrl);
    const put = received.find((r) => r.method === "POST" && r.path.includes("/object/kyc-private/"))!;
    ok("key is <orgId>/<sessionId>/<kind>-<uuid>.jpg", new RegExp(`^${ORG}/${SESSION}/id-front-[0-9a-f-]{36}\\.jpg$`).test(key), key);
    ok("uploaded to the kyc-private bucket at that key", !!put && put.path === `/storage/v1/object/kyc-private/${key}`);
    ok("upload carried the service-role bearer token", put?.auth === "Bearer test-service-role-key");
    ok("upload declared the SNIFFED content type", put?.contentType === "image/jpeg");
    ok("the exact image bytes arrived", put?.body.equals(JPEG), `${put?.body.length} bytes`);

    const signed = await live.signedUrl(key, 90);
    const sign = received.find((r) => r.path.includes("/object/sign/"))!;
    ok("signedUrl asks for a scoped, expiring token", JSON.parse(sign.body.toString()).expiresIn === 90);
    ok("signedUrl returns an absolute URL with the token", signed === `${url}/storage/v1/object/sign/kyc-private/${key}?token=fake.jwt.token`, signed ?? "null");
    ok("the signed URL is NOT the public object path", !!signed && !signed.includes("/object/public/"));

    const deleted = await live.deleteKycObjects([key, `sim/${ORG}/x/y.jpg`]);
    const del = received.find((r) => r.method === "DELETE")!;
    ok("deletion targets only real keys", deleted === 1 && JSON.parse(del.body.toString()).prefixes.length === 1);
  } finally {
    server.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
