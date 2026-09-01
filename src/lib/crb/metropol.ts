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
//     per-subscription values Metropol assigns. They live in the org vault,
//     never in code. THE PORT DIFFERS BETWEEN SUBSCRIPTIONS AND THIS MATTERS:
//     Micromart's TEST subscription is port 5555, PRODUCTION is 22225, and the
//     host and version (api.metropol.co.ke, v2_1) are the same for both. The
//     production key pair on port 5555 authenticates and then answers E003 "Not
//     Authorized" on every report — which reads exactly like a provisioning
//     failure and is really just the wrong port.
//   • Metropol answers only WHITELISTED SOURCE IPs, and port 22225 is not even
//     open to anyone else — a request from elsewhere hangs and dies with no
//     response, no api_code and nothing in a log. Callers that cannot hold a
//     fixed address (Vercel, the office DHCP link) egress through ./relay.
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
import { crbRelayEnabled, crbRelayFetch, CrbRelayError } from "@/lib/crb/relay";

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

// Report reasons (§5.2), report-type codes (§5.1) and the full report CATALOGUE
// now live in src/lib/crb/catalogue.ts. They moved because they stopped being
// constants a client hardcodes and became CONFIGURATION a lender chooses from:
// which reports to buy, at what depth, at what cost. Re-exported here so every
// existing call site keeps working unchanged.
export {
  REPORT_REASON,
  REPORT_TYPE,
  REPORT_REASON_LABEL,
  CRB_REPORTS,
  SCRUTINY_TIERS,
  resolvePlan,
  reportByCode,
} from "@/lib/crb/catalogue";
export type { ReportReason, ReportCode, CrbPlan, ScrutinyTierKey } from "@/lib/crb/catalogue";

import {
  REPORT_REASON as REASON,
  REPORT_TYPE as RT,
  reportByCode,
  resolvePlan,
  type ReportCode,
  type ReportReason,
  type ScrutinyTierKey,
} from "@/lib/crb/catalogue";

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

// The five identities a Metropol TEST subscription will answer for (Developer
// Guide §4.3). Any other ID returns E018 on the testbed.
export const SANDBOX_TEST_IDS = ["550000055", "660000066", "770000077", "880000088", "990000099"] as const;

// The two testbed IDs that carry a POPULATED credit file — 770 is a delinquent
// 4-account file, 990 a clean one. The sandbox remap prefers these so a demo on
// test keys always shows real accounts, a real score and a real delinquency
// picture rather than an empty thin file.
export const SANDBOX_RICH_IDS = ["770000077", "990000099"] as const;

/** Deterministically map any ID to a populated sandbox test ID (stable per person). */
export function sandboxTestIdFor(identityNumber: string): string {
  const h = createHash("sha256").update(String(identityNumber)).digest();
  return SANDBOX_RICH_IDS[h[0] % SANDBOX_RICH_IDS.length];
}

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

/**
 * PRODUCTION AND TEST DO NOT RETURN THE SAME SHAPE, and this is where that is
 * absorbed.
 *
 * The testbed answers flat — first_name, dob and the rest sit at the top level
 * beside api_code — and every mapping in this file was written against that.
 * The PRODUCTION subscription wraps the payload instead:
 *
 *   { api_code: 1010, api_code_description: "Identity found", has_error: false,
 *     success: true, trx_id: "…", data: { first_name: "…", dob: "…", … } }
 *
 * Nothing here read `data`, so on production every mapped field came back null
 * while has_error was false and success was true. That is the worst possible
 * failure: the console would report the check as VERIFIED and show a borrower
 * with no name and no date of birth, which reads as "the bureau has no details
 * for this person" rather than as a parsing bug on our side.
 *
 * Found on 2026-08-27 by the first real production pull (report 1, a live ID),
 * which returned a full record that this file then mapped to nothing.
 *
 * Fields are hoisted rather than replaced: the envelope still wins on a name
 * collision, so api_code/has_error/trx_id keep meaning what they meant, `data`
 * is left in place for anything that wants it, and a flat testbed response
 * passes through completely untouched. Only a plain object is hoisted — a
 * `data` that is an array belongs to a report whose mapper already walks it.
 */
