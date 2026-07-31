// ─────────────────────────────────────────────────────────────────────────────
// THE WIZARD'S FORM SHAPE, and the bridge to the block definition.
//
// The wizard keeps every value as a STRING so inputs stay controlled and a
// half-typed number never becomes NaN mid-keystroke. The definition
// (lib/products/definition.ts) is the typed document that is actually validated,
// published and snapshotted. These two converters are the only place the two
// representations meet, so a field can never be wired into one and forgotten in the
// other.
//
// Direction matters:
//   formToDefinition   what the admin typed  →  what gets published
//   formFromDefinition a template or a stored version  →  a pre-filled wizard
//
// Round-tripping is exercised by scripts/verify-product-templates.ts.
// ─────────────────────────────────────────────────────────────────────────────
import {
  mergeProduct, PRODUCT_DEFAULTS,
  type PeriodUnit, type ProductDefinition, type ScheduleBlock,
} from "./definition";

export type Form = {
  id: string;
  name: string; description: string;
  principalType: string; minPrincipal: string; maxPrincipal: string; minLoanLimit: string;
  interestType: string; interestMethod: string; interestRate: string; interestPeriodUnit: string;
  earlySettlementEnabled: boolean; earlySettlementDays: string; earlySettlementRate: string;
  repaymentPeriod: string; repaymentPeriodUnit: string; gracePeriodDays: string; penaltyRate: string; repaymentOrder: string;
  minCreditScore: string; guarantorRequired: boolean; guarantorReborrow: boolean; securityRequired: boolean; securityCoverPct: string;
  disbursementMode: string; newWorkflowId: string; repeatWorkflowId: string;
};

export const EMPTY_FORM: Form = {
  id: "", name: "", description: "",
  principalType: "standard", minPrincipal: "1000", maxPrincipal: "50000", minLoanLimit: "",
  interestType: "fixed", interestMethod: "flat", interestRate: "12", interestPeriodUnit: "term",
  earlySettlementEnabled: false, earlySettlementDays: "", earlySettlementRate: "",
  repaymentPeriod: "8", repaymentPeriodUnit: "week", gracePeriodDays: "0", penaltyRate: "5",
  repaymentOrder: "penalty,interest,principal,fees",
  minCreditScore: "", guarantorRequired: false, guarantorReborrow: false, securityRequired: false, securityCoverPct: "100",
  disbursementMode: "B2C_MPESA", newWorkflowId: "", repeatWorkflowId: "",
};

const num = (v: string, fallback = 0) => (v.trim() === "" || !Number.isFinite(Number(v)) ? fallback : Number(v));

/** The wizard's unit vocabulary is the column one; the schedule block adds fortnight. */
function toCycle(unit: string): ScheduleBlock["cycle"] {
  return unit === "day" || unit === "week" || unit === "month" || unit === "fortnight" ? unit : "week";
}

