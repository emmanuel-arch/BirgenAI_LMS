// ─────────────────────────────────────────────────────────────────────────────
// Live smoke-test for the Metropol CRB client (src/lib/crb/metropol.ts).
//
//   npm run test:crb
//
// Uses the REAL client code path (same signing, same mapping the LMS uses) so a
// green run proves the integration end-to-end, not a throwaway script. Reads the
// credentials from env; falls back to the Micromart TEST keys so it works out of
// the box on the testbed.
//
//   METROPOL_PUBLIC_KEY  METROPOL_PRIVATE_KEY  METROPOL_HOST
//   METROPOL_PORT (5555) METROPOL_VERSION (v2_1)
//
// Dummy testbed IDs (Developer Guide §4.3): 550000055, 660000066, 770000077,
// 880000088, 990000099. 770/990 carry a populated credit file; 55/66 are clean.
// ─────────────────────────────────────────────────────────────────────────────
import type { CrbConfig } from "@/lib/vault/integrations";
import { health, verifyIdentity, metroScore, delinquencyStatus, pullMetropol, MetropolError } from "@/lib/crb/metropol";

const cfg: CrbConfig = {
  bureau: "metropol",
  publicKey: process.env.METROPOL_PUBLIC_KEY || "ijkqeymLEBUPMGopzugRixgGYaxuqNREvpLbjXLuBUfGSAFmkLWBQrcKBxmp",
  privateKey: process.env.METROPOL_PRIVATE_KEY || "tKuiFSoUrMUvFBocuKBSkXnEXRNTMR",
  host: process.env.METROPOL_HOST || "api.metropol.co.ke",
  port: process.env.METROPOL_PORT || "5555",
  apiVersion: process.env.METROPOL_VERSION || "v2_1",
  reportDepth: "full",
};

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (cond) pass++; else fail++;
};

async function main() {
  console.log(`\nMetropol CRB live smoke-test → https://${cfg.host}:${cfg.port}/${cfg.apiVersion}\n`);

  // 1. Health
  try {
    const h = (await health(cfg)) as Record<string, unknown>;
    ok("Health check", h.has_error === false, String(h.api_code_description ?? h.api_code ?? ""));
  } catch (e) {
    ok("Health check", false, e instanceof Error ? e.message : String(e));
  }

  // 2. Identity verification (report 1) — cheap, proves signing + routing.
  try {
    const v = (await verifyIdentity(cfg, { identityNumber: "880000088" })) as Record<string, unknown>;
    ok("Identity verify (880000088)", !!(v.first_name || v.last_name), `${v.first_name ?? ""} ${v.last_name ?? ""} · DOB ${v.date_of_birth ?? v.dob ?? "?"}`);
  } catch (e) {
    ok("Identity verify", false, e instanceof Error ? e.message : String(e));
  }

  // 3. Metro score (report 3). Distinct IDs per report_type avoid the E409
  //    "duplicate within 60s" the API enforces on repeated identical pulls.
  try {
    const s = (await metroScore(cfg, { identityNumber: "990000099" })) as Record<string, unknown>;
    ok("Metro Score (990000099)", "credit_score" in s, `score=${s.credit_score} as_at=${s.as_at}`);
  } catch (e) {
    ok("Metro Score", false, e instanceof Error ? e.message : String(e));
  }

  // 4. Delinquency (report 2)
  try {
    const d = (await delinquencyStatus(cfg, { identityNumber: "660000066", loanAmount: 20000 })) as Record<string, unknown>;
    ok("Delinquency (660000066)", typeof d.delinquency_code === "string", `${d.delinquency_code} — ${d.delinquency_summary ?? ""}`);
  } catch (e) {
    ok("Delinquency", false, e instanceof Error ? e.message : String(e));
  }

  // 5. The orchestrated pull the LMS actually uses (report 12 + 3 + 11), mapped.
  try {
    const r = await pullMetropol(cfg, { identityNumber: "770000077" }, { loanAmount: 20000, depth: "full" });
    ok("pullMetropol map (770000077)", r.accounts.length > 0 || r.score != null,
      `reports=[${r.reportsPulled.join(", ")}] score=${r.score} accounts=${r.accounts.length} npl=${r.accountsSummary.npl} delinq=${r.delinquencyText} identity=${r.identity?.name ?? "—"}`);
    console.log(`      exposure=KES ${Math.round(r.accountsSummary.totalExposure).toLocaleString()} worstArrears=${r.accountsSummary.worstArrearsDays}d productMix=${r.productMix.map((p) => `${p.product}×${p.count}`).join(", ") || "—"}`);
  } catch (e) {
    ok("pullMetropol map", false, e instanceof Error ? e.message : String(e));
  }

  // 6. Thin file behaves as a valid clean result (E017 → no accounts, not a crash).
  try {
    const r = await pullMetropol(cfg, { identityNumber: "550000055" }, { loanAmount: 20000, depth: "standard" });
    ok("Thin file (550000055) resolves cleanly", true, `accounts=${r.accounts.length} thinFile=${r.thinFile} score=${r.score}`);
  } catch (e) {
    // A raw E017 escaping here would be the bug we're guarding against.
    ok("Thin file resolves cleanly", e instanceof MetropolError && e.apiCode === "E017" ? false : false, e instanceof Error ? e.message : String(e));
  }

  console.log(`\n${fail === 0 ? "✓ ALL PASSED" : "✗ FAILURES"} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
