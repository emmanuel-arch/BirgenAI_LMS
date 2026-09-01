// ─────────────────────────────────────────────────────────────────────────────
// THE LENDER'S LOAN BOOK, READ THROUGH RATHER THAN COPIED.
//
// Entity 3005 holds ~61,500 loans: 59.8k cleared, ~96 running, ~310 awaiting
// approval. The console pages this in the lender's own database for the same
// reason the borrower list does — a mirror in our Postgres would be a stale
// picture of somebody else's book, and the one thing a lending console must
// never be is confidently out of date about a balance.
//
// ── ARREARS COMES FROM THEIR TABLE, NOT FROM OUR ARITHMETIC ─────────────────
// `Transactions.dbo.LoansInArrears` is ServiceSuite's own arrears register —
// LoanId, DaysInArears (their spelling), AmountInArrears — maintained by their
// job and read by their DashboardController and AnalyticsController for every
// PAR figure Micromart actually looks at.
//
// This file first derived arrears from the schedule instead, and the two do not
// agree: on 1 Sep 2026 their register said 47 loans and KSh 127,009 while the
// derived figure said 33 and KSh 108,799. Both are defensible arithmetic; only
// one is the number on the lender's own screen. A console that contradicts the
// system of record is worse than one that stays quiet, because the disagreement
// surfaces in front of the customer and every other figure becomes suspect.
//
// So arrears and days-past-due are READ, never computed. The schedule is used
// for the one thing their register does not carry: the NEXT instalment owing.
//
// ── THE COLUMN THAT LIES IF YOU TRUST IT ─────────────────────────────────────
// LoanSchedule.UnPaidAmount IS NULL ON AN UNPAID INSTALMENT. Not zero — NULL.
// 3,109 of the 3,111 unpaid rows in this entity carry NULL.
//
// So `WHERE UnPaidAmount > 0` is never true, and `SUM(CASE … THEN UnPaidAmount)`
// is NULL, which ISNULL(…,0) then reports as a confident zero. ServiceSuite's
// OWN DashboardController carries this bug — its arrears expression returns 0
// against this data — which is very likely why its PAR screens read the register
// instead. What is outstanding is `amounttopay - ISNULL(AmountPaid, 0)`, and
// that is the only form used here.
//
// ── AND THE JOIN THAT WOULD DROP MOST OF THE SCHEDULE ───────────────────────
// LoanSchedule is joined on `Loanid` alone and deliberately NOT filtered by
// EntityId: that column is populated inconsistently — 448 rows carry 3005
// against ~2M rows overall. The loan already establishes the entity, so making
// the child table agree would silently discard almost every instalment.
// ─────────────────────────────────────────────────────────────────────────────
import { runReadOnlyQuery, mssql, type QueryParam } from "@/lib/enterprise/mssql";
import { type OrgDef } from "@/lib/enterprise/connections";

/** The outstanding amount on one instalment. The only correct form — see above. */
const DUE = "(ISNULL(s.amounttopay,0) - ISNULL(s.AmountPaid,0))";

/**
 * ServiceSuite's arrears register. A CROSS-DATABASE name, written exactly as
 * their own controllers write it (`Transactions.dbo.LoansInArrears` in
 * DashboardController and AnalyticsController). It sits beside the loan book on
 * the same server, so the read-only credential reaches it — verified against
 * entity 3005.
 */
const ARREARS = "Transactions.dbo.LoansInArrears";

/**
 * A SQL Server `date` column, as the calendar date it actually is.
 *
 * NOT toISOString(). The driver hands `date` back as a JS Date at local
 * midnight, so in Nairobi (UTC+3) an instalment due on the 7th becomes
 * "2026-09-06T21:00:00Z" and every due date in the console renders A DAY EARLY.
 * That is worse than a crash: a collections officer chases somebody the day
 * before they are late, and the schedule stays internally consistent while it
 * happens. Caught by comparing the adapter's output against the raw row.
 */
function dateOnly(v: unknown): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export type LiveLoanStatus = "PENDING" | "ACTIVE" | "CLEARED";