export function formToDefinition(f: Form, base?: ProductDefinition): ProductDefinition {
  // Starting from `base` preserves every block the wizard does not expose — rollover
  // detail, skip days, availability, evidence. Editing pricing in the wizard must
  // not silently reset a rollover cap somebody set deliberately.
  const b = base ?? PRODUCT_DEFAULTS;

  const order = f.repaymentOrder
    .split(",").map((s) => s.trim())
    .filter((s): s is ProductDefinition["pricing"]["repaymentOrder"][number] =>
      s === "penalty" || s === "interest" || s === "principal" || s === "fees");

  return mergeProduct({
    ...b,
    name: f.name.trim(),
    description: f.description.trim(),
    pricing: {
      ...b.pricing,
      method: f.interestMethod === "reducing" ? "reducing" : "flat",
      rateType: f.interestType === "variable" ? "variable" : "fixed",
      rate: num(f.interestRate),
      ratePeriod: (["day", "week", "month", "term"].includes(f.interestPeriodUnit) ? f.interestPeriodUnit : "term") as PeriodUnit,
      penaltyRate: num(f.penaltyRate),
      repaymentOrder: order.length === 4 ? order : b.pricing.repaymentOrder,
      earlySettlement: {
        enabled: f.earlySettlementEnabled,
        withinDays: num(f.earlySettlementDays, b.pricing.earlySettlement.withinDays),
        rebatePct: num(f.earlySettlementRate, b.pricing.earlySettlement.rebatePct),
      },
    },
    schedule: {
      ...b.schedule,
      principalType: (["standard", "interest_first", "balloon"].includes(f.principalType) ? f.principalType : "standard") as ScheduleBlock["principalType"],
      cycle: toCycle(f.repaymentPeriodUnit),
      installments: num(f.repaymentPeriod, 1),
      graceDays: num(f.gracePeriodDays),
    },
    limit: {
      // The basis carries over untouched: the wizard edits a min/max range, and a
      // product whose amount is derived from security or a band ladder must keep
      // that basis — the range fields still bound it either way.
      ...b.limit,
      min: num(f.minPrincipal),
      max: num(f.maxPrincipal),
      floor: num(f.minLoanLimit),
    },
    eligibility: {
      ...b.eligibility,
      minCreditScore: num(f.minCreditScore),
      guarantor: { ...b.eligibility.guarantor, required: f.guarantorRequired, canReborrow: f.guarantorReborrow },
      security: { ...b.eligibility.security, required: f.securityRequired, coverPct: num(f.securityCoverPct, 100) },
    },
    process: {
      ...b.process,
      newLoan: f.newWorkflowId ? "approval" : b.process.newLoan,
      newWorkflowId: f.newWorkflowId || null,
      repeatLoan: (f.repeatWorkflowId || f.newWorkflowId) ? "approval" : b.process.repeatLoan,
      repeatWorkflowId: f.repeatWorkflowId || f.newWorkflowId || null,
      disbursementMode: (f.disbursementMode as ProductDefinition["process"]["disbursementMode"]) || "B2C_MPESA",
    },
  });
}

export function formFromDefinition(d: ProductDefinition, id = ""): Form {
  const es = d.pricing.earlySettlement;
  // A band or fixed product still has to show SOME range in the wizard's number
  // fields; derive it from the bands so the admin sees real figures, not zeros.
  const min = d.limit.basis === "fixed" ? d.limit.fixedAmount
    : d.limit.basis === "bands" && d.limit.bands.length ? Math.min(...d.limit.bands)
      : d.limit.min;
  const max = d.limit.basis === "fixed" ? d.limit.fixedAmount
    : d.limit.basis === "bands" && d.limit.bands.length ? Math.max(...d.limit.bands)
      : d.limit.max;

  return {
    id,
    name: d.name,
    description: d.description,
    principalType: d.schedule.principalType,
    minPrincipal: String(min),
    maxPrincipal: String(max),
    minLoanLimit: d.limit.floor > 0 ? String(d.limit.floor) : "",
    interestType: d.pricing.rateType,
    interestMethod: d.pricing.method,
    interestRate: String(d.pricing.rate),
    interestPeriodUnit: d.pricing.ratePeriod,
    earlySettlementEnabled: es.enabled,
    earlySettlementDays: es.enabled ? String(es.withinDays) : "",
    earlySettlementRate: es.enabled ? String(es.rebatePct) : "",
    repaymentPeriod: String(d.schedule.installments),
    repaymentPeriodUnit: d.schedule.cycle,
    gracePeriodDays: String(d.schedule.graceDays),
    penaltyRate: String(d.pricing.penaltyRate),
    repaymentOrder: d.pricing.repaymentOrder.join(","),
    minCreditScore: d.eligibility.minCreditScore > 0 ? String(d.eligibility.minCreditScore) : "",
    guarantorRequired: d.eligibility.guarantor.required,
    guarantorReborrow: d.eligibility.guarantor.canReborrow,
    securityRequired: d.eligibility.security.required,
    securityCoverPct: String(d.eligibility.security.coverPct),
    disbursementMode: d.process.disbursementMode,
    newWorkflowId: d.process.newWorkflowId ?? "",
    repeatWorkflowId: d.process.repeatWorkflowId ?? "",
  };
}
