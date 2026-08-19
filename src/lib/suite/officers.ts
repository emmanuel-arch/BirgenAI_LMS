// ─────────────────────────────────────────────────────────────────────────────
// THE OFFICER VIEW AND THE BRANCH TREE — and why HR is the department that
// finally sees them.
//
// `Borrowers.EntityAgent` names the relationship officer who carries a borrower.
// It is an integer on a 160k-row table, it points at `UserMaster.ID`, and it has
// been there for years. What has never existed is a screen that follows it
// forward: from the officer, to their borrowers, to those borrowers' open loans,
// to which of those loans are sitting on the collections floor and in what band,
// to what the floor actually recovered against that book last month.
//
// That chain crosses two databases, and crossing it is the argument of this
// demo in a single screen. An HR system that lists names is an address book. An
// HR system that can say "this officer carries 622 borrowers, KES 4.1M of their
// book is in NPL, and the floor recovered KES 61k against it last month" is the
// thing the general manager has been asking three departments for separately —
// because today the roster lives in HR, the book lives in lending and the
// recovery lives in collections, and nothing joins them.
//
// ── WHY FIVE GROUPED QUERIES AND NOT ONE JOIN ────────────────────────────────
// The obvious version is a single SELECT with four LEFT JOINs and a GROUP BY. It
// is also the version that takes half a minute, because `Loans` (338k),
// `CollectionTracker` (93k) and `PayedAmount` (1.15M) carry NO INDEXES AT ALL on
// this database — `npm run db:index-advisor` reports exactly that and proposes
// nine. Grouping each table once on its own and joining the results in memory
// turns four correlated scans per officer into four table scans total. The same
// lesson is recorded above getRoster's branch rollup in ./people, where it cost
// seventeen seconds before it was fixed.
// ─────────────────────────────────────────────────────────────────────────────

import type { OrgDef } from "@/lib/enterprise/connections";
import { CB, SC, cbQuery, num, str, dt, msisdn } from "@/lib/collectbox/client";

export type Officer = {
  id: number;
  name: string;
  role: string;
  branch: string;
  branchId: number;
  entityId: number;
  active: boolean;
  phone: string;
  email: string;
  lastLoginAt: Date | null;
  /** Borrowers carried, from Borrowers.EntityAgent. */
  borrowers: number;
  /** Open loans across those borrowers, and what is outstanding on them. */
  loansOpen: number;
  olb: number;
  /** Of that book, what the collections floor is tracking. */
  tracked: number;
  nplLoans: number;
  nplAmount: number;
  /** Arrears across every band, not only NPL. */
  arrears: number;
  /** What the floor actually recovered against this officer's book, 30 days. */
  recovered30d: number;
  payments30d: number;
};

export type OfficerBook = {
  officers: Officer[];
  totals: {
    officers: number;
    borrowers: number;
    olb: number;
    tracked: number;
    nplAmount: number;
    recovered30d: number;
    /** Officers whose book is on the floor but saw no payment at all in 30 days. */
    untouched: number;
  };
};

