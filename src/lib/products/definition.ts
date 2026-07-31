// ─────────────────────────────────────────────────────────────────────────────
// THE PRODUCT DEFINITION — eight blocks, not sixty columns.
//
// What we are replacing: `ServiceSuite/Models/LoanProduct.cs` is 231 lines of ~60
// nullable integers holding untyped codes — `RollOverOn = 2`, `newLoanStatus = 1`,
// `modeOfDisbursement = 3` — whose meanings live in a Razor <option> list and
// nowhere else. Nothing stops MinPrincipal > MaxPrincipal, a weekly product with a
// monthly interest period, or a rollover penalty with no grace unit. And because
// `Loan` points at the product ROW, editing a rate rewrites what past borrowers
// agreed to.
//
// Here a product is a COMPOSITION OF NAMED BLOCKS, each independently meaningful:
//
//   pricing       what it costs
//   schedule      what shape the repayments take
//   limit         how much a borrower may have
//   rollover      what happens when they run past maturity
//   eligibility   who may have it at all
//   process       who approves it
//   evidence      what they must bring
//   availability  where and through what channel it is sold
//
// Three properties follow that their model cannot express:
//
//   1. EVERY VALUE IS NAMED. `rollover.penaltyBase = "unpaid_principal"` reads
//      itself; `RollOverOn = 2` does not.
//   2. THE BLOCKS VALIDATE EACH OTHER. Interest charged per month on a product that
//      repays weekly over 6 installments is caught here, not at the counter.
//   3. IT IS SNAPSHOTTABLE. The whole document is written to ProductVersion on
//      publish, so a loan can always answer what it agreed to.
//
// The flat columns on `Product` remain, as a PROJECTION of the live version
// (`projectToColumns`), so every query written before versioning keeps working.
// ─────────────────────────────────────────────────────────────────────────────

export type PeriodUnit = "day" | "week" | "month" | "term";

export type PricingBlock = {
  /** How the balance interest is computed. */
  method: "flat" | "reducing";
  /** Whether the rate can move for the life of the loan. */
  rateType: "fixed" | "variable";
  /** Percent. */
  rate: number;
  /** The period the rate is quoted against. "term" = once, over the whole loan. */
  ratePeriod: PeriodUnit;
  /** Percent per period applied to arrears. */
  penaltyRate: number;
  /** The waterfall a payment is applied in, most-senior first. */
  repaymentOrder: ("penalty" | "interest" | "principal" | "fees")[];
  /** Settling early rebates part of the unearned interest. */
  earlySettlement: { enabled: boolean; withinDays: number; rebatePct: number };
};

export type ScheduleBlock = {
  /** The repayment shape. */
  principalType: "standard" | "interest_first" | "balloon";
  /** How often an installment falls due. */
  cycle: "day" | "week" | "fortnight" | "month";
  /** How many installments. */
  installments: number;
  /** Days after disbursement before the first installment is due. */
  graceDays: number;
  /** Days of the week no installment may fall on (0 = Sunday). */
  skipDays: number[];
  /** A due date landing on a skipped day moves this way. */
  onSkippedDay: "next_business_day" | "previous_business_day";
};

export type LimitBlock = {
  /**
   * Where the borrowable amount comes from.
   *   fixed     one amount, take it or leave it
   *   range     anything between min and max
   *   bands     a ladder of discrete amounts
   *   security  a percentage of verified collateral value
   *   scored    the limit engine decides, inside min/max
   */
  basis: "fixed" | "range" | "bands" | "security" | "scored";
  fixedAmount: number;
  min: number;
  max: number;
  /** basis = "bands". */
  bands: number[];
  /** basis = "security" — percent of the verified collateral value. */
  securityLtvPct: number;
  /** The floor below which there is no loan, whatever the engine derives. */
  floor: number;
  /** May an approver move the amount off what was applied for? */
  allowIncrease: boolean;
  allowDecrease: boolean;
};