export function hoistData(j: Record<string, unknown>): Record<string, unknown> {
  const d = j.data;
  if (!d || typeof d !== "object" || Array.isArray(d)) return j;
  return { ...(d as Record<string, unknown>), ...j };
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
    // THE ONE PLACE THE EGRESS PATH IS CHOSEN. Metropol answers only whitelisted
    // source IPs, and neither Vercel (rotating pool) nor the office link (DHCP)
    // can be one — so when a relay is configured the call is made FROM a
    // whitelisted host instead of from here. The relay hands back a real
    // Response, so everything below this block is identical either way.
    // Unset CRB_RELAY_URL and the direct path runs exactly as before, which is
    // what keeps the whitelisted hosts themselves on a straight connection.
    res = crbRelayEnabled()
      ? await crbRelayFetch(
          { url, method, headers, body: data === undefined ? undefined : body, timeoutMs },
          ctrl.signal,
        )
      : await fetch(url, { method, headers, body: data === undefined ? undefined : body, signal: ctrl.signal });
  } catch (err) {
    // "The relay is down" and "Metropol refused us" are different call-outs to
    // different people. Both stay MetropolError so every caller's typed handling
    // still works, but the message never lets the two be confused.
    if (err instanceof CrbRelayError) throw new MetropolError(`CRB relay: ${err.message}`, null, 0, true);
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
  return hoistData(j) as T;
}

// ── Typed report calls ───────────────────────────────────────────────────────

type Subject = { identityNumber: string; identityType?: string };
type CreditArgs = Subject & { loanAmount: number; reportReason?: ReportReason; applicationRef?: string };

export function health(cfg: CrbConfig) {
  return metropolFetch(cfg, ENDPOINT.HEALTH);
}

export function verifyIdentity(cfg: CrbConfig, s: Subject) {
  return metropolFetch(cfg, ENDPOINT.IDENTITY_VERIFY, {
    report_type: RT.IDENTITY_VERIFY,
    identity_number: s.identityNumber,
    identity_type: s.identityType || "001",
  });
}

export function delinquencyStatus(cfg: CrbConfig, s: Subject & { loanAmount: number }) {
  return metropolFetch(cfg, ENDPOINT.DELINQUENCY, {
    report_type: RT.DELINQUENCY,
    identity_number: s.identityNumber,
    identity_type: s.identityType || "001",
    loan_amount: Math.round(s.loanAmount),
  });
}

export function metroScore(cfg: CrbConfig, s: Subject & { mobileScore?: boolean }) {
  return metropolFetch(cfg, ENDPOINT.METRO_SCORE, {
    report_type: RT.METRO_SCORE,
    identity_number: s.identityNumber,
    identity_type: s.identityType || "001",
    mobile_score: !!s.mobileScore,
  });
}

export function identityScrub(cfg: CrbConfig, s: Subject) {
  return metropolFetch(cfg, ENDPOINT.IDENTITY_SCRUB, {
    report_type: RT.IDENTITY_SCRUB,
    identity_number: s.identityNumber,
    identity_type: s.identityType || "001",
  });
}

/**
 * Every credit report shares one body shape (§4.3.7 – §4.3.14): the identity
 * triple, the loan amount the pull is justified by, and the reason for asking.
 * Only the report_type and the endpoint change — so one builder covers them all,
 * which is what makes an arbitrary, lender-chosen report SET callable without a
 * new function per report.
 */
function creditCall(cfg: CrbConfig, code: ReportCode, endpoint: string, a: CreditArgs) {
  return metropolFetch(cfg, endpoint, {
    report_type: code,
    identity_number: a.identityNumber,
    identity_type: a.identityType || "001",
    loan_amount: Math.round(a.loanAmount),
    report_reason: a.reportReason ?? REASON.NEW_APPLICATION,
    ...(a.applicationRef ? { application_ref_no: a.applicationRef } : {}),
  });
}