export async function getOfficers(org: OrgDef, entityIds = [3002, 3005]): Promise<OfficerBook> {
  const entities = entityIds.join(",");

  const [staff, borrowerRows, loanRows, floorRows, moneyRows] = await Promise.all([
    cbQuery<Record<string, unknown>>(
      org,
      `SELECT u.ID, u.FirstName, u.OtherName, u.PhoneNumber, u.Email, u.EntityID AS entityId,
              u.UserStatus, u.IsLocked, u.LastLogin, u.OrganizationUnit AS branchId,
              r.Title AS roleName, ou.UnitTitle AS branch
         FROM ${SC}.UserMaster u
         LEFT JOIN ${SC}.Roles r ON r.ID = u.RoleID
         LEFT JOIN ${SC}.OrganizationUnits ou ON ou.UnitId = u.OrganizationUnit
        WHERE u.EntityID IN (${entities})`,
      [], { timeoutMs: 30000, maxRows: 2000 },
    ),
    cbQuery<{ agent: number; n: number }>(
      org,
      `SELECT EntityAgent AS agent, COUNT(*) AS n
         FROM ${SC}.Borrowers WHERE EntityId IN (${entities}) GROUP BY EntityAgent`,
      [], { timeoutMs: 45000, maxRows: 3000 },
    ),
    cbQuery<{ agent: number; loans: number; olb: number }>(
      org,
      `SELECT b.EntityAgent AS agent, COUNT(l.id) AS loans,
              SUM(CAST(COALESCE(l.LoanBalance,0) AS decimal(18,2))) AS olb
         FROM ${SC}.Borrowers b
         JOIN ${SC}.Loans l ON l.BorrowerId = b.ID AND l.LoanCleared = 0
        WHERE b.EntityId IN (${entities})
        GROUP BY b.EntityAgent`,
      [], { timeoutMs: 60000, maxRows: 3000 },
    ),
    // THE CROSS-DATABASE PASS. CollectBox's live queue, resolved back through the
    // lending ledger to the officer who owns the relationship. One query plan,
    // executed in the server — not two round trips stitched together in Node.
    cbQuery<{ agent: number; tracked: number; nplLoans: number; nplAmount: number; arrears: number }>(
      org,
      `SELECT b.EntityAgent AS agent,
              COUNT(*) AS tracked,
              SUM(CASE WHEN ct.Loantype = 6 THEN 1 ELSE 0 END) AS nplLoans,
              SUM(CAST(COALESCE(ct.Npl,0) AS decimal(18,2))) AS nplAmount,
              SUM(CAST(COALESCE(ct.Watch1,0)+COALESCE(ct.Watch2,0)+COALESCE(ct.Watch3,0)
                      +COALESCE(ct.Npl,0)+COALESCE(ct.AmountDue,0) AS decimal(18,2))) AS arrears
         FROM ${CB}.CollectionTracker ct
         JOIN ${SC}.Loans l     ON l.id = ct.LoanId
         JOIN ${SC}.Borrowers b ON b.ID = l.BorrowerId
        WHERE b.EntityId IN (${entities})
        GROUP BY b.EntityAgent`,
      [], { timeoutMs: 60000, maxRows: 3000 },
    ),
    cbQuery<{ agent: number; amt: number; n: number }>(
      org,
      `SELECT b.EntityAgent AS agent,
              SUM(CAST(COALESCE(p.AmountPaid,0) AS decimal(18,2))) AS amt,
              COUNT(*) AS n
         FROM ${CB}.PayedAmount p
         JOIN ${SC}.Loans l     ON l.id = p.LoanId
         JOIN ${SC}.Borrowers b ON b.ID = l.BorrowerId
        WHERE p.DatePaid > DATEADD(day,-30,GETDATE()) AND b.EntityId IN (${entities})
        GROUP BY b.EntityAgent`,
      [], { timeoutMs: 60000, maxRows: 3000 },
    ),
  ]);

  const idx = <T>(rows: T[], key: (r: T) => number) => {
    const m = new Map<number, T>();
    for (const r of rows) m.set(key(r), r);
    return m;
  };
  const bk = idx(borrowerRows, (r) => num(r.agent));
  const ln = idx(loanRows, (r) => num(r.agent));
  const fl = idx(floorRows, (r) => num(r.agent));
  const mn = idx(moneyRows, (r) => num(r.agent));

  const officers: Officer[] = staff
    .map((u): Officer => {
      const id = num(u.ID);
      const f = fl.get(id);
      const m = mn.get(id);
      return {
        id,
        name: [str(u.FirstName), str(u.OtherName)].filter(Boolean).join(" ") || `User ${id}`,
        role: str(u.roleName) || "—",
        branch: str(u.branch) || "—",
        branchId: num(u.branchId),
        entityId: num(u.entityId),
        // UserStatus 1 = active, but IsLocked overrides it — which is why both
        // are read rather than trusting the status column alone.
        active: num(u.UserStatus) === 1 && num(u.IsLocked) !== 1,
        phone: msisdn(u.PhoneNumber),
        email: str(u.Email),
        lastLoginAt: dt(u.LastLogin),
        borrowers: num(bk.get(id)?.n),
        loansOpen: num(ln.get(id)?.loans),
        olb: num(ln.get(id)?.olb),
        tracked: num(f?.tracked),
        nplLoans: num(f?.nplLoans),
        nplAmount: num(f?.nplAmount),
        arrears: num(f?.arrears),
        recovered30d: num(m?.amt),
        payments30d: num(m?.n),
      };
    })
    // An officer is someone who carries borrowers. Everybody else belongs on the
    // directory in /people, not on a book-performance screen.
    .filter((o) => o.borrowers > 0)
    .sort((a, b) => b.olb - a.olb || b.borrowers - a.borrowers);

  return {
    officers,
    totals: {
      officers: officers.length,
      borrowers: officers.reduce((s, o) => s + o.borrowers, 0),
      olb: officers.reduce((s, o) => s + o.olb, 0),
      tracked: officers.reduce((s, o) => s + o.tracked, 0),
      nplAmount: officers.reduce((s, o) => s + o.nplAmount, 0),
      recovered30d: officers.reduce((s, o) => s + o.recovered30d, 0),
      untouched: officers.filter((o) => o.tracked > 0 && o.payments30d === 0).length,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE BRANCH TREE — the same chain, rolled up one level.
//
// `OrganizationUnits` is the org tree; `UserMaster.OrganizationUnit` puts staff
// into it and `Borrowers.EntityUnit` puts the book into it. Neither has ever
// been read against the collections floor, so no screen at Micromart today can
// answer "which branch's book is going bad, and is anybody working it?" — the
// branch manager, the collections supervisor and HR each hold one third of that
// answer and none of them hold the join.
// ─────────────────────────────────────────────────────────────────────────────

export type BranchNode = {
  id: number;
  name: string;
  staff: number;
  officers: number;
  borrowers: number;
  loansOpen: number;
  olb: number;
  tracked: number;
  nplLoans: number;
  arrears: number;
  recovered30d: number;
};

export type BranchTree = {
  branches: BranchNode[];
  totals: {
    branches: number;
    staff: number;
    borrowers: number;
    olb: number;
    arrears: number;
    recovered30d: number;
  };
};

export async function getBranchTree(org: OrgDef, entityIds = [3002, 3005]): Promise<BranchTree> {
  const entities = entityIds.join(",");

  const [units, staffRows, bookRows, floorRows, moneyRows] = await Promise.all([
    cbQuery<{ UnitId: number; UnitTitle: string }>(
      org,
      `SELECT UnitId, UnitTitle FROM ${SC}.OrganizationUnits`,
      [], { timeoutMs: 20000, maxRows: 500 },
    ),
    // "Officers" is staff who appear as an EntityAgent on at least one borrower,
    // not a role title — role names drift, the relationship does not.
    cbQuery<{ u: number; staff: number; officers: number }>(
      org,
      `SELECT u.OrganizationUnit AS u, COUNT(*) AS staff,
              COUNT(DISTINCT CASE WHEN b.EntityAgent IS NOT NULL THEN u.ID END) AS officers
         FROM ${SC}.UserMaster u
         LEFT JOIN (SELECT DISTINCT EntityAgent FROM ${SC}.Borrowers WHERE EntityId IN (${entities})) b
                ON b.EntityAgent = u.ID
        WHERE u.EntityID IN (${entities})
        GROUP BY u.OrganizationUnit`,
      [], { timeoutMs: 45000, maxRows: 500 },
    ),
    cbQuery<{ u: number; borrowers: number; loans: number; olb: number }>(
      org,
      `SELECT b.EntityUnit AS u, COUNT(DISTINCT b.ID) AS borrowers,
              COUNT(l.id) AS loans,
              SUM(CAST(COALESCE(l.LoanBalance,0) AS decimal(18,2))) AS olb
         FROM ${SC}.Borrowers b
         LEFT JOIN ${SC}.Loans l ON l.BorrowerId = b.ID AND l.LoanCleared = 0
        WHERE b.EntityId IN (${entities})
        GROUP BY b.EntityUnit`,
      [], { timeoutMs: 60000, maxRows: 500 },
    ),
    cbQuery<{ u: number; tracked: number; nplLoans: number; arrears: number }>(
      org,
      `SELECT b.EntityUnit AS u, COUNT(*) AS tracked,
              SUM(CASE WHEN ct.Loantype = 6 THEN 1 ELSE 0 END) AS nplLoans,
              SUM(CAST(COALESCE(ct.Watch1,0)+COALESCE(ct.Watch2,0)+COALESCE(ct.Watch3,0)
                      +COALESCE(ct.Npl,0)+COALESCE(ct.AmountDue,0) AS decimal(18,2))) AS arrears
         FROM ${CB}.CollectionTracker ct
         JOIN ${SC}.Loans l     ON l.id = ct.LoanId
         JOIN ${SC}.Borrowers b ON b.ID = l.BorrowerId
        WHERE b.EntityId IN (${entities})
        GROUP BY b.EntityUnit`,
      [], { timeoutMs: 60000, maxRows: 500 },
    ),
    cbQuery<{ u: number; amt: number }>(
      org,
      `SELECT b.EntityUnit AS u, SUM(CAST(COALESCE(p.AmountPaid,0) AS decimal(18,2))) AS amt
         FROM ${CB}.PayedAmount p
         JOIN ${SC}.Loans l     ON l.id = p.LoanId
         JOIN ${SC}.Borrowers b ON b.ID = l.BorrowerId
        WHERE p.DatePaid > DATEADD(day,-30,GETDATE()) AND b.EntityId IN (${entities})
        GROUP BY b.EntityUnit`,
      [], { timeoutMs: 60000, maxRows: 500 },
    ),
  ]);

  const idx = <T>(rows: T[], key: (r: T) => number) => {
    const m = new Map<number, T>();
    for (const r of rows) m.set(key(r), r);
    return m;
  };
  const st = idx(staffRows, (r) => num(r.u));
  const bk = idx(bookRows, (r) => num(r.u));
  const fl = idx(floorRows, (r) => num(r.u));
  const mn = idx(moneyRows, (r) => num(r.u));

  const branches: BranchNode[] = units
    .map((u): BranchNode => {
      const id = num(u.UnitId);
      return {
        id,
        name: str(u.UnitTitle) || `Unit ${id}`,
        staff: num(st.get(id)?.staff),
        officers: num(st.get(id)?.officers),
        borrowers: num(bk.get(id)?.borrowers),
        loansOpen: num(bk.get(id)?.loans),
        olb: num(bk.get(id)?.olb),
        tracked: num(fl.get(id)?.tracked),
        nplLoans: num(fl.get(id)?.nplLoans),
        arrears: num(fl.get(id)?.arrears),
        recovered30d: num(mn.get(id)?.amt),
      };
    })
    .filter((b) => b.staff > 0 || b.borrowers > 0)
    .sort((a, b) => b.olb - a.olb || b.borrowers - a.borrowers);

  return {
    branches,
    totals: {
      branches: branches.length,
      staff: branches.reduce((s, b) => s + b.staff, 0),
      borrowers: branches.reduce((s, b) => s + b.borrowers, 0),
      olb: branches.reduce((s, b) => s + b.olb, 0),
      arrears: branches.reduce((s, b) => s + b.arrears, 0),
      recovered30d: branches.reduce((s, b) => s + b.recovered30d, 0),
    },
  };
}