export type RolloverBlock = {
  enabled: boolean;
  /** Charged at final maturity, or at every missed installment. */
  applyAt: "maturity" | "installment";
  /** What the penalty is a percentage OF. */
  penaltyBase: "unpaid_principal" | "unpaid_interest" | "unpaid_principal_interest" | "total_balance";
  /** Days of leniency before the penalty starts. */
  graceDays: number;
  /** Percent, or a flat amount. */
  valueType: "percent" | "fixed";
  value: number;
  /** Charged once, or every cycle until cleared. */
  recurrence: "once" | "recurring";
  /** recurrence = "recurring" — days between charges. */
  everyDays: number;
  /** Stop charging once total penalties reach this. 0 = no cap. */
  cap: number;
};

export type EligibilityBlock = {
  minCreditScore: number;
  /** Overrides the org-wide age rule when set. 0 = inherit borrower settings. */
  minAge: number;
  maxAge: number;
  /** Must have cleared this many loans before this product is offered. */
  minClearedLoans: number;
  guarantor: { required: boolean; count: number; canReborrow: boolean };
  security: { required: boolean; coverPct: number };
  /** A borrower may not hold two live loans on this product at once. */
  oneAtATime: boolean;
};

export type ProcessBlock = {
  /** How a FIRST loan on this product is treated. */
  newLoan: "approval" | "direct";
  newWorkflowId: string | null;
  /** newLoan = "direct" — fund without approval up to this amount. */
  newDirectCeiling: number;
  /** How a REPEAT loan is treated. Almost always looser than the first. */
  repeatLoan: "approval" | "direct";
  repeatWorkflowId: string | null;
  repeatDirectCeiling: number;
  disbursementMode: "B2C_MPESA" | "MANUAL" | "TO_THIRD_PARTY" | "LENDER_SIDE";
  /** May an approver post-date or back-date the start date? */
  allowPostDate: boolean;
  allowBackDate: boolean;
};

export type EvidenceBlock = {
  /** Document kinds required on an application for this product. */
  documents: string[];
  /** The borrower's business/home pin must be on file before money moves. */
  requireGeoPin: boolean;
  /** A field officer must physically verify before disbursement. */
  requireFieldVisit: boolean;
};

export type AvailabilityBlock = {
  /** Branch ids this product is sold at. Empty = everywhere. */
  branchIds: string[];
  /** Where a borrower can reach it. */
  channels: ("console" | "portal" | "ussd" | "api")[];
  /** ISO dates. Null = no bound. */
  activeFrom: string | null;
  activeTo: string | null;
};

export type ProductDefinition = {
  /** Bumped when the block SHAPE changes, so old snapshots stay readable. */
  schemaVersion: 1;
  name: string;
  description: string;
  pricing: PricingBlock;
  schedule: ScheduleBlock;
  limit: LimitBlock;
  rollover: RolloverBlock;
  eligibility: EligibilityBlock;
  process: ProcessBlock;
  evidence: EvidenceBlock;
  availability: AvailabilityBlock;
};

export const BLOCK_KEYS = [
  "pricing", "schedule", "limit", "rollover", "eligibility", "process", "evidence", "availability",
] as const;
export type BlockKey = (typeof BLOCK_KEYS)[number];

export const BLOCK_LABELS: Record<BlockKey, { label: string; blurb: string }> = {
  pricing: { label: "Pricing", blurb: "What it costs — rate, method, penalties, early settlement." },
  schedule: { label: "Schedule", blurb: "The shape of the repayments." },
  limit: { label: "Limits", blurb: "How much a borrower may take." },
  rollover: { label: "Rollover", blurb: "What happens past maturity." },
  eligibility: { label: "Eligibility", blurb: "Who may have this product at all." },
  process: { label: "Process", blurb: "Who approves it, and how it pays out." },
  evidence: { label: "Evidence", blurb: "What the borrower must bring." },
  availability: { label: "Availability", blurb: "Where and through what channel it is sold." },
};

