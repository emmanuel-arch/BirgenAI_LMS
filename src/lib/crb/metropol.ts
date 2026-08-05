// ─────────────────────────────────────────────────────────────────────────────
// Metropol CRB — the real bureau client (MA Kenya API, Developer Guide v3.8).
//
// This is the live counterpart to the simulation in provider.ts. It speaks the
// Metropol REST protocol end-to-end:
//   • Auth is a per-call SHA-256 signature. Concatenate, as a UTF-8 string,
//       private_key + json_body + public_key + timestamp
//     and send the hex digest in X-METROPOL-REST-API-HASH, the public key in
//     X-METROPOL-REST-API-KEY, and a 20-char UTC timestamp in
//     X-METROPOL-REST-API-TIMESTAMP. The clock must be within 45s of Metropol's.
//   • The body must be COMPACT JSON (no spaces) and the SAME bytes we hash and
//     send — so we serialize once and reuse the string.
//   • Base URL is https://<host>:<port>/<version> — host/port/version are all
//     per-subscription values Metropol assigns (Micromart: api.metropol.co.ke,
//     port 5555, version v2_1). They live in the org vault, never in code.
//
// LIVE-VERIFIED against the testbed (dummy IDs 55…/66…/77…/88…/99…) — every
// report type here returned 200 with the shapes this file maps. Two behaviours
// the guide under-documents but the wire enforces, handled below:
//   • E409 "Duplicate Request": the SAME (identity, report_type, params) inside
//     60 seconds is rejected. The provider reuses a recent stored pull rather
//     than re-hitting; a raw E409 is surfaced as a typed, retryable error.
//   • `api_code` is sometimes an int (200) and sometimes a string ("E017"),
//     and money fields arrive as strings ("15220.00000"). Both normalized here.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "crypto";
import type { CrbConfig } from "@/lib/vault/integrations";

// ── Appendix maps (Developer Guide §5) ───────────────────────────────────────
export const PRODUCT_TYPE: Record<number, string> = {
  1: "Unknown", 2: "Current Account", 3: "Loan Account", 4: "Credit Card",
  5: "Line of Credit", 6: "Revolving Credit", 7: "Overdraft", 8: "Credit Card",
  9: "Business Working Capital", 10: "Business Expansion Loan", 11: "Mortgage",
  12: "Asset Finance Loan", 13: "Trade Finance Facility", 14: "Personal Loan",
  18: "Mobile Banking Loan", 19: "Other",
};

// account_status arrives either as a word ("Active") or the single-letter code.
export const ACCOUNT_STATUS: Record<string, string> = {
  "-": "Unknown", A: "Closed", B: "Dormant", C: "Performing", D: "Non-Performing",
  E: "Write-Off", F: "Legal", G: "Collection", H: "Active", I: "Terms Extended",
  J: "Early Settlement", K: "Fully Settled", L: "Revoked", M: "Suspended",
  P: "Paid Up", Q: "Disability/Deceased/Insurance Claim", R: "Deferred", N: "Not Updated",
};

export const DELINQUENCY: Record<string, string> = {
  "001": "Identity not found",
  "002": "No account information",
  "003": "No delinquency (clean)",
  "004": "Currently delinquent",
  "005": "Historical delinquency",
};

export const IDENTITY_TYPE: Record<string, string> = {
  "001": "National ID", "002": "Passport", "003": "Service ID",
  "004": "Alien Registration", "005": "Company/Business Registration",
};

// Report reason (Developer Guide §5.2) — every credit pull must state WHY.
export const REPORT_REASON = {
  NEW_APPLICATION: 1,
  REVIEW_EXISTING: 2,
  VERIFY_DETAILS: 3,
  CUSTOMER_REQUEST: 4,
} as const;
export type ReportReason = (typeof REPORT_REASON)[keyof typeof REPORT_REASON];