export type LiveLoan = {
  /** Namespaced because it is a ServiceSuite id, not an LMS uuid. */
  ref: string;
  serviceSuiteId: number;
  borrowerId: number;
  borrowerName: string | null;
  phone: string | null;
  nationalId: string | null;
  product: string | null;
  status: LiveLoanStatus;
  loanAmount: number;
  balance: number;
  principal: number;
  interest: number;
  penalty: number;
  borrowDate: string | null;
  disbursedAt: string | null;
  expectedClearDate: string | null;
  clearedAt: string | null;
  /** The next instalment still carrying money. Derived from the schedule — the
   *  arrears register does not hold it. */
  nextDue: { date: string; amount: number } | null;
  /** THE LENDER'S OWN FIGURE, from LoansInArrears. Never our arithmetic. */
  arrears: number;
  /** Their DaysInArears. Their spelling, their number. */
  daysInArrears: number | null;
  /** When this loan first fell behind, per their register. */
  firstMissedAt: string | null;
};

export type LiveLoanFilter = "all" | "active" | "cleared" | "pending" | "arrears";

export async function listLoansLive(
  org: OrgDef,
  entityId: number,
  opts: { q?: string; status?: LiveLoanFilter; take?: number; skip?: number } = {},
): Promise<{ loans: LiveLoan[]; total: number }> {
  const take = Math.min(Math.max(opts.take ?? 50, 1), 200);
  const skip = Math.max(opts.skip ?? 0, 0);
  const q = (opts.q ?? "").trim();
  const status = opts.status ?? "active";
  const digits = q.replace(/\D/g, "");
  // Phones are stored 2547XXXXXXXX; searches arrive as 07XX…, +2547…, 7XX… —
  // match on the last 9 digits so every format finds the same customer.
  const phone9 = digits.length >= 9 ? digits.slice(-9) : digits;

  const byStatus =
    status === "active"
      ? "AND l.isApproved = 1 AND l.LoanCleared = 0 AND l.LoanBalance > 0"
      : status === "cleared"
        ? "AND l.LoanCleared = 1"
        : status === "pending"
          ? "AND l.isApproved = 0"
          : status === "arrears"
            ? // Their register decides who is behind, so the filter and the
              // number in the column can never disagree with each other.
              "AND l.isApproved = 1 AND l.LoanCleared = 0 AND l.LoanBalance > 0 AND ISNULL(ia.DaysInArears,0) > 0"
            : "";

  const filter = `
    l.EntityId = @entityId
    ${byStatus}
    AND (@q = '' OR (
      (@phone9 <> '' AND RIGHT(REPLACE(b.PhoneNumber,' ',''), 9) LIKE '%' + @phone9 + '%')
      OR b.NationalID LIKE '%' + @q + '%'
      OR LTRIM(RTRIM(ISNULL(b.firstName,'') + ' ' + ISNULL(b.otherName,''))) LIKE '%' + @q + '%'
      OR CAST(l.id AS varchar(20)) = @q
    ))`;

  const params: QueryParam[] = [
    { name: "entityId", type: mssql.Int, value: entityId },
    { name: "q", type: mssql.VarChar(120), value: q },
    { name: "phone9", type: mssql.VarChar(32), value: phone9 },
    { name: "skip", type: mssql.Int, value: skip },
    { name: "take", type: mssql.Int, value: take },
  ];

  // The arrears register joins on LoanId and is cheap. THE SCHEDULE IS NOT:
  // there is no usable index on LoanSchedule.Loanid, so an OUTER APPLY into it
  // scans a ~2M-row table once per loan on the page — measured at 6,000ms for
  // FIVE rows, and a timeout at 30s on an unfiltered search. So the page is
  // fetched without touching the schedule, and one follow-up pass collects the
  // outstanding instalments for exactly those ids. 28,550ms to ~340ms, and it
  // improves with page size rather than degrading.
  const FROM = `
    FROM Loans l
    JOIN Borrowers b ON b.ID = l.BorrowerId
    LEFT JOIN Products pr ON pr.ID = l.ProductId
    LEFT JOIN ${ARREARS} ia ON ia.LoanId = l.id`;

  const COUNT_FROM =
    status === "arrears"
      ? `FROM Loans l JOIN Borrowers b ON b.ID = l.BorrowerId LEFT JOIN ${ARREARS} ia ON ia.LoanId = l.id`
      : "FROM Loans l JOIN Borrowers b ON b.ID = l.BorrowerId";

  const [page, counted] = await Promise.all([
    runReadOnlyQuery(
      org,
      `SELECT l.id, l.BorrowerId, l.LoanAmount, l.LoanBalance, l.Principal, l.Interest, l.Penalty,
              l.BorrowDate, l.LoanDisbursmentDate, l.ExpectedClearDate, l.DateCleared,
              l.LoanCleared, l.isApproved,
              LTRIM(RTRIM(ISNULL(b.firstName,'') + ' ' + ISNULL(b.otherName,''))) AS BorrowerName,
              b.PhoneNumber, b.NationalID,
              pr.ProductName,
              ISNULL(ia.DaysInArears, 0) AS DaysInArrears,
              ISNULL(ia.AmountInArrears, 0) AS AmountInArrears,
              ia.FirstDateInArrears
       ${FROM}
       WHERE ${filter}
       ORDER BY l.id DESC
       OFFSET @skip ROWS FETCH NEXT @take ROWS ONLY`,
      params,
      { timeoutMs: 45000, maxRows: take },
    ),
    // The count needs neither the product name nor — unless it is FILTERING on
    // arrears — the cross-database register. Dropping both off a COUNT over
    // 61,543 rows is most of the difference between a header that appears with
    // the page and one that arrives after it.
    runReadOnlyQuery(org, `SELECT COUNT(*) AS total ${COUNT_FROM} WHERE ${filter}`, params, {
      timeoutMs: 45000,
      maxRows: 1,
    }),
  ]);

  const n = (v: unknown): number => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  };
  const str = (v: unknown): string | null => (v == null ? null : String(v).trim() || null);
  const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

  // Only loans that can still owe anything are worth asking about. A cleared
  // loan has no outstanding instalment by definition, and putting 59,771 of them
  // in the id list would undo the point of the second query.
  const openIds = page.rows
    .filter((r) => n(r.LoanCleared) !== 1)
    .map((r) => n(r.id))
    .filter((id) => Number.isInteger(id) && id > 0);

  const nextByLoan = new Map<number, { date: string; amount: number }>();

  if (openIds.length > 0) {
    // The ids are integers this function just read out of Loans.id and has
    // re-validated with Number.isInteger — not user input, and they cannot carry
    // SQL. A bound parameter would be preferable on principle, but mssql has no
    // array binding and STRING_SPLIT would pin this to SQL Server 2016+ on a
    // database that is not ours to make assumptions about.
    const { rows } = await runReadOnlyQuery(
      org,
      `SELECT s.Loanid, s.ExpectedDueDate, ${DUE} AS DueAmount
       FROM LoanSchedule s
       WHERE s.Loanid IN (${openIds.join(",")}) AND ${DUE} > 0`,
      [],
      { timeoutMs: 45000, maxRows: 5000 },
    );
    for (const r of rows) {
      const id = n(r.Loanid);
      const date = dateOnly(r.ExpectedDueDate);
      if (!date) continue;
      const current = nextByLoan.get(id);
      // The EARLIEST instalment still owing is the one a customer is asked for.
      if (!current || date < current.date) nextByLoan.set(id, { date, amount: n(r.DueAmount) });
    }
  }

  const loans: LiveLoan[] = page.rows.map((r) => {
    const cleared = n(r.LoanCleared) === 1;
    const approved = n(r.isApproved) === 1;
    const dpd = n(r.DaysInArrears);
    return {
      ref: `ss:${n(r.id)}`,
      serviceSuiteId: n(r.id),
      borrowerId: n(r.BorrowerId),
      borrowerName: str(r.BorrowerName),
      phone: str(r.PhoneNumber),
      nationalId: str(r.NationalID),
      product: str(r.ProductName),
      status: cleared ? "CLEARED" : approved ? "ACTIVE" : "PENDING",
      loanAmount: n(r.LoanAmount),
      balance: n(r.LoanBalance),
      principal: n(r.Principal),
      interest: n(r.Interest),
      penalty: n(r.Penalty),
      borrowDate: iso(r.BorrowDate),
      disbursedAt: iso(r.LoanDisbursmentDate),
      expectedClearDate: dateOnly(r.ExpectedClearDate),
      clearedAt: iso(r.DateCleared),
      nextDue: nextByLoan.get(n(r.id)) ?? null,
      // ── A CLEARED LOAN IS NOT IN ARREARS, WHATEVER THE REGISTER SAYS ──────
      // LoansInArrears keeps rows after a loan settles — loan #417250 is CLEARED
      // with a zero balance and the register still reports 2 outstanding at 103
      // days past due. That is a leftover row, not a debt, and rendering it puts
      // "103 days late" beside a loan the customer paid off months ago. The loan
      // being cleared is the stronger fact, so it wins.
      arrears: cleared ? 0 : n(r.AmountInArrears),
      daysInArrears: !cleared && dpd > 0 ? dpd : null,
      firstMissedAt: dateOnly(r.FirstDateInArrears),
    };
  });

  return { loans, total: n(counted.rows[0]?.total) };
}

