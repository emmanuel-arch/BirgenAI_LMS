// ─────────────────────────────────────────────────────────────────────────────
// THE METROPOL REPORT CATALOGUE — every report the bureau sells, what it
// answers, and what it costs to ask.
//
// WHY THIS FILE EXISTS. A bureau pull is not one product, it is fourteen, and
// they are priced separately. The orchestrator used to hardcode three depths
// ("score" | "standard" | "full") that between them touched four report types
// and left the other ten unreachable. That is the wrong shape for a platform:
// Micromart want the full forensic file on a KES 400k check-off loan and would
// be insane to buy it on a KES 2,000 mobile top-up, and the lender after them
// will draw that line somewhere else again.
//
// So the report SET is a per-lender configuration, the catalogue below is the
// menu it is chosen from, and every entry carries the two things a lender needs
// to choose rationally: what the report actually tells them, and what it costs.
//
// ── ON THE PRICES ────────────────────────────────────────────────────────────
// The Developer Guide (v3.8) is a technical specification. It contains NO
// tariff — Metropol price per account, commercially, and Micromart's sheet has
// not landed yet (it is question 6 on the outstanding list, alongside the
// production keys). Every `indicativeTariff` below is therefore a PLACEHOLDER
// carrying the market shape (identity checks are cents, the full enhanced file
// is the expensive one), not a quoted price.
//
// This is deliberately not hidden. `tariffSource` on a resolved plan reports
// whether the numbers came from Metropol's sheet or from these placeholders,
// and the settings screen says so on the lender's behalf. The instant the
// tariff arrives it is typed into the vault once — `CrbConfig.tariff` overrides
// the catalogue per report, per lender — and every projection on this platform
// re-prices itself. No code change, which is the same promise made to Metropol
// about the production keys.
//
// ── SOURCE OF EVERY FACT BELOW ───────────────────────────────────────────────
// MA Kenya API Developer Guide v3.8 §4.1 (endpoints), §4.3.1–4.3.15 (per-report
// request parameters and response shapes), §5.1 (report types), §5.2 (report
// reasons). Verified live against api.metropol.co.ke:5555/v2_1 on the test key
// pair for reports 1, 2, 3, 11 and 12 plus the health check.
//
// ── WHAT MICROMART ARE ACTUALLY ENTITLED TO (2 Sep 2026) ─────────────────────
// The whole catalogue was pulled one report at a time against a real subject on
// production keys, through the CRB relay (npm run crb:all). Twelve of the
// fourteen answered:
//
//   ANSWERED   1, 2, 3, 5, 6, 8, 10, 11, 12, 13, 14, 16
//   REFUSED    22  Accounts Info (12-month history) — E029, unauthorized report.
//                  Not a bug and not a transport failure: this lender's contract
//                  does not include it. Anything that needs a month-by-month
//                  arrears trend must come from report 12's `metro_score_trend`
//                  (12 points) instead, which they DO get.
//   NO JSON     4  PDF Credit Report — a binary document, no JSON endpoint, and
//                  deliberately outside the orchestrated pull.
//
// Entitlement is per contract and can change without notice, so this is a record
// of what was true on that date, not a constant to branch on. Re-run the sweep
// rather than trusting this list if a report starts refusing.
// ─────────────────────────────────────────────────────────────────────────────

/** Report type codes, exactly as Metropol number them (§5.1). 7, 9, 15, 17, 20, 21 do not exist. */
export const REPORT_TYPE = {
  IDENTITY_VERIFY: 1,
  DELINQUENCY: 2,
  METRO_SCORE: 3,
  PDF_REPORT: 4,
  JSON_REPORT: 5,
  IDENTITY_SCRUB: 6,
  CREDIT_INFO: 8,
  ENHANCED_CREDIT_INFO: 10,
  CREDIT_INFO_MOBILE: 11,
  FULL_ENHANCED_CREDIT_INFO: 12,
  MINIFIED_CREDIT_INFO: 13,
  FULL_JSON_REPORT: 14,
  ACCOUNTS_SUMMARY: 16,
  ACCOUNTS_INFO: 22,
} as const;

