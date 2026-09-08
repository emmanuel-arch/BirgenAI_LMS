// ─────────────────────────────────────────────────────────────────────────────
// THE CHARGE SHAPE — one vocabulary for a fee, shared by the API, the product
// builder and the charges screen.
//
// A fee has four independent questions, and every system that conflates any two of
// them ends up unable to express something a lender actually sells:
//
//   WHEN is it offered?        trigger      registration · application · manual
//   HOW is it collected?       applyAt      before disbursement · netted off · spread
//   MUST it be taken?          isMandatory  always · the officer decides
//   HOW MUCH is it?            valueType    fixed · percent · hybrid, of WHAT
//
// ServiceSuite gets the four right (it is where this vocabulary comes from) but
// stores each as a bare integer whose meaning lives in a Razor <option> list, and
// its percentage reference — the difference between 6% of principal and 6% of
// principal+interest, which on a 20% loan is a fifth of the fee — is a `FeeRef`
// column with no constraint at all.
//
// "Hybrid" deserves a note, because it is the one people mis-model. It is not a
// third kind of arithmetic: it is a PERCENTAGE with a floor and a ceiling. Micromart
// charge 6% of principal but never less than 650 nor more than 6,000, which on their
// book means a 5,000 loan pays 650 (the floor bites) and a 150,000 loan pays 6,000
// (the ceiling bites). Modelled as its own value type it needs its own branch in
// every calculator; modelled as bounds on a percentage, `priceCharge` is six lines.
// ─────────────────────────────────────────────────────────────────────────────

/** WHEN the fee is offered. */
export const CHARGE_TRIGGERS = [
  { key: "ON_REGISTRATION", label: "When a customer is registered", blurb: "A joining fee. Raised the moment the person becomes a customer." },
  { key: "ON_APPLICATION", label: "When they apply for a loan", blurb: "Raised with the application, on every loan that carries this charge." },
  { key: "MANUAL", label: "Whenever staff ask for it", blurb: "Never automatic. An officer raises it from wherever they are." },
] as const;

/** HOW the fee is collected. Only the first one can stop a loan. */
export const CHARGE_APPLY_AT = [
  { key: "BEFORE_DISBURSEMENT", label: "Before disbursement", blurb: "The customer pays it before the money is released. This is the only one that gates a loan." },
  { key: "DEDUCT_FROM_PRINCIPAL", label: "Deducted from principal", blurb: "Netted off the payout — they borrow 15,000, receive 13,950, and still owe 15,000." },
  { key: "ON_INSTALLMENTS", label: "Spread across instalments", blurb: "Collected with the repayments rather than up front." },
] as const;

/** HOW MUCH, and of what. */
export const CHARGE_VALUE_TYPES = [
  { key: "fixed", label: "Fixed amount", blurb: "The same figure on every loan that carries it." },
  { key: "percent", label: "Percentage", blurb: "A share of the reference below, unbounded." },
  { key: "hybrid", label: "Percentage, bounded", blurb: "A share of the reference, but never below the minimum nor above the maximum." },
] as const;

export type ChargeValueType = (typeof CHARGE_VALUE_TYPES)[number]["key"];

/** WHAT a percentage is a percentage OF. */
export const PERCENT_REFERENCES = [
  { key: "principal", label: "Principal", blurb: "The amount borrowed." },
  { key: "principal_interest", label: "Principal + interest", blurb: "The total the customer will repay." },
  { key: "instalment", label: "Each instalment", blurb: "Charged per instalment rather than per loan." },
  { key: "outstanding_balance", label: "Outstanding balance", blurb: "What is still owed when the fee falls due." },
] as const;

export type PercentReference = (typeof PERCENT_REFERENCES)[number]["key"];

