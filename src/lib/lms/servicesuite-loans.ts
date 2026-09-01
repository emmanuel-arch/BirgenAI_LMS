// ─────────────────────────────────────────────────────────────────────────────
// THE LENDER'S LOAN BOOK, READ THROUGH RATHER THAN COPIED.
//
// Entity 3005 holds ~61,500 loans: 59.8k cleared, ~96 running, ~310 awaiting
// approval. The console pages this in the lender's own database for the same
// reason the borrower list does — a mirror in our Postgres would be a stale
// picture of somebody else's book, and the one thing a lending console must
// never be is confidently out of date about a balance.
//
// ── THE COLUMN THAT LIES IF YOU TRUST IT ─────────────────────────────────────
// LoanSchedule.UnPaidAmount IS NULL ON AN UNPAID INSTALMENT. Not zero — NULL.
//
// So the obvious `WHERE UnPaidAmount > 0` is never true. It matches no rows, and
// every loan in the estate then reports no payment due and no arrears. Nothing
// about that looks broken: the screen renders, the columns are merely empty, and
// the book appears to be perfectly current. It was caught only by running the
// query against the live database and noticing that a lender with 33 delinquent
// loans was showing none.
//
// What is outstanding on an instalment is `amounttopay - ISNULL(AmountPaid, 0)`.
// That is the only expression used here. UnPaidAmount is never read.
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

// ── AND THE PREDICATE THAT MAKES IT USABLE ──────────────────────────────────
// `l.LoanCleared = 0` goes INSIDE both schedule lookups, not just in the outer
// WHERE. It looks redundant — a cleared loan has nothing outstanding, so the
// APPLY would return nothing anyway — and it is the difference between a screen
// and a timeout.
//
// 59,771 of Micromart's 61,543 loans are cleared. Without this the optimiser
// walks a ~2M-row LoanSchedule twice for every one of them to discover that,
// and the first measured run took 17 SECONDS for five rows and then timed out
// at 30s on an unfiltered search. With it, the whole cleared book is eliminated
// before the child table is touched.
const RUNNING_ONLY = "l.LoanCleared = 0";