// Every report type the API exposes (Developer Guide §5.1). Kept complete so the
// full surface is reachable; the orchestrator uses the high-value subset.
export const REPORT_TYPE = {
  IDENTITY_VERIFY: 1,
  DELINQUENCY: 2,
  METRO_SCORE: 3,
  PDF_REPORT: 4,
  JSON_REPORT: 5,
  IDENTITY_SCRUB: 6,
  CREDIT_INFO: 8,
  ENHANCED_CREDIT_INFO: 10,
  ENHANCED_CREDIT_INFO_MOBILE: 11,
  FULL_ENHANCED_CREDIT_INFO: 12,
  MINIFIED_CREDIT_INFO: 13,
  FULL_JSON_REPORT: 14,
  ACCOUNTS_SUMMARY: 16,
  ACCOUNTS_INFO: 22,
} as const;

const ENDPOINT = {
  IDENTITY_VERIFY: "/identity/verify",
  DELINQUENCY: "/delinquency/status",
  METRO_SCORE: "/score/consumer",
  PDF_REPORT: "/report/pdf",
  JSON_REPORT: "/report/json",
  IDENTITY_SCRUB: "/identity/scrub",
  CREDIT_INFO: "/report/credit_info",
  ENHANCED_CREDIT_INFO: "/report/credit_info_enhanced",
  ENHANCED_CREDIT_INFO_MOBILE: "/report/creditinfo/mobile",
  HEALTH: "/health",
} as const;

// ── Wire helpers ─────────────────────────────────────────────────────────────

export class MetropolError extends Error {
  constructor(
    message: string,
    readonly apiCode: string | null,
    readonly httpStatus: number,
    /** E409 (dedupe) and E025 (time mismatch) are worth retrying; most aren't. */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "MetropolError";
  }
}

type MetropolBase = { host: string; port: string; version: string; publicKey: string; privateKey: string };

function resolveBase(cfg: CrbConfig): MetropolBase {
  const host = (cfg.host || "api.metropol.co.ke").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const port = String(cfg.port || "5555");
  const version = (cfg.apiVersion || "").trim().replace(/^\/+|\/+$/g, "");
  const publicKey = (cfg.publicKey || cfg.username || "").trim();
  const privateKey = (cfg.privateKey || cfg.password || "").trim();
  if (!publicKey || !privateKey) throw new MetropolError("Metropol keys are not configured.", null, 0, false);
  if (!version) throw new MetropolError("Metropol API version is not configured (Metropol assigns it — e.g. v2_1).", null, 0, false);
  return { host, port, version, publicKey, privateKey };
}

/** 20-char UTC stamp: YYYYMMDDHHMMSS + 6 fractional digits (ms padded). */
function timestamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const base =
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
  // Milliseconds → 6 digits so the whole stamp is exactly 20 chars.
  return base + p(d.getUTCMilliseconds(), 3) + p(Math.floor(Math.random() * 1000), 3);
}

function sign(priv: string, body: string, pub: string, ts: string): string {
  return createHash("sha256").update(priv + body + pub + ts, "utf8").digest("hex");
}

/** Normalize `api_code` (int|string|null) to a string, or null. */
function codeOf(j: Record<string, unknown>): string | null {
  const c = j.api_code;
  if (c === null || c === undefined) return null;
  return String(c);
}

