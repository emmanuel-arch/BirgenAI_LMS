// ─────────────────────────────────────────────────────────────────────────────
// THE LOANS NAMESPACE — everything a lender decides about a loan AFTER it books.
//
// Origination has had a home for a while: the credit policy decides who borrows
// and the product decides on what terms. What had no home is the other half of a
// lending business — the day a customer cannot pay, wants more, wants longer, or
// wants out. In the system we are replacing that half is seven separate screens
// (`RestructureSettings`, `LoanTopUpSettings`, `ManagedLoanSettings`,
// `RedisbursementSettings`, `TopUp`, `EarlySettlement`, `ReconciliationAccess`),
// seven tables, and seven MERGE statements, and between them they hold almost no
// policy: five of the seven store nothing but an approval-workflow id.
//
// That is the tell. "Who signs it off" is not a restructure policy. A restructure
// policy is: may it happen at all, how often, how far into a loan, what may move,
// what it costs, whether arrears must clear first, and what the schedule does
// afterwards. None of that exists there, so it lives in each branch's habits.
//
// Here it is one versioned document, and every after-book action reads it:
//
//   calculator     what staff may quote, and what a quote is worth
//   restructure    rescheduling a live loan
//   topup          lending more on an existing one
//   waiver         forgiving penalty, interest or fees
//   writeoff       taking a loss, deliberately
//   redisbursement re-releasing money on a loan that was returned
//   earlySettlement paying it off early, and what that earns
//   penalty        what arrears cost, and when they stop costing
//   arrears        the buckets the whole book is aged into
//   reconciliation what an unmatched payment is allowed to do
//   disbursement   the controls on money leaving
//   statement      what the customer sees
//
// Every block that can be gated carries its own `workflowId`, so a lender who wants
// four eyes on a waiver and none on a top-up simply says so.
// ─────────────────────────────────────────────────────────────────────────────
import type { ConfigIssue } from "./borrower";

/** How a fee or a discount is expressed. */
export type ValueType = "percent" | "fixed";

