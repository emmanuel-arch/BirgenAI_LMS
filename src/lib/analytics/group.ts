// ─────────────────────────────────────────────────────────────────────────────
// THE GROUP BOOK — every entity a lender runs, in one read.
//
// A bridged lender is not one book. Micromart run four entities on one server and
// have never seen them side by side: ServiceSuite scopes its dashboard to whoever
// signed in, by UserMaster.EntityID, so a group roll-up does not exist anywhere in
// their world today. This is that view.
//
// WHERE THE TENANT BOUNDARY IS. Each lender has their own connection string
// (SERVICESUITE_CONN_<LENDER>), and a connection reaches exactly one lender's
// server. So "every entity on this connection" IS "every entity this lender owns"
// — verified on the Micromart server, where BsEntity holds precisely their four
// and nothing else. That is why this reads BsEntity rather than taking an entity
// list from us: a hardcoded list goes stale the day they add a subsidiary, and
// asking the server is both simpler and more current.
//
// ONE ROUND TRIP, not one per entity. The aggregates are grouped in the database
// and joined back to BsEntity, so adding a fifth entity costs nothing.
// ─────────────────────────────────────────────────────────────────────────────

import { runReadOnlyQuery, mssql } from "@/lib/enterprise/mssql";
import { type OrgDef } from "@/lib/enterprise/connections";

// ─────────────────────────────────────────────────────────────────────────────
// SERVICESUITE PARITY — THE 90-DAY BOUNDARY
//
// Every figure below that a manager can also read on their own dashboard is
// computed the way THEIR dashboard computes it. The definitions are lifted from
// the MainDashboard stored procedure, not guessed, because a studio that reports
// a different OLB from the screen a GM already trusts is not a second opinion —
// it is a bug they will never stop pointing at.
//
// The whole model turns on one rule: a loan more than 90 days past its
// ExpectedClearDate is NON-PERFORMING and leaves the performing book entirely.
//
//   ActiveLoans  open loans whose DaysInArears <= 90
//   OLB (TOTAL)  SUM(LoanBalance) on open loans <= 90 days past ExpectedClearDate
//   arrears      SUM(AmountInArrears) on those loans, from LoansInArrears
//   OLB (CLEAN)  OLB − arrears
//   PQS          CleanOLB / OLB × 100
//   NPL          open loans MORE than 90 days past ExpectedClearDate
//
// This is the answer to the question the aging table raised. The 38,889 loans on
// entity 3002 sitting over a year past due are not an anomaly nobody noticed —
// Micromart's own system already carves them out as NPL, which is exactly why
// their dashboard reads KES 84.5m outstanding where a naive SUM over every
// uncleared loan reads KES 340.7m. Both numbers are real; only one of them is
// what the lender means by "outstanding".
//
// Verified against their live dashboard on 13 Aug 2026:
//   3002  OLB 84,476,131.99 · CLEAN 56,045,921.18 · PQS 66.35%
//   3005  OLB    613,513.00 · CLEAN    606,620.00 · PQS 98.88%
// ─────────────────────────────────────────────────────────────────────────────

export type EntityBook = {
  entityId: number;
  name: string;
  borrowers: number;
  activeBorrowers: number;
  scored: number;
  /** Borrowers with a usable coordinate. Zero across Micromart's whole group. */
  pinned: number;
  loans: number;
  clearedLoans: number;

  // ── The performing book, as ServiceSuite defines it ──────────────────────
  /** Open loans within 90 days of their expected clear date. Their "Active loans". */
  activeLoans: number;
  /** Their "OLB (TOTAL)" — balance on the performing book only. */
  olbTotal: number;
  /** Their "OLB (CLEAN)" — performing balance less what is currently in arrears. */
  olbClean: number;
  /** Arrears inside the performing book (0 < DaysInArears, still under 90 days). */
  arrears: number;
  /** Portfolio Quality Score: olbClean / olbTotal × 100. */
  pqs: number;
  /** Share of customers carrying a performing loan — their "% Funded". */
  pctFunded: number;

  // ── The non-performing book ──────────────────────────────────────────────
  /** Open loans more than 90 days past their expected clear date. */
  nplCount: number;
  nplAmount: number;

  /**
   * Every uncleared balance, performing and not. NOT what the lender means by
   * "outstanding" — kept because the gap between this and olbTotal IS the NPL
   * story, and a studio that only ever shows the flattering figure is not
   * analytics.
   */
  olbAllOpen: number;
  openLoansAll: number;

  disbursedAllTime: number;
  disbursed30d: number;
  loans30d: number;
  /** Aging of every open loan by days past the expected clear date. */
  aging: LoanAging;
  lastLoanAt: string | null;
};

