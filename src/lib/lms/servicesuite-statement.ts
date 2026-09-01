// ─────────────────────────────────────────────────────────────────────────────
// THE CUSTOMER STATEMENT — every shilling that moved, as the lender records it.
//
// ── WHY THIS IS THE MOST IMPORTANT LIVE READ IN THE CONSOLE ─────────────────
// A balance says where somebody is. The statement says HOW THEY GOT THERE, and
// for these customers that is the only thing that answers the question the
// console exists to answer: do they pay? `CustomerStatement` holds 671,440 rows
// for 16,568 of entity 3005's 17,021 borrowers, running from August 2021 to this
// morning. It is the repayment behaviour, first-hand.
//
// ── IT IS MODELLED ON sp_GetCustomerStatement, NOT CALLED ───────────────────
// ServiceSuite renders this through `sp_GetCustomerStatement` (BorrowerManager
// .GetBorrowerStatement), which returns three result sets. This file returns the
// same three things and deliberately does NOT execute that procedure, for two
// reasons:
//
//   · IT RETURNS FORMATTED STRINGS. Every money column comes back through
//     FORMAT(..., 'c', @currencyLanguageCode) — "KSh 5,229.00", not 5229. That
//     is right for their Razor view and useless to a typed API: the console
//     cannot total, sort or chart a string, and parsing money back out of a
//     localised label is how rounding bugs are born.
//   · IT TAKES ONLY @userid AND DERIVES THE ENTITY FROM THE BORROWER ROW. This
//     integration is explicitly entity-scoped — 3002 and 3005 hold different
//     people — so the entity is checked HERE rather than inferred.
//
// The SEMANTICS are theirs and are followed exactly, including the two that are
// easy to get backwards:
//
//   TransType 1 = "Money In", 2 = "Money OUT" — FROM THE CUSTOMER'S SIDE. A loan
//   repayment is TransType 2, because it left their pocket, even though it is
//   money arriving at the lender. Flipping this would label every repayment a
//   disbursement.
//
//   ARREARS comes from their own figure. `dbo.GetBorrowerArrears(LoanId)` and
//   `Transactions.dbo.LoansInArrears` were compared row by row on 1 Sep 2026 and
//   agree exactly (6729/6729, 4684/4684, 9975/9975 …), so the register is used
//   here too and the statement can never disagree with the loans list.
//
// ── AND THE ONE THAT CAUGHT US ──────────────────────────────────────────────
// These customers were moved from entity 3002 to 3005 and THEIR SCHEDULE ROWS
// DID NOT COME WITH THEM: 298,202 LoanSchedule rows for 3005 loans are still
// stamped EntityId 3002, against 448 stamped 3005. So nothing here filters a
// child table by entity — the loan or the borrower establishes it, and asking
// the children to agree would silently drop 99.85% of the history.
// ─────────────────────────────────────────────────────────────────────────────
import { runReadOnlyQuery, mssql, type QueryParam } from "@/lib/enterprise/mssql";
import { type OrgDef } from "@/lib/enterprise/connections";

const ARREARS = "Transactions.dbo.LoansInArrears";

/** A SQL Server `date`/`datetime`, as the calendar date it holds. Never
 *  toISOString() on a date column — see servicesuite-loans.ts for the day that
 *  cost. */
function dateOnly(v: unknown): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export type StatementTxn = {
  id: number;
  /** Full timestamp — two repayments can land in the same second (they do). */
  at: string;
  narration: string | null;
  /** The M-Pesa receipt. What a customer quotes when they ring up. */
  reference: string | null;
  loanId: number | null;
  /** THEIR sense: "in" is money reaching the customer, "out" is money leaving
   *  them. A loan repayment is "out". */
  direction: "in" | "out";
  amount: number;
  /** The running balances as they stood after this row. */
  loanBalance: number | null;
  accountBalance: number | null;
};

export type StatementLoan = {
  loanId: number;
  product: string | null;
  borrowDate: string | null;
  principal: number;
  interest: number;
  installmentAmount: number | null;
  installments: string | null;
  balance: number;
  expectedClearDate: string | null;
  /** Their register's figure, not ours. */
  arrears: number;
  daysInArrears: number | null;
  status: "ACTIVE" | "CLEARED";
};

export type LiveStatement = {
  borrower: {
    serviceSuiteId: number;
    name: string | null;
    accountNo: string | null;
    nationalId: string | null;
    phone: string | null;
    office: string | null;
    entityId: number;
  };
  loans: StatementLoan[];
  transactions: StatementTxn[];
  /** Across the WHOLE ledger, not just the page — the totals are the point. */
  totals: { moneyIn: number; moneyOut: number; count: number; firstAt: string | null; lastAt: string | null };
  /** True when `transactions` was capped and older rows exist. */
  truncated: boolean;
};

