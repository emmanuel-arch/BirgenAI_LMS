// ─────────────────────────────────────────────────────────────────────────────
// ServiceSuite → LMS product translation.
//
// A lender's shelf is written in ServiceSuite's vocabulary: integer enums, a rate
// quoted per period, fees banded by principal. This module is the ONE place that
// vocabulary is translated into ours, and it is deliberately pure — every rule
// below was verified against Micromart's live loan book (EntityId 3002) rather
// than inferred from the column names, and the tests re-assert them.
//
// THE RATE, which is the rule everything else hangs off:
//   ServiceSuite stores InterestRate PER UNIT of the repayment period, and
//   InterestMethods.ID 1 is "Flat rate — Principal × Rate × Time". Our
//   lib/lending/schedule.ts reads Product.interestRate as the rate for the WHOLE
//   term. So ours = theirs × RepaymentPeriod.
//
//   Proved on real loans, to the decimal:
//     4 WEEKS  (7.25 × 4)  → 29.00%   loan 436666: P 8,000 → I 2,320 ✓
//     6 WEEKS  (7.25 × 6)  → 43.50%   ✓
//     5 WEEKS  (7.25 × 5)  → 36.25%   ✓
//     SCHOOL FEE-3 MONTH (15 × 3) → 45.00%  ✓
//     JENGA BIASHARA-14 DAYS (2.14 × 14) → 29.96%  ✓
//     IPF (0.83 × 30) → 24.90%  ✓
//   And the shape agrees too: that 4 WEEKS loan pays 4 equal weekly installments
//   of 2,580, which is exactly what buildSchedule() produces for flat/4/week.
//
// NOTE on Products.InterestPeriod: it is NOT a multiplier. 4 WEEKS carries
// InterestPeriod=1 and BIASHARA BOOST carries 3, yet both price at rate × term.
// It is unused legacy data, and reading it would corrupt every price. Only
// InterestPeriodType/RepaymentPeriodType (1=day, 2=week, 3=month) mean anything.
// ─────────────────────────────────────────────────────────────────────────────

/** ServiceSuite period types — Products.RepaymentPeriodType / InterestPeriodType. */
export const PERIOD_UNIT: Record<number, "day" | "week" | "month"> = {
  1: "day",
  2: "week",
  3: "month",
};

/** ServiceSuite InterestMethods (live lookup table on Micromart). */
export const INTEREST_METHOD: Record<number, "flat" | "reducing"> = {
  1: "flat", // "Flat rate — Principal × Rate × Time"
  2: "reducing", // "Reducing balance"
  3: "flat", // "Fixed Amount" — no reducing maths; closest honest mapping.
};

/** ServiceSuite ProductPrincipalType → our repayment shape. */
export const PRINCIPAL_TYPE: Record<number, "standard" | "interest_first" | "balloon"> = {
  1: "standard", // Fixed Amount
  2: "standard", // Amount Range
  3: "standard", // Principal Bands
  4: "standard", // Calculated (from security / asset value)
};

/** ServiceSuite ProductFeesTypes → our ChargeApplyAt. */
export const FEE_APPLY_AT: Record<number, "BEFORE_DISBURSEMENT" | "DEDUCT_FROM_PRINCIPAL" | "ON_INSTALLMENTS"> = {
  1: "BEFORE_DISBURSEMENT", // "Fee applied before the loan is disbursed"
  2: "DEDUCT_FROM_PRINCIPAL", // "Fee deducted on principal before disbursement"
  3: "ON_INSTALLMENTS", // "Fee applied on installments repayment"
};

/** ServiceSuite AmountType — ProductFees.FeeValueType. */
export const FEE_IS_PERCENT: Record<number, boolean> = {
  1: true, // "Percentage(%)"
  2: false, // "Fixed Amount"
};

/**
 * ServiceSuite DisbursmentMode → ours.
 *
 * Micromart uses 1 (the overwhelming majority), 2 and 3. Their meanings are not
 * published in a lookup table, and guessing which one is a bank transfer would put
 * money on the wrong rail. Everything therefore lands on M-Pesa B2C — the rail
 * every one of these loans actually disburses on — and the ServiceSuite value is
 * kept on the product for whoever wires the others up.
 */
export const DISBURSEMENT_MODE = "B2C_MPESA" as const;