export type ReportCode = (typeof REPORT_TYPE)[keyof typeof REPORT_TYPE];

/** Report reasons (§5.2). Every credit report must state WHY it is being pulled. */
export const REPORT_REASON = {
  NEW_APPLICATION: 1,
  REVIEW_EXISTING: 2,
  VERIFY_DETAILS: 3,
  CUSTOMER_REQUEST: 4,
} as const;
export type ReportReason = (typeof REPORT_REASON)[keyof typeof REPORT_REASON];

export const REPORT_REASON_LABEL: Record<number, string> = {
  1: "New credit application",
  2: "Review of existing credit",
  3: "Verify customer details",
  4: "Direct customer request",
};

export type CrbReportDef = {
  code: ReportCode;
  /** Stable key for config/UI. Never renumber; Metropol's codes are the contract. */
  key: string;
  /** Metropol's own name for it (§5.1). */
  name: string;
  endpoint: string;
  method: "POST" | "GET";
  /** The decision question this report answers, in a credit officer's words. */
  answers: string;
  /** What it contributes to the merged borrower file. Drives the "what you lose" copy. */
  yields: string[];
  needsLoanAmount: boolean;
  needsReportReason: boolean;
  /** Optional request parameters beyond the identity triple. */
  options?: string[];
  /**
   * Whether the orchestrator merges this into the LMS report today. Unwired
   * reports are still callable (raw) and still selectable — they simply have no
   * mapped home yet, and the UI says so rather than pretending.
   */
  wired: boolean;
  /** Placeholder per-call price in KES. See "ON THE PRICES" above. */
  indicativeTariff: number;
  /** 0..1 — how far into the borrower's file this reaches. Drives the scrutiny meter. */
  depth: number;
  /** Reports whose output this one already contains — selecting both is waste. */
  supersedes?: ReportCode[];
};