/** A single signed call. `data===undefined` ⇒ GET (health). */
async function metropolFetch<T = Record<string, unknown>>(
  cfg: CrbConfig,
  endpoint: string,
  data?: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<T> {
  const base = resolveBase(cfg);
  const url = `https://${base.host}:${base.port}/${base.version}${endpoint}`;
  const method = data === undefined ? "GET" : "POST";
  const body = data === undefined ? "" : JSON.stringify(data); // compact — no spaces
  const ts = timestamp();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-METROPOL-REST-API-KEY": base.publicKey,
    "X-METROPOL-REST-API-HASH": sign(base.privateKey, body, base.publicKey, ts),
    "X-METROPOL-REST-API-TIMESTAMP": ts,
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: data === undefined ? undefined : body, signal: ctrl.signal });
  } catch (err) {
    throw new MetropolError(
      err instanceof Error && err.name === "AbortError" ? "Metropol timed out." : "Could not reach Metropol.",
      null, 0, true,
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // A non-JSON 404 means the base URL (port/version) is wrong.
    throw new MetropolError(
      res.status === 404 ? "Metropol endpoint not found — check the port and API version." : `Metropol returned a non-JSON response (HTTP ${res.status}).`,
      null, res.status, false,
    );
  }

  const apiCode = codeOf(j);
  // has_error===true is a hard error. E017 ("No account information") comes back
  // with has_error:false — a valid THIN FILE, not a failure.
  if (j.has_error === true) {
    const desc = (j.api_code_description as string) || "Metropol request failed.";
    const retryable = apiCode === "E409" || apiCode === "E025" || apiCode === "E024" || res.status >= 500;
    throw new MetropolError(`${desc}${apiCode ? ` (${apiCode})` : ""}`, apiCode, res.status, retryable);
  }
  return j as T;
}

// ── Typed report calls ───────────────────────────────────────────────────────

type Subject = { identityNumber: string; identityType?: string };
type CreditArgs = Subject & { loanAmount: number; reportReason?: ReportReason; applicationRef?: string };

export function health(cfg: CrbConfig) {
  return metropolFetch(cfg, ENDPOINT.HEALTH);
}

export function verifyIdentity(cfg: CrbConfig, s: Subject) {
  return metropolFetch(cfg, ENDPOINT.IDENTITY_VERIFY, {
    report_type: REPORT_TYPE.IDENTITY_VERIFY,
    identity_number: s.identityNumber,
    identity_type: s.identityType || "001",
  });
}

export function delinquencyStatus(cfg: CrbConfig, s: Subject & { loanAmount: number }) {
  return metropolFetch(cfg, ENDPOINT.DELINQUENCY, {
    report_type: REPORT_TYPE.DELINQUENCY,
    identity_number: s.identityNumber,
    identity_type: s.identityType || "001",
    loan_amount: Math.round(s.loanAmount),
  });
}

export function metroScore(cfg: CrbConfig, s: Subject & { mobileScore?: boolean }) {
  return metropolFetch(cfg, ENDPOINT.METRO_SCORE, {
    report_type: REPORT_TYPE.METRO_SCORE,
    identity_number: s.identityNumber,
    identity_type: s.identityType || "001",
    mobile_score: !!s.mobileScore,
  });
}

export function identityScrub(cfg: CrbConfig, s: Subject) {
  return metropolFetch(cfg, ENDPOINT.IDENTITY_SCRUB, {
    report_type: REPORT_TYPE.IDENTITY_SCRUB,
    identity_number: s.identityNumber,
    identity_type: s.identityType || "001",
  });
}

/** Report 12 — the everything call: identity verify + scrub + full credit file. */
export function fullEnhancedCreditInfo(cfg: CrbConfig, a: CreditArgs) {
  return metropolFetch(cfg, ENDPOINT.CREDIT_INFO, {
    report_type: REPORT_TYPE.FULL_ENHANCED_CREDIT_INFO,
    identity_number: a.identityNumber,
    identity_type: a.identityType || "001",
    loan_amount: Math.round(a.loanAmount),
    report_reason: a.reportReason ?? REPORT_REASON.NEW_APPLICATION,
  });
}

/** Report 11 — credit info WITH income estimation (mobile). */
export function creditInfoWithIncome(cfg: CrbConfig, a: CreditArgs) {
  return metropolFetch(cfg, ENDPOINT.ENHANCED_CREDIT_INFO_MOBILE, {
    report_type: REPORT_TYPE.ENHANCED_CREDIT_INFO_MOBILE,
    identity_number: a.identityNumber,
    identity_type: a.identityType || "001",
    loan_amount: Math.round(a.loanAmount),
    report_reason: a.reportReason ?? REPORT_REASON.NEW_APPLICATION,
  });
}