export type ServiceSuiteProduct = {
  ID: number;
  ProductName: string;
  ProductDesc: string | null;
  MinPrincipal: number;
  MaxPrincipal: number;
  InterestMethod: number | null;
  InterestRate: number;
  RepaymentPeriod: number;
  RepaymentPeriodType: number | null;
  RepaymentOrder: string | null;
  MinCreditScore: number | null;
  IsActive: number | null;
  WorkflowId: number | null;
  repeatWorkflowId: number | null;
  guarantorRequired: number | null;
  guarantorReborrow: number | null;
  securityRequired: number | null;
  securityLimitType: number | null;
  securityLimitValue: number | null;
  minLoanLimit: number | null;
  PrincipalType: number | null;
  EnableEarlyRate: number | null;
  EarlyPaymentDays: number | null;
  EarlyPaymentRate: number | null;
};

export type MappedProduct = {
  name: string;
  description: string | null;
  minPrincipal: number;
  maxPrincipal: number;
  /** Percent for the WHOLE term — what our schedule engine expects. */
  interestRate: number;
  interestMethod: "flat" | "reducing";
  interestType: "fixed";
  principalType: "standard" | "interest_first" | "balloon";
  interestPeriodUnit: "term";
  repaymentPeriod: number;
  repaymentPeriodUnit: "day" | "week" | "month";
  repaymentOrder: string;
  minLoanLimit: number | null;
  minCreditScore: number | null;
  guarantorRequired: boolean;
  guarantorReborrow: boolean;
  securityRequired: boolean;
  securityCoverPct: number;
  /** ServiceSuite's own securityRequired flag — recorded, deliberately not obeyed. */
  serviceSuiteSecurityRequired: boolean;
  earlySettlementEnabled: boolean;
  earlySettlementDays: number | null;
  earlySettlementRate: number | null;
  isActive: boolean;
  serviceSuiteProductId: number;
  /** ServiceSuite's own rate, per period — kept for the console to explain the price. */
  ratePerPeriod: number;
};

const n = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

/** Rate for the whole term = the per-period rate × the number of periods. */
export function fullTermRate(ratePerPeriod: number, repaymentPeriod: number): number {
  // 2 decimals: 2.14 × 14 = 29.96, and the book says 29.96.
  return Math.round(ratePerPeriod * repaymentPeriod * 100) / 100;
}

/**
 * Does ServiceSuite's securityRequired mean OUR securityRequired? No — and mirroring
 * it as-is would have produced a shelf that cannot lend.
 *
 * Our Product.securityRequired is a HARD GATE: lib/lending/security.ts refuses to book
 * until a named officer has VERIFIED collateral covering securityCoverPct% of the
 * principal. Micromart sets securityRequired=1 on 24 of its 34 products — including
 * 4 WEEKS, which has **226,163 approved loans**. Nobody verifies collateral on a
 * quarter of a million KES 5,000 loans, and the DB agrees: their `Collaterals` table
 * holds **zero rows, server-wide**.
 *
 * So their flag means "show the security fields on the application form" — a
 * data-capture setting. Ours means "do not release money". Same word, different
 * machine. Mirroring it literally would have gated 24 products behind collateral
 * that does not exist, and the demo could not have booked a single 4 WEEKS loan.
 *
 * What IS real about their security is the KES 50 SECURITY FEE, and that comes across
 * as a charge like any other, priced and collected. That is the observable operation.
 *
 * A lender who genuinely wants the collateral gate turns it on per product in the
 * product wizard — an explicit decision, not one inherited from an ambiguous integer.
 */
export const MIRRORED_SECURITY_REQUIRED = false;

/**
 * Security cover, as a percentage of principal — only meaningful once a human has
 * switched the gate on for a product, which the mirror never does.
 *
 * ServiceSuite's securityLimitType/securityLimitValue do NOT reliably follow AmountType:
 * 6 WEEKS carries type=1 (which would mean "percentage") with value=500, and 500% cover
 * would demand KES 25,000 of verified assets against a KES 5,000 loan — plainly not
 * their rule. With no lookup table to settle it, the mirror declines to guess and leaves
 * our own default in place.
 */
export const MIRRORED_SECURITY_COVER_PCT = 100;