export const CRB_REPORTS: CrbReportDef[] = [
  {
    code: 1,
    key: "identity-verify",
    name: "Identity Verification",
    endpoint: "/identity/verify",
    method: "POST",
    answers: "Is this ID real, and is it the person in front of me?",
    yields: ["Registered names", "Date of birth", "Gender", "Citizenship", "ID serial number", "Date of death (if any)"],
    needsLoanAmount: false,
    needsReportReason: false,
    wired: true,
    indicativeTariff: 10,
    depth: 0.15,
  },
  {
    code: 2,
    key: "delinquency",
    name: "Delinquency Status",
    endpoint: "/delinquency/status",
    method: "POST",
    answers: "Are they in default right now, or have they ever been?",
    yields: ["Delinquency code (001–005)", "Current vs. historical NPA"],
    needsLoanAmount: true,
    needsReportReason: false,
    wired: true,
    indicativeTariff: 10,
    depth: 0.25,
    // Report 12 returns the same delinquency code inside the full file.
    supersedes: [],
  },
  {
    code: 3,
    key: "metro-score",
    name: "Metro / Mobile Score",
    endpoint: "/score/consumer",
    method: "POST",
    answers: "What is the bureau's number on this person?",
    yields: ["Metro Score (200–900)", "Mobile Score (when requested)", "Score as-at date"],
    needsLoanAmount: false,
    needsReportReason: false,
    options: ["mobile_score"],
    wired: true,
    indicativeTariff: 25,
    depth: 0.35,
  },
  {
    code: 4,
    key: "pdf-report",
    name: "PDF Credit Report",
    endpoint: "/report/pdf",
    method: "POST",
    answers: "Give me the bureau's own signed document for the file.",
    yields: ["Binary PDF of the full credit report"],
    needsLoanAmount: true,
    needsReportReason: true,
    wired: false,
    indicativeTariff: 60,
    depth: 0.7,
  },
  {
    code: 5,
    key: "json-report",
    name: "JSON Credit Report",
    endpoint: "/report/json",
    method: "POST",
    answers: "The full credit report, machine-readable.",
    yields: ["Accounts", "Delinquency", "Enquiries", "Bounced cheques", "Credit applications", "PPI"],
    needsLoanAmount: true,
    needsReportReason: true,
    wired: false,
    indicativeTariff: 60,
    depth: 0.75,
  },
  {
    code: 6,
    key: "identity-scrub",
    name: "Identity Scrub",
    endpoint: "/identity/scrub",
    method: "POST",
    answers: "What does the bureau know about them that isn't an account?",
    yields: ["Known phone numbers", "Reported names", "Employer / address traces", "Fraud markers"],
    needsLoanAmount: false,
    needsReportReason: false,
    wired: true,
    indicativeTariff: 15,
    depth: 0.3,
  },
  {
    code: 8,
    key: "credit-info",
    name: "Credit Info",
    endpoint: "/report/credit_info",
    method: "POST",
    answers: "Every credit account on file and how each is performing.",
    yields: ["Account list", "Balances", "Overdue", "Days in arrears", "Sector exposure", "Enquiry counts"],
    needsLoanAmount: true,
    needsReportReason: true,
    wired: false,
    indicativeTariff: 40,
    depth: 0.65,
  },
  {
    code: 10,
    key: "enhanced-credit-info",
    name: "Enhanced Credit Info",
    endpoint: "/report/credit_info_enhanced",
    method: "POST",
    answers: "The credit file, plus who else is standing behind them.",
    yields: ["Everything in Credit Info", "Guarantors", "Stakeholders / directorships"],
    needsLoanAmount: true,
    needsReportReason: true,
    options: ["application_ref_no"],
    wired: true,
    indicativeTariff: 55,
    depth: 0.8,
    supersedes: [8],
  },
  {
    code: 11,
    key: "credit-info-mobile",
    name: "Credit Info with Income Estimation",
    endpoint: "/report/creditinfo/mobile",
    method: "POST",
    answers: "What can they actually afford to repay each month?",
    yields: ["Estimated income", "Mobile-lending exposure", "Generic loan instalments"],
    needsLoanAmount: true,
    needsReportReason: true,
    wired: true,
    indicativeTariff: 65,
    depth: 0.7,
  },
  {
    code: 12,
    key: "full-enhanced-credit-info",
    name: "Full Enhanced Credit Info",
    endpoint: "/report/credit_info",
    method: "POST",
    answers: "Everything the bureau holds, in one call.",
    yields: [
      "Identity verification",
      "Identity scrub",
      "Full account list",
      "Delinquency",
      "Sector exposure",
      "Enquiries & applications",
      "Last 12 months of Metro Score",
      "Last 12 months of Payment Performance Index",
    ],
    needsLoanAmount: true,
    needsReportReason: true,
    wired: true,
    indicativeTariff: 80,
    depth: 1,
    // It literally contains reports 1, 6 and 8 (§4.3.10). Buying them alongside
    // it is money spent twice for the same bytes.
    supersedes: [1, 6, 8],
  },
  {
    code: 13,
    key: "minified-credit-info",
    name: "Minified Credit Info",
    endpoint: "/report/credit_info",
    method: "POST",
    answers: "The one-paragraph version, for a bulk screen.",
    yields: ["Account counts", "Total exposure", "Worst arrears"],
    needsLoanAmount: true,
    needsReportReason: true,
    wired: false,
    indicativeTariff: 20,
    depth: 0.4,
  },
  {
    code: 14,
    key: "full-json-report",
    name: "Full JSON Credit Report",
    endpoint: "/report/json",
    method: "POST",
    answers: "The complete file including guarantors, as raw JSON.",
    yields: ["Identity verification", "Identity scrub", "Credit info", "Stakeholders", "Guarantors"],
    needsLoanAmount: true,
    needsReportReason: true,
    wired: false,
    indicativeTariff: 90,
    depth: 0.95,
    supersedes: [1, 6, 8, 10],
  },
  {
    code: 16,
    key: "accounts-summary",
    name: "Credit Accounts Summary",
    endpoint: "/report/credit_info",
    method: "POST",
    answers: "How many mobile loans are they juggling, and what do they owe monthly?",
    yields: [
      "Mobile vs. generic account counts",
      "Total monthly instalment on generic loans",
      "Accounts in arrears",
      "Accounts in NPL",
      "Reported names & phone numbers",
    ],
    needsLoanAmount: true,
    needsReportReason: true,
    wired: true,
    indicativeTariff: 30,
    depth: 0.5,
  },
  {
    code: 22,
    key: "accounts-info",
    name: "Accounts Info (12-month history)",
    endpoint: "/report/credit_info",
    method: "POST",
    answers: "Is their repayment behaviour getting better or worse?",
    yields: [
      "Per-account status month by month",
      "Days in arrears trend",
      "Last payment amount & date",
      "Overdue balance trend",
      "Credit score trend",
    ],
    needsLoanAmount: true,
    needsReportReason: true,
    options: ["application_ref_no"],
    wired: true,
    indicativeTariff: 45,
    depth: 0.85,
  },
];