/** Report 8 — the credit file without guarantors. */
export const creditInfo = (cfg: CrbConfig, a: CreditArgs) => creditCall(cfg, RT.CREDIT_INFO, ENDPOINT.CREDIT_INFO, a);

/** Report 10 — enhanced credit info with guarantors + stakeholders. */
export const enhancedCreditInfo = (cfg: CrbConfig, a: CreditArgs) =>
  creditCall(cfg, RT.ENHANCED_CREDIT_INFO, ENDPOINT.ENHANCED_CREDIT_INFO, a);

/** Report 11 — credit info WITH income estimation (mobile). */
export const creditInfoWithIncome = (cfg: CrbConfig, a: CreditArgs) =>
  creditCall(cfg, RT.CREDIT_INFO_MOBILE, ENDPOINT.ENHANCED_CREDIT_INFO_MOBILE, a);

/** Report 12 — the everything call: identity verify + scrub + full credit file. */
export const fullEnhancedCreditInfo = (cfg: CrbConfig, a: CreditArgs) =>
  creditCall(cfg, RT.FULL_ENHANCED_CREDIT_INFO, ENDPOINT.CREDIT_INFO, a);

/** Report 13 — the one-paragraph version, for a bulk screen. */
export const minifiedCreditInfo = (cfg: CrbConfig, a: CreditArgs) =>
  creditCall(cfg, RT.MINIFIED_CREDIT_INFO, ENDPOINT.CREDIT_INFO, a);

/** Report 14 — the complete file as raw JSON, guarantors included. */
export const fullJsonReport = (cfg: CrbConfig, a: CreditArgs) =>
  creditCall(cfg, RT.FULL_JSON_REPORT, ENDPOINT.JSON_REPORT, a);

/** Report 16 — mobile vs. generic account counts and the monthly instalment load. */
export const accountsSummary = (cfg: CrbConfig, a: CreditArgs) =>
  creditCall(cfg, RT.ACCOUNTS_SUMMARY, ENDPOINT.CREDIT_INFO, a);

/** Report 22 — 12 months of per-account behaviour: status, arrears, payments. */
export const accountsInfo = (cfg: CrbConfig, a: CreditArgs) =>
  creditCall(cfg, RT.ACCOUNTS_INFO, ENDPOINT.CREDIT_INFO, a);

/** Report 5 — the credit report as JSON (no guarantors). */
export const jsonReport = (cfg: CrbConfig, a: CreditArgs) => creditCall(cfg, RT.JSON_REPORT, ENDPOINT.JSON_REPORT, a);

/**
 * Report 4 — the bureau's own PDF.
 *
 * The ONE report that does not return JSON, so it does not go through
 * metropolFetch's parser. Kept out of the orchestrated merge for that reason and
 * exposed on its own for the "attach the bureau's document to the file" flow.
 */
export const pdfReport = (cfg: CrbConfig, a: CreditArgs) => creditCall(cfg, RT.PDF_REPORT, ENDPOINT.PDF_REPORT, a);