export type ChargeShape = {
  id?: string;
  name: string;
  code: string;
  description: string;
  valueType: ChargeValueType;
  /** The figure: an amount when `fixed`, a percentage otherwise. */
  value: number;
  percentOf: PercentReference;
  /** Floor and ceiling for a percentage. Only meaningful when `hybrid`. */
  minValue: number | null;
  maxValue: number | null;
  /** The principal band this price applies to. Null = any loan size. */
  minPrincipal: number | null;
  maxPrincipal: number | null;
  trigger: (typeof CHARGE_TRIGGERS)[number]["key"];
  applyAt: (typeof CHARGE_APPLY_AT)[number]["key"];
  isMandatory: boolean;
  glAccount: string;
  /** Scoped to one product, or null for every product on the shelf. */
  productId: string | null;
  isActive: boolean;
};

export const EMPTY_CHARGE: ChargeShape = {
  name: "", code: "", description: "",
  valueType: "fixed", value: 0, percentOf: "principal",
  minValue: null, maxValue: null, minPrincipal: null, maxPrincipal: null,
  trigger: "ON_APPLICATION", applyAt: "BEFORE_DISBURSEMENT",
  isMandatory: true, glAccount: "", productId: null, isActive: true,
};

export type ChargeIssue = { path: string; message: string };

export function validateCharge(c: ChargeShape): ChargeIssue[] {
  const out: ChargeIssue[] = [];
  const bad = (path: string, message: string) => out.push({ path, message });

  if (c.name.trim().length < 2) bad("name", "Give the charge a name.");
  // The code becomes the M-Pesa AccountReference the customer SEES on their phone,
  // so it has to be short, stable and typeable.
  if (!/^[A-Z0-9]{2,12}$/.test(c.code)) {
    bad("code", "The short code is 2–12 letters or digits — the customer sees it on their M-Pesa prompt.");
  }
  if (!Number.isFinite(c.value) || c.value <= 0) bad("value", "Enter a value above zero.");

  if (c.valueType !== "fixed") {
    if (c.value > 100) bad("value", "A percentage cannot be more than 100.");
    if (c.valueType === "hybrid") {
      if (c.minValue === null && c.maxValue === null) {
        bad("minValue", "A bounded percentage needs a minimum, a maximum, or both — otherwise it is just a percentage.");
      }
      if (c.minValue !== null && c.minValue < 0) bad("minValue", "The minimum cannot be negative.");
      if (c.minValue !== null && c.maxValue !== null && c.minValue > c.maxValue) {
        bad("maxValue", "The minimum charge is above the maximum.");
      }
    }
  }

  if (c.minPrincipal !== null && c.maxPrincipal !== null && c.minPrincipal > c.maxPrincipal) {
    bad("maxPrincipal", "The principal band ends below where it begins.");
  }
  // A fee spread over instalments cannot also be the thing that gates disbursement.
  if (c.applyAt === "ON_INSTALLMENTS" && c.trigger === "ON_REGISTRATION") {
    bad("applyAt", "A registration fee has no instalments to spread across — there is no loan yet.");
  }
  if (c.percentOf === "instalment" && c.applyAt !== "ON_INSTALLMENTS") {
    bad("percentOf", "A per-instalment percentage has to be collected with the instalments.");
  }
  if (c.percentOf === "outstanding_balance" && c.applyAt === "BEFORE_DISBURSEMENT") {
    bad("percentOf", "There is no outstanding balance before the loan is disbursed.");
  }
  return out;
}

/**
 * What this charge actually costs on a given loan.
 *
 * Returns null when the charge does not apply — outside its principal band, or
 * switched off. One function, so the quote the customer is given at the counter, the
 * figure netted off the payout, and the line on the statement can never disagree.
 */
