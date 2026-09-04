// ─────────────────────────────────────────────────────────────────────────────
// ONE LOAN, WHOLE — the file behind a single row of the loan book.
//
// The loans list answers "which loans are behind?". The customer statement
// answers "what has passed between us, ever?". Neither answers the question an
// officer on the phone actually has, which is about ONE loan:
//
//   what did we lend, on what terms, which instalments have been paid, which one
//   is late and by how much, what has this person actually sent against it, and
//   what would it cost them to clear it today?
//
// That question had no page. The loans list linked the customer's name to
// Customer 360 — a page about the PERSON — so an officer working an arrears
// queue landed on four loans when they had clicked one, and had to work out for
// themselves which of them the row was about. This module is the read behind the
// page that answers it.
//
// ── THE RULES ARE THE ONES THE REST OF THIS FOLDER ALREADY FOLLOWS ──────────
//   · ARREARS IS READ, NEVER DERIVED. Transactions.dbo.LoansInArrears is the
//     register the lender's own PAR reports are computed from. A figure we
//     derived from the schedule disagreed with it — 33 loans against their 47 —
//     and a console that contradicts the system of record loses the argument in
//     front of the customer.
//   · A CLEARED LOAN IS NOT IN ARREARS. Their register keeps rows after a loan
//     settles; loan #417250 is CLEARED with a zero balance and still reports 103
//     days past due. The loan being cleared is the stronger fact.
//   · NEVER FILTER LoanSchedule BY EntityId. 298,202 of entity 3005's schedule
//     rows are still stamped 3002 from the split. The LOAN establishes the
//     entity; the children are joined on Loanid alone.
//   · OUTSTANDING IS `amounttopay - AmountPaid`. `UnPaidAmount` exists, is NULL
//     across this book, and is what their own dashboard reads — which is exactly
//     why their dashboard is wrong about it.
// ─────────────────────────────────────────────────────────────────────────────
import { runReadOnlyQuery, mssql, type QueryParam } from "@/lib/enterprise/mssql";
import { type OrgDef } from "@/lib/enterprise/connections";
import { drivePhotoUrl } from "./servicesuite";
import type { StatementTxn } from "./servicesuite-statement";

const ARREARS = "Transactions.dbo.LoansInArrears";

/** A SQL Server `date` as the calendar day it holds — never toISOString(). */
function dateOnly(v: unknown): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export type InstallmentStatus = "PAID" | "PARTIAL" | "OVERDUE" | "DUE" | "UPCOMING";

export type LoanInstallment = {
  seq: number;
  dueDate: string | null;
  /** The contractual instalment — what sp_CreditScoringAndGraduation divides by. */
  installment: number;
  due: number;
  paid: number;
  outstanding: number;
  principalDue: number;
  interestDue: number;
  paidAt: string | null;
  penalised: boolean;
  status: InstallmentStatus;
};

export type LiveLoanFile = {
  loan: {
    loanId: number;
    ref: string;
    entityId: number;
    product: string | null;
    productId: number | null;
    /** "10 (Week)" — their own phrasing of the term. */
    term: string | null;
    status: "PENDING" | "ACTIVE" | "CLEARED";
    principal: number;
    interest: number;
    loanAmount: number;
    balance: number;
    penalty: number;
    amountDisbursed: number;
    borrowDate: string | null;
    disbursedAt: string | null;
    expectedClearDate: string | null;
    clearedAt: string | null;
    rolledOver: boolean;
    /** Their register's figure, not ours. */
    arrears: number;
    daysInArrears: number | null;
    firstMissedAt: string | null;
  };
  borrower: {
    serviceSuiteId: number;
    name: string | null;
    phone: string | null;
    nationalId: string | null;
    accountNo: string | null;
    photoUrl: string | null;
    office: string | null;
  };
  schedule: LoanInstallment[];
  /** The ledger rows this loan is named on — the money that actually moved. */
  ledger: StatementTxn[];
  totals: {
    scheduled: number;
    paid: number;
    outstanding: number;
    /** Instalments settled in full, out of how many. */
    settled: number;
    count: number;
    /** The earliest instalment still carrying money. */
    nextDue: { date: string; amount: number } | null;
  };
};

