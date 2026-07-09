// ─────────────────────────────────────────────────────────────────────────────
// The repayment schedule — one pure function, two callers.
//
// The offer a borrower signs and the loan we book MUST be the same numbers. The
// only way to guarantee that is for both to come from here: `buildSchedule` is
// deterministic in its inputs, and `bookLoanFromApplication` re-runs it against
// the accepted offer's terms and refuses to book if the totals disagree.
//
// Interest methods:
//   FLAT     — interest = principal × rate%. Equal installments; the last row
//              absorbs rounding so the schedule sums exactly to the total.
//   REDUCING — equal principal, interest on the declining balance. The product
//              rate is the rate for the FULL term, spread per period, so total
//              interest = P × rate% × (n+1)/(2n) — always ≤ the flat equivalent.
// ─────────────────────────────────────────────────────────────────────────────

export const round2 = (n: number) => Math.round(n * 100) / 100;

export type ScheduleRow = {
  seq: number;
  dueDate: Date;
  amountDue: number;
  principalDue: number;
  interestDue: number;
};

export type ScheduleTerms = {
  principal: number;
  /** Percent for the whole term, e.g. 12 for 12%. */
  rate: number;
  /** Number of installments. */
  count: number;
  /** "day" | "week" | "month" (prefix-matched, as ServiceSuite stores it). */
  unit: string;
  method: "flat" | "reducing";
  graceDays?: number;
  /** Defaults to now. Pass the offer's borrowDate to reproduce a schedule exactly. */
  borrowDate?: Date;
};

export type Schedule = {
  rows: ScheduleRow[];
  interest: number;
  loanAmount: number;
  borrowDate: Date;
  scheduleStart: Date;
  firstDueDate: Date;
  expectedClearDate: Date;
};

export function stepDate(from: Date, unit: string, count: number): Date {
  const d = new Date(from);
  const u = unit.toLowerCase();
  if (u.startsWith("month")) d.setMonth(d.getMonth() + count);
  else if (u.startsWith("week")) d.setDate(d.getDate() + 7 * count);
  else d.setDate(d.getDate() + count); // day
  return d;
}

export function buildSchedule(t: ScheduleTerms): Schedule {
  const principal = t.principal;
  const rate = t.rate;
  const count = Math.max(1, t.count);
  const graceDays = t.graceDays ?? 0;
  const borrowDate = t.borrowDate ?? new Date();
  const scheduleStart = new Date(borrowDate.getTime() + graceDays * 86_400_000);

  const rows: ScheduleRow[] = [];
  let interest: number;

  if (t.method === "reducing") {
    const periodicRate = rate / 100 / count;
    const perPrincipal = round2(principal / count);
    let outstanding = principal;
    let prinAcc = 0;
    let intAcc = 0;
    for (let i = 1; i <= count; i++) {
      const last = i === count;
      const principalDue = last ? round2(principal - prinAcc) : perPrincipal;
      const interestDue = round2(outstanding * periodicRate);
      rows.push({
        seq: i,
        dueDate: stepDate(scheduleStart, t.unit, i),
        amountDue: round2(principalDue + interestDue),
        principalDue,
        interestDue,
      });
      prinAcc = round2(prinAcc + principalDue);
      intAcc = round2(intAcc + interestDue);
      outstanding = round2(outstanding - principalDue);
    }
    interest = intAcc;
  } else {
    interest = round2(principal * (rate / 100));
    const total = round2(principal + interest);
    const perAmount = round2(total / count);
    const perPrincipal = round2(principal / count);
    let amtAcc = 0;
    let prinAcc = 0;
    for (let i = 1; i <= count; i++) {
      const last = i === count;
      const amountDue = last ? round2(total - amtAcc) : perAmount;
      const principalDue = last ? round2(principal - prinAcc) : perPrincipal;
      rows.push({
        seq: i,
        dueDate: stepDate(scheduleStart, t.unit, i),
        amountDue,
        principalDue,
        interestDue: round2(amountDue - principalDue),
      });
      amtAcc = round2(amtAcc + amountDue);
      prinAcc = round2(prinAcc + principalDue);
    }
  }

  return {
    rows,
    interest,
    loanAmount: round2(principal + interest),
    borrowDate,
    scheduleStart,
    firstDueDate: rows[0].dueDate,
    expectedClearDate: rows[rows.length - 1].dueDate,
  };
}

/**
 * What the borrower saves by settling today, in full, at installment `afterSeq`.
 *
 * Blueprint §5.1.12 wants "pay early, pay less" on the offer. Only a REDUCING
 * balance loan actually charges less when you settle early — under FLAT the
 * interest was fixed the day the loan was written, and telling a borrower
 * otherwise would be a lie. So this returns zero for flat, and the UI says why.
 */
export function earlySettlementSaving(t: ScheduleTerms, afterSeq: number): number {
  if (t.method !== "reducing" || afterSeq >= t.count) return 0;
  const full = buildSchedule(t);
  const remaining = full.rows.filter((r) => r.seq > afterSeq);
  return round2(remaining.reduce((s, r) => s + r.interestDue, 0));
}