/** Dispatch table: report code → the call that fetches it. */
const CALLERS: Partial<Record<number, (cfg: CrbConfig, a: CreditArgs) => Promise<Record<string, unknown>>>> = {
  [RT.IDENTITY_VERIFY]: (cfg, a) => verifyIdentity(cfg, a) as Promise<Record<string, unknown>>,
  [RT.DELINQUENCY]: (cfg, a) => delinquencyStatus(cfg, a) as Promise<Record<string, unknown>>,
  [RT.METRO_SCORE]: (cfg, a) => metroScore(cfg, a) as Promise<Record<string, unknown>>,
  [RT.IDENTITY_SCRUB]: (cfg, a) => identityScrub(cfg, a) as Promise<Record<string, unknown>>,
  [RT.CREDIT_INFO]: creditInfo,
  [RT.ENHANCED_CREDIT_INFO]: enhancedCreditInfo,
  [RT.CREDIT_INFO_MOBILE]: creditInfoWithIncome,
  [RT.FULL_ENHANCED_CREDIT_INFO]: fullEnhancedCreditInfo,
  [RT.MINIFIED_CREDIT_INFO]: minifiedCreditInfo,
  [RT.FULL_JSON_REPORT]: fullJsonReport,
  [RT.ACCOUNTS_SUMMARY]: accountsSummary,
  [RT.ACCOUNTS_INFO]: accountsInfo,
  [RT.JSON_REPORT]: jsonReport,
};

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

  // ── Reports the plan may or may not have bought ──────────────────────────
  // Each is null/empty when its report was not in the lender's chosen set. That
  // is the point of a configurable plan: the shape never changes, only how much
  // of it is filled in, so no call site has to know what was purchased.

  /** Report 6 (or report 12's nested scrub) — what the bureau knows that isn't an account. */
  scrub: {
    names: string[];
    phones: string[];
    emails: string[];
    employers: string[];
    towns: string[];
  } | null;

  /**
   * Report 16 — the borrower's CURRENT repayment load, split mobile vs. generic.
   * This is the affordability denominator: what they already owe every month
   * before this loan is added.
   */
  loanLoad: {
    mobileActive: number;
    mobileClosed: number;
    mobileInArrears: number;
    mobileNpa: number;
    genericActive: number;
    genericClosed: number;
    genericInArrears: number;
    genericNpa: number;
    /** Sum of monthly instalments on active non-mobile loans. */
    monthlyInstalmentGeneric: number;
    avgPrincipalMobileActive: number;
  } | null;

  /** Report 22 — 12 months of behaviour per account. Empty when not purchased. */
  accountHistory: Array<{
    accountNumber: string;
    product: string;
    points: Array<{
      month: string;
      status: string;
      arrearsDays: number;
      overdue: number;
      lastPaymentAmount: number | null;
      lastPaymentDate: string | null;
    }>;
  }>;

  /** Report 22 — the score band over the observed window. */
  scoreRange: { min: number; max: number } | null;

  /** Which report codes actually answered. Drives the cost line and the audit trail. */
  reportCodes: number[];
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
export type MetropolParts = {
  /** Report 12 (or 10/8/14) — whichever full credit file the plan bought. */
  full?: Record<string, unknown> | null;
  /** Report 3 — Metro Score. */
  score?: Record<string, unknown> | null;
  /** Report 3 with mobile_score:true. */
  mobileScore?: Record<string, unknown> | null;
  /** Report 11 — credit info with income estimation. */
  income?: Record<string, unknown> | null;
  /** Report 1 — identity verification, when bought on its own. */
  identity?: Record<string, unknown> | null;
  /** Report 6 — identity scrub, when bought on its own. */
  scrub?: Record<string, unknown> | null;
  /** Report 2 — delinquency status, when bought on its own. */
  delinquency?: Record<string, unknown> | null;
  /** Report 10 — enhanced credit info (guarantors + stakeholders). */
  enhanced?: Record<string, unknown> | null;
  /** Report 16 — credit accounts summary. */
  summary?: Record<string, unknown> | null;
  /** Report 22 — 12-month account history. */
  history?: Record<string, unknown> | null;
  /** Report 13 — minified credit info. */
  minified?: Record<string, unknown> | null;
  /** The report codes that were actually attempted and answered. */
  codes?: number[];
};