/**
 * One customer's statement, straight from the lender's book.
 *
 * `entityId` is REQUIRED and checked. A borrower id is only unique within an
 * entity's meaning here: 3002 and 3005 hold different people, and rendering a
 * statement for the wrong one would be a data-protection incident rather than a
 * display bug. Returns null when the id does not belong to this entity.
 */
export async function getCustomerStatementLive(
  org: OrgDef,
  entityId: number,
  borrowerId: number,
  opts: { take?: number } = {},
): Promise<LiveStatement | null> {
  const take = Math.min(Math.max(opts.take ?? 300, 1), 1000);
  const params: QueryParam[] = [
    { name: "borrowerId", type: mssql.Int, value: borrowerId },
    { name: "entityId", type: mssql.Int, value: entityId },
  ];

  const who = await runReadOnlyQuery(
    org,
    `SELECT TOP 1 b.ID, b.firstName, b.otherName, b.AccountNo, b.NationalID, b.PhoneNumber, b.EntityId,
            dbo.GetOrganizationUnitsBreadcrumb(b.EntityUnit) AS OfficeTrail
     FROM Borrowers b WHERE b.ID = @borrowerId AND b.EntityId = @entityId`,
    params,
    { timeoutMs: 30000, maxRows: 1 },
  );
  if (who.rows.length === 0) return null;

  const n = (v: unknown): number => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  };
  const str = (v: unknown): string | null => (v == null ? null : String(v).trim() || null);

  const [loanRows, txnRows, totalRows] = await Promise.all([
    // EVERY approved loan, not the TOP 1 their procedure returns. Their view is a
    // one-loan statement; a console reviewing repayment behaviour needs the run
    // of them, and "three cleared before this one" is the most informative thing
    // on the page.
    runReadOnlyQuery(
      org,
      `SELECT l.id, p.ProductName, l.BorrowDate, l.Principal, l.Interest, l.LoanBalance,
              l.ExpectedClearDate, l.LoanCleared,
              CAST(p.RepaymentPeriod AS varchar(12)) + ' (' +
                ISNULL((SELECT duratioName FROM DurationOptions WHERE ID = p.RepaymentPeriodType), '') + ')' AS Installments,
              (SELECT TOP 1 s.InstallmentAmount FROM LoanSchedule s WHERE s.Loanid = l.id) AS InstallmentAmount,
              ISNULL(ia.AmountInArrears, 0) AS AmountInArrears,
              ISNULL(ia.DaysInArears, 0) AS DaysInArrears
       FROM Loans l
       LEFT JOIN Products p ON p.ID = l.ProductId
       LEFT JOIN ${ARREARS} ia ON ia.LoanId = l.id
       WHERE l.BorrowerId = @borrowerId AND l.isApproved = 1
       ORDER BY l.id DESC`,
      params,
      { timeoutMs: 45000, maxRows: 200 },
    ),
    // Newest first: a statement is read from the top, and the most recent
    // payment is the one somebody is ringing about.
    runReadOnlyQuery(
      org,
      `SELECT TOP (${take}) c.id, c.TransactedDate, c.Narration, c.MpesaRef, c.LoanId,
              c.TransType, c.Amount, c.LoanBalance, c.AccountBalance
       FROM CustomerStatement c
       WHERE c.UserId = @borrowerId
       ORDER BY c.TransactedDate DESC, c.id DESC`,
      params,
      { timeoutMs: 45000, maxRows: take },
    ),
    // Totals over the WHOLE ledger. Summing the page would understate a customer
    // with four years of history, and understating what somebody has repaid is
    // the least forgivable arithmetic on this screen.
    runReadOnlyQuery(
      org,
      `SELECT COUNT(*) AS n,
              ISNULL(SUM(CASE WHEN c.TransType = 1 THEN c.Amount END), 0) AS moneyIn,
              ISNULL(SUM(CASE WHEN c.TransType = 2 THEN c.Amount END), 0) AS moneyOut,
              MIN(c.TransactedDate) AS firstAt, MAX(c.TransactedDate) AS lastAt
       FROM CustomerStatement c WHERE c.UserId = @borrowerId`,
      params,
      { timeoutMs: 45000, maxRows: 1 },
    ),
  ]);

  const b = who.rows[0];

  // The office breadcrumb arrives as JSON [{Unit, Level, rn}], leaf-first.
  let office: string | null = null;
  try {
    const trail = JSON.parse(String(b.OfficeTrail ?? "[]")) as { Unit?: string; rn?: number }[];
    office =
      trail
        .sort((x, y) => (y.rn ?? 0) - (x.rn ?? 0))
        .map((x) => String(x.Unit ?? "").trim())
        .filter(Boolean)
        .join(" › ") || null;
  } catch {
    /* the trail is decorative */
  }

  const totals = totalRows.rows[0] ?? {};

  return {
    borrower: {
      serviceSuiteId: n(b.ID),
      name: `${String(b.firstName ?? "").trim()} ${String(b.otherName ?? "").trim()}`.trim() || null,
      accountNo: str(b.AccountNo),
      nationalId: str(b.NationalID),
      phone: str(b.PhoneNumber),
      office,
      entityId: n(b.EntityId),
    },
    loans: loanRows.rows.map((r) => {
      // Their own rule: cleared or not. The WHERE already restricts to approved
      // loans, so there is no third state to render here.
      const cleared = n(r.LoanCleared) === 1;
      const dpd = n(r.DaysInArrears);

      // ── A CLEARED LOAN IS NOT IN ARREARS, WHATEVER THE REGISTER SAYS ──────
      // LoansInArrears keeps rows after a loan settles: this customer's loan
      // #417250 is CLEARED with a zero balance and the register still reports
      // 2 outstanding at 103 days past due. The row is a leftover, not a debt.
      //
      // Rendering it would put "103 days in arrears" beside a loan the customer
      // paid off months ago — which is alarming, wrong, and exactly the sort of
      // thing that gets repeated to the customer before anyone checks. The loan
      // being cleared is the stronger fact, so it wins.
      return {
        loanId: n(r.id),
        product: str(r.ProductName),
        borrowDate: dateOnly(r.BorrowDate),
        principal: n(r.Principal),
        interest: n(r.Interest),
        installmentAmount: r.InstallmentAmount == null ? null : n(r.InstallmentAmount),
        installments: str(r.Installments),
        balance: n(r.LoanBalance),
        expectedClearDate: dateOnly(r.ExpectedClearDate),
        arrears: cleared ? 0 : n(r.AmountInArrears),
        daysInArrears: !cleared && dpd > 0 ? dpd : null,
        status: cleared ? "CLEARED" : "ACTIVE",
      };
    }),
    transactions: txnRows.rows.map((r) => ({
      id: n(r.id),
      // A timestamp, not a date: two repayments landing in the same second is
      // normal here, and collapsing them to a day loses the order they arrived.
      at: r.TransactedDate ? new Date(r.TransactedDate as string).toISOString() : "",
      narration: str(r.Narration),
      reference: str(r.MpesaRef),
      loanId: r.LoanId != null && n(r.LoanId) > 0 ? n(r.LoanId) : null,
      direction: n(r.TransType) === 1 ? "in" : "out",
      amount: n(r.Amount),
      loanBalance: r.LoanBalance == null ? null : n(r.LoanBalance),
      accountBalance: r.AccountBalance == null ? null : n(r.AccountBalance),
    })),
    totals: {
      count: n(totals.n),
      moneyIn: n(totals.moneyIn),
      moneyOut: n(totals.moneyOut),
      firstAt: totals.firstAt ? new Date(totals.firstAt as string).toISOString() : null,
      lastAt: totals.lastAt ? new Date(totals.lastAt as string).toISOString() : null,
    },
    truncated: n(totals.n) > txnRows.rows.length,
  };
}

