// ─────────────────────────────────────────────────────────────────────────────
// The approved limit — how much this borrower qualifies for, and why.
//
// Until now the platform scored the RISK of an application but let the customer
// name any figure inside the product's bounds: a first-time applicant could ask
// a 300,000-shilling product for all of it, and the only thing standing between
// that and a booking was an officer's instinct. The limit engine closes that
// gap: every scored applicant gets a ceiling derived from their cashflow, their
// risk, and their history with this lender — and the application form caps the
// ask at it. The customer chooses any amount UP TO the approved limit; the
// limit itself is not theirs to choose.
//
// The method is three numbers multiplied, then a ladder, then the product:
//
//   CAPACITY — what the statement says they can carry. 40% of three months' net
//   cashflow (the cruncher's avgMonthlyNet). An affordability rule a regulator
//   recognises, not a model output.
//
//   RISK     — the fused PD discounts capacity. A 6% PD keeps it whole; a 30%
//   PD keeps 40% of it; a declined application keeps none.
//
//   THE LADDER — progressive exposure, the microfinance discipline that made
//   graduation mean something. A NEW borrower (no history with this lender) is
//   capped at KES 25,000 no matter how good the statement — the statement can
//   be someone else's phone. RETURNING (1–4 cleared) can hold 1.5× the largest
//   principal they have actually repaid. GRADUATED (5+ cleared) 2×. History
//   with THIS lender is the only thing that raises the ceiling.
//
// Deterministic and explainable on purpose, like the early-warning weights:
// every limit ships with reason codes in the same shape the scorer uses, so the
// officer's screen and the borrower's screen can both say WHY the number is the
// number. Nothing here decides approval — the workflow still does that.
// ─────────────────────────────────────────────────────────────────────────────

export type BorrowerClass = "NEW" | "RETURNING" | "GRADUATED";

export type LimitReason = {
  code: string;
  factor: string;
  detail: string;
  direction: "up" | "down";
};

export type LimitInput = {
  /** Fused probability of default, 0..1. */
  pd: number;
  /** APPROVE | REVIEW | DECLINE — a declined applicant has no limit. */
  decision: string;
  /** From the statement cruncher's features; null when no statement was read. */
  avgMonthlyNet?: number | null;
  /** Cleared loans with THIS lender. */
  priorLoanCount: number;
  graduated: boolean;
  /** Largest principal this borrower has REPAID here; null for new borrowers. */
  largestCleared?: number | null;
  /** Product bounds; 0 = unbounded. */
  productMin?: number;
  productMax?: number;
  // ── Product terms — when present, the limit is sized AFFORDABILITY-FIRST ──────
  // We size the principal so its largest installment fits the borrower's monthly
  // cashflow room, on THIS product's own frequency and term. Absent these, the
  // engine falls back to the legacy three-month lump-sum capacity.
  /** Percent for the full term, exactly as buildSchedule reads it. */
  productRate?: number | null;
  /** Number of installments (n). */
  repaymentPeriod?: number | null;
  /** "day" | "week" | "month" — the installment frequency. */
  repaymentPeriodUnit?: string | null;
  /** The product's own minimum bookable amount; overrides productMin when higher. */
  minLoanLimit?: number | null;
};

export type LimitResult = {
  /** KES, rounded down to the nearest 500. 0 = cannot responsibly lend at all. */
  approvedLimit: number;
  borrowerClass: BorrowerClass;
  reasons: LimitReason[];
  /** The largest installment the approved limit implies on this product's term —
   *  what the officer's and borrower's screens say the repayment "feels like".
   *  null when no product term was supplied or nothing is lendable. */
  affordableInstallment: number | null;
  /** Echoed back so the UI can render "KES X per week × 8" without re-deriving. */
  installmentCount: number | null;
  installmentUnit: string | null;
};

/** First-cycle ceiling: no statement outranks no history. */
export const NEW_BORROWER_CAP = 25_000;
/** Returning/graduated floors, so a good statement is not wasted on a tiny book. */
const RETURNING_FLOOR = 40_000;
const GRADUATED_FLOOR = 70_000;

const AFFORDABILITY = 0.4; // share of net cashflow that may service debt
const MONTHS = 3; // capacity horizon (legacy lump-sum path, no product term)

/** How many installments of a given frequency fall in a month — the bridge between
 *  a monthly statement figure and a per-installment affordability test. */