/**
 * One loan, read whole from the lender's book.
 *
 * `entityId` is asserted on the LOAN, which is the parent that establishes the
 * book: ids only mean something within an entity. Returns null when the loan is
 * not in this one — refusing is the safe answer, not falling back to a search.
 */
export async function getLoanLive(
  org: OrgDef,
  entityId: number,
  loanId: number,
): Promise<LiveLoanFile | null> {
  if (!Number.isInteger(loanId) || loanId <= 0) return null;

  const params: QueryParam[] = [
    { name: "loanId", type: mssql.Int, value: loanId },
    { name: "entityId", type: mssql.Int, value: entityId },
  ];

  const head = await runReadOnlyQuery(
    org,
    `SELECT TOP 1
            l.id, l.EntityId, l.BorrowerId, l.ProductId, l.Principal, l.Interest, l.Penalty,
            l.LoanAmount, l.LoanBalance, l.AmountToDisburse, l.BorrowDate, l.LoanDisbursmentDate,
            l.ExpectedClearDate, l.DateCleared, l.LoanCleared, l.isApproved, l.IsRolledOver,
            p.ProductName,
            CAST(p.RepaymentPeriod AS varchar(12)) + ' (' +
              ISNULL((SELECT duratioName FROM DurationOptions WHERE ID = p.RepaymentPeriodType), '') + ')' AS Term,
            LTRIM(RTRIM(ISNULL(b.firstName,'') + ' ' + ISNULL(b.otherName,''))) AS BorrowerName,
            b.PhoneNumber, b.NationalID, b.AccountNo, b.borrowerPhoto,
            dbo.GetOrganizationUnitsBreadcrumb(b.EntityUnit) AS OfficeTrail,
            ISNULL(ia.AmountInArrears, 0) AS AmountInArrears,
            ISNULL(ia.DaysInArears, 0) AS DaysInArrears,
            ia.FirstDateInArrears
     FROM Loans l
     JOIN Borrowers b ON b.ID = l.BorrowerId
     LEFT JOIN Products p ON p.ID = l.ProductId
     LEFT JOIN ${ARREARS} ia ON ia.LoanId = l.id
     WHERE l.id = @loanId AND l.EntityId = @entityId`,
    params,
    { timeoutMs: 45000, maxRows: 1 },
  );
  if (head.rows.length === 0) return null;

  const r = head.rows[0];
  const n = (v: unknown): number => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  };
  const str = (v: unknown): string | null => (v == null ? null : String(v).trim() || null);
  const borrowerId = n(r.BorrowerId);

  const [sched, ledger] = await Promise.all([
    // Joined on Loanid ALONE — see the header. `Loanid` has no usable index, so
    // this is one narrow scan for one loan rather than an OUTER APPLY per row.
    runReadOnlyQuery(
      org,
      `SELECT s.entryid, s.ExpectedDueDate, s.amounttopay, s.AmountPaid, s.InstallmentAmount,
              s.Principletopay, s.InterestTopay, s.dateofpayment, s.IsPenaltyAppled
       FROM LoanSchedule s
       WHERE s.Loanid = @loanId
       ORDER BY s.ExpectedDueDate, s.entryid`,
      params,
      { timeoutMs: 45000, maxRows: 500 },
    ),
    // The money that actually moved against THIS loan. Their disbursement row
    // carries the loan id; so does every repayment allocated to it.
    runReadOnlyQuery(
      org,
      `SELECT c.id, c.TransactedDate, c.Narration, c.MpesaRef, c.LoanId,
              c.TransType, c.Amount, c.LoanBalance, c.AccountBalance
       FROM CustomerStatement c
       WHERE c.LoanId = @loanId AND c.UserId = @borrowerId
       ORDER BY c.TransactedDate DESC, c.id DESC`,
      [...params, { name: "borrowerId", type: mssql.Int, value: borrowerId }],
      { timeoutMs: 45000, maxRows: 500 },
    ),
  ]);

  const cleared = n(r.LoanCleared) === 1;
  const approved = n(r.isApproved) === 1;
  const dpd = n(r.DaysInArrears);
  const today = dateOnly(new Date())!;

  const schedule: LoanInstallment[] = sched.rows.map((s, i) => {
    const due = n(s.amounttopay);
    const paid = n(s.AmountPaid);
    const outstanding = Math.max(0, due - paid);
    const dueDate = dateOnly(s.ExpectedDueDate);
    // Their book records no per-instalment status worth trusting (`status` is 0
    // across this loan), so it is derived from the two facts that are reliable:
    // what is still owed, and whether the day has passed.
    const status: InstallmentStatus =
      due > 0 && outstanding <= 0 ? "PAID"
      : dueDate && dueDate < today ? "OVERDUE"
      : paid > 0 ? "PARTIAL"
      : dueDate === today ? "DUE"
      : "UPCOMING";
    return {
      seq: n(s.entryid) || i + 1,
      dueDate,
      installment: n(s.InstallmentAmount) || due,
      due,
      paid,
      outstanding,
      principalDue: n(s.Principletopay),
      interestDue: n(s.InterestTopay),
      paidAt: dateOnly(s.dateofpayment),
      penalised: n(s.IsPenaltyAppled) === 1,
      status,
    };
  });

  const scheduled = schedule.reduce((t, s) => t + s.due, 0);
  const paidTotal = schedule.reduce((t, s) => t + s.paid, 0);
  const outstanding = schedule.reduce((t, s) => t + s.outstanding, 0);
  const nextDue =
    schedule
      .filter((s) => s.outstanding > 0 && s.dueDate)
      .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))
      .map((s) => ({ date: s.dueDate!, amount: s.outstanding }))[0] ?? null;

  // The office breadcrumb arrives as JSON [{Unit, Level, rn}], leaf-first.
  let office: string | null = null;
  try {
    const trail = JSON.parse(String(r.OfficeTrail ?? "[]")) as { Unit?: string; rn?: number }[];
    office =
      trail
        .sort((x, y) => (y.rn ?? 0) - (x.rn ?? 0))
        .map((x) => String(x.Unit ?? "").trim())
        .filter(Boolean)
        .join(" › ") || null;
  } catch {
    /* the trail is decorative */
  }

  return {
    loan: {
      loanId: n(r.id),
      ref: `ss:${n(r.id)}`,
      entityId: n(r.EntityId),
      product: str(r.ProductName),
      productId: r.ProductId == null ? null : n(r.ProductId),
      term: str(r.Term),
      status: cleared ? "CLEARED" : approved ? "ACTIVE" : "PENDING",
      principal: n(r.Principal),
      interest: n(r.Interest),
      loanAmount: n(r.LoanAmount),
      balance: n(r.LoanBalance),
      penalty: n(r.Penalty),
      amountDisbursed: n(r.AmountToDisburse),
      borrowDate: dateOnly(r.BorrowDate),
      disbursedAt: r.LoanDisbursmentDate ? new Date(r.LoanDisbursmentDate as string).toISOString() : null,
      expectedClearDate: dateOnly(r.ExpectedClearDate),
      clearedAt: dateOnly(r.DateCleared),
      rolledOver: n(r.IsRolledOver) === 1,
      arrears: cleared ? 0 : n(r.AmountInArrears),
      daysInArrears: !cleared && dpd > 0 ? dpd : null,
      firstMissedAt: cleared ? null : dateOnly(r.FirstDateInArrears),
    },
    borrower: {
      serviceSuiteId: borrowerId,
      name: str(r.BorrowerName),
      phone: str(r.PhoneNumber),
      nationalId: str(r.NationalID),
      accountNo: str(r.AccountNo),
      photoUrl: drivePhotoUrl(r.borrowerPhoto),
      office,
    },
    schedule,
    ledger: ledger.rows.map((t) => ({
      id: n(t.id),
      at: new Date(t.TransactedDate as string).toISOString(),
      narration: str(t.Narration),
      reference: str(t.MpesaRef),
      loanId: t.LoanId == null ? null : n(t.LoanId),
      // THEIR sense: 1 = money reaching the customer, 2 = money leaving them.
      direction: n(t.TransType) === 1 ? "in" : "out",
      amount: n(t.Amount),
      loanBalance: t.LoanBalance == null ? null : n(t.LoanBalance),
      accountBalance: t.AccountBalance == null ? null : n(t.AccountBalance),
    })),
    totals: {
      scheduled,
      paid: paidTotal,
      outstanding,
      settled: schedule.filter((s) => s.status === "PAID").length,
      count: schedule.length,
      nextDue,
    },
  };
}