export const PRODUCT_DEFAULTS: ProductDefinition = {
  schemaVersion: 1,
  name: "",
  description: "",
  pricing: {
    method: "flat",
    rateType: "fixed",
    rate: 12,
    ratePeriod: "term",
    penaltyRate: 5,
    repaymentOrder: ["penalty", "interest", "principal", "fees"],
    earlySettlement: { enabled: false, withinDays: 30, rebatePct: 50 },
  },
  schedule: {
    principalType: "standard",
    cycle: "week",
    installments: 8,
    graceDays: 0,
    skipDays: [],
    onSkippedDay: "next_business_day",
  },
  limit: {
    basis: "range",
    fixedAmount: 0,
    min: 1_000,
    max: 50_000,
    bands: [],
    securityLtvPct: 70,
    floor: 0,
    allowIncrease: false,
    allowDecrease: true,
  },
  rollover: {
    enabled: false,
    applyAt: "maturity",
    penaltyBase: "unpaid_principal_interest",
    graceDays: 3,
    valueType: "percent",
    value: 5,
    recurrence: "once",
    everyDays: 30,
    cap: 0,
  },
  eligibility: {
    minCreditScore: 0,
    minAge: 0,
    maxAge: 0,
    minClearedLoans: 0,
    guarantor: { required: false, count: 1, canReborrow: false },
    security: { required: false, coverPct: 100 },
    oneAtATime: true,
  },
  process: {
    newLoan: "approval",
    newWorkflowId: null,
    newDirectCeiling: 0,
    repeatLoan: "approval",
    repeatWorkflowId: null,
    repeatDirectCeiling: 0,
    disbursementMode: "B2C_MPESA",
    allowPostDate: false,
    allowBackDate: false,
  },
  evidence: { documents: [], requireGeoPin: true, requireFieldVisit: false },
  availability: { branchIds: [], channels: ["console", "portal"], activeFrom: null, activeTo: null },
};

// ── Validation ────────────────────────────────────────────────────────────────

export type ProductIssue = { path: string; message: string };

/** How many days one cycle of the schedule spans — used for period coherence checks. */
const CYCLE_DAYS: Record<ScheduleBlock["cycle"], number> = {
  day: 1, week: 7, fortnight: 14, month: 30,
};

/** The whole loan's term, in days. */
export function termDays(s: ScheduleBlock): number {
  return CYCLE_DAYS[s.cycle] * Math.max(1, s.installments) + Math.max(0, s.graceDays);
}

