// ─────────────────────────────────────────────────────────────────────────────
// ONE REAL IDENTITY VERIFICATION (Metropol report type 1), with retries.
//
//   npm run crb:identity -- 39362808
//   CRB_ID=39362808 npm run crb:identity
//
// This is the smallest thing that can prove the production subscription works
// end to end: report 1 is the cheapest report Metropol sells, it is the one
// they confirmed by email they had tested successfully against our keys, and it
// returns a name and a date of birth rather than a credit file — so a green run
// here is unambiguous and a red one is diagnosable.
//
// IT USES THE REAL CLIENT PATH. verifyIdentity() from lib/crb/metropol is what
// the console calls when a loan officer presses "Run CRB check", including the
// relay hop. A pass here is a pass in the product, not in a throwaway script.
//
// ── WHY IT RETRIES, AND WHY NOT IN A TIGHT LOOP ──────────────────────────────
// Metropol rejects the SAME (identity, report_type, params) inside 60 seconds
// with E409 "Duplicate Request". So a naive retry loop turns one recoverable
// blip into a wall of E409s that looks like a hard failure and is really just
// us hammering. Anything retryable therefore waits out that window before the
// next attempt. Non-retryable answers (E003, E027, E004) stop immediately —
// re-asking a question the bureau has already answered definitively is noise.
//
// BILLING: report 1 on a REAL identity is a real, billable lookup. This script
// takes the ID as an explicit argument and never invents one, so it cannot be
// run by accident. The non-billable sweep is `npm run test:crb:prod`, which
// probes with 550000055 — an ID that has no file.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import type { CrbConfig } from "@/lib/vault/integrations";
import { verifyIdentity, MetropolError } from "@/lib/crb/metropol";
import { crbRelayEnabled, crbRelayUrl } from "@/lib/crb/relay";

const pick = (...names: string[]) => {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) return v.trim().replace(/^["']|["']$/g, "");
  }
  return "";
};

const identityNumber = (process.argv[2] || pick("CRB_ID", "CRB_REAL_ID")).replace(/\D/g, "");
const identityType = pick("CRB_ID_TYPE") || "001"; // 001 = National ID

const cfg: CrbConfig = {
  bureau: "metropol",
  publicKey: pick("METROPOL_PUBLIC_KEY", "Metropol_Public_Key", "METROPOL_PUB_KEY"),
  privateKey: pick("METROPOL_PRIVATE_KEY", "Metropol_Private_Key", "Private_Key"),
  host: pick("METROPOL_HOST") || "api.metropol.co.ke",
  port: pick("METROPOL_PORT") || "22225",
  apiVersion: pick("METROPOL_VERSION") || "v2_1",
  reportDepth: "full",
};

const fp = (k: string) => (k ? `${k.length} chars · ${k.slice(0, 4)}…${k.slice(-4)}` : "MISSING");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Attempts, and how long to wait before the next one. */
const MAX_ATTEMPTS = Number(pick("CRB_ATTEMPTS") || 6);
const DUPLICATE_WINDOW_MS = 65_000; // E409 clears at 60s; 65 gives the clock room.
const TRANSPORT_BACKOFF_MS = 10_000;

async function main() {
  if (!identityNumber) {
    console.error(
      "\nUsage: npm run crb:identity -- <national-id>\n" +
        "       CRB_ID=<national-id> npm run crb:identity\n\n" +
        "Refusing to run without an explicit ID — report 1 on a real identity is billable.\n",
    );
    process.exit(1);
  }
  if (!cfg.publicKey || !cfg.privateKey) {
    console.error("\n✗ Metropol keys not found. Expected Metropol_Public_Key / Metropol_Private_Key in .env\n");
    process.exit(1);
  }

  console.log(`\nMetropol identity verification (report 1) → https://${cfg.host}:${cfg.port}/${cfg.apiVersion}`);
  console.log(`  identity : ${identityNumber} (type ${identityType})`);
  console.log(`  public   : ${fp(cfg.publicKey)}`);
  console.log(`  egress   : ${crbRelayEnabled() ? `via CRB relay ${crbRelayUrl()}` : "direct from this host"}\n`);

  if (!crbRelayEnabled()) {
    console.log(
      "  ⚠ No relay configured. Port 22225 does not answer unregistered source\n" +
        "    addresses, so unless THIS machine is whitelisted every attempt below will\n" +
        "    time out at the transport. Set CRB_RELAY_URL and CRB_RELAY_SECRET.\n",
    );
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const label = `  attempt ${attempt}/${MAX_ATTEMPTS}`;
    try {
      const started = Date.now();
      const v = (await verifyIdentity(cfg, { identityNumber, identityType })) as Record<string, unknown>;
      const ms = Date.now() - started;

      // `surname` on production, `last_name` on the testbed. See hoistData().
      const name = [v.first_name, v.other_name, v.last_name ?? v.surname]
        .filter(Boolean)
        .join(" ")
        .trim();
      console.log(`${label} — \x1b[32m✓ REPORT 1 RETURNED\x1b[0m in ${ms}ms\n`);
      console.log(`    name          : ${name || "(not returned)"}`);
      console.log(`    date of birth : ${v.date_of_birth ?? v.dob ?? "(not returned)"}`);
      console.log(`    id number     : ${v.identity_number ?? identityNumber}`);
      if (v.gender) console.log(`    gender        : ${v.gender}`);
      if (v.trx_id) console.log(`    trx id        : ${v.trx_id}`);
      console.log(`\n    raw: ${JSON.stringify(v)}\n`);
      console.log("✓ PRODUCTION SUBSCRIPTION IS LIVE — keys, port, whitelist and signing all good.\n");
      process.exit(0);
    } catch (e) {
      const me = e instanceof MetropolError ? e : null;
      const code = me?.apiCode ?? "—";
      console.log(`${label} — ✗ ${code} ${me?.message ?? (e instanceof Error ? e.message : String(e))}`);

      // A definitive "no" is not worth re-asking.
      if (me && !me.retryable) {
        console.log(`\n  ${explain(me.apiCode)}\n`);
        process.exit(1);
      }
      if (attempt === MAX_ATTEMPTS) break;

      const delay = me?.apiCode === "E409" ? DUPLICATE_WINDOW_MS : TRANSPORT_BACKOFF_MS;
      console.log(`     waiting ${Math.round(delay / 1000)}s before the next attempt…`);
      await wait(delay);
    }
  }

  console.log("\n✗ Gave up. Nothing above was a definitive bureau rejection, so this is a\n" +
    "  transport or entitlement problem rather than a bad identity number.\n");
  process.exit(1);
}

function explain(code: string | null): string {
  switch (code) {
    case "E003":
      return "E003 Not Authorized — the keys authenticate but this subscription is not entitled\n  " +
        "on this port. Confirm METROPOL_PORT is 22225 (production), not 5555 (test).";
    case "E026":
    case "E027":
      return "E026/E027 hash problem — the signature was rejected. That is a bug in this repo,\n  " +
        "not a Metropol issue. Check the body is sent as the exact bytes that were hashed.";
    case "E002":
    case "E004":
      return "E002/E004 — the public key is empty, unknown or expired at the bureau.";
    case "E017":
      return "E017 No Account Information — the identity exists but has no credit file. For\n  " +
        "report 1 this still means the subscription answered, which is the thing being tested.";
    case "E018":
      return "E018 — the bureau does not recognise this identity number. On TEST keys this is\n  " +
        "expected for any real ID; only the five sandbox IDs resolve there.";
    default:
      return `${code ?? "unknown"} — see the Referencing API guide §6 for this code.`;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
