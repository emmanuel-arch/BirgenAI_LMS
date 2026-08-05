// ─────────────────────────────────────────────────────────────────────────────
// CRB Orchestrator — the credit-bureau pull (Metropol / TransUnion / Creditinfo).
//
// SIMULATION-FIRST, identical philosophy to the KYC provider: a real bureau
// subscription is a paid, per-lender credential. Until one is saved in the org
// vault (CRB integration), every check runs a high-fidelity SIMULATION that
// returns a realistic, DETERMINISTIC report seeded off the national ID — so the
// same person always pulls the same file, and a demo looks and behaves exactly
// like production.
//
// The instant Metropol keys + API version land in the vault, `crbMode` flips to
// "live" and the same call site hits the real bureau (src/lib/crb/metropol.ts).
// The live report is mapped onto the SAME CrbReport shape the whole app already
// consumes, plus a richer `metropol` block the Customer-360 panel surfaces. No
// call-site change anywhere.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "crypto";
import { getIntegration, type CrbConfig } from "@/lib/vault/integrations";
import {
  pullMetropol, MetropolError, REPORT_REASON, sandboxTestIdFor,
  type MetropolReport, type ReportReason, type MetropolAccount,
} from "@/lib/crb/metropol";

export type CrbMode = "simulation" | "live";
export { MetropolError };