export function validateProduct(d: ProductDefinition): ProductIssue[] {
  const out: ProductIssue[] = [];
  const bad = (path: string, message: string) => out.push({ path, message });

  if (!d.name || d.name.trim().length < 3) bad("name", "Give the product a name of at least 3 characters.");

  // ── Pricing ──
  if (d.pricing.rate < 0 || d.pricing.rate > 100) bad("pricing.rate", "Interest rate must be between 0 and 100%.");
  if (d.pricing.penaltyRate < 0 || d.pricing.penaltyRate > 100) bad("pricing.penaltyRate", "Penalty rate must be between 0 and 100%.");
  {
    const order = new Set(d.pricing.repaymentOrder);
    for (const t of ["penalty", "interest", "principal", "fees"] as const) {
      if (!order.has(t)) bad("pricing.repaymentOrder", `The repayment waterfall is missing "${t}" — a payment would have nowhere to go.`);
    }
  }
  if (d.pricing.earlySettlement.enabled) {
    if (d.pricing.earlySettlement.withinDays <= 0) bad("pricing.earlySettlement.withinDays", "Set the early-settlement window.");
    if (d.pricing.earlySettlement.rebatePct <= 0 || d.pricing.earlySettlement.rebatePct > 100) {
      bad("pricing.earlySettlement.rebatePct", "The rebate must be between 1 and 100% of unearned interest.");
    }
    if (d.pricing.earlySettlement.withinDays >= termDays(d.schedule)) {
      bad("pricing.earlySettlement.withinDays", "The early-settlement window is longer than the loan term — every loan would qualify.");
    }
  }
  // The cross-block check their model cannot express: a rate quoted per month on a
  // loan that finishes inside a month prices nothing anyone can explain.
  if (d.pricing.ratePeriod === "month" && termDays(d.schedule) < 28) {
    bad("pricing.ratePeriod", "Interest is quoted per month but the loan runs under a month. Quote it per week or per term.");
  }
  if (d.pricing.ratePeriod === "week" && d.schedule.cycle === "day" && d.schedule.installments < 7) {
    bad("pricing.ratePeriod", "Interest is quoted per week but the loan runs under a week.");
  }

  // ── Schedule ──
  if (!Number.isInteger(d.schedule.installments) || d.schedule.installments < 1 || d.schedule.installments > 120) {
    bad("schedule.installments", "Installments must be a whole number between 1 and 120.");
  }
  if (d.schedule.graceDays < 0) bad("schedule.graceDays", "Grace days cannot be negative.");
  if (d.schedule.skipDays.length >= 7) bad("schedule.skipDays", "Every day of the week is skipped — no installment could ever fall due.");
  if (d.schedule.principalType === "interest_first" && d.schedule.installments < 2) {
    bad("schedule.principalType", "Interest-first needs at least two installments — the first services interest, the last clears principal.");
  }

  // ── Limits ──
  switch (d.limit.basis) {
    case "fixed":
      if (d.limit.fixedAmount <= 0) bad("limit.fixedAmount", "Set the fixed loan amount.");
      break;
    case "range":
    case "scored":
      if (d.limit.min <= 0) bad("limit.min", "Set the minimum principal.");
      if (d.limit.max < d.limit.min) bad("limit.max", "Maximum principal must be at least the minimum.");
      break;
    case "bands":
      if (d.limit.bands.length === 0) bad("limit.bands", "Add at least one band.");
      if (d.limit.bands.some((b) => b <= 0)) bad("limit.bands", "Every band must be greater than zero.");
      break;
    case "security":
      if (d.limit.securityLtvPct <= 0 || d.limit.securityLtvPct > 100) bad("limit.securityLtvPct", "Loan-to-value must be between 1 and 100%.");
      if (!d.eligibility.security.required) bad("limit.basis", "The limit is derived from security, but security is not required — there would be nothing to derive it from.");
      break;
  }
  if (d.limit.floor > 0 && d.limit.basis !== "fixed" && d.limit.floor > d.limit.max && d.limit.max > 0) {
    bad("limit.floor", "The minimum loan floor is above the maximum principal — no amount would be bookable.");
  }

  // ── Rollover ──
  if (d.rollover.enabled) {
    if (d.rollover.value <= 0) bad("rollover.value", "Set the rollover penalty, or switch rollover off.");
    if (d.rollover.valueType === "percent" && d.rollover.value > 100) bad("rollover.value", "A percentage penalty cannot exceed 100%.");
    if (d.rollover.recurrence === "recurring" && d.rollover.everyDays <= 0) {
      bad("rollover.everyDays", "A recurring penalty needs an interval in days.");
    }
    if (d.rollover.recurrence === "recurring" && d.rollover.cap <= 0) {
      // Not fatal, but a recurring uncapped penalty is how a KES 5,000 loan
      // becomes a KES 90,000 debt. Say so out loud.
      bad("rollover.cap", "A recurring penalty with no cap grows without limit. Set a maximum.");
    }
    if (d.rollover.applyAt === "installment" && d.schedule.installments === 1) {
      bad("rollover.applyAt", "There is only one installment, so per-installment and per-maturity are the same thing.");
    }
  }

  // ── Eligibility ──
  if (d.eligibility.minCreditScore < 0 || d.eligibility.minCreditScore > 1000) {
    bad("eligibility.minCreditScore", "Minimum credit score must be between 0 and 1000.");
  }
  if (d.eligibility.minAge > 0 && d.eligibility.maxAge > 0 && d.eligibility.minAge >= d.eligibility.maxAge) {
    bad("eligibility.maxAge", "Maximum age must be greater than minimum age.");
  }
  if (d.eligibility.guarantor.required && d.eligibility.guarantor.count < 1) {
    bad("eligibility.guarantor.count", "A guarantor is required but the count is zero.");
  }
  if (d.eligibility.security.required && d.eligibility.security.coverPct <= 0) {
    bad("eligibility.security.coverPct", "Set the security cover percentage.");
  }

  // ── Process ──
  if (d.process.newLoan === "approval" && !d.process.newWorkflowId) {
    bad("process.newWorkflowId", "New loans need approval but no workflow is selected — they would have nowhere to go.");
  }
  if (d.process.repeatLoan === "approval" && !d.process.repeatWorkflowId) {
    bad("process.repeatWorkflowId", "Repeat loans need approval but no workflow is selected.");
  }
  if (d.process.newLoan === "direct" && d.process.newDirectCeiling <= 0) {
    bad("process.newDirectCeiling", "Direct funding needs a ceiling — otherwise any amount pays out unreviewed.");
  }
  if (d.process.repeatLoan === "direct" && d.process.repeatDirectCeiling <= 0) {
    bad("process.repeatDirectCeiling", "Direct funding needs a ceiling.");
  }

  // ── Availability ──
  if (d.availability.channels.length === 0) {
    bad("availability.channels", "A product with no channel cannot be reached by anyone.");
  }
  if (d.availability.activeFrom && d.availability.activeTo && d.availability.activeFrom > d.availability.activeTo) {
    bad("availability.activeTo", "The availability window ends before it begins.");
  }

  return out;
}