export function mapMetropol(parts: MetropolParts): MetropolReport {
  // The "full file" is whichever of reports 12 / 10 / 14 / 8 the plan bought.
  // They share a shape; report 12 simply carries the most of it.
  const full = parts.full ?? parts.enhanced ?? {};
  const income = parts.income ?? {};
  const summary = parts.summary ?? {};
  const history = parts.history ?? {};
  // Accounts: prefer the full file; then the 12-month history call (report 22
  // returns the same account_info with an extra account_history array); then the
  // income (mobile) call. Whichever the plan bought, the account list is the same
  // shape — so a lender on a cheap tier still gets accounts if ANY report carried
  // them, and a lender on none gets an honest empty list rather than a crash.
  const accounts = mapAccounts(
    (full.account_info as unknown) ?? (history.account_info as unknown) ?? (income.account_info as unknown),
  );
  const delinquencyCode = String(
    full.delinquency_code ?? parts.delinquency?.delinquency_code ?? history.delinquency_code ?? income.delinquency_code ?? "",
  );
  const nplCount = accounts.filter((a) => isNpl(a)).length +
    (accounts.length === 0 && delinquencyCode === "004" ? 1 : 0);

  // Identity comes from report 12's nested block, or from report 1 bought alone.
  const iv = (full.identity_verification as Record<string, unknown>) ?? parts.identity ?? null;
  const scrub = (full.identity_scrub as Record<string, unknown>) ?? parts.scrub ?? null;
  const scrubName = Array.isArray(scrub?.names) && scrub!.names.length ? String((scrub!.names as unknown[])[0]) : null;
  const identity = iv
    ? {
        // Production names the family field `surname`; the testbed (and report
        // 12's nested identity block) call it `last_name`. Both are read — the
        // live 2026-08-27 pull returned surname:"KIPLETING" with no last_name
        // at all, which mapped to a verified borrower with a blank name.
        verified: iv.success === true || !!(iv.first_name || iv.last_name || iv.surname),
        firstName: (iv.first_name as string) || null,
        lastName: (iv.last_name as string) || (iv.surname as string) || null,
        name:
          [iv.first_name, iv.other_name, iv.last_name ?? iv.surname]
            .filter(Boolean)
            .join(" ")
            .trim() || scrubName || null,
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

  // The 12-month score trend arrives from report 12 as `metro_score_trend` and
  // from report 22 as `monthly_score`. A plan may buy either, both or neither —
  // 12 wins where they overlap because it also carries the PPI alongside.
  const trendFrom = (list: unknown, scoreKey: string) =>
    Array.isArray(list)
      ? (list as Array<Record<string, unknown>>)
          .map((t) => ({
            month: String(t.month ?? ""),
            score: t[scoreKey] != null ? num(t[scoreKey]) : null,
            ppi: t.ppi != null ? num(t.ppi) : null,
            ppiRank: (t.ppi_rank as string) || null,
          }))
          .filter((t) => t.month)
      : [];
  const trend12 = trendFrom(full.metro_score_trend, "credit_score");
  const trend22 = trendFrom(history.monthly_score, "credit_score");
  const trendMap = new Map(trend22.map((t) => [t.month, t]));
  for (const t of trend12) trendMap.set(t.month, t);
  const trend = [...trendMap.values()].sort((a, b) => a.month.localeCompare(b.month));

  const ppiRaw = full.ppi_analysis as Record<string, unknown> | null;

  const incomeEst = (income.income_estimation as Record<string, unknown>)?.estimated_amount;

  const scoreVal =
    parts.score?.credit_score != null ? num(parts.score.credit_score)
    : full.credit_score != null ? num(full.credit_score)
    : income.credit_score != null ? num(income.credit_score)
    : null;

  const trxIds = [
    full.trx_id, income.trx_id, summary.trx_id, history.trx_id,
    parts.score?.trx_id, parts.mobileScore?.trx_id, parts.identity?.trx_id,
    parts.scrub?.trx_id, parts.delinquency?.trx_id, parts.minified?.trx_id,
  ].filter((x): x is string => typeof x === "string" && !!x);

  // Named from the CATALOGUE rather than a hardcoded list, so a plan that buys a
  // report nobody anticipated still shows the lender exactly what they paid for.
  const codes = parts.codes ?? [];
  const reportsPulled = codes.map((c) => {
    const def = reportByCode(c);
    return def ? `${def.name} (${c})` : `Report ${c}`;
  });

  // ── Report 6 / report 12's scrub block — the non-account intelligence ──────
  const strList = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : [];
  const scrubBlock = scrub
    ? {
        names: strList(scrub.names),
        phones: strList(scrub.phone),
        emails: strList(scrub.email),
        employers: Array.isArray(scrub.employment)
          ? (scrub.employment as Array<Record<string, unknown>>)
              .map((e) => String(e?.employer_name ?? "").trim())
              .filter(Boolean)
          : [],
        towns: [
          ...(Array.isArray(scrub.postal_address) ? (scrub.postal_address as Array<Record<string, unknown>>) : []),
          ...(Array.isArray(scrub.physical_address) ? (scrub.physical_address as Array<Record<string, unknown>>) : []),
        ]
          .map((a) => String(a?.town ?? "").trim())
          .filter(Boolean),
      }
    : null;

  // ── Report 16 — the current monthly repayment load ────────────────────────
  const ci = (summary.credit_info as Record<string, unknown>) ?? null;
  const loanLoad = ci
    ? {
        mobileActive: num(ci.mobile_account_count_active),
        mobileClosed: num(ci.mobile_account_count_closed),
        mobileInArrears: num(ci.mobile_account_in_arrears_count),
        mobileNpa: num(ci.mobile_account_npa_count),
        genericActive: num(ci.generic_account_count),
        genericClosed: num(ci.generic_account_count_closed),
        genericInArrears: num(ci.generic_account_in_arrears_count),
        genericNpa: num(ci.generic_account_npa_count),
        monthlyInstalmentGeneric: num(ci.total_monthly_instalment_generic),
        avgPrincipalMobileActive: num(ci.average_principal_mobile_loans_active),
      }
    : null;

  // ── Report 22 — 12 months of behaviour per account ────────────────────────
  const accountHistory = Array.isArray(history.account_info)
    ? (history.account_info as Array<Record<string, unknown>>)
        .map((a) => ({
          accountNumber: String(a.account_number ?? ""),
          product: String(a.product_type_name ?? "Loan"),
          points: Array.isArray(a.account_history)
            ? (a.account_history as Array<Record<string, unknown>>).map((h) => ({
                month: String(h.month ?? "").slice(0, 10),
                status: statusText(h.account_status),
                arrearsDays: num(h.days_in_arrears),
                overdue: num(h.overdue_balance),
                lastPaymentAmount: h.last_payment_amount != null ? num(h.last_payment_amount) : null,
                lastPaymentDate: (h.last_payment_date as string) || null,
              }))
            : [],
        }))
        // An account with no history contributes nothing to a behaviour chart;
        // the guide says the tag comes back empty when there is under 3 months
        // of data, and rendering an empty series reads as a bug.
        .filter((a) => a.points.length > 0)
    : [];

  const scoreRange =
    history.min_credit_score != null && history.max_credit_score != null
      ? { min: num(history.min_credit_score), max: num(history.max_credit_score) }
      : null;

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
    scrub: scrubBlock,
    loanLoad,
    accountHistory,
    scoreRange,
    reportCodes: codes,
  };
}

