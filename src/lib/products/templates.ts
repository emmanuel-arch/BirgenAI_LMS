// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE PACKS — the five products a Kenyan lender actually sells.
//
// A lender onboarding onto the reference system starts at an empty six-step wizard
// with sixty untyped fields and no idea which combination is normal. That is the
// single biggest reason their onboarding is a project: someone who already knows
// the system has to sit with the lender and fill it in.
//
// Here "create a product" starts from a working shape that a real lender would
// recognise, and the lender tunes it. Because a template is just a
// ProductDefinition, "start from" is a copy — no special-casing anywhere, and the
// validator holds a templated product to exactly the same standard as a hand-built
// one.
//
// These are DEFAULTS, not opinions about the lender's economics: rates and terms are
// deliberately conservative round numbers meant to be edited on the first screen.
// The shape is the valuable part — which blocks matter for this kind of lending, and
// which settings have to agree with each other.
// ─────────────────────────────────────────────────────────────────────────────
import { PRODUCT_DEFAULTS, mergeProduct, type ProductDefinition } from "./definition";

export type ProductTemplate = {
  id: string;
  name: string;
  /** One line on the gallery card. */
  tagline: string;
  /** Who this is for, in the lender's words. */
  audience: string;
  /** The three facts that distinguish it, for the card's spec strip. */
  highlights: string[];
  icon: "store" | "wallet" | "truck" | "car" | "users";
  definition: ProductDefinition;
};

const t = (partial: Parameters<typeof mergeProduct>[0]) => mergeProduct(partial);