export type LoansConfig = {
  calculator: {
    /** Staff may price a loan without an applicant in front of them. */
    enabled: boolean;
    /** Show the all-in cost and effective rate, not just the instalment. */
    showTotalCost: boolean;
    showEffectiveRate: boolean;
    /** A quote may pick any term inside the product's range, not only its default. */
    allowCustomTerm: boolean;
    /** A quote may be saved, sent to the customer, and turned into an application. */
    allowSaveQuote: boolean;
    /** Days a saved quote survives before it must be re-priced. */
    quoteExpiryDays: number;
    /** Include charges in the quoted figure. Off = the customer is surprised later. */
    includeCharges: boolean;
  };

  restructure: {
    enabled: boolean;
    /** What the borrower may actually move. */
    allow: { term: boolean; instalment: boolean; startDate: boolean; rate: boolean };
    fee: { type: ValueType; value: number };
    /** How many times one loan may ever be restructured. 0 = no limit. */
    maxTimes: number;
    /** Not before this many days have run on the loan. */
    minDaysIntoLoan: number;
    /** Arrears must be cleared to zero before a restructure may be requested. */
    requireArrearsCleared: boolean;
    /** Accrued penalties are dropped as part of the restructure. */
    waivePenaltyOnRestructure: boolean;
    /** The restructured loan may not run past this many days from its original maturity. */
    maxExtensionDays: number;
    workflowId: string | null;
    requireReason: boolean;
  };

  topup: {
    enabled: boolean;
    /** The share of the running loan that must already be repaid. */
    minPercentPaid: number;
    /** A ceiling on the ADDITIONAL amount. 0 = the borrower's limit is the ceiling. */
    maxTopUpAmount: number;
    /** The top-up must leave total exposure inside the borrower's limit. */
    respectBorrowerLimit: boolean;
    /** No top-up while the loan is in arrears. */
    blockIfInArrears: boolean;
    /** Days a top-up quote survives. */
    quoteExpiryDays: number;
    /** Attachment codes required on a top-up request. */
    attachments: string[];
    /** Settle the running loan from the new principal, or run the two side by side. */
    settlementMode: "settle_and_reissue" | "parallel";
    workflowId: string | null;
  };

  waiver: {
    enabled: boolean;
    /** What may be forgiven. Principal is deliberately off by default. */
    allow: { penalty: boolean; interest: boolean; fees: boolean; principal: boolean };
    /** The most one waiver may forgive. 0 = no cap. */
    maxAmount: number;
    /** …or, as a share of the outstanding balance. 0 = no cap. */
    maxPercent: number;
    requireReason: boolean;
    /** Above this amount a second approver is required whatever the workflow says. */
    dualApprovalAbove: number;
    workflowId: string | null;
  };

  writeoff: {
    enabled: boolean;
    /** Not before the loan has been in arrears this long. */
    afterArrearsDays: number;
    /** A write-off is only offered up to this exposure. 0 = any. */
    maxAmount: number;
    requireReason: boolean;
    /** The customer is barred from new lending once written off. */
    blacklistBorrower: boolean;
    /** Recoveries after a write-off are still posted against the loan. */
    allowRecovery: boolean;
    workflowId: string | null;
  };

  redisbursement: {
    enabled: boolean;
    /** Money that came back may be re-released within this many days. */
    withinDays: number;
    /** …and only on the same product and terms. */
    sameTermsOnly: boolean;
    workflowId: string | null;
  };

  earlySettlement: {
    enabled: boolean;
    /** Settling within this many days of disbursement qualifies. 0 = any time. */
    withinDays: number;
    /** Share of UNEARNED interest rebated. */
    rebatePct: number;
    /** Accrued penalties are dropped too. */
    waivePenalty: boolean;
    /** Outstanding fees still fall due. */
    chargeOutstandingFees: boolean;
    /** A product may set its own rebate; off means this document is the only word. */
    allowProductOverride: boolean;
  };

  penalty: {
    enabled: boolean;
    /** Days late before anything is charged. */
    graceDays: number;
    /** Percent, on the base below. */
    rate: number;
    base: "unpaid_principal" | "unpaid_interest" | "unpaid_principal_interest" | "total_balance" | "instalment";
    /** Charged once, or every accrual period until cleared. */
    recurrence: "once" | "recurring";
    accrual: "daily" | "weekly" | "monthly";
    /** Stop once accumulated penalties reach this share of principal. 0 = uncapped. */
    capPercentOfPrincipal: number;
    /** Stop accruing the day a loan is written off. */
    stopOnWriteOff: boolean;
    /** A product's own penalty terms win over this default. */
    allowProductOverride: boolean;
  };

  /**
   * THE AGEING BUCKETS. ServiceSuite calls these ArrearsRanges and every report,
   * queue and provision rate in the business is keyed to them, so they belong to
   * the lender and not to a report's hard-coded CASE statement.
   */
  arrears: {
    buckets: { label: string; fromDays: number; toDays: number | null; provisionPct: number }[];
    /** A loan is "in arrears" once it is this many days past due. */
    delinquentAfterDays: number;
    /** …and non-performing at this many. Drives the NPL ratio everywhere. */
    nplAfterDays: number;
  };

  reconciliation: {
    /** Payments that cannot be matched land here rather than being rejected. */
    useSuspenseAccount: boolean;
    /** An amount within this of a due instalment is treated as that instalment. */
    toleranceAmount: number;
    /** Auto-match on account reference, phone, then name. Off = every payment is manual. */
    autoMatch: boolean;
    /** Unmatched for this many days raises an exception a person must clear. */
    escalateAfterDays: number;
    /** Role ids allowed to release a suspended payment. Empty = anyone with the right. */
    releaseRoleIds: string[];
    /** A release above this needs a second pair of eyes. 0 = never. */
    dualApprovalAbove: number;
  };

  disbursement: {
    /** Whoever prepared a payout may not be the one who releases it. */
    makerChecker: boolean;
    /** A payout above this needs a second authoriser. 0 = never. */
    dualApprovalAbove: number;
    /** Payouts only inside these hours, org local time. "" = any time. */
    cutoffFrom: string;
    cutoffTo: string;
    /** Days of the week payouts may run (0 = Sunday). Empty = every day. */
    payoutDays: number[];
    /** A failed B2C is retried this many times before a human is asked. */
    autoRetries: number;
    /** Hold the payout until every before-disbursement charge is settled. */
    requireChargesSettled: boolean;
  };

  statement: {
    /** What a customer sees on their own statement. */
    showCharges: boolean;
    showPenalties: boolean;
    showRunningBalance: boolean;
    /** Include loans that have already cleared. */
    includeClosedLoans: boolean;
    /** Footer wording — the lender's own note. */
    footer: string;
  };
};