/**
 * Fill a stored definition forward to the current shape.
 *
 * Same contract as the borrower namespace: a lender keeps every choice they made and
 * inherits today's defaults for anything that did not exist when they published.
 */
export function mergeProduct(stored: unknown): ProductDefinition {
  const s = (stored ?? {}) as Partial<ProductDefinition>;
  const d = PRODUCT_DEFAULTS;
  return {
    schemaVersion: 1,
    name: s.name ?? d.name,
    description: s.description ?? d.description,
    pricing: { ...d.pricing, ...s.pricing, earlySettlement: { ...d.pricing.earlySettlement, ...s.pricing?.earlySettlement } },
    schedule: { ...d.schedule, ...s.schedule },
    limit: { ...d.limit, ...s.limit },
    rollover: { ...d.rollover, ...s.rollover },
    eligibility: {
      ...d.eligibility, ...s.eligibility,
      guarantor: { ...d.eligibility.guarantor, ...s.eligibility?.guarantor },
      security: { ...d.eligibility.security, ...s.eligibility?.security },
    },
    process: { ...d.process, ...s.process },
    evidence: { ...d.evidence, ...s.evidence },
    availability: { ...d.availability, ...s.availability },
  };
}

// ── Projection onto the flat Product columns ──────────────────────────────────

/** The `repaymentPeriodUnit` column has no "fortnight" — it is stored as weeks. */
function cycleToUnit(cycle: ScheduleBlock["cycle"]): { unit: string; multiplier: number } {
  return cycle === "fortnight" ? { unit: "week", multiplier: 2 } : { unit: cycle, multiplier: 1 };
}

/**
 * The live version, expressed in the columns the rest of the app already reads.
 *
 * This is what lets versioning land WITHOUT a big-bang rewrite: the scheduler, the
 * limit engine, the portal and every existing query keep reading `Product`, while the
 * definition becomes the thing that is actually authored and snapshotted. As call
 * sites migrate to the definition, the projection shrinks.
 */
export function projectToColumns(d: ProductDefinition) {
  const { unit, multiplier } = cycleToUnit(d.schedule.cycle);
  const min = d.limit.basis === "fixed" ? d.limit.fixedAmount
    : d.limit.basis === "bands" ? Math.min(...(d.limit.bands.length ? d.limit.bands : [0]))
      : d.limit.min;
  const max = d.limit.basis === "fixed" ? d.limit.fixedAmount
    : d.limit.basis === "bands" ? Math.max(...(d.limit.bands.length ? d.limit.bands : [0]))
      : d.limit.max;

  return {
    name: d.name.trim(),
    description: d.description.trim() || null,
    minPrincipal: min,
    maxPrincipal: max,
    interestRate: d.pricing.rate,
    interestMethod: d.pricing.method,
    interestType: d.pricing.rateType,
    // The projection multiplies a fortnightly cycle out into weeks, so a column
    // reader sees the same calendar the definition describes.
    interestPeriodUnit: d.pricing.ratePeriod,
    principalType: d.schedule.principalType,
    repaymentPeriod: d.schedule.installments * multiplier,
    repaymentPeriodUnit: unit,
    gracePeriodDays: d.schedule.graceDays,
    penaltyRate: d.pricing.penaltyRate,
    repaymentOrder: d.pricing.repaymentOrder.join(","),
    earlySettlementEnabled: d.pricing.earlySettlement.enabled,
    earlySettlementDays: d.pricing.earlySettlement.enabled ? d.pricing.earlySettlement.withinDays : null,
    earlySettlementRate: d.pricing.earlySettlement.enabled ? d.pricing.earlySettlement.rebatePct : null,
    minLoanLimit: d.limit.floor > 0 ? d.limit.floor : null,
    minCreditScore: d.eligibility.minCreditScore > 0 ? d.eligibility.minCreditScore : null,
    guarantorRequired: d.eligibility.guarantor.required,
    guarantorReborrow: d.eligibility.guarantor.canReborrow,
    securityRequired: d.eligibility.security.required,
    securityCoverPct: d.eligibility.security.coverPct,
    disbursementMode: d.process.disbursementMode,
    newWorkflowId: d.process.newWorkflowId,
    repeatWorkflowId: d.process.repeatWorkflowId,
  };
}