/**
 * The open book, bucketed by how far past its expected clear date it is.
 *
 * The 90-day line runs between `d31to90` and `d91to365`: everything above it is
 * the performing book that feeds olbTotal, everything below it is NPL. Keeping
 * the buckets either side of that boundary is what lets one table explain why
 * the lender's own dashboard says KES 84.5m and a naive sum says KES 340.7m.
 *
 * `stale` — over a year past due — is still reported separately even though
 * ServiceSuite lumps it into NPL with everything past 90 days. On entity 3002 it
 * is 38,889 loans and KES 195.5m: three quarters of the entire non-performing
 * book, and old enough that "will it be collected" and "should it still be on
 * the balance sheet" are different questions from the ones a 4-month arrear
 * raises. Their system has no reason to separate it; a studio does.
 */
export type LoanAging = {
  current: AgingBucket;
  d1to30: AgingBucket;
  d31to90: AgingBucket;
  d91to365: AgingBucket;
  /** Over a year past due. Needs a business answer before it is called anything. */
  stale: AgingBucket;
};

export type AgingBucket = { loans: number; olb: number };

export type GroupBook = {
  entities: EntityBook[];
  totals: {
    entities: number;
    /** Entities carrying at least one borrower — 3004 is provisioned but empty. */
    activeEntities: number;
    borrowers: number;
    activeBorrowers: number;
    scored: number;
    pinned: number;
    loans: number;
    clearedLoans: number;
    activeLoans: number;
    olbTotal: number;
    olbClean: number;
    arrears: number;
    /** Group PQS is recomputed from group totals, never averaged across entities:
        a mean of four percentages weights a KES 613k book the same as a KES 495m
        one and produces a number that is nobody's portfolio quality. */
    pqs: number;
    nplCount: number;
    nplAmount: number;
    openLoansAll: number;
    olbAllOpen: number;
    disbursedAllTime: number;
    disbursed30d: number;
    loans30d: number;
    aging: LoanAging;
  };
  readAt: string;
};

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

const emptyAging = (): LoanAging => ({
  current: { loans: 0, olb: 0 },
  d1to30: { loans: 0, olb: 0 },
  d31to90: { loans: 0, olb: 0 },
  d91to365: { loans: 0, olb: 0 },
  stale: { loans: 0, olb: 0 },
});

const addBucket = (a: AgingBucket, b: AgingBucket): AgingBucket => ({
  loans: a.loans + b.loans,
  olb: a.olb + b.olb,
});

/**
 * Every entity on the lender's server with its book, in one query.
 *
 * `LoanAmount` and `LoanBalance` are cast to BIGINT before summing: Micromart's
 * group carries KES 836m outstanding across 62,000 open loans, and the default
 * numeric sum overflows on the check-off entity, which alone holds KES 495m on
 * 3,602 loans.
 */
