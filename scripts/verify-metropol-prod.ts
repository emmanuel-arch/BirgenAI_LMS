// ─────────────────────────────────────────────────────────────────────────────
// PRODUCTION key probe for the Metropol CRB client.
//
//   npm run test:crb:prod              # entitlement sweep, no billable pull
//   npm run test:crb:prod -- --testbed # same sweep against the TEST subscription
//   CRB_REAL_ID=12345678 npm run test:crb:prod   # + ONE real identity verify
//
// Deliberately different from verify-metropol.ts, which is a TESTBED script: its
// dummy IDs (55…/66…/77…) exist only on a test subscription, so running it with
// production keys proves nothing and misreads a correct rejection as a failure.
//
// The question this answers is NOT "does our code work" — verify-metropol.ts
// already settles that — but "what is this subscription allowed to do". So it
// sweeps every endpoint and classifies the response by WHERE it failed:
//
//   E026/E027  hash absent/mismatch  → our signing or the private key is wrong
//   E002/E004  empty/invalid key     → the public key is unknown or expired
//   E003       not authorized        → keys are GOOD, subscription is not
//                                      entitled to that service (or we are on
//                                      the wrong port/version for this key)
//   E023-E025  timestamp             → this host's clock has drifted past 45s
//   200/E017/E018                    → entitled and answering
//
// That distinction is the whole point: E003 and E027 both look like "CRB is
// broken" from the console, but one is a phone call to Metropol and the other
// is a bug in this repo.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import type { CrbConfig } from "@/lib/vault/integrations";
import { health, MetropolError, REPORT_TYPE } from "@/lib/crb/metropol";
import { createHash } from "crypto";

// .env carries these as Metropol_Public_Key / Metropol_Private_Key. On Windows
// process.env is case-insensitive so METROPOL_PUBLIC_KEY would also resolve —
// but that is a platform accident, not a contract, so read every spelling.
const pick = (...names: string[]) => {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) return v.trim().replace(/^["']|["']$/g, "");
  }
  return "";
};

// --testbed runs the SAME sweep against the known-good test subscription. That
// A/B is the diagnostic: if testbed passes where production returns E003, the
// code, the signing and the clock are all exonerated and the difference is the
// subscription itself.
const TESTBED = process.argv.includes("--testbed");
const publicKey = TESTBED
  ? "ijkqeymLEBUPMGopzugRixgGYaxuqNREvpLbjXLuBUfGSAFmkLWBQrcKBxmp"
  : pick("METROPOL_PUBLIC_KEY", "Metropol_Public_Key", "METROPOL_PUB_KEY");
const privateKey = TESTBED
  ? "tKuiFSoUrMUvFBocuKBSkXnEXRNTMR"
  : pick("METROPOL_PRIVATE_KEY", "Metropol_Private_Key", "Private_Key");

const cfg: CrbConfig = {
  bureau: "metropol",
  publicKey,
  privateKey,
  host: pick("METROPOL_HOST") || "api.metropol.co.ke",
  port: pick("METROPOL_PORT") || "5555",
  apiVersion: pick("METROPOL_VERSION") || "v2_1",
  reportDepth: "full",
};

// Never print a key. A length plus first/last 4 is enough to tell two pairs
// apart in a log, and enough to catch the usual paste damage (quotes, truncation).
const fp = (k: string) => (k ? `${k.length} chars · ${k.slice(0, 4)}…${k.slice(-4)}` : "MISSING");

// The probe ID is never a real person: on the testbed 550000055 is a valid dummy,
// and on production it is simply an ID with no file — so an ENTITLED production
// subscription answers E017 "identity not found" rather than billing for a
// report. Entitlement is therefore visible without buying anything.
const PROBE_ID = "550000055";

type Verdict = "ENTITLED" | "NOT_ENTITLED" | "CREDENTIAL" | "SIGNING" | "CLOCK" | "UNKNOWN";

const classify = (code: string | null): Verdict => {
  switch (code) {
    case null: return "UNKNOWN";
    case "E026": case "E027": return "SIGNING";
    case "E002": case "E004": return "CREDENTIAL";
    case "E003": case "E016": case "E029": return "NOT_ENTITLED";
    case "E023": case "E024": case "E025": return "CLOCK";
    default: return "ENTITLED"; // E017/E018/E011/… means we reached the service itself
  }
};