export const LOANS_DEFAULTS: LoansConfig = {
  calculator: {
    enabled: true, showTotalCost: true, showEffectiveRate: true,
    allowCustomTerm: true, allowSaveQuote: true, quoteExpiryDays: 7, includeCharges: true,
  },
  restructure: {
    enabled: false,
    allow: { term: true, instalment: true, startDate: false, rate: false },
    fee: { type: "fixed", value: 0 },
    maxTimes: 1, minDaysIntoLoan: 30, requireArrearsCleared: false,
    waivePenaltyOnRestructure: false, maxExtensionDays: 90,
    workflowId: null, requireReason: true,
  },
  topup: {
    enabled: false, minPercentPaid: 50, maxTopUpAmount: 0, respectBorrowerLimit: true,
    blockIfInArrears: true, quoteExpiryDays: 7, attachments: [],
    settlementMode: "settle_and_reissue", workflowId: null,
  },
  waiver: {
    enabled: false,
    allow: { penalty: true, interest: false, fees: false, principal: false },
    maxAmount: 0, maxPercent: 0, requireReason: true, dualApprovalAbove: 0, workflowId: null,
  },
  writeoff: {
    enabled: false, afterArrearsDays: 180, maxAmount: 0, requireReason: true,
    blacklistBorrower: true, allowRecovery: true, workflowId: null,
  },
  redisbursement: { enabled: false, withinDays: 7, sameTermsOnly: true, workflowId: null },
  earlySettlement: {
    enabled: false, withinDays: 0, rebatePct: 50, waivePenalty: false,
    chargeOutstandingFees: true, allowProductOverride: true,
  },
  penalty: {
    enabled: true, graceDays: 3, rate: 5, base: "unpaid_principal_interest",
    recurrence: "once", accrual: "daily", capPercentOfPrincipal: 100,
    stopOnWriteOff: true, allowProductOverride: true,
  },
  arrears: {
    buckets: [
      { label: "Current", fromDays: 0, toDays: 0, provisionPct: 0 },
      { label: "1–30 days", fromDays: 1, toDays: 30, provisionPct: 1 },
      { label: "31–60 days", fromDays: 31, toDays: 60, provisionPct: 5 },
      { label: "61–90 days", fromDays: 61, toDays: 90, provisionPct: 25 },
      { label: "91–180 days", fromDays: 91, toDays: 180, provisionPct: 50 },
      { label: "Over 180 days", fromDays: 181, toDays: null, provisionPct: 100 },
    ],
    delinquentAfterDays: 1,
    nplAfterDays: 90,
  },
  reconciliation: {
    useSuspenseAccount: true, toleranceAmount: 5, autoMatch: true,
    escalateAfterDays: 2, releaseRoleIds: [], dualApprovalAbove: 0,
  },
  disbursement: {
    makerChecker: true, dualApprovalAbove: 0, cutoffFrom: "", cutoffTo: "",
    payoutDays: [], autoRetries: 2, requireChargesSettled: true,
  },
  statement: {
    showCharges: true, showPenalties: true, showRunningBalance: true,
    includeClosedLoans: false, footer: "",
  },
};