function periodsPerMonth(unit?: string | null): number {
  const u = (unit ?? "month").toLowerCase();
  if (u.startsWith("day")) return 30.437;
  if (u.startsWith("week")) return 4.345;
  return 1; // month
}

/** The largest installment a principal implies on this term. For BOTH flat and
 *  reducing schedules the binding (largest) installment is the first one, and it
 *  equals (P / n)·(1 + rate%) — see lib/lending/schedule.ts. Inverting it gives the
 *  principal whose largest installment exactly meets an affordability ceiling. */
function largestInstallment(principal: number, ratePct: number, count: number): number {
  return (principal / Math.max(1, count)) * (1 + ratePct / 100);
}
function principalFromInstallment(installment: number, ratePct: number, count: number): number {
  return (installment * Math.max(1, count)) / (1 + ratePct / 100);
}

function riskMultiplier(pd: number): { m: number; label: string } {
  if (pd <= 0.08) return { m: 1.0, label: "low risk — full capacity" };
  if (pd <= 0.15) return { m: 0.8, label: "moderate risk — capacity trimmed 20%" };
  if (pd <= 0.25) return { m: 0.6, label: "elevated risk — capacity trimmed 40%" };
  if (pd <= 0.35) return { m: 0.4, label: "high risk — capacity trimmed 60%" };
  return { m: 0.2, label: "very high risk — minimal exposure" };
}

export function classOf(input: Pick<LimitInput, "priorLoanCount" | "graduated">): BorrowerClass {
  if (input.graduated || input.priorLoanCount >= 5) return "GRADUATED";
  if (input.priorLoanCount >= 1) return "RETURNING";
  return "NEW";
}

const round500 = (n: number) => Math.max(0, Math.floor(n / 500) * 500);