/** Report 10 — enhanced credit info with guarantors + stakeholders. */
export function enhancedCreditInfo(cfg: CrbConfig, a: CreditArgs) {
  return metropolFetch(cfg, ENDPOINT.ENHANCED_CREDIT_INFO, {
    report_type: REPORT_TYPE.ENHANCED_CREDIT_INFO,
    identity_number: a.identityNumber,
    identity_type: a.identityType || "001",
    loan_amount: Math.round(a.loanAmount),
    report_reason: a.reportReason ?? REPORT_REASON.NEW_APPLICATION,
    ...(a.applicationRef ? { application_ref_no: a.applicationRef } : {}),
  });
}

// ── The mapped, LMS-shaped result ────────────────────────────────────────────

const num = (v: unknown): number => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
};
const statusText = (s: unknown): string => {
  const raw = String(s ?? "").trim();
  if (!raw) return "Unknown";
  return ACCOUNT_STATUS[raw] ?? raw; // word passes through; letter code resolves
};

export type MetropolAccount = {
  accountNumber: string;
  product: string;
  status: string;
  opened: string | null;
  original: number | null;
  balance: number;
  overdue: number;
  arrearsDays: number;
  highestArrearsDays: number;
  delinquency: string;
  lastPaymentDate: string | null;
  isYours: boolean;
};