// ── Merge ─────────────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : {});
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const str = (v: unknown, d: string) => (typeof v === "string" ? v : d);
const int = (v: unknown, d: number, lo = 0, hi = Number.MAX_SAFE_INTEGER) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : d;
};
const dec = (v: unknown, d: number, lo = 0, hi = Number.MAX_SAFE_INTEGER) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], d: T): T =>
  (allowed as readonly string[]).includes(String(v)) ? (v as T) : d;
const id = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const codes = (v: unknown, d: string[]) =>
  Array.isArray(v) ? [...new Set(v.map((x) => String(x).toUpperCase().trim()).filter(Boolean))] : d;

export function mergeLoansConfig(stored: unknown): LoansConfig {
  const s = obj(stored);
  const D = LOANS_DEFAULTS;

  const calc = obj(s.calculator);
  const res = obj(s.restructure);
  const resAllow = obj(res.allow);
  const resFee = obj(res.fee);
  const top = obj(s.topup);
  const wai = obj(s.waiver);
  const waiAllow = obj(wai.allow);
  const wof = obj(s.writeoff);
  const red = obj(s.redisbursement);
  const es = obj(s.earlySettlement);
  const pen = obj(s.penalty);
  const arr = obj(s.arrears);
  const rec = obj(s.reconciliation);
  const dis = obj(s.disbursement);
  const stm = obj(s.statement);

  const buckets = Array.isArray(arr.buckets) && arr.buckets.length
    ? arr.buckets
        .map((b) => {
          const o = obj(b);
          const to = o.toDays === null || o.toDays === undefined || o.toDays === "" ? null : int(o.toDays, 0);
          return {
            label: str(o.label, "").slice(0, 40) || "Bucket",
            fromDays: int(o.fromDays, 0),
            toDays: to,
            provisionPct: dec(o.provisionPct, 0, 0, 100),
          };
        })
        .sort((a, b) => a.fromDays - b.fromDays)
    : D.arrears.buckets;

  return {
    calculator: {
      enabled: bool(calc.enabled, D.calculator.enabled),
      showTotalCost: bool(calc.showTotalCost, D.calculator.showTotalCost),
      showEffectiveRate: bool(calc.showEffectiveRate, D.calculator.showEffectiveRate),
      allowCustomTerm: bool(calc.allowCustomTerm, D.calculator.allowCustomTerm),
      allowSaveQuote: bool(calc.allowSaveQuote, D.calculator.allowSaveQuote),
      quoteExpiryDays: int(calc.quoteExpiryDays, D.calculator.quoteExpiryDays, 0, 365),
      includeCharges: bool(calc.includeCharges, D.calculator.includeCharges),
    },
    restructure: {
      enabled: bool(res.enabled, D.restructure.enabled),
      allow: {
        term: bool(resAllow.term, D.restructure.allow.term),
        instalment: bool(resAllow.instalment, D.restructure.allow.instalment),
        startDate: bool(resAllow.startDate, D.restructure.allow.startDate),
        rate: bool(resAllow.rate, D.restructure.allow.rate),
      },
      fee: {
        type: oneOf(resFee.type, ["percent", "fixed"] as const, D.restructure.fee.type),
        value: dec(resFee.value, D.restructure.fee.value, 0),
      },
      maxTimes: int(res.maxTimes, D.restructure.maxTimes, 0, 20),
      minDaysIntoLoan: int(res.minDaysIntoLoan, D.restructure.minDaysIntoLoan, 0, 3650),
      requireArrearsCleared: bool(res.requireArrearsCleared, D.restructure.requireArrearsCleared),
      waivePenaltyOnRestructure: bool(res.waivePenaltyOnRestructure, D.restructure.waivePenaltyOnRestructure),
      maxExtensionDays: int(res.maxExtensionDays, D.restructure.maxExtensionDays, 0, 3650),
      workflowId: id(res.workflowId),
      requireReason: bool(res.requireReason, D.restructure.requireReason),
    },
    topup: {
      enabled: bool(top.enabled, D.topup.enabled),
      minPercentPaid: dec(top.minPercentPaid, D.topup.minPercentPaid, 0, 100),
      maxTopUpAmount: dec(top.maxTopUpAmount, D.topup.maxTopUpAmount, 0),
      respectBorrowerLimit: bool(top.respectBorrowerLimit, D.topup.respectBorrowerLimit),
      blockIfInArrears: bool(top.blockIfInArrears, D.topup.blockIfInArrears),
      quoteExpiryDays: int(top.quoteExpiryDays, D.topup.quoteExpiryDays, 0, 365),
      attachments: codes(top.attachments, D.topup.attachments),
      settlementMode: oneOf(top.settlementMode, ["settle_and_reissue", "parallel"] as const, D.topup.settlementMode),
      workflowId: id(top.workflowId),
    },
    waiver: {
      enabled: bool(wai.enabled, D.waiver.enabled),
      allow: {
        penalty: bool(waiAllow.penalty, D.waiver.allow.penalty),
        interest: bool(waiAllow.interest, D.waiver.allow.interest),
        fees: bool(waiAllow.fees, D.waiver.allow.fees),
        principal: bool(waiAllow.principal, D.waiver.allow.principal),
      },
      maxAmount: dec(wai.maxAmount, D.waiver.maxAmount, 0),
      maxPercent: dec(wai.maxPercent, D.waiver.maxPercent, 0, 100),
      requireReason: bool(wai.requireReason, D.waiver.requireReason),
      dualApprovalAbove: dec(wai.dualApprovalAbove, D.waiver.dualApprovalAbove, 0),
      workflowId: id(wai.workflowId),
    },
    writeoff: {
      enabled: bool(wof.enabled, D.writeoff.enabled),
      afterArrearsDays: int(wof.afterArrearsDays, D.writeoff.afterArrearsDays, 0, 3650),
      maxAmount: dec(wof.maxAmount, D.writeoff.maxAmount, 0),
      requireReason: bool(wof.requireReason, D.writeoff.requireReason),
      blacklistBorrower: bool(wof.blacklistBorrower, D.writeoff.blacklistBorrower),
      allowRecovery: bool(wof.allowRecovery, D.writeoff.allowRecovery),
      workflowId: id(wof.workflowId),
    },
    redisbursement: {
      enabled: bool(red.enabled, D.redisbursement.enabled),
      withinDays: int(red.withinDays, D.redisbursement.withinDays, 0, 365),
      sameTermsOnly: bool(red.sameTermsOnly, D.redisbursement.sameTermsOnly),
      workflowId: id(red.workflowId),
    },
    earlySettlement: {
      enabled: bool(es.enabled, D.earlySettlement.enabled),
      withinDays: int(es.withinDays, D.earlySettlement.withinDays, 0, 3650),
      rebatePct: dec(es.rebatePct, D.earlySettlement.rebatePct, 0, 100),
      waivePenalty: bool(es.waivePenalty, D.earlySettlement.waivePenalty),
      chargeOutstandingFees: bool(es.chargeOutstandingFees, D.earlySettlement.chargeOutstandingFees),
      allowProductOverride: bool(es.allowProductOverride, D.earlySettlement.allowProductOverride),
    },
    penalty: {
      enabled: bool(pen.enabled, D.penalty.enabled),
      graceDays: int(pen.graceDays, D.penalty.graceDays, 0, 365),
      rate: dec(pen.rate, D.penalty.rate, 0, 100),
      base: oneOf(pen.base, ["unpaid_principal", "unpaid_interest", "unpaid_principal_interest", "total_balance", "instalment"] as const, D.penalty.base),
      recurrence: oneOf(pen.recurrence, ["once", "recurring"] as const, D.penalty.recurrence),
      accrual: oneOf(pen.accrual, ["daily", "weekly", "monthly"] as const, D.penalty.accrual),
      capPercentOfPrincipal: dec(pen.capPercentOfPrincipal, D.penalty.capPercentOfPrincipal, 0, 1000),
      stopOnWriteOff: bool(pen.stopOnWriteOff, D.penalty.stopOnWriteOff),
      allowProductOverride: bool(pen.allowProductOverride, D.penalty.allowProductOverride),
    },
    arrears: {
      buckets,
      delinquentAfterDays: int(arr.delinquentAfterDays, D.arrears.delinquentAfterDays, 0, 365),
      nplAfterDays: int(arr.nplAfterDays, D.arrears.nplAfterDays, 1, 3650),
    },
    reconciliation: {
      useSuspenseAccount: bool(rec.useSuspenseAccount, D.reconciliation.useSuspenseAccount),
      toleranceAmount: dec(rec.toleranceAmount, D.reconciliation.toleranceAmount, 0),
      autoMatch: bool(rec.autoMatch, D.reconciliation.autoMatch),
      escalateAfterDays: int(rec.escalateAfterDays, D.reconciliation.escalateAfterDays, 0, 90),
      releaseRoleIds: Array.isArray(rec.releaseRoleIds)
        ? [...new Set(rec.releaseRoleIds.map(String).filter(Boolean))]
        : D.reconciliation.releaseRoleIds,
      dualApprovalAbove: dec(rec.dualApprovalAbove, D.reconciliation.dualApprovalAbove, 0),
    },
    disbursement: {
      makerChecker: bool(dis.makerChecker, D.disbursement.makerChecker),
      dualApprovalAbove: dec(dis.dualApprovalAbove, D.disbursement.dualApprovalAbove, 0),
      cutoffFrom: /^\d{2}:\d{2}$/.test(String(dis.cutoffFrom)) ? String(dis.cutoffFrom) : "",
      cutoffTo: /^\d{2}:\d{2}$/.test(String(dis.cutoffTo)) ? String(dis.cutoffTo) : "",
      payoutDays: Array.isArray(dis.payoutDays)
        ? [...new Set(dis.payoutDays.map((d) => int(d, 0, 0, 6)))].sort()
        : D.disbursement.payoutDays,
      autoRetries: int(dis.autoRetries, D.disbursement.autoRetries, 0, 10),
      requireChargesSettled: bool(dis.requireChargesSettled, D.disbursement.requireChargesSettled),
    },
    statement: {
      showCharges: bool(stm.showCharges, D.statement.showCharges),
      showPenalties: bool(stm.showPenalties, D.statement.showPenalties),
      showRunningBalance: bool(stm.showRunningBalance, D.statement.showRunningBalance),
      includeClosedLoans: bool(stm.includeClosedLoans, D.statement.includeClosedLoans),
      footer: str(stm.footer, D.statement.footer).slice(0, 400),
    },
  };
}