/** @deprecated The three fixed depths are now the tiers in the catalogue. */
export type PullDepth = "score" | "standard" | "full";

/** Where each answered report lands in the merge. */
const PART_FOR: Record<number, keyof MetropolParts> = {
  [RT.IDENTITY_VERIFY]: "identity",
  [RT.DELINQUENCY]: "delinquency",
  [RT.METRO_SCORE]: "score",
  [RT.IDENTITY_SCRUB]: "scrub",
  [RT.CREDIT_INFO]: "full",
  [RT.ENHANCED_CREDIT_INFO]: "enhanced",
  [RT.CREDIT_INFO_MOBILE]: "income",
  [RT.FULL_ENHANCED_CREDIT_INFO]: "full",
  [RT.MINIFIED_CREDIT_INFO]: "minified",
  [RT.FULL_JSON_REPORT]: "full",
  [RT.ACCOUNTS_SUMMARY]: "summary",
  [RT.ACCOUNTS_INFO]: "history",
  [RT.JSON_REPORT]: "full",
};

export type PullResult = MetropolReport & {
  /** Per-report outcome — what answered, what was skipped, and why. */
  calls: Array<{ code: number; name: string; ok: boolean; skipped: boolean; apiCode: string | null; ms: number }>;
};

export type PullOptions = {
  loanAmount: number;
  reportReason?: ReportReason;
  /** The lender's scrutiny tier. Ignored when `reports` is given explicitly. */
  tier?: ScrutinyTierKey;
  /** Explicit report codes — overrides the tier. This is the real control. */
  reports?: number[];
  /** Per-report tariff overrides, for costing the pull. */
  tariff?: Record<string, number> | null;
  mobileScore?: boolean;
  applicationRef?: string;
  /** @deprecated Use `tier`. Mapped onto the tiers for saved configs. */
  depth?: PullDepth;
};