/**
 * Book-level counts for the header strip.
 *
 * Computed in the lender's database because they describe the WHOLE book. A
 * total derived from the page on screen is a different and much smaller claim,
 * and "50 loans" under a book of 61,543 is the kind of number somebody repeats
 * in a meeting.
 */
export type LoanBookStats = {
  total: number;
  active: number;
  cleared: number;
  pending: number;
  inArrears: number;
  olb: number;
  arrearsValue: number;
  /** The worst days-past-due in the running book. Their number. */
  worstDpd: number;
};

export async function getLoanBookStats(org: OrgDef, entityId: number): Promise<LoanBookStats> {
  const param: QueryParam[] = [{ name: "entityId", type: mssql.Int, value: entityId }];

  const [book, ar] = await Promise.all([
    runReadOnlyQuery(
      org,
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN l.isApproved = 1 AND l.LoanCleared = 0 AND l.LoanBalance > 0 THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN l.LoanCleared = 1 THEN 1 ELSE 0 END) AS cleared,
         SUM(CASE WHEN l.isApproved = 0 THEN 1 ELSE 0 END) AS pending,
         ISNULL(SUM(CASE WHEN l.LoanCleared = 0 THEN l.LoanBalance ELSE 0 END), 0) AS olb
       FROM Loans l WHERE l.EntityId = @entityId`,
      param,
      { timeoutMs: 45000, maxRows: 1 },
    ),
    // Straight off their register, so this matches the figure on Micromart's own
    // dashboard rather than being a second opinion about the same book.
    runReadOnlyQuery(
      org,
      `SELECT COUNT(*) AS inArrears,
              ISNULL(SUM(ia.AmountInArrears), 0) AS arrearsValue,
              ISNULL(MAX(ia.DaysInArears), 0) AS worstDpd
       FROM Loans l
       JOIN ${ARREARS} ia ON ia.LoanId = l.id
       WHERE l.EntityId = @entityId AND l.isApproved = 1 AND l.LoanCleared = 0
         AND l.LoanBalance > 0 AND ia.DaysInArears > 0`,
      param,
      { timeoutMs: 45000, maxRows: 1 },
    ),
  ]);

  const n = (v: unknown): number => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  };
  const r = book.rows[0] ?? {};
  return {
    total: n(r.total),
    active: n(r.active),
    cleared: n(r.cleared),
    pending: n(r.pending),
    olb: n(r.olb),
    inArrears: n(ar.rows[0]?.inArrears),
    arrearsValue: n(ar.rows[0]?.arrearsValue),
    worstDpd: n(ar.rows[0]?.worstDpd),
  };
}