export function priceCharge(
  c: ChargeShape,
  loan: { principal: number; totalRepayable?: number; instalment?: number; outstanding?: number },
): number | null {
  if (!c.isActive) return null;
  if (c.minPrincipal !== null && loan.principal < c.minPrincipal) return null;
  if (c.maxPrincipal !== null && loan.principal > c.maxPrincipal) return null;

  if (c.valueType === "fixed") return round2(c.value);

  const base =
    c.percentOf === "principal_interest" ? loan.totalRepayable ?? loan.principal
      : c.percentOf === "instalment" ? loan.instalment ?? 0
        : c.percentOf === "outstanding_balance" ? loan.outstanding ?? loan.principal
          : loan.principal;

  let amount = (base * c.value) / 100;
  // Hybrid is a percentage with bounds, so the clamp is the whole of its behaviour.
  if (c.valueType === "hybrid") {
    if (c.minValue !== null) amount = Math.max(amount, c.minValue);
    if (c.maxValue !== null) amount = Math.min(amount, c.maxValue);
  }
  return round2(amount);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A one-line price, for a list. */
export function describeCharge(c: ChargeShape): string {
  const money = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
  if (c.valueType === "fixed") return money(c.value);
  const ref = PERCENT_REFERENCES.find((r) => r.key === c.percentOf)?.label.toLowerCase() ?? "principal";
  const pct = `${c.value}% of ${ref}`;
  if (c.valueType !== "hybrid") return pct;
  if (c.minValue !== null && c.maxValue !== null) return `${pct}, ${money(c.minValue)}–${money(c.maxValue)}`;
  if (c.minValue !== null) return `${pct}, min ${money(c.minValue)}`;
  if (c.maxValue !== null) return `${pct}, max ${money(c.maxValue)}`;
  return pct;
}

/** Read a stored row (the flat Prisma shape) into the shared shape. */
export function chargeFromRow(r: {
  id: string; name: string; code: string; description: string | null;
  amount: unknown; isPercent: boolean; percentOf: string;
  minValue: unknown; maxValue: unknown; minPrincipal: unknown; maxPrincipal: unknown;
  trigger: string; applyAt: string; isMandatory: boolean; glAccount: string | null;
  productId: string | null; isActive: boolean;
}): ChargeShape {
  const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  const hasBounds = n(r.minValue) !== null || n(r.maxValue) !== null;
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    description: r.description ?? "",
    // The bounds are what make it hybrid; the column pair IS the value type.
    valueType: r.isPercent ? (hasBounds ? "hybrid" : "percent") : "fixed",
    value: Number(r.amount),
    percentOf: (PERCENT_REFERENCES.some((p) => p.key === r.percentOf) ? r.percentOf : "principal") as PercentReference,
    minValue: n(r.minValue),
    maxValue: n(r.maxValue),
    minPrincipal: n(r.minPrincipal),
    maxPrincipal: n(r.maxPrincipal),
    trigger: (CHARGE_TRIGGERS.some((t) => t.key === r.trigger) ? r.trigger : "MANUAL") as ChargeShape["trigger"],
    applyAt: (CHARGE_APPLY_AT.some((a) => a.key === r.applyAt) ? r.applyAt : "BEFORE_DISBURSEMENT") as ChargeShape["applyAt"],
    isMandatory: r.isMandatory,
    glAccount: r.glAccount ?? "",
    productId: r.productId,
    isActive: r.isActive,
  };
}

/** The reverse: the shared shape written back onto the columns. */
export function chargeToRow(c: ChargeShape) {
  const percent = c.valueType !== "fixed";
  return {
    name: c.name.trim(),
    code: c.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12),
    description: c.description.trim() || null,
    amount: c.value,
    isPercent: percent,
    percentOf: percent ? c.percentOf : "principal",
    // Bounds are meaningless off a hybrid, and carrying them forward is how a fee
    // that was once bounded keeps a floor nobody can see to remove.
    minValue: c.valueType === "hybrid" ? c.minValue : null,
    maxValue: c.valueType === "hybrid" ? c.maxValue : null,
    minPrincipal: c.minPrincipal,
    maxPrincipal: c.maxPrincipal,
    trigger: c.trigger,
    applyAt: c.applyAt,
    isMandatory: c.isMandatory,
    glAccount: c.glAccount.trim() || null,
    productId: c.productId,
    isActive: c.isActive,
  };
}