export async function getGroupBook(org: OrgDef): Promise<GroupBook> {
  const { rows } = await runReadOnlyQuery(
    org,
    `SELECT e.ID AS entityId, e.EntityName AS name,
            ISNULL(b.borrowers, 0)       AS borrowers,
            ISNULL(b.activeBorrowers, 0) AS activeBorrowers,
            ISNULL(b.scored, 0)          AS scored,
            ISNULL(b.pinned, 0)          AS pinned,
            ISNULL(l.loans, 0)           AS loans,
            ISNULL(l.clearedLoans, 0)    AS clearedLoans,
            ISNULL(l.openLoansAll, 0)    AS openLoansAll,
            ISNULL(l.olbAllOpen, 0)      AS olbAllOpen,
            ISNULL(l.olbTotal, 0)        AS olbTotal,
            ISNULL(al.activeLoans, 0)    AS activeLoans,
            ISNULL(l.nplCount, 0)        AS nplCount,
            ISNULL(l.nplAmount, 0)       AS nplAmount,
            ISNULL(ar.arrears, 0)        AS arrears,
            ISNULL(l.disbursedAllTime,0) AS disbursedAllTime,
            ISNULL(l.disbursed30d, 0)    AS disbursed30d,
            ISNULL(l.loans30d, 0)        AS loans30d,
            ISNULL(a.curLoans,0) AS curLoans, ISNULL(a.curOlb,0) AS curOlb,
            ISNULL(a.b1Loans,0)  AS b1Loans,  ISNULL(a.b1Olb,0)  AS b1Olb,
            ISNULL(a.b2Loans,0)  AS b2Loans,  ISNULL(a.b2Olb,0)  AS b2Olb,
            ISNULL(a.b3Loans,0)  AS b3Loans,  ISNULL(a.b3Olb,0)  AS b3Olb,
            ISNULL(a.stLoans,0)  AS stLoans,  ISNULL(a.stOlb,0)  AS stOlb,
            l.lastLoanAt
     FROM BsEntity e
     LEFT JOIN (
       SELECT EntityId,
              COUNT(*) AS borrowers,
              SUM(CASE WHEN AccountStatus = 1 THEN 1 ELSE 0 END) AS activeBorrowers,
              SUM(CASE WHEN CreditScore IS NOT NULL THEN 1 ELSE 0 END) AS scored,
              -- Both coordinate pairs, same rule the field worklist uses.
              SUM(CASE WHEN (Latitude IS NOT NULL AND LTRIM(RTRIM(Latitude)) <> ''
                             AND Longitude IS NOT NULL AND LTRIM(RTRIM(Longitude)) <> '')
                         OR (onboardingLatitude IS NOT NULL AND onboardingLatitude <> 0
                             AND onboardingLongitude IS NOT NULL AND onboardingLongitude <> 0)
                       THEN 1 ELSE 0 END) AS pinned
       FROM Borrowers GROUP BY EntityId
     ) b ON b.EntityId = e.ID
     LEFT JOIN (
       SELECT EntityId,
              COUNT(*) AS loans,
              SUM(CASE WHEN LoanCleared = 1 THEN 1 ELSE 0 END) AS clearedLoans,
              SUM(CASE WHEN LoanCleared = 0 AND LoanBalance > 0 THEN 1 ELSE 0 END) AS openLoansAll,
              SUM(CASE WHEN LoanCleared = 0 THEN CAST(LoanBalance AS BIGINT) ELSE 0 END) AS olbAllOpen,
              -- THE PERFORMING BOOK. Same predicate as MainDashboard's @OLB:
              -- open, and within 90 days of the expected clear date.
              SUM(CASE WHEN LoanCleared = 0 AND DATEDIFF(day, ExpectedClearDate, GETDATE()) <= 90
                       THEN CAST(LoanBalance AS BIGINT) ELSE 0 END) AS olbTotal,
              -- NON-PERFORMING. MainDashboard's @NplCount / @NplAmount.
              SUM(CASE WHEN LoanCleared = 0 AND DATEDIFF(day, ExpectedClearDate, GETDATE()) > 90
                       THEN 1 ELSE 0 END) AS nplCount,
              SUM(CASE WHEN LoanCleared = 0 AND DATEDIFF(day, ExpectedClearDate, GETDATE()) > 90
                       THEN CAST(LoanBalance AS BIGINT) ELSE 0 END) AS nplAmount,
              SUM(CAST(LoanAmount AS BIGINT)) AS disbursedAllTime,
              SUM(CASE WHEN BorrowDate >= DATEADD(day, -30, GETDATE()) THEN CAST(LoanAmount AS BIGINT) ELSE 0 END) AS disbursed30d,
              SUM(CASE WHEN BorrowDate >= DATEADD(day, -30, GETDATE()) THEN 1 ELSE 0 END) AS loans30d,
              MAX(BorrowDate) AS lastLoanAt
       FROM Loans WHERE isApproved = 1 GROUP BY EntityId
     ) l ON l.EntityId = e.ID
     LEFT JOIN (
       SELECT EntityId,
              SUM(CASE WHEN dpd <= 0 THEN 1 ELSE 0 END) AS curLoans,
              SUM(CASE WHEN dpd <= 0 THEN bal ELSE 0 END) AS curOlb,
              SUM(CASE WHEN dpd BETWEEN 1 AND 30 THEN 1 ELSE 0 END) AS b1Loans,
              SUM(CASE WHEN dpd BETWEEN 1 AND 30 THEN bal ELSE 0 END) AS b1Olb,
              SUM(CASE WHEN dpd BETWEEN 31 AND 90 THEN 1 ELSE 0 END) AS b2Loans,
              SUM(CASE WHEN dpd BETWEEN 31 AND 90 THEN bal ELSE 0 END) AS b2Olb,
              SUM(CASE WHEN dpd BETWEEN 91 AND 365 THEN 1 ELSE 0 END) AS b3Loans,
              SUM(CASE WHEN dpd BETWEEN 91 AND 365 THEN bal ELSE 0 END) AS b3Olb,
              SUM(CASE WHEN dpd > 365 THEN 1 ELSE 0 END) AS stLoans,
              SUM(CASE WHEN dpd > 365 THEN bal ELSE 0 END) AS stOlb
       FROM (
         SELECT EntityId,
                DATEDIFF(day, ExpectedClearDate, GETDATE()) AS dpd,
                CAST(LoanBalance AS BIGINT) AS bal
         FROM Loans
         WHERE isApproved = 1 AND LoanCleared = 0 AND LoanBalance > 0
       ) x GROUP BY EntityId
     ) a ON a.EntityId = e.ID
     -- ARREARS INSIDE THE PERFORMING BOOK, from MainDashboard's @totalarears.
     -- It lives in a different database (Transactions), which is why it is its own
     -- join rather than another CASE: LoansInArrears is the lender's own arrears
     -- ledger and we must read their figure, not recompute one from due dates.
     LEFT JOIN (
       SELECT L.EntityId, SUM(CAST(LN.AmountInArrears AS BIGINT)) AS arrears
       FROM Transactions.dbo.LoansInArrears LN
       INNER JOIN Loans L ON L.id = LN.LoanId
       WHERE LN.DaysInArears > 0 AND L.LoanBalance > 0
         AND DATEDIFF(day, L.ExpectedClearDate, GETDATE()) < 90
       GROUP BY L.EntityId
     ) ar ON ar.EntityId = e.ID
     -- ACTIVE LOANS, exactly as MainDashboard's @ActiveLoans counts them.
     --
     -- NOT "open and within 90 days of the due date", which is the obvious reading
     -- and is wrong by 62 loans on entity 3002. Their count is driven by the
     -- ARREARS LEDGER: DaysInArears from Transactions.dbo.LoansInArrears, defaulting
     -- to 0 for a loan that has never appeared there. A loan can be past its
     -- expected clear date while the arrears ledger has not yet aged it, and their
     -- dashboard counts that loan as active. Ours must too, or a GM reconciling the
     -- two screens finds a discrepancy in the first number they check.
     --
     -- Note also the absence of a LoanBalance > 0 filter. That is theirs, kept
     -- deliberately: matching a definition means matching it where it is loose.
     LEFT JOIN (
       SELECT L.EntityId, COUNT(L.id) AS activeLoans
       FROM Loans L
       LEFT JOIN Transactions.dbo.LoansInArrears T ON T.Loanid = L.ID
       WHERE L.isApproved = 1 AND L.LoanCleared = 0 AND ISNULL(T.DaysInArears, 0) <= 90
       GROUP BY L.EntityId
     ) al ON al.EntityId = e.ID
     ORDER BY ISNULL(l.olbTotal, 0) DESC, ISNULL(b.borrowers, 0) DESC`,
    [],
    { timeoutMs: 60000, maxRows: 200 },
  );

  const entities: EntityBook[] = rows.map((r) => {
    const borrowers = n(r.borrowers);
    const olbTotal = n(r.olbTotal);
    const arrears = n(r.arrears);
    const activeLoans = n(r.activeLoans);
    // CleanOLB and PQS are derived exactly as MainDashboard derives them, and PQS
    // guards on olbTotal rather than on the loan count: an entity whose whole
    // performing book is in arrears has a real PQS of 0, not a division by zero.
    const olbClean = olbTotal - arrears;
    return {
    entityId: n(r.entityId),
    name: String(r.name ?? "").trim() || `Entity ${n(r.entityId)}`,
    borrowers,
    activeBorrowers: n(r.activeBorrowers),
    scored: n(r.scored),
    pinned: n(r.pinned),
    loans: n(r.loans),
    clearedLoans: n(r.clearedLoans),
    activeLoans,
    olbTotal,
    olbClean,
    arrears,
    pqs: olbTotal > 0 ? (olbClean / olbTotal) * 100 : 0,
    pctFunded: borrowers > 0 ? (activeLoans / borrowers) * 100 : 0,
    nplCount: n(r.nplCount),
    nplAmount: n(r.nplAmount),
    openLoansAll: n(r.openLoansAll),
    olbAllOpen: n(r.olbAllOpen),
    disbursedAllTime: n(r.disbursedAllTime),
    disbursed30d: n(r.disbursed30d),
    loans30d: n(r.loans30d),
    aging: {
      current: { loans: n(r.curLoans), olb: n(r.curOlb) },
      d1to30: { loans: n(r.b1Loans), olb: n(r.b1Olb) },
      d31to90: { loans: n(r.b2Loans), olb: n(r.b2Olb) },
      d91to365: { loans: n(r.b3Loans), olb: n(r.b3Olb) },
      stale: { loans: n(r.stLoans), olb: n(r.stOlb) },
    },
    lastLoanAt: r.lastLoanAt ? new Date(r.lastLoanAt as string).toISOString() : null,
    };
  });

  const sum = (pick: (e: EntityBook) => number) => entities.reduce((t, e) => t + pick(e), 0);
  const aging = entities.reduce<LoanAging>((t, e) => ({
    current: addBucket(t.current, e.aging.current),
    d1to30: addBucket(t.d1to30, e.aging.d1to30),
    d31to90: addBucket(t.d31to90, e.aging.d31to90),
    d91to365: addBucket(t.d91to365, e.aging.d91to365),
    stale: addBucket(t.stale, e.aging.stale),
  }), emptyAging());

  return {
    entities,
    totals: {
      entities: entities.length,
      // An entity with no borrowers is reported, never hidden: a missing entity in
      // a group view reads as a bug, and dropping it is how a board loses faith in
      // a total it cannot reconcile against its own org chart.
      activeEntities: entities.filter((e) => e.borrowers > 0).length,
      borrowers: sum((e) => e.borrowers),
      activeBorrowers: sum((e) => e.activeBorrowers),
      scored: sum((e) => e.scored),
      pinned: sum((e) => e.pinned),
      loans: sum((e) => e.loans),
      clearedLoans: sum((e) => e.clearedLoans),
      activeLoans: sum((e) => e.activeLoans),
      olbTotal: sum((e) => e.olbTotal),
      olbClean: sum((e) => e.olbClean),
      arrears: sum((e) => e.arrears),
      pqs: sum((e) => e.olbTotal) > 0 ? (sum((e) => e.olbClean) / sum((e) => e.olbTotal)) * 100 : 0,
      nplCount: sum((e) => e.nplCount),
      nplAmount: sum((e) => e.nplAmount),
      openLoansAll: sum((e) => e.openLoansAll),
      olbAllOpen: sum((e) => e.olbAllOpen),
      disbursedAllTime: sum((e) => e.disbursedAllTime),
      disbursed30d: sum((e) => e.disbursed30d),
      loans30d: sum((e) => e.loans30d),
      aging,
    },
    readAt: new Date().toISOString(),
  };
}