/**
 * A SQL Server `date` column, as the calendar date it actually is.
 *
 * NOT toISOString(). The driver hands `date` back as a JS Date at local
 * midnight, so in Nairobi (UTC+3) an instalment due on the 7th becomes
 * "2026-09-06T21:00:00Z" and every due date in the console renders A DAY EARLY.
 * That is worse than a crash: a collections officer chases somebody a day
 * before they are late, and the schedule looks internally consistent while
 * doing it. Caught by comparing the adapter's output against the raw row.
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
  /** The next instalment still carrying money. Null when nothing is outstanding. */
  nextDue: { date: string; amount: number } | null;
  /** Everything past its due date and still unpaid. */
  arrears: number;
  /** How long the OLDEST unpaid instalment has been overdue. The honest measure
   *  of delinquency — the newest missed payment would flatter every case. */
  daysInArrears: number | null;
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

  // An EXISTS rather than a join: a loan with four overdue instalments must
  // appear ONCE. A join would repeat it four times and inflate the total in the
  // header beside it.
  const overdue =
    "EXISTS (SELECT 1 FROM LoanSchedule s WHERE s.Loanid = l.id " +
    `AND ${RUNNING_ONLY} AND ${DUE} > 0 AND s.ExpectedDueDate < CAST(GETDATE() AS date))`;

  const byStatus =
    status === "active"
      ? "AND l.isApproved = 1 AND l.LoanCleared = 0 AND l.LoanBalance > 0"
      : status === "cleared"
        ? "AND l.LoanCleared = 1"
        : status === "pending"
          ? "AND l.isApproved = 0"
          : status === "arrears"
            ? `AND l.isApproved = 1 AND l.LoanCleared = 0 AND l.LoanBalance > 0 AND ${overdue}`
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

  // ── TWO QUERIES, NOT ONE CORRELATED ONE ────────────────────────────────────
  // The obvious shape — OUTER APPLY into LoanSchedule for the next instalment
  // and again for the arrears — is what this started as, and it is unusable:
  // MEASURED AT ~6,000ms FOR FIVE ROWS, and a timeout at 30s on an unfiltered
  // search. There is no usable index on LoanSchedule.Loanid, so each APPLY scans
  // a ~2M-row table once PER LOAN ON THE PAGE.
  //
  // So the page is fetched with no child-table work at all (186ms for 50 rows),
  // and then ONE pass collects every outstanding instalment for exactly those
  // loans (275ms). Same answer, 461ms instead of 6,000 — and it gets better with
  // page size rather than worse, because the second query is one scan regardless.
  //
  // Folding the instalments in JS rather than in SQL is deliberate: "the next
  // one still owing" and "everything already overdue" are two different readings
  // of the same rows, and doing it here means the database is asked once.
  const [page, counted] = await Promise.all([
    runReadOnlyQuery(
      org,
      `SELECT l.id, l.BorrowerId, l.LoanAmount, l.LoanBalance, l.Principal, l.Interest, l.Penalty,
              l.BorrowDate, l.LoanDisbursmentDate, l.ExpectedClearDate, l.DateCleared,
              l.LoanCleared, l.isApproved,
              LTRIM(RTRIM(ISNULL(b.firstName,'') + ' ' + ISNULL(b.otherName,''))) AS BorrowerName,
              b.PhoneNumber, b.NationalID,
              pr.ProductName
       FROM Loans l
       JOIN Borrowers b ON b.ID = l.BorrowerId
       LEFT JOIN Products pr ON pr.ID = l.ProductId
       WHERE ${filter}
       ORDER BY l.id DESC
       OFFSET @skip ROWS FETCH NEXT @take ROWS ONLY`,
      params,
      { timeoutMs: 45000, maxRows: take },
    ),
    runReadOnlyQuery(
      org,
      `SELECT COUNT(*) AS total FROM Loans l JOIN Borrowers b ON b.ID = l.BorrowerId WHERE ${filter}`,
      params,
      { timeoutMs: 45000, maxRows: 1 },
    ),
  ]);

  const n = (v: unknown): number => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  };
  const str = (v: unknown): string | null => (v == null ? null : String(v).trim() || null);
  const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

  // Only loans that can still owe anything are worth asking about. A cleared
  // loan has no outstanding instalment by definition, and including 59,771 of
  // them in the id list would undo the whole point of the second query.
  const openIds = page.rows
    .filter((r) => n(r.LoanCleared) !== 1)
    .map((r) => n(r.id))
    .filter((id) => Number.isInteger(id) && id > 0);

  type Outstanding = { due: string; amount: number };
  const byLoan = new Map<number, Outstanding[]>();

  if (openIds.length > 0) {
    // The ids are integers this function just read out of Loans.id and has
    // re-validated with Number.isInteger — they are not user input and cannot
    // carry SQL. A bound parameter would be preferable on principle, but mssql
    // has no array binding and STRING_SPLIT would pin this to SQL Server 2016+
    // on a database that is not ours to make assumptions about.
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
      const due = dateOnly(r.ExpectedDueDate);
      if (!due) continue;
      const list = byLoan.get(id) ?? [];
      list.push({ due, amount: n(r.DueAmount) });
      byLoan.set(id, list);
    }
  }

  // Compared as calendar days in UTC so a Nairobi afternoon does not make
  // today's instalment look overdue.
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayMs = Date.parse(`${todayKey}T00:00:00Z`);

  const loans: LiveLoan[] = page.rows.map((r) => {
    const cleared = n(r.LoanCleared) === 1;
    const approved = n(r.isApproved) === 1;
    const outstanding = (byLoan.get(n(r.id)) ?? []).sort((a, b) => a.due.localeCompare(b.due));

    const next = outstanding[0] ?? null;
    const overdue = outstanding.filter((x) => x.due < todayKey);
    const arrears = overdue.reduce((sum, x) => sum + x.amount, 0);
    const oldest = overdue[0]?.due ?? null;

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
      nextDue: next ? { date: next.due, amount: next.amount } : null,
      arrears,
      daysInArrears: oldest ? Math.max(0, Math.round((todayMs - Date.parse(`${oldest}T00:00:00Z`)) / 86_400_000)) : null,
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
    // A second pass on purpose. Folding arrears into the aggregate above needs a
    // correlated subquery inside a SUM across the whole 61.5k-row book, and the
    // optimiser turns that into a scan — the header goes from fast to unusable.
    runReadOnlyQuery(
      org,
      `SELECT COUNT(*) AS inArrears, ISNULL(SUM(d.Arrears), 0) AS arrearsValue
       FROM Loans l
       CROSS APPLY (
         SELECT SUM(${DUE}) AS Arrears
         FROM LoanSchedule s WHERE s.Loanid = l.id AND ${RUNNING_ONLY} AND ${DUE} > 0
           AND s.ExpectedDueDate < CAST(GETDATE() AS date)
       ) d
       WHERE l.EntityId = @entityId AND l.isApproved = 1 AND l.LoanCleared = 0
         AND l.LoanBalance > 0 AND d.Arrears > 0`,
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
  };
}