export function mapProduct(p: ServiceSuiteProduct): MappedProduct {
  const repaymentPeriod = Math.max(1, n(p.RepaymentPeriod) ?? 1);
  const unit = PERIOD_UNIT[n(p.RepaymentPeriodType) ?? 2] ?? "week";
  const ratePerPeriod = n(p.InterestRate) ?? 0;
  const method = INTEREST_METHOD[n(p.InterestMethod) ?? 1] ?? "flat";
  const minLoanLimit = n(p.minLoanLimit);
  const minCreditScore = n(p.MinCreditScore);

  return {
    name: p.ProductName.trim(),
    description: p.ProductDesc?.trim() || null,
    minPrincipal: n(p.MinPrincipal) ?? 0,
    maxPrincipal: n(p.MaxPrincipal) ?? 0,
    interestRate: fullTermRate(ratePerPeriod, repaymentPeriod),
    interestMethod: method,
    interestType: "fixed",
    principalType: PRINCIPAL_TYPE[n(p.PrincipalType) ?? 2] ?? "standard",
    interestPeriodUnit: "term",
    repaymentPeriod,
    repaymentPeriodUnit: unit,
    // ServiceSuite leaves RepaymentOrder null on every Micromart product; our
    // default waterfall is the one the schedule already assumes.
    repaymentOrder: p.RepaymentOrder?.trim() || "penalty,interest,principal,fees",
    minLoanLimit: minLoanLimit && minLoanLimit > 0 ? minLoanLimit : null,
    minCreditScore: minCreditScore && minCreditScore > 0 ? Math.round(minCreditScore) : null,
    guarantorRequired: n(p.guarantorRequired) === 1,
    guarantorReborrow: n(p.guarantorReborrow) === 1,
    // See MIRRORED_SECURITY_REQUIRED — their flag is form capture, ours stops money.
    securityRequired: MIRRORED_SECURITY_REQUIRED,
    securityCoverPct: MIRRORED_SECURITY_COVER_PCT,
    /** What ServiceSuite said, kept so nothing is silently thrown away. */
    serviceSuiteSecurityRequired: n(p.securityRequired) === 1,
    earlySettlementEnabled: n(p.EnableEarlyRate) === 1,
    earlySettlementDays: n(p.EarlyPaymentDays),
    earlySettlementRate: n(p.EarlyPaymentRate),
    // ServiceSuite's IsActive is not a boolean: 1 = live on the shelf, 2 = switched
    // off. Treating it as truthy would turn every disabled product back on.
    isActive: n(p.IsActive) === 1,
    serviceSuiteProductId: n(p.ID) ?? 0,
    ratePerPeriod,
  };
}

export type ServiceSuiteFee = {
  ID: number;
  ProductId: number;
  FeeName: string;
  FeeDesc: string | null;
  FeeType: number | null;
  FeeValueType: number | null;
  FeeValue: number;
  MinValue: number | null;
  MaxValue: number | null;
  MinPrincipal: number | null;
  MaxPrincipal: number | null;
  IsActive: number | null;
};

export type MappedFee = {
  name: string;
  code: string;
  description: string | null;
  amount: number;
  isPercent: boolean;
  minValue: number | null;
  maxValue: number | null;
  minPrincipal: number | null;
  maxPrincipal: number | null;
  applyAt: "BEFORE_DISBURSEMENT" | "DEDUCT_FROM_PRINCIPAL" | "ON_INSTALLMENTS";
  trigger: "ON_APPLICATION";
  isActive: boolean;
  serviceSuiteFeeId: number;
  serviceSuiteProductId: number;
};

/**
 * A stable, unique M-Pesa AccountReference for a mirrored fee.
 *
 * Charge.code is unique per org and doubles as the reference the customer's payment
 * arrives under, so it cannot simply be "PROCESSING FEE" — Micromart has 33 of those.
 * Keying it to the ServiceSuite fee row keeps it unique, stable across re-runs, and
 * traceable back to the row it mirrors.
 */
export function feeCode(name: string, serviceSuiteFeeId: number): string {
  const slug = name.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 10) || "FEE";
  return `${slug}-${serviceSuiteFeeId}`;
}

export function mapFee(f: ServiceSuiteFee): MappedFee {
  const isPercent = FEE_IS_PERCENT[f.FeeValueType ?? 2] ?? false;
  const name = f.FeeName.trim();
  return {
    name,
    code: feeCode(name, f.ID),
    description: f.FeeDesc?.trim() || null,
    amount: n(f.FeeValue) ?? 0,
    isPercent,
    // The clamp only means anything for a percentage. On a fixed fee ServiceSuite
    // mirrors the amount into Min/MaxValue, and carrying that across would look like
    // a rule when it is just a copy.
    minValue: isPercent ? n(f.MinValue) : null,
    maxValue: isPercent ? n(f.MaxValue) : null,
    minPrincipal: n(f.MinPrincipal),
    maxPrincipal: n(f.MaxPrincipal),
    applyAt: FEE_APPLY_AT[f.FeeType ?? 1] ?? "BEFORE_DISBURSEMENT",
    // Every mirrored fee is a per-loan fee: it is priced off a principal and owed
    // again on the next loan. Registration fees are the org's own, not the shelf's.
    trigger: "ON_APPLICATION",
    isActive: n(f.IsActive) === 1,
    serviceSuiteFeeId: n(f.ID) ?? 0,
    serviceSuiteProductId: n(f.ProductId) ?? 0,
  };
}