/**
 * Monthly disbursement per entity, for the group trend.
 *
 * Kept separate from the roll-up above because it is the one query whose cost
 * grows with the window rather than with the number of entities, and because a
 * board can render its totals long before the chart resolves.
 */
export type GroupTrendPoint = { month: string; entityId: number; loans: number; disbursed: number };

export async function getGroupTrend(org: OrgDef, months = 12): Promise<GroupTrendPoint[]> {
  const { rows } = await runReadOnlyQuery(
    org,
    `SELECT FORMAT(BorrowDate, 'yyyy-MM') AS month, EntityId AS entityId,
            COUNT(*) AS loans, SUM(CAST(LoanAmount AS BIGINT)) AS disbursed
     FROM Loans
     WHERE isApproved = 1 AND BorrowDate >= DATEADD(month, -@months, GETDATE())
     GROUP BY FORMAT(BorrowDate, 'yyyy-MM'), EntityId
     ORDER BY month ASC, EntityId ASC`,
    [{ name: "months", type: mssql.Int, value: Math.min(Math.max(months, 1), 60) }],
    { timeoutMs: 60000, maxRows: 2000 },
  );

  return rows.map((r) => ({
    month: String(r.month),
    entityId: n(r.entityId),
    loans: n(r.loans),
    disbursed: n(r.disbursed),
  }));
}

/**
 * The share of the open book that has not moved in over a year.
 *
 * Exposed as its own helper because the group board has to lead with it: on
 * Micromart it is two thirds of every open loan, and any screen that shows an
 * outstanding balance without saying so is presenting a number the lender will
 * not be able to reconcile.
 */
export function staleShare(aging: LoanAging): { loans: number; olb: number; pctLoans: number; pctOlb: number } {
  const totalLoans = aging.current.loans + aging.d1to30.loans + aging.d31to90.loans + aging.d91to365.loans + aging.stale.loans;
  const totalOlb = aging.current.olb + aging.d1to30.olb + aging.d31to90.olb + aging.d91to365.olb + aging.stale.olb;
  return {
    loans: aging.stale.loans,
    olb: aging.stale.olb,
    pctLoans: totalLoans > 0 ? (aging.stale.loans / totalLoans) * 100 : 0,
    pctOlb: totalOlb > 0 ? (aging.stale.olb / totalOlb) * 100 : 0,
  };
}