export type MetropolReport = {
  trxIds: string[];
  reportsPulled: string[];
  /** Metro Score (Developer Guide report 3), 200..900. */
  score: number | null;
  scoreAsAt: string | null;
  mobileScore: number | null;
  delinquencyCode: string;
  delinquencyText: string;
  hasFraud: boolean;
  thinFile: boolean; // E017: person exists at the bureau but has no accounts
  identity: {
    verified: boolean;
    name: string | null;
    firstName: string | null;
    lastName: string | null;
    dob: string | null;
    gender: string | null;
    serialNumber: string | null;
  } | null;
  incomeEstimate: number | null;
  accounts: MetropolAccount[];
  accountsSummary: { total: number; active: number; closed: number; npl: number; totalExposure: number; totalOverdue: number; worstArrearsDays: number };
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

const SECTOR_LABEL: Record<string, string> = {
  sector_bank: "Banks", sector_mfb: "Microfinance Banks", sector_mfi: "MFIs",
  sector_sacco: "SACCOs", sector_other: "Other lenders",
};

const win = (v: unknown) => {
  const o = (v ?? {}) as Record<string, unknown>;
  return { last3m: num(o.last_3_months), last6m: num(o.last_6_months), last12m: num(o.last_12_months) };
};

function mapAccounts(list: unknown): MetropolAccount[] {
  if (!Array.isArray(list)) return [];
  return list.map((raw) => {
    const a = raw as Record<string, unknown>;
    const pid = Number(a.product_type_id);
    return {
      accountNumber: String(a.account_number ?? ""),
      product: PRODUCT_TYPE[pid] ?? (a.product_type_name ? String(a.product_type_name) : "Loan"),
      status: statusText(a.account_status ?? a.account_status_name),
      opened: (a.date_opened as string) || null,
      original: a.original_amount != null ? num(a.original_amount) : null,
      balance: num(a.current_balance),
      overdue: num(a.overdue_balance),
      arrearsDays: num(a.days_in_arrears),
      highestArrearsDays: num(a.highest_days_in_arrears),
      delinquency: DELINQUENCY[String(a.delinquency_code ?? "")] ?? String(a.delinquency_code ?? ""),
      lastPaymentDate: (a.last_payment_date as string) || null,
      isYours: a.is_your_account === true,
    };
  });
}

function isNpl(a: MetropolAccount): boolean {
  return (
    a.arrearsDays >= 90 ||
    a.highestArrearsDays >= 90 ||
    /Non-Performing|Write-Off|Legal|Collection/i.test(a.status) ||
    (a.overdue > 0 && a.arrearsDays >= 30)
  );
}

/**
 * Merge the raw report shapes into one LMS report. Pass any of report 12 (full
 * enhanced), report 3 (score), report 11 (income) — whichever were pulled.
 */
export function mapMetropol(parts: {
  full?: Record<string, unknown> | null;
  score?: Record<string, unknown> | null;
  mobileScore?: Record<string, unknown> | null;
  income?: Record<string, unknown> | null;
}): MetropolReport {
  const full = parts.full ?? {};
  const income = parts.income ?? {};
  // Accounts: prefer the full file; fall back to the income (mobile) call.
  const accounts = mapAccounts((full.account_info as unknown) ?? (income.account_info as unknown));
  const delinquencyCode = String(full.delinquency_code ?? income.delinquency_code ?? "");
  const nplCount = accounts.filter((a) => isNpl(a)).length +
    (accounts.length === 0 && delinquencyCode === "004" ? 1 : 0);

  const iv = (full.identity_verification as Record<string, unknown>) ?? null;
  const scrub = (full.identity_scrub as Record<string, unknown>) ?? null;
  const scrubName = Array.isArray(scrub?.names) && scrub!.names.length ? String((scrub!.names as unknown[])[0]) : null;
  const identity = iv
    ? {
        verified: iv.success === true || !!(iv.first_name || iv.last_name),
        firstName: (iv.first_name as string) || null,
        lastName: (iv.last_name as string) || null,
        name: [iv.first_name, iv.other_name, iv.last_name].filter(Boolean).join(" ").trim() || scrubName || null,
        dob: (iv.date_of_birth as string) || (iv.dob as string) || null,
        gender: (iv.gender as string) || null,
        serialNumber: (iv.serial_number as string) || null,
      }
    : scrubName
      ? { verified: false, firstName: null, lastName: null, name: scrubName, dob: null, gender: null, serialNumber: null }
      : null;

  const productCount = new Map<string, number>();
  for (const a of accounts) productCount.set(a.product, (productCount.get(a.product) ?? 0) + 1);

  const sectorRaw = (full.lender_sector ?? income.lender_sector ?? {}) as Record<string, Record<string, unknown>>;
  const sectorExposure = Object.entries(sectorRaw).map(([k, v]) => ({
    sector: SECTOR_LABEL[k] ?? k,
    performing: num(v.account_performing),
    npa: num(v.account_npa),
    npaHistory: num(v.account_performing_npa_history),
  }));

  const trend = Array.isArray(full.metro_score_trend)
    ? (full.metro_score_trend as Array<Record<string, unknown>>)
        .map((t) => ({
          month: String(t.month ?? ""),
          score: t.credit_score != null ? num(t.credit_score) : null,
          ppi: t.ppi != null ? num(t.ppi) : null,
          ppiRank: (t.ppi_rank as string) || null,
        }))
        .filter((t) => t.month)
    : [];

  const ppiRaw = full.ppi_analysis as Record<string, unknown> | null;

  const incomeEst = (income.income_estimation as Record<string, unknown>)?.estimated_amount;

  const scoreVal =
    parts.score?.credit_score != null ? num(parts.score.credit_score)
    : full.credit_score != null ? num(full.credit_score)
    : income.credit_score != null ? num(income.credit_score)
    : null;

  const trxIds = [full.trx_id, income.trx_id, parts.score?.trx_id, parts.mobileScore?.trx_id]
    .filter((x): x is string => typeof x === "string" && !!x);
  const reportsPulled: string[] = [];
  if (parts.full) reportsPulled.push("Full Enhanced Credit Info (12)");
  if (parts.score) reportsPulled.push("Metro Score (3)");
  if (parts.mobileScore) reportsPulled.push("Mobile Score (3)");
  if (parts.income) reportsPulled.push("Credit Info + Income (11)");

  const totalExposure = accounts.reduce((s, a) => s + a.balance, 0);
  const totalOverdue = accounts.reduce((s, a) => s + a.overdue, 0);
  const worstArrears = accounts.reduce((m, a) => Math.max(m, a.highestArrearsDays, a.arrearsDays), 0);
  const activeCount = accounts.filter((a) => /Active|Performing|Terms Extended|Deferred/i.test(a.status)).length;

  const thinFile = accounts.length === 0 && (delinquencyCode === "002" || delinquencyCode === "");

  return {
    trxIds,
    reportsPulled,
    score: scoreVal,
    scoreAsAt: (parts.score?.as_at as string) || null,
    mobileScore: parts.mobileScore?.credit_score != null ? num(parts.mobileScore.credit_score) : null,
    delinquencyCode,
    delinquencyText: DELINQUENCY[delinquencyCode] ?? "Unknown",
    hasFraud: full.has_fraud === true || income.has_fraud === true,
    thinFile,
    identity,
    incomeEstimate: incomeEst != null ? num(incomeEst) : null,
    accounts,
    accountsSummary: {
      total: accounts.length,
      active: activeCount,
      closed: accounts.filter((a) => /Closed|Fully Settled|Paid Up|Early Settlement/i.test(a.status)).length,
      npl: nplCount,
      totalExposure,
      totalOverdue,
      worstArrearsDays: worstArrears,
    },
    productMix: [...productCount.entries()].map(([product, count]) => ({ product, count })),
    enquiries: win(full.no_of_enquiries ?? income.no_of_enquiries),
    bouncedCheques: win(full.no_of_bounced_cheques ?? income.no_of_bounced_cheques),
    creditApplications: win(full.no_of_credit_applications ?? income.no_of_credit_applications),
    sectorExposure,
    scoreTrend: trend,
    ppi: ppiRaw ? { ppi: ppiRaw.ppi != null ? num(ppiRaw.ppi) : null, rank: (ppiRaw.ppi_rank as string) || null } : null,
    guarantors: Array.isArray(full.guarantors) ? full.guarantors.length : 0,
    stakeholders: Array.isArray(full.stakeholders) ? full.stakeholders.length : 0,
  };
}

export type PullDepth = "score" | "standard" | "full";

/**
 * The orchestrated pull the LMS actually uses. Runs the high-value report set in
 * parallel (they are distinct report_types, so no E409 collision between them)
 * and merges the result. Each call is best-effort: a missing income estimate
 * never sinks the credit file, and a thin file (E017) is a valid clean result.
 *
 *   score     → report 3 only (cheapest — a number and a band)
 *   standard  → report 12 (the full file) + report 3 (authoritative score)
 *   full      → standard + report 11 (income estimation for affordability)
 */
export async function pullMetropol(
  cfg: CrbConfig,
  subject: Subject,
  opts: { loanAmount: number; reportReason?: ReportReason; depth?: PullDepth; mobileScore?: boolean } = { loanAmount: 0 },
): Promise<MetropolReport> {
  const depth: PullDepth = opts.depth ?? (cfg.reportDepth as PullDepth) ?? "full";
  const loanAmount = Math.max(1, Math.round(opts.loanAmount || 0)) || 10_000;
  const args: CreditArgs = { ...subject, loanAmount, reportReason: opts.reportReason };

  // A soft-fail wrapper: E017 (thin file) resolves to null here, so a person with
  // no bureau accounts still yields a valid report built from the score alone.
  const soft = async <T>(p: Promise<T>): Promise<T | null> => {
    try {
      return await p;
    } catch (err) {
      if (err instanceof MetropolError && (err.apiCode === "E017" || err.apiCode === "E002")) return null;
      throw err;
    }
  };

  if (depth === "score") {
    const score = await metroScore(cfg, subject);
    return mapMetropol({ score });
  }

  const jobs: Array<Promise<unknown>> = [
    soft(fullEnhancedCreditInfo(cfg, args)),
    soft(metroScore(cfg, subject)),
  ];
  if (depth === "full") jobs.push(soft(creditInfoWithIncome(cfg, args)));

  const [full, score, income] = (await Promise.all(jobs)) as [
    Record<string, unknown> | null,
    Record<string, unknown> | null,
    Record<string, unknown> | undefined,
  ];
  return mapMetropol({ full, score, income: income ?? null });
}
