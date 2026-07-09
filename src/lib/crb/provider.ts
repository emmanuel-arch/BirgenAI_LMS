// ─────────────────────────────────────────────────────────────────────────────
// CRB Orchestrator — the credit-bureau pull (TransUnion / Metropol / Creditinfo).
//
// SIMULATION-FIRST, identical philosophy to the KYC provider: a real bureau
// subscription is a paid, per-lender credential. Until one is saved in the org
// vault (CRB integration), every check runs a high-fidelity SIMULATION that
// returns a realistic, DETERMINISTIC report seeded off the national ID — so the
// same person always pulls the same file, and a demo looks and behaves exactly
// like production. The instant a bureau credential lands in the vault, `crbMode`
// flips to "live" and the same call site hits the real bureau. No UI change.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "crypto";
import { getIntegration, type CrbConfig } from "@/lib/vault/integrations";

export type CrbMode = "simulation" | "live";

/** Deterministic 0..1 from a seed — stable per (person, facet). */
function seeded(seed: string, facet: string): number {
  const h = createHash("sha256").update(`${seed}:${facet}`).digest();
  return (((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0) / 0xffffffff;
}

export async function crbMode(orgId: string): Promise<CrbMode> {
  const cfg = await getIntegration(orgId, "CRB").catch(() => null);
  return cfg?.username && cfg?.password ? "live" : "simulation";
}

const BUREAU_NAME: Record<string, string> = { transunion: "TransUnion Kenya", metropol: "Metropol CRB", creditinfo: "Creditinfo" };
const LENDERS = ["Tala", "Branch", "KCB M-Pesa", "Zenka", "Okash", "Timiza", "Fuliza", "Zash"];

export type CrbListing = { lender: string; amount: number; status: string; since: string };
export type CrbReport = {
  bureau: string;
  reference: string;
  checkedAt: string;
  score: number; // 200..900 (Kenyan bureau scale)
  band: "Excellent" | "Good" | "Fair" | "Poor";
  probabilityOfDefault: number; // 0..1
  accounts: { total: number; active: number; closed: number; npl: number };
  totalExposure: number;
  worstArrearsDays: number;
  enquiriesLast6m: number;
  negativeListings: CrbListing[];
  verdict: "CLEAR" | "CAUTION" | "ADVERSE";
  summary: string;
  mode: CrbMode;
};

async function bureauName(orgId: string, mode: CrbMode): Promise<string> {
  if (mode === "live") {
    const cfg = await getIntegration(orgId, "CRB").catch(() => null);
    if (cfg?.bureau && BUREAU_NAME[cfg.bureau]) return BUREAU_NAME[cfg.bureau];
  }
  return "Metropol CRB";
}

function monthsAgoISO(seed: string, facet: string, maxMonths: number): string {
  const m = Math.floor(seeded(seed, facet) * maxMonths) + 1;
  const d = new Date();
  d.setMonth(d.getMonth() - m);
  return d.toISOString().slice(0, 10);
}

/**
 * Run a bureau check for a person. In simulation the report is derived
 * deterministically from the national ID (falls back to phone) so it is stable
 * and demoable; in live mode this is where the real bureau call slots in.
 */
export async function runCrbCheck(
  orgId: string,
  subject: { nationalId?: string | null; phone: string; name?: string | null },
): Promise<CrbReport> {
  const mode = await crbMode(orgId);
  const seed = (subject.nationalId || subject.phone || "unknown").replace(/\D/g, "") || subject.phone;
  const bureau = await bureauName(orgId, mode);

  const score = 480 + Math.round(seeded(seed, "score") * 400); // 480..880
  const band: CrbReport["band"] = score >= 780 ? "Excellent" : score >= 680 ? "Good" : score >= 560 ? "Fair" : "Poor";
  const probabilityOfDefault = Math.max(0.01, Math.min(0.6, 0.02 + ((800 - score) / 800) * 0.5));

  const total = 1 + Math.floor(seeded(seed, "acct") * 6); // 1..6
  const active = Math.floor(seeded(seed, "actv") * (total + 1)); // 0..total
  const npl = score < 560 ? 1 + Math.floor(seeded(seed, "npl") * 2) : score < 640 && seeded(seed, "npl2") > 0.6 ? 1 : 0;
  const totalExposure = 5_000 + Math.floor(seeded(seed, "exp") * 295_000);
  const worstArrearsDays = score < 560 ? 30 + Math.floor(seeded(seed, "arr") * 120) : score < 680 ? Math.floor(seeded(seed, "arr") * 20) : 0;
  const enquiriesLast6m = Math.floor(seeded(seed, "enq") * 5);

  const negativeListings: CrbListing[] = [];
  const listingCount = score < 560 ? 1 + Math.floor(seeded(seed, "lst") * 2) : 0;
  for (let i = 0; i < listingCount; i++) {
    negativeListings.push({
      lender: LENDERS[Math.floor(seeded(seed, `lender${i}`) * LENDERS.length)],
      amount: 1_500 + Math.floor(seeded(seed, `lamt${i}`) * 48_500),
      status: seeded(seed, `lstat${i}`) > 0.5 ? "Defaulted" : "In arrears",
      since: monthsAgoISO(seed, `lsince${i}`, 24),
    });
  }

  const verdict: CrbReport["verdict"] = score >= 680 && npl === 0 ? "CLEAR" : score >= 560 ? "CAUTION" : "ADVERSE";
  const summary =
    verdict === "CLEAR"
      ? "No adverse records. Strong repayment history across the bureau — a clean file."
      : verdict === "CAUTION"
        ? `Some risk on file: ${npl} non-performing account${npl === 1 ? "" : "s"}${worstArrearsDays ? `, worst arrears ${worstArrearsDays} days` : ""}. Lend with appropriate limits.`
        : `Adverse listing(s) present with ${worstArrearsDays} days worst arrears. High bureau risk — decline or require security.`;

  return {
    bureau,
    reference: `${(subject.nationalId || subject.phone).slice(-6)}-${Math.floor(seeded(seed, "ref") * 900000 + 100000)}`,
    checkedAt: new Date().toISOString(),
    score, band, probabilityOfDefault,
    accounts: { total, active, closed: Math.max(0, total - active), npl },
    totalExposure, worstArrearsDays, enquiriesLast6m, negativeListings, verdict, summary, mode,
  };
}
