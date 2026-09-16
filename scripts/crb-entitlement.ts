// ─────────────────────────────────────────────────────────────────────────────
// WHICH METROPOL REPORTS IS THIS SUBSCRIPTION ACTUALLY ALLOWED TO PULL?
//
//   npm run crb:entitlement                  # all 14, production keys
//   npm run crb:entitlement -- --testbed     # the same sweep on the test keys
//   npm run crb:entitlement -- --json out.json
//
// ── WHY THIS IS FREE ─────────────────────────────────────────────────────────
// The probe identity is 550000055 — a dummy from the Developer Guide's test set
// that exists on no production file. An ENTITLED subscription therefore answers
// E017 "identity not found" (or a thin-file 200) instead of returning a credit
// report, so nothing is bought and nobody real is looked up. An UNENTITLED one
// answers E029 "unauthorized report" BEFORE it ever reaches the subject.
//
// That asymmetry is the whole measurement: entitlement is visible without
// spending a shilling, which means this can be re-run whenever a contract
// changes rather than once a quarter when somebody is brave enough to pay.
//
// It differs from scripts/verify-metropol-prod.ts, which sweeps eight endpoints
// as a HEALTH check. This sweeps the full catalogue — all fourteen report types,
// including 4, 5, 13, 14, 16 and 22 — because "how many reports can we resell"
// is a commercial question about the Interchange's bureau product, not a
// diagnostic about our keys.
//
// ── IT GOES OUT THROUGH THE RELAY ────────────────────────────────────────────
// Metropol answer only whitelisted source addresses and this workstation is not
// one, so the call egresses through CRB_RELAY_URL. Without it every probe would
// time out and the sweep would report a dead subscription that is perfectly
// healthy.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { writeFileSync } from "fs";
import { createHash } from "crypto";
import { CRB_REPORTS, REPORT_REASON, type CrbReportDef } from "../src/lib/crb/catalogue";
import { crbRelayEnabled, crbRelayFetch, crbRelayUrl } from "../src/lib/crb/relay";

const pick = (...names: string[]) => {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) return v.trim().replace(/^["']|["']$/g, "");
  }
  return "";
};

const TESTBED = process.argv.includes("--testbed");
const jsonOut = (() => {
  const i = process.argv.indexOf("--json");
  return i >= 0 ? process.argv[i + 1] : null;
})();

const publicKey = TESTBED
  ? "ijkqeymLEBUPMGopzugRixgGYaxuqNREvpLbjXLuBUfGSAFmkLWBQrcKBxmp"
  : pick("METROPOL_PUBLIC_KEY", "Metropol_Public_Key", "METROPOL_PUB_KEY");
const privateKey = TESTBED
  ? "tKuiFSoUrMUvFBocuKBSkXnEXRNTMR"
  : pick("METROPOL_PRIVATE_KEY", "Metropol_Private_Key", "Private_Key");

// The port IS the subscription: test is 5555, production 22225.
const HOST = pick("METROPOL_HOST") || "api.metropol.co.ke";
const PORT = TESTBED ? pick("METROPOL_TEST_PORT") || "5555" : pick("METROPOL_PORT") || "22225";
const VERSION = pick("METROPOL_VERSION") || "v2_1";

/** A dummy ID with no production credit file. Nothing real is pulled. */
const PROBE_ID = "550000055";

type Verdict = "ENTITLED" | "NOT_ENTITLED" | "CREDENTIAL" | "SIGNING" | "CLOCK" | "UNREACHABLE" | "UNKNOWN";

/**
 * WHERE the call failed is what tells us what it means.
 *
 * E029/E003/E016 are refusals by the SUBSCRIPTION and arrive before the subject
 * is ever considered. E017/E018/E011 mean the request reached the report service
 * itself, which is what "entitled" actually is. Everything else is our side.
 */
function classify(code: string | null, httpOk: boolean): Verdict {
  switch (code) {
    case "E026": case "E027": return "SIGNING";
    case "E002": case "E004": case "E030": return "CREDENTIAL";
    case "E003": case "E016": case "E019": case "E029": return "NOT_ENTITLED";
    case "E023": case "E024": case "E025": return "CLOCK";
    case null: return httpOk ? "ENTITLED" : "UNKNOWN";
    default: return "ENTITLED";
  }
}

type Probe = {
  code: number;
  key: string;
  name: string;
  endpoint: string;
  verdict: Verdict;
  apiCode: string | null;
  detail: string;
  ms: number;
  httpStatus: number | null;
};

/**
 * Bodies mirror the real client exactly (see src/lib/crb/metropol.ts).
 *
 * This matters more than it looks: report 3 takes `mobile_score` and NOT
 * `loan_amount`, and Metropol answers an unexpected parameter on /score/consumer
 * with E027 "Hash Mismatch" — which reads as a signing bug and is not one. A
 * sweep that sends the wrong body measures its own mistakes.
 */
function bodyFor(def: CrbReportDef): Record<string, unknown> {
  const subject = { identity_number: PROBE_ID, identity_type: "001" };
  const body: Record<string, unknown> = { report_type: def.code, ...subject };
  if (def.code === 3) body.mobile_score = false;
  if (def.needsLoanAmount) body.loan_amount = 20_000;
  if (def.needsReportReason) body.report_reason = REPORT_REASON.NEW_APPLICATION;
  return body;
}

