// ─────────────────────────────────────────────────────────────────────────────
// WHAT THE CUSTOMER MEANT, AND WHERE THE MONEY WILL ACTUALLY GO.
//
// ── THE PROBLEM ─────────────────────────────────────────────────────────────
// "Pay now" with a purpose picker is an obvious feature and a dangerous one.
// The obvious build is five buttons — repayment, savings, CRB, processing fee,
// penalty — each of which posts the same request, because Micromart's own
// `Repayment` endpoint takes exactly `{ Amount, PhoneNumber, EntityId }` and
// nothing else. The customer picks "Savings", the money pays down their loan,
// and the app told them otherwise on a money screen. That is the single worst
// thing this feature could do.
//
// ── WHAT ACTUALLY DECIDES THE ALLOCATION ────────────────────────────────────
// Not us, and not their API. `dbo.RepaymentTrigger`, an AFTER INSERT trigger on
// `dbo.INCOMINGC2B`, which is where every M-Pesa payment on this book lands.
// Read live on 10 Sep 2026, its rule is:
//
//   · no open approved loan            → the WHOLE amount becomes savings
//     (`sp_CreateAccountSavings`)
//   · an open loan, amount ≤ balance   → all of it pays the loan down
//   · an open loan, amount > balance   → the loan clears, the REMAINDER
//     becomes savings
//
// and then it writes the customer statement, knocks the loan schedule, holds
// the paid amount, runs the promise-to-pay knocker, and sends the confirmation
// SMS through `Notifications.dbo.sp_InsertsmsAndEmails`. All of that is theirs
// and all of it is correct. Replicating any of it here would fork the ledger.
//
// ── SO WHAT IS A PURPOSE FOR ────────────────────────────────────────────────
// Two real things, neither of which is routing:
//
//   1. IT SETS THE AMOUNT AND THE EXPECTATION. "Clear my loan" and "put money
//      aside" suggest different figures and produce different confirmations.
//   2. IT IS RECORDED. What a customer BELIEVED they were paying for is the
//      first question in any dispute, and today nobody captures it.
//
// What a purpose must never do is describe a destination the trigger will not
// honour. So every purpose resolves through `explainAllocation()` below, which
// applies the trigger's own rule to the customer's current position and returns
// the split in shillings. The screen shows that split BEFORE the prompt goes
// out. Where the customer's intent and the trigger disagree — "save" while a
// loan is open — the screen says so plainly rather than quietly reinterpreting.
//
// ── CRB, PROCESSING FEE AND PENALTY ─────────────────────────────────────────
// On entity 3005 these are configured in `ProductFees` (CRBFee, PROCESSINGFEE,
// SecurityFee, ChapInstallmentFee) and applied at origination — before
// disbursement, deducted from principal, or spread across instalments, per
// `ProductFeesTypes`. `LoanChargeBalance`, the table that would carry a
// separately settleable per-charge balance, is EMPTY on this server.
//
// So they are not separate pots a customer can pay into. They are already
// inside the loan balance. Offering them is still right — it is how customers
// think and what they are asked for on the phone — but the copy says where the
// money lands, which is the loan.
// ─────────────────────────────────────────────────────────────────────────────

/** The purposes the app offers. Ordered as the sheet presents them. */
export const PAY_PURPOSES = ["repayment", "savings", "penalty", "processing-fee", "crb"] as const;
export type PayPurpose = (typeof PAY_PURPOSES)[number];

export function isPayPurpose(v: unknown): v is PayPurpose {
  return typeof v === "string" && (PAY_PURPOSES as readonly string[]).includes(v);
}

export type Allocation = {
  /** What the customer said they were doing. */
  purpose: PayPurpose;
  /** Of the amount, what pays down the loan. */
  toLoan: number;
  /** Of the amount, what lands in savings. */
  toSavings: number;
  /** Will this clear the loan outright? */
  clearsLoan: boolean;
  /**
   * True when the trigger will NOT do what the purpose literally says — the
   * only case being "savings" while a loan is open, because the trigger always
   * settles the loan first. The screen must surface this before confirming,
   * not after the money has moved.
   */
  divergent: boolean;
  /** One sentence, in the customer's language, stating where the money goes. */
  explanation: string;
};

const kes = (n: number) => `KSh ${Math.round(n).toLocaleString("en-KE")}`;

/**
 * Apply RepaymentTrigger's rule to this customer's position.
 *
 * `outstanding` is the loan balance as the lender holds it. Everything here is
 * a PREDICTION of what their trigger will do — it is deliberately derived from
 * the trigger's logic rather than from what we would like to happen, so that
 * when the two ever diverge the fix is to re-read the trigger and change this,
 * not to argue with a customer about a confirmation screen.
 */
export function explainAllocation(purpose: PayPurpose, amount: number, outstanding: number): Allocation {
  const amt = Math.max(0, Math.round(amount));
  const owed = Math.max(0, Math.round(outstanding));

  // No open loan: everything becomes savings, whatever the customer chose.
  if (owed <= 0) {
    return {
      purpose,
      toLoan: 0,
      toSavings: amt,
      clearsLoan: false,
      // Not divergent. With nothing owed, "repay" landing in savings is the
      // only sensible outcome and every customer expects it — being told their
      // payment was "redirected" when they owe nothing would be alarming noise.
      divergent: false,
      explanation:
        purpose === "savings"
          ? `${kes(amt)} goes into your savings.`
          : `You have no running loan, so ${kes(amt)} goes into your savings and waits there.`,
    };
  }

  const toLoan = Math.min(amt, owed);
  const toSavings = amt - toLoan;
  const clearsLoan = toLoan >= owed;

  if (purpose === "savings") {
    return {
      purpose,
      toLoan,
      toSavings,
      clearsLoan,
      divergent: true,
      explanation:
        toSavings > 0
          ? `Your lender settles the loan first. ${kes(toLoan)} clears what you owe and the remaining ${kes(toSavings)} goes into savings.`
          : `Your lender settles the loan first, so this ${kes(amt)} goes against your balance of ${kes(owed)} rather than into savings.`,
    };
  }

  const head =
    purpose === "penalty"
      ? "Penalties are carried in your loan balance"
      : purpose === "processing-fee"
        ? "Your processing fee is already inside your loan balance"
        : purpose === "crb"
          ? "Your CRB fee is already inside your loan balance"
          : null;

  return {
    purpose,
    toLoan,
    toSavings,
    clearsLoan,
    divergent: false,
    explanation: head
      ? `${head}, so ${kes(toLoan)} goes against it${clearsLoan ? " and clears the loan" : ""}${
          toSavings > 0 ? `, and ${kes(toSavings)} lands in savings` : ""
        }.`
      : clearsLoan
        ? `${kes(toLoan)} clears your loan${toSavings > 0 ? `, and ${kes(toSavings)} goes into savings` : ""}.`
        : `${kes(toLoan)} comes off your balance, leaving ${kes(owed - toLoan)}.`,
  };
}

/** The label the sheet shows, kept beside the logic it describes. */
export const PURPOSE_LABELS: Record<PayPurpose, { label: string; note: string }> = {
  repayment: { label: "Repay my loan", note: "Pay down what you owe." },
  savings: { label: "Save", note: "Put money aside in your account." },
  penalty: { label: "Late penalty", note: "Settle a penalty on your loan." },
  "processing-fee": { label: "Processing fee", note: "The fee charged on your loan." },
  crb: { label: "CRB fee", note: "The credit reference bureau charge." },
};