export const PRODUCT_TEMPLATES: ProductTemplate[] = [
  {
    id: "micro-business",
    name: "Micro Business Loan",
    tagline: "Weekly working capital for a market trader or kiosk.",
    audience: "Traders with daily takings and no formal payslip.",
    highlights: ["Weekly repayments", "M-Pesa cashflow scored", "Business photo required"],
    icon: "store",
    definition: t({
      name: "Micro Business Loan",
      description: "Short-term working capital repaid weekly from daily business takings.",
      pricing: {
        ...PRODUCT_DEFAULTS.pricing,
        method: "flat", rate: 15, ratePeriod: "term", penaltyRate: 5,
      },
      schedule: { ...PRODUCT_DEFAULTS.schedule, cycle: "week", installments: 8, graceDays: 7, skipDays: [0] },
      limit: { ...PRODUCT_DEFAULTS.limit, basis: "scored", min: 3_000, max: 100_000, floor: 3_000 },
      rollover: {
        ...PRODUCT_DEFAULTS.rollover,
        enabled: true, applyAt: "maturity", penaltyBase: "unpaid_principal_interest",
        graceDays: 3, valueType: "percent", value: 5, recurrence: "once", cap: 0,
      },
      eligibility: {
        ...PRODUCT_DEFAULTS.eligibility,
        minCreditScore: 420,
        guarantor: { required: true, count: 1, canReborrow: false },
        security: { required: false, coverPct: 100 },
      },
      evidence: {
        documents: ["MPESA_STATEMENT", "ID_FRONT", "SELFIE", "BUSINESS_PHOTO"],
        requireGeoPin: true, requireFieldVisit: false,
      },
    }),
  },

  {
    id: "salary-advance",
    name: "Salary Advance",
    tagline: "One-installment advance cleared on payday.",
    audience: "Employed borrowers with a verifiable payslip.",
    highlights: ["Single installment", "Monthly cycle", "Payslip + employment letter"],
    icon: "wallet",
    definition: t({
      name: "Salary Advance",
      description: "A one-off advance against next month's salary, cleared in full on payday.",
      pricing: {
        ...PRODUCT_DEFAULTS.pricing,
        method: "flat", rate: 8, ratePeriod: "month", penaltyRate: 4,
        earlySettlement: { enabled: true, withinDays: 10, rebatePct: 50 },
      },
      // One installment, a month out — so the early-settlement window (10 days)
      // stays comfortably inside the term and the monthly rate period is coherent.
      schedule: { ...PRODUCT_DEFAULTS.schedule, cycle: "month", installments: 1, graceDays: 0 },
      limit: { ...PRODUCT_DEFAULTS.limit, basis: "scored", min: 5_000, max: 150_000, floor: 5_000 },
      eligibility: {
        ...PRODUCT_DEFAULTS.eligibility,
        minCreditScore: 500,
        guarantor: { required: false, count: 0, canReborrow: false },
        security: { required: false, coverPct: 100 },
      },
      process: {
        ...PRODUCT_DEFAULTS.process,
        // A repeat salary advance to a proven employee is the classic case for
        // direct funding — the first one is still reviewed.
        newLoan: "approval", repeatLoan: "direct", repeatDirectCeiling: 30_000,
      },
      evidence: {
        documents: ["PAYSLIP", "EMPLOYMENT_LETTER", "ID_FRONT", "SELFIE", "MPESA_STATEMENT"],
        requireGeoPin: false, requireFieldVisit: false,
      },
    }),
  },

  {
    id: "asset-finance",
    name: "Asset Finance",
    tagline: "Finance a machine, a fridge, a boda — the asset is the security.",
    audience: "Borrowers buying productive equipment.",
    highlights: ["Monthly over 12", "70% loan-to-value", "Field visit before release"],
    icon: "truck",
    definition: t({
      name: "Asset Finance",
      description: "Medium-term finance for productive equipment, secured on the asset itself.",
      pricing: { ...PRODUCT_DEFAULTS.pricing, method: "reducing", rate: 2.5, ratePeriod: "month", penaltyRate: 3 },
      schedule: { ...PRODUCT_DEFAULTS.schedule, cycle: "month", installments: 12, graceDays: 30 },
      // The amount IS a function of the asset — which is why security is required
      // below; the validator refuses this basis without it.
      limit: { ...PRODUCT_DEFAULTS.limit, basis: "security", securityLtvPct: 70, min: 20_000, max: 800_000, floor: 20_000 },
      eligibility: {
        ...PRODUCT_DEFAULTS.eligibility,
        minCreditScore: 480, minClearedLoans: 1,
        guarantor: { required: true, count: 1, canReborrow: false },
        security: { required: true, coverPct: 143 },
      },
      evidence: {
        documents: ["ID_FRONT", "SELFIE", "SECURITY_PHOTO", "MPESA_STATEMENT", "BUSINESS_LICENCE"],
        requireGeoPin: true, requireFieldVisit: true,
      },
    }),
  },

  {
    id: "logbook",
    name: "Logbook Loan",
    tagline: "Secured on a motor vehicle, released against the logbook.",
    audience: "Vehicle owners needing a larger, longer facility.",
    highlights: ["Reducing balance", "Logbook held", "Recurring rollover, capped"],
    icon: "car",
    definition: t({
      name: "Logbook Loan",
      description: "A larger facility secured on a motor vehicle, with the logbook held for the term.",
      pricing: { ...PRODUCT_DEFAULTS.pricing, method: "reducing", rate: 3, ratePeriod: "month", penaltyRate: 4 },
      schedule: { ...PRODUCT_DEFAULTS.schedule, cycle: "month", installments: 18, graceDays: 30 },
      limit: { ...PRODUCT_DEFAULTS.limit, basis: "security", securityLtvPct: 50, min: 50_000, max: 2_000_000, floor: 50_000 },
      rollover: {
        ...PRODUCT_DEFAULTS.rollover,
        enabled: true, applyAt: "installment", penaltyBase: "unpaid_principal",
        graceDays: 5, valueType: "percent", value: 2,
        // Recurring, but capped — the validator insists on a cap here, because an
        // uncapped recurring penalty is how a small arrears becomes an unpayable one.
        recurrence: "recurring", everyDays: 30, cap: 50_000,
      },
      eligibility: {
        ...PRODUCT_DEFAULTS.eligibility,
        minCreditScore: 520, minAge: 21, maxAge: 65,
        guarantor: { required: false, count: 0, canReborrow: false },
        security: { required: true, coverPct: 200 },
      },
      process: { ...PRODUCT_DEFAULTS.process, disbursementMode: "B2C_MPESA", allowPostDate: true },
      evidence: {
        documents: ["ID_FRONT", "ID_BACK", "SELFIE", "LOGBOOK", "SECURITY_PHOTO", "BANK_STATEMENT"],
        requireGeoPin: true, requireFieldVisit: true,
      },
    }),
  },

  {
    id: "group",
    name: "Group / Chama Loan",
    tagline: "Joint-liability lending to a savings group.",
    audience: "Chamas and self-help groups guaranteeing each other.",
    highlights: ["Fortnightly", "3 guarantors", "No collateral"],
    icon: "users",
    definition: t({
      name: "Group / Chama Loan",
      description: "Joint-liability lending where group members guarantee one another rather than pledging security.",
      pricing: { ...PRODUCT_DEFAULTS.pricing, method: "flat", rate: 10, ratePeriod: "term", penaltyRate: 5 },
      schedule: { ...PRODUCT_DEFAULTS.schedule, cycle: "fortnight", installments: 12, graceDays: 14, skipDays: [0] },
      limit: { ...PRODUCT_DEFAULTS.limit, basis: "bands", bands: [5_000, 10_000, 20_000, 40_000, 80_000], floor: 5_000 },
      eligibility: {
        ...PRODUCT_DEFAULTS.eligibility,
        minCreditScore: 380,
        // The group IS the security — three members stand for each borrower.
        guarantor: { required: true, count: 3, canReborrow: true },
        security: { required: false, coverPct: 100 },
      },
      evidence: {
        documents: ["ID_FRONT", "SELFIE", "MPESA_STATEMENT"],
        requireGeoPin: true, requireFieldVisit: false,
      },
      availability: { ...PRODUCT_DEFAULTS.availability, channels: ["console"] },
    }),
  },
];

export const productTemplate = (id: string) => PRODUCT_TEMPLATES.find((p) => p.id === id);

/**
 * The blanks a template deliberately leaves for the lender.
 *
 * Approval workflows are per-org rows, so no shipped template can name one — a
 * template that guessed would either point at nothing or silently route a real
 * lender's loans through the wrong committee. The wizard uses this to mark the
 * fields it must not let someone skip past, and the validator independently refuses
 * to publish while they are empty.
 */
export function templateBlanks(d: ProductDefinition): string[] {
  const out: string[] = [];
  if (d.process.newLoan === "approval" && !d.process.newWorkflowId) out.push("process.newWorkflowId");
  if (d.process.repeatLoan === "approval" && !d.process.repeatWorkflowId) out.push("process.repeatWorkflowId");
  return out;
}