export const reportByCode = (code: number): CrbReportDef | undefined =>
  CRB_REPORTS.find((r) => r.code === code);

/** Reports the orchestrator can merge today. The others are raw-callable only. */
export const WIRED_REPORTS: ReportCode[] = CRB_REPORTS.filter((r) => r.wired).map((r) => r.code);

// ─────────────────────────────────────────────────────────────────────────────
// SCRUTINY TIERS — the level of examination a lender is willing to pay for.
//
// A tier is a NAMED REPORT SET, not a magic number. The names are the lender's
// decision, expressed in their language: a KES 2,000 30-day mobile loan gets
// "Screen", a KES 400,000 check-off gets "Forensic", and the same lender runs
// both. That is why the tier is resolved per CHECK (see resolvePlan) and not
// only per org: an org-level default with a per-product override is the shape
// that actually matches how lending works.
// ─────────────────────────────────────────────────────────────────────────────

export type ScrutinyTierKey = "gate" | "screen" | "standard" | "deep" | "forensic" | "custom";

export type ScrutinyTier = {
  key: Exclude<ScrutinyTierKey, "custom">;
  name: string;
  /** One line: what this level of scrutiny is FOR. */
  purpose: string;
  /** The loan sizes this tier is proportionate to, as guidance not a rule. */
  suitedTo: string;
  reports: ReportCode[];
  accent: string;
};

export const SCRUTINY_TIERS: ScrutinyTier[] = [
  {
    key: "gate",
    name: "Gate",
    purpose: "Prove the identity is real. No credit history is bought at all.",
    suitedTo: "Onboarding and KYC, before any money is on the table",
    reports: [REPORT_TYPE.IDENTITY_VERIFY],
    accent: "#64748b",
  },
  {
    key: "screen",
    name: "Screen",
    purpose: "A number and a yes/no. The cheapest pull that can decline someone.",
    suitedTo: "High-volume mobile lending under ~KES 20,000",
    reports: [REPORT_TYPE.DELINQUENCY, REPORT_TYPE.METRO_SCORE],
    accent: "#0284c7",
  },
  {
    key: "standard",
    name: "Standard",
    purpose: "Verified identity, the bureau score, and the whole credit file behind it.",
    suitedTo: "Ordinary unsecured lending, roughly KES 20,000 – 150,000",
    reports: [REPORT_TYPE.METRO_SCORE, REPORT_TYPE.FULL_ENHANCED_CREDIT_INFO],
    accent: "#059669",
  },
  {
    key: "deep",
    name: "Deep",
    purpose: "Standard, plus what they can afford — income estimation and their mobile-loan load.",
    suitedTo: "Affordability-sensitive lending, roughly KES 150,000 – 500,000",
    reports: [
      REPORT_TYPE.METRO_SCORE,
      REPORT_TYPE.FULL_ENHANCED_CREDIT_INFO,
      REPORT_TYPE.CREDIT_INFO_MOBILE,
      REPORT_TYPE.ACCOUNTS_SUMMARY,
    ],
    accent: "#7c3aed",
  },
  {
    key: "forensic",
    name: "Forensic",
    purpose: "Everything: the file, affordability, who guarantees them, and 12 months of behaviour.",
    suitedTo: "Large, secured or check-off lending — anything above ~KES 500,000",
    reports: [
      REPORT_TYPE.METRO_SCORE,
      REPORT_TYPE.FULL_ENHANCED_CREDIT_INFO,
      REPORT_TYPE.CREDIT_INFO_MOBILE,
      REPORT_TYPE.ENHANCED_CREDIT_INFO,
      REPORT_TYPE.ACCOUNTS_SUMMARY,
      REPORT_TYPE.ACCOUNTS_INFO,
    ],
    accent: "#be123c",
  },
];