// ── Validation ────────────────────────────────────────────────────────────────

export function validateLoansConfig(c: LoansConfig): ConfigIssue[] {
  const out: ConfigIssue[] = [];
  const bad = (path: string, message: string) => out.push({ path, message });

  if (c.restructure.enabled) {
    const a = c.restructure.allow;
    if (!a.term && !a.instalment && !a.startDate && !a.rate) {
      bad("restructure.allow", "Restructuring is on but nothing may be changed — it would do nothing.");
    }
    if (c.restructure.fee.type === "percent" && c.restructure.fee.value > 100) {
      bad("restructure.fee.value", "A percentage fee cannot exceed 100%.");
    }
  }

  if (c.topup.enabled) {
    if (c.topup.minPercentPaid >= 100) {
      bad("topup.minPercentPaid", "Requiring 100% repaid means the loan is already closed — there is nothing to top up.");
    }
    if (c.topup.settlementMode === "parallel" && c.topup.blockIfInArrears === false) {
      // Not fatal, but the combination is how a book quietly doubles its exposure.
      bad("topup.settlementMode", "Parallel top-ups while in arrears will stack exposure on a customer who is already late.");
    }
  }

  if (c.waiver.enabled) {
    const a = c.waiver.allow;
    if (!a.penalty && !a.interest && !a.fees && !a.principal) {
      bad("waiver.allow", "Waivers are on but nothing may be waived.");
    }
    if (a.principal && c.waiver.maxAmount === 0 && c.waiver.maxPercent === 0) {
      bad("waiver.maxAmount", "Principal may be waived with no cap at all. Set a maximum amount or percentage.");
    }
  }

  if (c.writeoff.enabled && c.writeoff.afterArrearsDays < c.arrears.nplAfterDays) {
    bad("writeoff.afterArrearsDays", `A loan would be written off (${c.writeoff.afterArrearsDays} days) before it is even non-performing (${c.arrears.nplAfterDays} days).`);
  }

  if (c.penalty.enabled && c.penalty.rate === 0) {
    bad("penalty.rate", "Penalties are on but the rate is zero — nothing would ever be charged.");
  }
  if (c.penalty.recurrence === "recurring" && c.penalty.capPercentOfPrincipal === 0) {
    bad("penalty.capPercentOfPrincipal", "A recurring penalty with no cap grows without limit. Set a ceiling.");
  }

  // ── Arrears buckets must tile the number line without gaps or overlaps ──
  const b = c.arrears.buckets;
  if (b.length === 0) bad("arrears.buckets", "Define at least one ageing bucket.");
  if (b.length > 0 && b[0].fromDays !== 0) bad("arrears.buckets", "The first bucket must start at day 0.");
  for (let i = 0; i < b.length; i++) {
    const cur = b[i];
    if (cur.toDays !== null && cur.toDays < cur.fromDays) {
      bad(`arrears.buckets.${i}`, `"${cur.label}" ends before it begins.`);
    }
    if (cur.toDays === null && i !== b.length - 1) {
      bad(`arrears.buckets.${i}`, `"${cur.label}" is open-ended but is not the last bucket.`);
    }
    const next = b[i + 1];
    if (next && cur.toDays !== null && next.fromDays !== cur.toDays + 1) {
      bad(`arrears.buckets.${i}`, `"${cur.label}" and "${next.label}" leave a gap or overlap at day ${cur.toDays}.`);
    }
  }
  if (b.length > 0 && b[b.length - 1].toDays !== null) {
    bad(`arrears.buckets.${b.length - 1}`, "The last bucket must be open-ended, or loans older than it would age into nothing.");
  }
  if (c.arrears.nplAfterDays < c.arrears.delinquentAfterDays) {
    bad("arrears.nplAfterDays", "A loan cannot be non-performing before it is delinquent.");
  }

  if (c.disbursement.cutoffFrom && c.disbursement.cutoffTo && c.disbursement.cutoffFrom >= c.disbursement.cutoffTo) {
    bad("disbursement.cutoffTo", "The payout window closes before it opens.");
  }

  return out;
}

// ── Readers ───────────────────────────────────────────────────────────────────

/** Which ageing bucket a days-past-due figure falls in. */
export function bucketFor(c: LoansConfig, daysPastDue: number) {
  const d = Math.max(0, Math.round(daysPastDue));
  return (
    c.arrears.buckets.find((b) => d >= b.fromDays && (b.toDays === null || d <= b.toDays)) ??
    c.arrears.buckets[c.arrears.buckets.length - 1] ??
    null
  );
}

/** Is a payout permitted right now, under the disbursement window? */
export function payoutWindowOpen(c: LoansConfig, at = new Date()): boolean {
  const { cutoffFrom, cutoffTo, payoutDays } = c.disbursement;
  if (payoutDays.length > 0 && !payoutDays.includes(at.getDay())) return false;
  if (!cutoffFrom || !cutoffTo) return true;
  const hhmm = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  return hhmm >= cutoffFrom && hhmm <= cutoffTo;
}