/**
 * The orchestrated pull — WHATEVER REPORT SET THE LENDER BOUGHT.
 *
 * The report set is no longer a property of this function; it is a property of
 * the lender, resolved from their scrutiny tier (or an explicit list) through
 * the catalogue. This function's only job is to run that set and merge it.
 *
 * Three behaviours are load-bearing:
 *
 *   · PARALLEL, because distinct report_types do not collide with Metropol's
 *     E409 duplicate guard — that fires on an IDENTICAL call inside 60 seconds,
 *     and two different report types are not identical.
 *   · BEST-EFFORT PER REPORT. E017 ("no account information") is a valid THIN
 *     FILE, not a failure; E029 ("unauthorized report") means the account is not
 *     entitled to that report, which is a configuration fact worth surfacing and
 *     not a reason to fail the whole pull. Either resolves to null and the merge
 *     carries on with what did answer.
 *   · A HARD failure on EVERY report still throws, because a pull where nothing
 *     answered is not a thin file — it is an outage, and calling it "clean" is
 *     how a lender ends up disbursing against a bureau that never replied.
 */
export async function pullMetropol(
  cfg: CrbConfig,
  subject: Subject,
  opts: PullOptions = { loanAmount: 0 },
): Promise<PullResult> {
  // Precedence: explicit reports → explicit tier → the org's saved tier → the
  // legacy `reportDepth` mapped onto a tier → "standard".
  const plan = resolvePlan({
    tier: opts.reports?.length
      ? "custom"
      : (opts.tier ?? (cfg.scrutinyTier as ScrutinyTierKey | undefined) ?? LEGACY_TIER[cfg.reportDepth ?? ""] ?? "standard"),
    reports: opts.reports ?? cfg.reports ?? null,
    tariff: opts.tariff ?? cfg.tariff ?? null,
  });

  const loanAmount = Math.max(1, Math.round(opts.loanAmount || 0)) || 10_000;
  const args: CreditArgs = {
    ...subject,
    loanAmount,
    reportReason: opts.reportReason,
    applicationRef: opts.applicationRef,
  };

  const calls: PullResult["calls"] = [];
  const parts: MetropolParts = {};
  let hardError: MetropolError | null = null;

  const results = await Promise.all(
    plan.reports.map(async (code) => {
      const def = reportByCode(code)!;
      const caller = CALLERS[code];
      const started = Date.now();
      if (!caller) {
        // Report 4 is a binary PDF and has no JSON to merge. It stays out of the
        // orchestrated pull deliberately rather than failing inside it.
        calls.push({ code, name: def.name, ok: false, skipped: true, apiCode: null, ms: 0 });
        return null;
      }
      try {
        const json = await caller(cfg, args);
        calls.push({ code, name: def.name, ok: true, skipped: false, apiCode: null, ms: Date.now() - started });
        return { code, json };
      } catch (err) {
        const apiCode = err instanceof MetropolError ? err.apiCode : null;
        calls.push({ code, name: def.name, ok: false, skipped: false, apiCode, ms: Date.now() - started });
        // E017 thin file / E002 empty key / E029 not entitled — soft.
        if (err instanceof MetropolError && SOFT_CODES.has(err.apiCode ?? "")) return null;
        if (err instanceof MetropolError) hardError = err;
        else hardError = new MetropolError("Metropol request failed.", null, 0, false);
        return null;
      }
    }),
  );

  type Answered = { code: ReportCode; json: Record<string, unknown> };
  const answered = results.filter((r): r is Answered => r !== null);

  // Nothing answered AND something failed hard ⇒ this is an outage, not a file.
  if (answered.length === 0 && hardError) throw hardError;

  // Merge in catalogue order so a richer report never loses to a poorer one that
  // happened to resolve first: report 12 must win the `full` slot over report 8.
  for (const { code, json } of answered.sort((a, b) => a.code - b.code)) {
    const slot = PART_FOR[code];
    if (!slot) continue;
    if (slot === "full" && parts.full && code < RT.FULL_ENHANCED_CREDIT_INFO) continue;
    (parts as Record<string, unknown>)[slot] = json;
  }

  // Report 3 with mobile_score:true is the same report type, so it can only be
  // requested as an OPTION on the score call, never as a second entry in the set.
  if (opts.mobileScore && parts.score) parts.mobileScore = parts.score;

  const report = mapMetropol({ ...parts, codes: answered.map((a) => a.code) });
  return { ...report, calls };
}