async function probe(def: CrbReportDef): Promise<Probe> {
  const url = `https://${HOST}:${PORT}/${VERSION}${def.endpoint}`;
  const json = JSON.stringify(bodyFor(def));
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const ts =
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}` +
    `${p(d.getUTCMilliseconds(), 3)}${p(Math.floor(Math.random() * 1000), 3)}`;
  const headers = {
    "Content-Type": "application/json",
    "X-METROPOL-REST-API-KEY": publicKey,
    "X-METROPOL-REST-API-HASH": createHash("sha256").update(privateKey + json + publicKey + ts, "utf8").digest("hex"),
    "X-METROPOL-REST-API-TIMESTAMP": ts,
  };

  const started = Date.now();
  const base = { code: def.code, key: def.key, name: def.name, endpoint: def.endpoint };
  try {
    const res = crbRelayEnabled()
      ? await crbRelayFetch({ url, method: "POST", headers, body: json, timeoutMs: 30_000 })
      : await fetch(url, { method: "POST", headers, body: json, signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    const ms = Date.now() - started;

    let j: Record<string, unknown>;
    try {
      j = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { ...base, verdict: "UNKNOWN", apiCode: null, detail: `non-JSON HTTP ${res.status} — wrong port or version?`, ms, httpStatus: res.status };
    }

    const apiCode = j.api_code === null || j.api_code === undefined ? null : String(j.api_code);
    const desc = String(j.api_code_description ?? "");
    const verdict = j.has_error === true ? classify(apiCode, res.ok) : "ENTITLED";
    // A 200 with a payload is worth distinguishing from a 200 that is an empty
    // thin file: both prove entitlement, only one proves the report has content.
    const fields = Object.keys(j).length;
    return {
      ...base,
      verdict,
      apiCode,
      detail: desc || (j.has_error === false ? `answered · ${fields} fields` : `HTTP ${res.status}`),
      ms,
      httpStatus: res.status,
    };
  } catch (e) {
    return { ...base, verdict: "UNREACHABLE", apiCode: null, detail: e instanceof Error ? e.message.slice(0, 90) : String(e), ms: Date.now() - started, httpStatus: null };
  }
}

const MARK: Record<Verdict, string> = {
  ENTITLED: "\x1b[32m✓\x1b[0m", NOT_ENTITLED: "\x1b[33m✗\x1b[0m", CREDENTIAL: "\x1b[31m✗\x1b[0m",
  SIGNING: "\x1b[31m✗\x1b[0m", CLOCK: "\x1b[31m✗\x1b[0m", UNREACHABLE: "\x1b[31m·\x1b[0m", UNKNOWN: "\x1b[2m?\x1b[0m",
};

async function main() {
  console.log(`\n\x1b[1mMetropol entitlement sweep\x1b[0m — ${TESTBED ? "TESTBED" : "PRODUCTION"} → https://${HOST}:${PORT}/${VERSION}`);
  console.log(`  probe identity : ${PROBE_ID} \x1b[2m(no production file — nothing is bought)\x1b[0m`);
  console.log(`  egress         : ${crbRelayEnabled() ? `relay ${crbRelayUrl()}` : "\x1b[33mdirect from this host — likely not whitelisted\x1b[0m"}`);
  console.log(`  catalogue      : ${CRB_REPORTS.length} report types\n`);

  if (!publicKey || !privateKey) {
    console.error("✗ Metropol keys not found in .env (Metropol_Public_Key / Metropol_Private_Key)\n");
    process.exit(1);
  }

  // Serial, not parallel: fourteen simultaneous requests from one relay address
  // is the shape a bureau rate-limits, and a 429 would be misread as a refusal.
  const results: Probe[] = [];
  console.log("  code  report                             verdict        api    ms   detail");
  console.log("  " + "─".repeat(104));
  for (const def of CRB_REPORTS) {
    const r = await probe(def);
    results.push(r);
    console.log(
      `  ${String(r.code).padStart(4)}  ${r.name.padEnd(33)} ${MARK[r.verdict]} ${r.verdict.padEnd(12)}` +
        ` ${String(r.apiCode ?? "—").padEnd(6)} ${String(r.ms).padStart(5)}  ${r.detail.slice(0, 46)}`,
    );
  }

  const by = (v: Verdict) => results.filter((r) => r.verdict === v);
  const entitled = by("ENTITLED");
  const refused = by("NOT_ENTITLED");

  console.log(`\n\x1b[1m  ${entitled.length} of ${CRB_REPORTS.length} report types entitled\x1b[0m`);
  console.log(`  entitled : ${entitled.map((r) => r.code).join(", ") || "none"}`);
  if (refused.length) console.log(`  refused  : ${refused.map((r) => `${r.code} (${r.apiCode})`).join(", ")}`);
  for (const v of ["CREDENTIAL", "SIGNING", "CLOCK", "UNREACHABLE", "UNKNOWN"] as const) {
    const rows = by(v);
    if (rows.length) console.log(`  ${v.toLowerCase().padEnd(9)}: ${rows.map((r) => r.code).join(", ")}`);
  }

  if (jsonOut) {
    writeFileSync(
      jsonOut,
      JSON.stringify(
        { sweptAt: new Date().toISOString(), environment: TESTBED ? "testbed" : "production", host: HOST, port: PORT, version: VERSION, probeId: PROBE_ID, results },
        null,
        2,
      ),
    );
    console.log(`\n  written: ${jsonOut}`);
  }
  console.log("");
}

main().catch((e) => {
  console.error("\n\x1b[31m" + (e instanceof Error ? e.message : String(e)) + "\x1b[0m\n");
  process.exit(1);
});