// The sweep calls endpoints directly rather than through the typed helpers so
// that one un-entitled report cannot abort the others — we want the full picture.
async function probe(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<{ verdict: Verdict; code: string | null; detail: string }> {
  const url = `https://${cfg.host}:${cfg.port}/${cfg.apiVersion}${endpoint}`;
  const json = JSON.stringify(body);
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const ts =
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}` +
    `${p(d.getUTCMilliseconds(), 3)}${p(Math.floor(Math.random() * 1000), 3)}`;
  const hash = createHash("sha256").update(privateKey + json + publicKey + ts, "utf8").digest("hex");
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-METROPOL-REST-API-KEY": publicKey,
        "X-METROPOL-REST-API-HASH": hash,
        "X-METROPOL-REST-API-TIMESTAMP": ts,
      },
      body: json,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { verdict: "UNKNOWN", code: null, detail: `non-JSON HTTP ${res.status} — wrong port/version?` };
    }
    const code = j.api_code === null || j.api_code === undefined ? null : String(j.api_code);
    const desc = String(j.api_code_description ?? "");
    if (j.has_error === true) return { verdict: classify(code), code, detail: desc || `HTTP ${res.status}` };
    return { verdict: "ENTITLED", code, detail: desc || "200 OK, payload returned" };
  } catch (e) {
    return { verdict: "UNKNOWN", code: null, detail: e instanceof Error ? e.message : String(e) };
  }
}

const MARK: Record<Verdict, string> = {
  ENTITLED: "✓", NOT_ENTITLED: "✗", CREDENTIAL: "✗", SIGNING: "✗", CLOCK: "✗", UNKNOWN: "?",
};

async function main() {
  console.log(`\nMetropol ${TESTBED ? "TESTBED" : "PRODUCTION"} probe → https://${cfg.host}:${cfg.port}/${cfg.apiVersion}`);
  console.log(`  public  : ${fp(publicKey)}`);
  console.log(`  private : ${fp(privateKey)}\n`);

  if (!publicKey || !privateKey) {
    console.error("✗ Keys not found in env. Expected Metropol_Public_Key / Metropol_Private_Key in .env\n");
    process.exit(1);
  }

  // 1. Health — proves host/port/version route to a live Metropol node at all.
  let healthy = false;
  try {
    const h = (await health(cfg)) as Record<string, unknown>;
    healthy = h.has_error === false;
    console.log(`  ${healthy ? "✓" : "✗"} Health / routing — ${String(h.api_code_description ?? h.api_code ?? "")}`);
  } catch (e) {
    console.log(`  ✗ Health / routing — ${e instanceof MetropolError ? `${e.message} [${e.apiCode}]` : String(e)}`);
  }

  // 2. Entitlement sweep across the catalogue.
  const RT = REPORT_TYPE as unknown as Record<string, number>;
  // Bodies mirror the real client exactly (guide §4.3.1–§4.3.14). They have to:
  // report 3 takes mobile_score and NOT loan_amount, and the credit reports each
  // need report_reason — and Metropol answers an unexpected parameter on
  // /score/consumer with E027 "Hash Mismatch", which reads as a signing bug and
  // is not one. A sweep that sends the wrong body measures its own mistakes.
  const subject = { identity_number: PROBE_ID, identity_type: "001" };
  const credit = { ...subject, loan_amount: 20000, report_reason: 1 };
  const sweep: Array<[string, string, Record<string, unknown>]> = [
    ["Identity verify",        "/identity/verify",             { report_type: RT.IDENTITY_VERIFY ?? 1, ...subject }],
    ["Delinquency status",     "/delinquency/status",          { report_type: RT.DELINQUENCY ?? 2, ...subject, loan_amount: 20000 }],
    ["Metro score",            "/score/consumer",              { report_type: RT.METRO_SCORE ?? 3, ...subject, mobile_score: false }],
    ["Identity scrub",         "/identity/scrub",              { report_type: RT.IDENTITY_SCRUB ?? 6, ...subject }],
    ["Credit info",            "/report/credit_info",          { report_type: 8, ...credit }],
    ["Enhanced credit info",   "/report/credit_info_enhanced", { report_type: 10, ...credit }],
    ["Enh. credit info mobile", "/report/creditinfo/mobile",   { report_type: 11, ...credit }],
    ["Full enhanced credit",   "/report/credit_info",          { report_type: 12, ...credit }],
  ];

  console.log(`\n  Entitlement sweep (probe ID ${PROBE_ID} — no real credit file is bought):`);
  const tally: Record<Verdict, number> = { ENTITLED: 0, NOT_ENTITLED: 0, CREDENTIAL: 0, SIGNING: 0, CLOCK: 0, UNKNOWN: 0 };
  for (const [name, endpoint, body] of sweep) {
    const r = await probe(endpoint, body);
    tally[r.verdict]++;
    console.log(`    ${MARK[r.verdict]} ${name.padEnd(25)} ${String(r.code ?? "—").padEnd(6)} ${r.verdict.padEnd(13)} ${r.detail.slice(0, 58)}`);
  }

  // 3. Optional, opt-in, billable: one real identity verify.
  const realId = pick("CRB_REAL_ID");
  if (realId) {
    const r = await probe("/identity/verify", { report_type: 1, identity_number: realId, identity_type: "001" });
    console.log(`\n  ${MARK[r.verdict]} Real identity verify (${realId}) — ${r.code ?? "—"} ${r.detail.slice(0, 80)}`);
  } else {
    console.log("\n  · Real-ID lookup skipped (set CRB_REAL_ID in .env to run one billable check)");
  }

  // 4. Verdict. An un-entitled production subscription is a RED run: the keys
  //    are real but the LMS cannot pull a single report with them.
  console.log("");
  if (tally.SIGNING) console.log("  ✗ SIGNING — hash rejected. That is a bug in this repo, not a Metropol issue.");
  if (tally.CREDENTIAL) console.log("  ✗ CREDENTIAL — the public key is unknown or expired at the bureau.");
  if (tally.CLOCK) console.log("  ✗ CLOCK — this host is more than 45s from Metropol's time. Fix NTP.");
  if (tally.NOT_ENTITLED && !tally.ENTITLED) {
    console.log(
      "  ✗ NOT ENTITLED — keys authenticate (no E027/E004), but this subscription is\n" +
      "    authorized for NO report service on this port/version. Ask Metropol to confirm\n" +
      "    (a) the production port + API version, and (b) which report types are switched on.",
    );
  }
  const green = tally.ENTITLED > 0 && !tally.SIGNING && !tally.CREDENTIAL && !tally.CLOCK;
  console.log(`\n${green ? "✓ USABLE" : "✗ NOT USABLE"} — ${tally.ENTITLED}/${sweep.length} services entitled${healthy ? "" : ", host unreachable"}\n`);
  process.exit(green ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