export const tierByKey = (key: string): ScrutinyTier | undefined =>
  SCRUTINY_TIERS.find((t) => t.key === key);

/** Legacy `reportDepth` values map onto the new tiers so no saved config breaks. */
export const LEGACY_DEPTH_TIER: Record<string, ScrutinyTierKey> = {
  score: "screen",
  standard: "standard",
  full: "deep",
};

// ─────────────────────────────────────────────────────────────────────────────
// AMOUNT LADDER — scrutiny proportional to exposure.
//
// The single most common way a lender overspends at a bureau is buying the same
// depth of file for a KES 3,000 loan as for a KES 300,000 one. A ladder makes
// the tier a function of the amount at risk, which is the only variable that
// actually justifies the spend.
// ─────────────────────────────────────────────────────────────────────────────

export type LadderRung = { upTo: number | null; tier: Exclude<ScrutinyTierKey, "custom"> };

/** The default ladder. Overridable per lender via `CrbConfig.ladder`. */
export const DEFAULT_LADDER: LadderRung[] = [
  { upTo: 20_000, tier: "screen" },
  { upTo: 150_000, tier: "standard" },
  { upTo: 500_000, tier: "deep" },
  { upTo: null, tier: "forensic" },
];

/** Which rung a loan amount lands on. */
export function tierForAmount(amount: number, ladder: LadderRung[] = DEFAULT_LADDER): Exclude<ScrutinyTierKey, "custom"> {
  const amt = Math.max(0, Number(amount) || 0);
  for (const rung of ladder) {
    if (rung.upTo === null || amt <= rung.upTo) return rung.tier;
  }
  return ladder.at(-1)?.tier ?? "standard";
}

// ─────────────────────────────────────────────────────────────────────────────
// THE RESOLVED PLAN — what a single check will actually call, and cost.
// ─────────────────────────────────────────────────────────────────────────────

export type TariffSource = "metropol" | "indicative" | "mixed";

export type CrbPlan = {
  tier: ScrutinyTierKey;
  tierName: string;
  reports: ReportCode[];
  /** Per-report cost as resolved (lender tariff where set, catalogue otherwise). */
  lines: Array<{ code: ReportCode; name: string; cost: number; source: "metropol" | "indicative" }>;
  /** Total KES for ONE check at this tier. */
  perCheck: number;
  tariffSource: TariffSource;
  /** 0..100 — how deep into the file this plan reaches. For the scrutiny meter. */
  scrutiny: number;
  /** Reports selected that another selected report already contains. */
  redundant: Array<{ code: ReportCode; containedBy: ReportCode }>;
  /** Selected reports the orchestrator cannot merge yet. */
  unwired: ReportCode[];
};