/**
 * ONE report, on its own, with the bureau's RAW answer kept.
 *
 * pullMetropol() is the orchestrator: it runs a SET, merges the answers into one
 * borrower file, and throws the raw responses away once mapped — which is exactly
 * right for a credit decision, where what you want is the merged view.
 *
 * The master file wants the opposite. Its whole premise is that every scrutiny is
 * an artifact in its own right: "Metropol Report 12, pulled on the 2nd, said
 * this" is a different and more auditable claim than "the bureau file says this",
 * and it is the form a report has to be in before it can be weighed, aged, or
 * contributed to the Interchange. So this returns the untouched JSON, per report,
 * and never merges.
 *
 * It NEVER throws for a report the bureau simply cannot answer. A thin file
 * (E017), an unentitled report (E029) and an empty key (E002) are FINDINGS — "we
 * asked, and this is what came back" — and a sweep of fourteen reports that
 * aborted on the first of them would tell a lender nothing about the other
 * thirteen. Only the transport failing is an error, and even then it is reported
 * rather than raised.
 */
export type SingleReportResult = {
  code: number;
  key: string;
  name: string;
  ok: boolean;
  /** True when this report has no JSON caller at all — report 4 is a binary PDF. */
  skipped: boolean;
  apiCode: string | null;
  message: string | null;
  ms: number;
  /** The bureau's own response, untouched. Null unless `ok`. */
  json: Record<string, unknown> | null;
};

export async function pullSingleReport(
  cfg: CrbConfig,
  subject: Subject,
  code: number,
  opts: { loanAmount?: number; reportReason?: ReportReason; applicationRef?: string } = {},
): Promise<SingleReportResult> {
  const def = reportByCode(code as ReportCode);
  const name = def?.name ?? `Report ${code}`;
  const key = def?.key ?? `report-${code}`;
  const caller = CALLERS[code];
  const started = Date.now();

  if (!caller) {
    return { code, key, name, ok: false, skipped: true, apiCode: null, message: "No JSON endpoint — this report is a binary document.", ms: 0, json: null };
  }

  const args: CreditArgs = {
    ...subject,
    // Several reports price the enquiry off the amount being applied for. Zero is
    // rejected by the bureau, so a nominal amount stands in when none is given —
    // the reports that ignore it are unaffected, and the ones that do not at
    // least get a valid request rather than a validation error.
    loanAmount: Math.max(1, Math.round(opts.loanAmount || 0)) || 10_000,
    reportReason: opts.reportReason,
    applicationRef: opts.applicationRef,
  };

  try {
    const json = await caller(cfg, args);
    return { code, key, name, ok: true, skipped: false, apiCode: null, message: null, ms: Date.now() - started, json };
  } catch (err) {
    const e = err instanceof MetropolError ? err : null;
    return {
      code, key, name, ok: false, skipped: false,
      apiCode: e?.apiCode ?? null,
      message: e?.message ?? (err instanceof Error ? err.message : "Request failed."),
      ms: Date.now() - started,
      json: null,
    };
  }
}

/** API codes that mean "this report has no answer for this person", not "we failed". */
const SOFT_CODES = new Set(["E017", "E002", "E029", "E016", "E019"]);

/** Saved configs still carry the old three depths. Map them onto the tiers. */
const LEGACY_TIER: Record<string, ScrutinyTierKey | undefined> = {
  score: "screen",
  standard: "standard",
  full: "deep",
};