/**
 * What has been REPAID on one of their loans since a moment in time.
 *
 * The promise-to-pay resolver needs this. A promise taken on the live arrears
 * queue is keyed on `ss:<loanId>`, and the money that answers it lands in THEIR
 * paybill and THEIR ledger — never in our C2BReceipt/PaymentIntent tables. Asked
 * of those tables the answer is always zero, which would resolve every live
 * promise BROKEN and tell an officer a customer who paid did not.
 *
 * TransType 2, because a repayment is money leaving the CUSTOMER (see the header
 * — this is the semantic that is easy to get backwards, and getting it backwards
 * here would count a disbursement as a repayment).
 *
 * Not entity-filtered, deliberately: the loan id establishes the entity, and
 * CustomerStatement is a child table — see the 3005 transfer note in the header.
 */
export async function paidOnLoanSince(org: OrgDef, serviceSuiteLoanId: number, since: Date): Promise<number> {
  const { rows } = await runReadOnlyQuery(
    org,
    `SELECT ISNULL(SUM(c.Amount), 0) AS paid
     FROM CustomerStatement c WITH (NOLOCK)
     WHERE c.LoanId = @loanId AND c.TransType = 2 AND c.TransactedDate >= @since`,
    [
      { name: "loanId", type: mssql.Int, value: serviceSuiteLoanId },
      { name: "since", type: mssql.DateTime, value: since },
    ],
    { timeoutMs: 30000, maxRows: 1 },
  );
  const v = Number(rows[0]?.paid);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}