export type PlanInput = {
  tier?: ScrutinyTierKey | null;
  /** Explicit report set. Only consulted when tier === "custom". */
  reports?: number[] | null;
  /** Per-report price overrides from Metropol's tariff sheet, keyed by report code. */
  tariff?: Record<string, number> | null;
};

/**
 * Resolve a lender's configuration into the concrete set of calls one check makes.
 *
 * Ordering is stable (catalogue order) so two identical plans always produce the
 * same signature — which matters, because that signature is what the reuse cache
 * and the E409 duplicate guard are keyed on.
 */
export function resolvePlan(input: PlanInput): CrbPlan {
  const tier: ScrutinyTierKey = input.tier ?? "standard";
  const chosen =
    tier === "custom"
      ? (input.reports ?? []).filter((c) => reportByCode(c))
      : (tierByKey(tier)?.reports ?? tierByKey("standard")!.reports);

  // Catalogue order, de-duplicated.
  const codes = CRB_REPORTS.filter((r) => chosen.includes(r.code)).map((r) => r.code);

  const overrides = input.tariff ?? {};
  const lines = codes.map((code) => {
    const def = reportByCode(code)!;
    const override = Number(overrides[String(code)]);
    const hasOverride = Number.isFinite(override) && override >= 0;
    return {
      code,
      name: def.name,
      cost: hasOverride ? override : def.indicativeTariff,
      source: (hasOverride ? "metropol" : "indicative") as "metropol" | "indicative",
    };
  });

  const sources = new Set(lines.map((l) => l.source));
  const tariffSource: TariffSource =
    lines.length === 0 ? "indicative" : sources.size > 1 ? "mixed" : [...sources][0];

  // Redundancy: a report whose content another selected report already contains.
  const redundant: CrbPlan["redundant"] = [];
  for (const code of codes) {
    for (const other of codes) {
      if (other === code) continue;
      if (reportByCode(other)?.supersedes?.includes(code)) {
        redundant.push({ code, containedBy: other });
        break;
      }
    }
  }

  // Scrutiny is the DEEPEST report reached, lifted a little by breadth — not a
  // sum. Buying five shallow reports is not the same as buying one deep one, and
  // a meter that says otherwise would sell the wrong upgrade.
  const deepest = Math.max(0, ...codes.map((c) => reportByCode(c)?.depth ?? 0));
  const breadth = codes.length > 0 ? Math.min(0.15, (codes.length - 1) * 0.04) : 0;

  return {
    tier,
    tierName: tier === "custom" ? "Custom" : (tierByKey(tier)?.name ?? "Standard"),
    reports: codes,
    lines,
    perCheck: lines.reduce((s, l) => s + l.cost, 0),
    tariffSource,
    scrutiny: Math.round(Math.min(1, deepest + breadth) * 100),
    redundant,
    unwired: codes.filter((c) => !reportByCode(c)?.wired),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SPEND PROJECTION
//
// What the lender is buying, per month, before they buy it. Three things move
// the number and all three are theirs to set:
//
//   1. VOLUME — checks per month.
//   2. THE REUSE WINDOW — how long a stored pull stays fresh. A repeat pull
//      inside the window costs nothing, because we serve the stored file. This
//      is also what keeps us clear of Metropol's E409 duplicate guard, which
//      rejects an identical call inside 60 seconds.
//   3. THE TIER — the report set above.
//
// The repeat rate is estimated from the window unless the lender knows theirs.
// The estimate is deliberately conservative (it under-claims the saving) because
// a projection that flatters the caching is a projection that gets a lender's
// bureau bill wrong in the direction that hurts.
// ─────────────────────────────────────────────────────────────────────────────

/** Share of checks expected to land on a borrower already pulled inside the window. */
export function repeatRateFor(reuseHours: number): number {
  const h = Math.max(0, reuseHours);
  if (h <= 0) return 0;
  if (h <= 1) return 0.03;
  if (h <= 6) return 0.08;
  if (h <= 24) return 0.15;
  if (h <= 24 * 7) return 0.3;
  if (h <= 24 * 30) return 0.45;
  return 0.55;
}

export type SpendProjection = {
  perCheck: number;
  monthlyChecks: number;
  /** Every check billed — the no-caching worst case. */
  gross: number;
  /** Checks actually sent to Metropol after the reuse window absorbs repeats. */
  billableChecks: number;
  net: number;
  saved: number;
  repeatRate: number;
  annual: number;
  /** Cost per APPROVED loan — the figure a CFO actually recognises. */
  perApproval: number | null;
  /** Bureau cost as a share of the interest earned on the average loan. */
  costOfCreditPct: number | null;
  budget: number | null;
  /** How far into the monthly budget this projection runs. Null when no budget. */
  budgetUsedPct: number | null;
  overBudget: boolean;
};

export type ProjectionInput = {
  perCheck: number;
  monthlyChecks: number;
  reuseHours: number;
  /** Override the modelled repeat rate when the lender knows their own. */
  repeatRate?: number | null;
  /** Share of checks that end in a disbursement, 0..1. Drives cost-per-approval. */
  approvalRate?: number | null;
  /** Average loan size, for the cost-of-credit ratio. */
  avgLoanAmount?: number | null;
  /** Average all-in yield on a loan, 0..1 (e.g. 0.15 for 15%). */
  avgYield?: number | null;
  monthlyBudget?: number | null;
};

export function projectSpend(input: ProjectionInput): SpendProjection {
  const perCheck = Math.max(0, input.perCheck);
  const monthlyChecks = Math.max(0, Math.round(input.monthlyChecks));
  const repeatRate =
    input.repeatRate != null && Number.isFinite(input.repeatRate)
      ? Math.min(0.9, Math.max(0, input.repeatRate))
      : repeatRateFor(input.reuseHours);

  const gross = perCheck * monthlyChecks;
  const billableChecks = Math.round(monthlyChecks * (1 - repeatRate));
  const net = perCheck * billableChecks;
  const budget = input.monthlyBudget != null && input.monthlyBudget > 0 ? input.monthlyBudget : null;

  const approvals = input.approvalRate != null && input.approvalRate > 0 ? monthlyChecks * input.approvalRate : null;
  const interestPerLoan =
    input.avgLoanAmount != null && input.avgLoanAmount > 0 && input.avgYield != null && input.avgYield > 0
      ? input.avgLoanAmount * input.avgYield
      : null;
  const perApproval = approvals && approvals > 0 ? net / approvals : null;

  return {
    perCheck,
    monthlyChecks,
    gross,
    billableChecks,
    net,
    saved: gross - net,
    repeatRate,
    annual: net * 12,
    perApproval,
    costOfCreditPct: perApproval != null && interestPerLoan ? (perApproval / interestPerLoan) * 100 : null,
    budget,
    budgetUsedPct: budget ? (net / budget) * 100 : null,
    overBudget: budget != null && net > budget,
  };
}

/**
 * The cheapest tier whose monthly spend fits a budget at a given volume.
 *
 * Used by the settings screen to answer "what CAN I afford?" rather than only
 * "what does my choice cost?" — and by the budget guard to pick the fallback
 * when a lender's spend runs out mid-month.
 */
export function tiersWithinBudget(
  monthlyChecks: number,
  reuseHours: number,
  budget: number,
  tariff?: Record<string, number> | null,
): Array<{ tier: ScrutinyTier; projection: SpendProjection; fits: boolean }> {
  return SCRUTINY_TIERS.map((tier) => {
    const plan = resolvePlan({ tier: tier.key, tariff });
    const projection = projectSpend({ perCheck: plan.perCheck, monthlyChecks, reuseHours, monthlyBudget: budget });
    return { tier, projection, fits: !projection.overBudget };
  });
}

/** A stable signature for a plan — the reuse cache and audit trail key on it. */
export function planSignature(plan: CrbPlan): string {
  return `${plan.tier}:${plan.reports.join(",")}`;
}