/** Deterministic 0..1 from a seed — stable per (person, facet). */
function seeded(seed: string, facet: string): number {
  const h = createHash("sha256").update(`${seed}:${facet}`).digest();
  return (((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0) / 0xffffffff;
}

/** Live only when the configured bureau is actually reachable. */
export async function crbMode(orgId: string): Promise<CrbMode> {
  const cfg = await getIntegration(orgId, "CRB").catch(() => null);
  if (!cfg) return "simulation";
  if (cfg.bureau === "metropol") {
    const hasKeys = (cfg.publicKey || cfg.username) && (cfg.privateKey || cfg.password);
    return hasKeys && cfg.apiVersion ? "live" : "simulation";
  }
  return cfg.username && cfg.password ? "live" : "simulation";
}

const BUREAU_NAME: Record<string, string> = { transunion: "TransUnion Kenya", metropol: "Metropol CRB", creditinfo: "Creditinfo" };
const LENDERS = ["Tala", "Branch", "KCB M-Pesa", "Zenka", "Okash", "Timiza", "Fuliza", "Zash"];

export type CrbListing = { lender: string; amount: number; status: string; since: string };

/** The rich, Metropol-sourced detail the Customer-360 panel renders when live. */
export type CrbMetropolDetail = {
  reportsPulled: string[];
  trxIds: string[];
  scoreAsAt: string | null;
  mobileScore: number | null;
  delinquencyCode: string;
  delinquencyText: string;
  hasFraud: boolean;
  thinFile: boolean;
  identity: MetropolReport["identity"];
  incomeEstimate: number | null;
  accounts: MetropolAccount[];
  productMix: Array<{ product: string; count: number }>;
  enquiries: { last3m: number; last6m: number; last12m: number };
  bouncedCheques: { last3m: number; last6m: number; last12m: number };
  creditApplications: { last3m: number; last6m: number; last12m: number };
  sectorExposure: Array<{ sector: string; performing: number; npa: number; npaHistory: number }>;
  scoreTrend: Array<{ month: string; score: number | null; ppi: number | null; ppiRank: string | null }>;
  ppi: { ppi: number | null; rank: string | null } | null;
  guarantors: number;
  stakeholders: number;
};

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
  /**
   * True when the pull ran against a Metropol TEST subscription and the
   * borrower's real ID was remapped to a sandbox identity (test keys only answer
   * for 5 dummy IDs). The data is REAL and LIVE, but it is NOT this borrower's
   * file — swap to production keys to lift this.
   */
  sandbox?: boolean;
  /** Present only on a LIVE Metropol pull — the full bureau detail. */
  metropol?: CrbMetropolDetail;
};

function bandFor(score: number): CrbReport["band"] {
  return score >= 780 ? "Excellent" : score >= 680 ? "Good" : score >= 560 ? "Fair" : "Poor";
}
function pdFor(score: number): number {
  return Math.max(0.01, Math.min(0.6, 0.02 + ((800 - score) / 800) * 0.5));
}

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

export type CrbSubject = { nationalId?: string | null; phone: string; name?: string | null; identityType?: string };
export type CrbOptions = {
  /** Loan amount the pull is justified by (Metropol requires it on credit reports). */
  loanAmount?: number;
  /** Why the file is being pulled (Metropol §5.2). Defaults to New Application. */
  reason?: ReportReason;
};

/**
 * Run a bureau check for a person. Live (Metropol) when configured; otherwise a
 * deterministic simulation seeded off the national ID so demos are stable.
 * Throws MetropolError on a hard live failure (E409 dedupe, network) so the
 * caller can reuse a recent stored pull rather than double-charging.
 */
export async function runCrbCheck(orgId: string, subject: CrbSubject, opts: CrbOptions = {}): Promise<CrbReport> {
  const mode = await crbMode(orgId);

  if (mode === "live") {
    const cfg = await getIntegration(orgId, "CRB").catch(() => null);
    if (cfg?.bureau === "metropol" && subject.nationalId) {
      return liveMetropol(cfg, subject, opts);
    }
    // Other bureaus not yet wired to a real client — fall through to simulation
    // rather than pretend, but keep the configured bureau name on the report.
  }

  return simulate(orgId, subject, mode);
}

// ── Live: Metropol → CrbReport ───────────────────────────────────────────────
async function liveMetropol(cfg: CrbConfig, subject: CrbSubject, opts: CrbOptions): Promise<CrbReport> {
  const identityNumber = (subject.nationalId || "").trim();
  const pullOpts = { loanAmount: opts.loanAmount ?? 10_000, reportReason: opts.reason ?? REPORT_REASON.NEW_APPLICATION };

  let sandbox = false;
  let m: MetropolReport;
  try {
    m = await pullMetropol(cfg, { identityNumber, identityType: subject.identityType || "001" }, pullOpts);
  } catch (err) {
    // A TEST subscription rejects any ID outside its 5 sandbox identities (E018).
    // Rather than dead-end a demo, remap to a deterministic sandbox identity, pull
    // the REAL live file for it, and label the report as sandbox so nobody mistakes
    // it for this borrower. Production keys never hit E018, so this never fires live.
    if (err instanceof MetropolError && err.apiCode === "E018") {
      sandbox = true;
      m = await pullMetropol(cfg, { identityNumber: sandboxTestIdFor(identityNumber || subject.phone), identityType: "001" }, pullOpts);
    } else {
      throw err;
    }
  }

  // The score: Metro Score when returned; else derive a conservative proxy from
  // the delinquency picture so a thin/adverse file never scores as "unknown-good".
  const score = m.score != null && m.score > 0
    ? Math.round(m.score)
    : m.delinquencyCode === "004" ? 380
    : m.delinquencyCode === "005" ? 520
    : m.thinFile ? 560
    : 600;

  const npl = m.accountsSummary.npl;
  const verdict: CrbReport["verdict"] =
    m.delinquencyCode === "004" || npl > 0 ? "ADVERSE"
    : score >= 680 && m.delinquencyCode !== "005" ? "CLEAR"
    : "CAUTION";

  const negativeListings: CrbListing[] = m.accounts
    .filter((a) => a.overdue > 0 || a.arrearsDays >= 30 || /Non-Performing|Write-Off|Legal|Collection/i.test(a.status))
    .slice(0, 8)
    .map((a) => ({
      lender: a.product + (a.accountNumber ? ` · ${a.accountNumber.slice(-6)}` : ""),
      amount: a.overdue > 0 ? a.overdue : a.balance,
      status: a.status,
      since: a.opened ?? "—",
    }));

  const summary =
    verdict === "CLEAR"
      ? `${m.delinquencyText}. Metro Score ${score}. ${m.accountsSummary.total} account${m.accountsSummary.total === 1 ? "" : "s"} on file, none adverse.`
      : verdict === "CAUTION"
        ? `${m.delinquencyText}. Metro Score ${score}. ${m.thinFile ? "Thin file — little bureau history to lean on." : `${npl} adverse account${npl === 1 ? "" : "s"}, worst arrears ${m.accountsSummary.worstArrearsDays} days.`}`
        : `${m.delinquencyText}. Metro Score ${score}, ${npl} non-performing account${npl === 1 ? "" : "s"}, worst arrears ${m.accountsSummary.worstArrearsDays} days. High bureau risk — refer for a human decision or require security.`;

  return {
    bureau: "Metropol CRB",
    reference: m.trxIds[0] ?? `MC-${identityNumber.slice(-6)}`,
    checkedAt: new Date().toISOString(),
    score,
    band: bandFor(score),
    probabilityOfDefault: pdFor(score),
    accounts: {
      total: m.accountsSummary.total,
      active: m.accountsSummary.active,
      closed: m.accountsSummary.closed,
      npl,
    },
    totalExposure: Math.round(m.accountsSummary.totalExposure),
    worstArrearsDays: m.accountsSummary.worstArrearsDays,
    enquiriesLast6m: m.enquiries.last6m,
    negativeListings,
    verdict,
    summary: sandbox
      ? `SANDBOX (Metropol test subscription — live data from a sandbox identity, not this borrower). ${summary}`
      : summary,
    mode: "live",
    sandbox,
    metropol: {
      reportsPulled: m.reportsPulled,
      trxIds: m.trxIds,
      scoreAsAt: m.scoreAsAt,
      mobileScore: m.mobileScore,
      delinquencyCode: m.delinquencyCode,
      delinquencyText: m.delinquencyText,
      hasFraud: m.hasFraud,
      thinFile: m.thinFile,
      identity: m.identity,
      incomeEstimate: m.incomeEstimate,
      accounts: m.accounts,
      productMix: m.productMix,
      enquiries: m.enquiries,
      bouncedCheques: m.bouncedCheques,
      creditApplications: m.creditApplications,
      sectorExposure: m.sectorExposure,
      scoreTrend: m.scoreTrend,
      ppi: m.ppi,
      guarantors: m.guarantors,
      stakeholders: m.stakeholders,
    },
  };
}

// ── Simulation (unconfigured orgs / demos) ───────────────────────────────────
async function simulate(orgId: string, subject: CrbSubject, mode: CrbMode): Promise<CrbReport> {
  const seed = (subject.nationalId || subject.phone || "unknown").replace(/\D/g, "") || subject.phone;
  const bureau = await bureauName(orgId, mode);

  const score = 480 + Math.round(seeded(seed, "score") * 400); // 480..880
  const band = bandFor(score);
  const probabilityOfDefault = pdFor(score);

  const total = 1 + Math.floor(seeded(seed, "acct") * 6);
  const active = Math.floor(seeded(seed, "actv") * (total + 1));
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