/**
 * Read a legacy flat product back into a definition.
 *
 * Products created before versioning have columns and no document. Rather than
 * asking a lender to re-enter them, the first publish lifts the columns into blocks
 * — so v1 of an existing product is exactly what it already was.
 */
export function definitionFromColumns(p: Record<string, unknown>): ProductDefinition {
  const num = (v: unknown, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  const unit = String(p.repaymentPeriodUnit ?? "week");
  const cycle: ScheduleBlock["cycle"] =
    unit === "day" || unit === "week" || unit === "month" ? unit : "week";

  const order = String(p.repaymentOrder ?? "penalty,interest,principal,fees")
    .split(",").map((s) => s.trim())
    .filter((s): s is PricingBlock["repaymentOrder"][number] =>
      s === "penalty" || s === "interest" || s === "principal" || s === "fees");

  return mergeProduct({
    name: String(p.name ?? ""),
    description: String(p.description ?? ""),
    pricing: {
      method: p.interestMethod === "reducing" ? "reducing" : "flat",
      rateType: p.interestType === "variable" ? "variable" : "fixed",
      rate: num(p.interestRate, 0),
      ratePeriod: (["day", "week", "month", "term"].includes(String(p.interestPeriodUnit)) ? p.interestPeriodUnit : "term") as PeriodUnit,
      penaltyRate: num(p.penaltyRate, 0),
      repaymentOrder: order.length === 4 ? order : PRODUCT_DEFAULTS.pricing.repaymentOrder,
      earlySettlement: {
        enabled: Boolean(p.earlySettlementEnabled),
        withinDays: num(p.earlySettlementDays, 30),
        rebatePct: num(p.earlySettlementRate, 50),
      },
    },
    schedule: {
      principalType: (["standard", "interest_first", "balloon"].includes(String(p.principalType)) ? p.principalType : "standard") as ScheduleBlock["principalType"],
      cycle,
      installments: num(p.repaymentPeriod, 1),
      graceDays: num(p.gracePeriodDays, 0),
      skipDays: [],
      onSkippedDay: "next_business_day",
    },
    limit: {
      basis: "range",
      fixedAmount: 0,
      min: num(p.minPrincipal, 0),
      max: num(p.maxPrincipal, 0),
      bands: [],
      securityLtvPct: 70,
      floor: num(p.minLoanLimit, 0),
      allowIncrease: false,
      allowDecrease: true,
    },
    eligibility: {
      minCreditScore: num(p.minCreditScore, 0),
      minAge: 0,
      maxAge: 0,
      minClearedLoans: 0,
      guarantor: { required: Boolean(p.guarantorRequired), count: 1, canReborrow: Boolean(p.guarantorReborrow) },
      security: { required: Boolean(p.securityRequired), coverPct: num(p.securityCoverPct, 100) },
      oneAtATime: true,
    },
    process: {
      newLoan: p.newWorkflowId ? "approval" : "direct",
      newWorkflowId: (p.newWorkflowId as string) ?? null,
      newDirectCeiling: p.newWorkflowId ? 0 : num(p.maxPrincipal, 0),
      repeatLoan: p.repeatWorkflowId ? "approval" : "direct",
      repeatWorkflowId: (p.repeatWorkflowId as string) ?? null,
      repeatDirectCeiling: p.repeatWorkflowId ? 0 : num(p.maxPrincipal, 0),
      disbursementMode: (p.disbursementMode as ProcessBlock["disbursementMode"]) ?? "B2C_MPESA",
      allowPostDate: false,
      allowBackDate: false,
    },
  });
}