export function computeApprovedLimit(input: LimitInput): LimitResult {
  const borrowerClass = classOf(input);
  const reasons: LimitReason[] = [];

  // The product term, when the caller passed it, switches on affordability-first
  // sizing: the principal is grown until its largest installment meets — but does
  // not exceed — the cashflow room, on THIS product's frequency and term.
  const count = Number.isFinite(Number(input.repaymentPeriod)) && Number(input.repaymentPeriod)! > 0
    ? Math.round(Number(input.repaymentPeriod)) : null;
  const ratePct = Number(input.productRate ?? 0);
  const unit = input.repaymentPeriodUnit ?? null;
  const termKnown = count != null;

  const noInstallment = { affordableInstallment: null, installmentCount: null, installmentUnit: null };

  if (input.decision === "DECLINE") {
    return {
      approvedLimit: 0,
      borrowerClass,
      reasons: [{ code: "LIM_DECLINED", factor: "Approved limit", detail: "The risk decision was DECLINE — no limit is offered.", direction: "down" }],
      ...noInstallment,
    };
  }

  // 1. Capacity from the statement.
  const net = Number(input.avgMonthlyNet ?? 0);
  let capacity: number;
  if (net > 0 && termKnown) {
    // AFFORDABILITY-FIRST: the monthly room the statement leaves for debt, expressed
    // as an installment on this product's frequency, then grown back to a principal.
    const monthlyRoom = net * AFFORDABILITY;
    const installmentRoom = monthlyRoom / periodsPerMonth(unit);
    capacity = principalFromInstallment(installmentRoom, ratePct, count!);
    reasons.push({
      code: "LIM_CASHFLOW",
      factor: "Repayment capacity",
      detail: `M-Pesa cashflow leaves about KES ${Math.round(installmentRoom).toLocaleString()} a ${(unit ?? "month").replace(/s$/, "")} for repayments (a ${AFFORDABILITY * 100}% affordability cap) — up to KES ${Math.round(capacity).toLocaleString()} over this product's ${count} installments.`,
      direction: "up",
    });
  } else if (net > 0) {
    capacity = net * MONTHS * AFFORDABILITY;
    reasons.push({
      code: "LIM_CASHFLOW",
      factor: "Repayment capacity",
      detail: `M-Pesa cashflow supports ~KES ${Math.round(capacity).toLocaleString()} over ${MONTHS} months at a ${AFFORDABILITY * 100}% affordability cap.`,
      direction: "up",
    });
  } else {
    // No statement: the ladder floor for their class, heavily discounted below.
    capacity = borrowerClass === "NEW" ? NEW_BORROWER_CAP : RETURNING_FLOOR;
    reasons.push({
      code: "LIM_NO_STATEMENT",
      factor: "Repayment capacity",
      detail: "No statement cashflow on file — the limit rests on repayment history alone.",
      direction: "down",
    });
  }

  // 2. Risk discounts capacity.
  const risk = riskMultiplier(input.pd);
  if (risk.m < 1) {
    reasons.push({
      code: "LIM_RISK",
      factor: "Risk adjustment",
      detail: `Model PD ${(input.pd * 100).toFixed(0)}%: ${risk.label}.`,
      direction: "down",
    });
  } else {
    reasons.push({ code: "LIM_RISK", factor: "Risk adjustment", detail: `Model PD ${(input.pd * 100).toFixed(0)}%: ${risk.label}.`, direction: "up" });
  }
  let limit = capacity * risk.m;

  // 3. The ladder.
  const largest = Number(input.largestCleared ?? 0);
  if (borrowerClass === "NEW") {
    if (limit > NEW_BORROWER_CAP) {
      limit = NEW_BORROWER_CAP;
      reasons.push({
        code: "LIM_FIRST_CYCLE",
        factor: "First loan with this lender",
        detail: `First-cycle exposure is capped at KES ${NEW_BORROWER_CAP.toLocaleString()} — repaying it raises the ceiling.`,
        direction: "down",
      });
    } else {
      reasons.push({ code: "LIM_FIRST_CYCLE", factor: "First loan with this lender", detail: "No repayment history here yet — the ladder starts on this loan.", direction: "down" });
    }
  } else {
    const multiple = borrowerClass === "GRADUATED" ? 2 : 1.5;
    const floor = borrowerClass === "GRADUATED" ? GRADUATED_FLOOR : RETURNING_FLOOR;
    const ladderCap = Math.max(largest * multiple, floor);
    if (limit > ladderCap) {
      limit = ladderCap;
      reasons.push({
        code: "LIM_LADDER",
        factor: "Repayment history",
        detail: `${input.priorLoanCount} loan${input.priorLoanCount === 1 ? "" : "s"} repaid here — exposure grows to ${multiple}× the largest cleared (KES ${Math.round(largest).toLocaleString()}).`,
        direction: "down",
      });
    } else {
      reasons.push({
        code: "LIM_LADDER",
        factor: "Repayment history",
        detail: `${input.priorLoanCount} loan${input.priorLoanCount === 1 ? "" : "s"} repaid with this lender${input.graduated ? " — graduated" : ""}.`,
        direction: "up",
      });
    }
  }

  // 4. The product's own bounds are the outer walls.
  const pMax = Number(input.productMax ?? 0);
  const pMin = Number(input.productMin ?? 0);
  if (pMax > 0 && limit > pMax) {
    limit = pMax;
    reasons.push({ code: "LIM_PRODUCT", factor: "Product ceiling", detail: `This product lends up to KES ${pMax.toLocaleString()}.`, direction: "down" });
  }

  // The floor is the higher of the product's principal minimum and its explicit
  // minimum loan limit (ServiceSuite parity) — below it, there is no loan.
  const floor = Math.max(pMin, Number(input.minLoanLimit ?? 0));
  let approvedLimit = round500(limit);
  if (floor > 0 && approvedLimit < floor) {
    approvedLimit = 0;
    reasons.push({
      code: "LIM_BELOW_MIN",
      factor: "Approved limit",
      detail: `The supported amount falls below this product's minimum of KES ${floor.toLocaleString()}.`,
      direction: "down",
    });
  }

  // The installment the FINAL approved principal implies — always consistent with
  // the number we just approved, whatever cap ended up binding.
  let affordableInstallment: number | null = null;
  if (approvedLimit > 0 && termKnown) {
    affordableInstallment = Math.round(largestInstallment(approvedLimit, ratePct, count!));
    reasons.push({
      code: "LIM_INSTALLMENT",
      factor: "What it repays",
      detail: `KES ${approvedLimit.toLocaleString()} repays about KES ${affordableInstallment.toLocaleString()} per ${(unit ?? "month").replace(/s$/, "")} across ${count} installments.`,
      direction: "up",
    });
  }

  return {
    approvedLimit,
    borrowerClass,
    reasons,
    affordableInstallment,
    installmentCount: termKnown ? count : null,
    installmentUnit: termKnown ? unit : null,
  };
}
