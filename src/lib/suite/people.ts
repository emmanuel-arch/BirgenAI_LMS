// ─────────────────────────────────────────────────────────────────────────────
// PEOPLEHUB — the roster, read from the systems that already know it.
//
// ── WHY THIS IS NOT A NEW DIRECTORY ──────────────────────────────────────────
// Micromart already have three staff directories and the last thing they need is
// a fourth. `Serviceconnect.dbo.UserMaster` holds 1,121 lending-system users,
// `CollectBox.dbo.UserMaster` holds 32 call-floor agents, and
// `Serviceconnect.dbo.CollectionAgents` is the only table that knows which rows
// in the first two are the same human being.
//
// PeopleHub reads all three and presents ONE roster. Nobody is asked to re-enter
// anybody. The value it adds is the join nothing else makes: an officer's book,
// their branch, their collections seat and their actual production, together.
//
// ── WHAT IS READ AND WHAT IS SIMULATED ───────────────────────────────────────
// Read live: identity, role, branch, entity, the borrowers each officer carries,
// the balance on that book, and — for anyone on the call floor — recovery,
// commission and contact rate.
//
// NOT available anywhere in their systems and therefore NOT invented: payroll,
// leave, contracts, appraisals. `AgentPerformanceHistory` and `LoanAgentMetrics`
// exist as tables and are both EMPTY. Those sections say so on screen rather
// than filling with plausible numbers — a demo that fabricates a salary is a
// demo that cannot be trusted about the balances either.
// ─────────────────────────────────────────────────────────────────────────────

import type { OrgDef } from "@/lib/enterprise/connections";
import { CB, SC, cbQuery, cbOne, num, str, dt, msisdn, P } from "@/lib/collectbox/client";

export type Person = {
  /** Serviceconnect UserMaster id, or a negative CollectBox id when they exist only there. */
  id: number;
  name: string;
  username: string;
  email: string;
  phone: string;
  roleId: number;
  role: string;
  entityId: number;
  branch: string;
  branchId: number;
  active: boolean;
  lastLoginAt: Date | null;
  createdAt: Date | null;
  /** Borrowers this person carries as relationship officer. */
  borrowers: number;
  /** Outstanding balance on that book. */
  bookOlb: number;
  /** Their seat on the collections floor, where they have one. */
  desk: {
    agentId: number;
    recovered30d: number;
    payments30d: number;
    assigned: number;
    linkedBy: string;
  } | null;
};

export type Roster = {
  people: Person[];
  totals: {
    staff: number;
    officers: number;
    onCallFloor: number;
    branches: number;
    entities: number[];
    activeLast30d: number;
  };
  branches: { id: number; name: string; staff: number; borrowers: number; olb: number }[];
  roles: { id: number; name: string; n: number }[];
  /** Tables that exist but hold nothing — reported, never filled in. */
  emptySources: { table: string; rows: number; wouldPower: string }[];
};

export async function getRoster(org: OrgDef, entityIds = [3002, 3005]): Promise<Roster> {
  const entities = entityIds.join(",");

  const [staff, books, deskRows, links, branchRows, roleRows, empties] = await Promise.all([
    cbQuery<Record<string, unknown>>(
      org,
      `SELECT u.ID, u.Username, u.FirstName, u.OtherName, u.PhoneNumber, u.Email,
              u.RoleID, u.EntityID AS entityId, u.OrganizationUnit AS branchId,
              u.UserStatus, u.IsLocked, u.LastLogin, u.CreatedDate,
              r.Title AS roleName, ou.UnitTitle AS branch
         FROM ${SC}.UserMaster u
         LEFT JOIN ${SC}.Roles r ON r.ID = u.RoleID
         LEFT JOIN ${SC}.OrganizationUnits ou ON ou.UnitId = u.OrganizationUnit
        WHERE u.EntityID IN (${entities})
        ORDER BY u.FirstName, u.OtherName`,
      [], { timeoutMs: 30000, maxRows: 2000 },
    ),
    // Each officer's book, in one grouped pass.
    cbQuery<{ EntityAgent: number; n: number; olb: number }>(
      org,
      `SELECT b.EntityAgent, COUNT(*) AS n,
              SUM(CAST(COALESCE(l.LoanBalance,0) AS decimal(18,2))) AS olb
         FROM ${SC}.Borrowers b
         LEFT JOIN ${SC}.Loans l ON l.BorrowerId = b.ID AND l.LoanCleared = 0
        WHERE b.EntityId IN (${entities})
        GROUP BY b.EntityAgent`,
      [], { timeoutMs: 45000, maxRows: 2000 },
    ),
    // The call floor's own production, 30 days.
    cbQuery<{ AgentId: number; amt: number; n: number }>(
      org,
      `SELECT AgentId, SUM(CAST(AmountPaid AS decimal(18,2))) AS amt, COUNT(*) AS n
         FROM ${CB}.PayedAmount
        WHERE DatePaid > DATEADD(day,-30,GETDATE())
        GROUP BY AgentId`,
      [], { timeoutMs: 30000, maxRows: 500 },
    ),
    // ── The Rosetta stone, and the fallbacks it needs ──────────────────────
    //
    // `CollectionAgents.CollectBoxRef` is populated on only ONE of its 63 rows,
    // so on its own it matches almost nobody. The fallbacks therefore index the
    // CollectBox roster DIRECTLY by phone and email rather than going through
    // the join table — CollectBox.UserMaster is 32 rows and carries both.
    cbQuery<Record<string, unknown>>(
      org,
      `SELECT ca.AgentRef, ca.CollectBoxRef, ca.AgentPhoneNo, ca.AgentEmail, ca.AgentName,
              NULL AS cbId, NULL AS cbPhone, NULL AS cbEmail, 'link' AS src
         FROM ${SC}.CollectionAgents ca
        WHERE ca.AgentStatus = 1
       UNION ALL
       SELECT NULL, cbu.ID, cbu.PhoneNumber, cbu.Email, cbu.FirstName,
              cbu.ID, cbu.PhoneNumber, cbu.Email, 'floor'
         FROM ${CB}.UserMaster cbu`,
      [], { timeoutMs: 25000, maxRows: 800 },
    ),
    // Branch rollup. Two grouped passes joined in memory rather than a
    // correlated subquery per branch — 127 branches x 2 scans of a 160k-row
    // borrower table was 17 seconds of this function's runtime.
    cbQuery<{ UnitId: number; UnitTitle: string; staff: number; borrowers: number; olb: number }>(
      org,
      `WITH s AS (
          SELECT OrganizationUnit AS u, COUNT(*) AS n
            FROM ${SC}.UserMaster WHERE EntityID IN (${entities}) GROUP BY OrganizationUnit
       ), b AS (
          SELECT EntityUnit AS u, COUNT(*) AS n
            FROM ${SC}.Borrowers WHERE EntityId IN (${entities}) GROUP BY EntityUnit
       )
       SELECT ou.UnitId, ou.UnitTitle,
              COALESCE(s.n,0) AS staff, COALESCE(b.n,0) AS borrowers, 0 AS olb
         FROM ${SC}.OrganizationUnits ou
         LEFT JOIN s ON s.u = ou.UnitId
         LEFT JOIN b ON b.u = ou.UnitId
        WHERE COALESCE(s.n,0) > 0 OR COALESCE(b.n,0) > 0`,
      [], { timeoutMs: 45000, maxRows: 300 },
    ),
    cbQuery<{ RoleID: number; Title: string; n: number }>(
      org,
      `SELECT u.RoleID, MAX(r.Title) AS Title, COUNT(*) AS n
         FROM ${SC}.UserMaster u
         LEFT JOIN ${SC}.Roles r ON r.ID = u.RoleID
        WHERE u.EntityID IN (${entities})
        GROUP BY u.RoleID
        ORDER BY COUNT(*) DESC`,
      [], { timeoutMs: 25000, maxRows: 100 },
    ),
    cbOne<{ perf: number; metrics: number; profile: number }>(
      org,
      `SELECT (SELECT COUNT(*) FROM ${SC}.AgentPerformanceHistory) AS perf,
              (SELECT COUNT(*) FROM ${SC}.LoanAgentMetrics) AS metrics,
              (SELECT COUNT(*) FROM ${SC}.UserProfile) AS profile`,
      [], { timeoutMs: 20000 },
    ),
  ]);

  const bookOf = new Map<number, { n: number; olb: number }>();
  for (const b of books) bookOf.set(num(b.EntityAgent), { n: num(b.n), olb: num(b.olb) });

  const deskOf = new Map<number, { amt: number; n: number }>();
  for (const d of deskRows) deskOf.set(num(d.AgentId), { amt: num(d.amt), n: num(d.n) });

  // Match a lending-system user to a collections seat: by the join table first,
  // then by phone, then by email — and record which, never silently.
  const byRef = new Map<number, { cbId: number; how: string }>();
  const byPhone = new Map<string, { cbId: number; how: string }>();
  const byEmail = new Map<string, { cbId: number; how: string }>();
  for (const l of links) {
    if (str(l.src) === "link") {
      // A CollectionAgents row. Only useful when CollectBoxRef is actually set —
      // which on this database is one row in sixty-three.
      const cbId = num(l.CollectBoxRef);
      const ref = num(l.AgentRef);
      if (cbId > 0 && ref > 0) byRef.set(ref, { cbId, how: "collectbox-ref" });
      continue;
    }
    // A CollectBox floor seat. Indexed by its own phone and email so a lending
    // user can be matched to it without the join table being populated.
    const cbId = num(l.cbId);
    if (cbId <= 0) continue;
    const ph = msisdn(l.cbPhone);
    if (ph && !byPhone.has(ph)) byPhone.set(ph, { cbId, how: "phone" });
    const em = str(l.cbEmail).toLowerCase();
    if (em && !byEmail.has(em)) byEmail.set(em, { cbId, how: "email" });
  }

  const people: Person[] = staff.map((u) => {
    const id = num(u.ID);
    const phone = msisdn(u.PhoneNumber);
    const email = str(u.Email).toLowerCase();
    const book = bookOf.get(id);

    const seat = byRef.get(id) ?? (phone ? byPhone.get(phone) : undefined) ?? (email ? byEmail.get(email) : undefined) ?? null;
    const prod = seat ? deskOf.get(seat.cbId) : undefined;

    return {
      id,
      name: [str(u.FirstName), str(u.OtherName)].filter(Boolean).join(" ") || str(u.Username),
      username: str(u.Username),
      email: str(u.Email),
      phone,
      roleId: num(u.RoleID),
      role: str(u.roleName) || "Staff",
      entityId: num(u.entityId),
      branch: str(u.branch) || "—",
      branchId: num(u.branchId),
      active: num(u.IsLocked) !== 1,
      lastLoginAt: dt(u.LastLogin),
      createdAt: dt(u.CreatedDate),
      borrowers: book?.n ?? 0,
      bookOlb: book?.olb ?? 0,
      desk: seat
        ? { agentId: seat.cbId, recovered30d: prod?.amt ?? 0, payments30d: prod?.n ?? 0, assigned: 0, linkedBy: seat.how }
        : null,
    };
  });

  const thirtyDaysAgo = Date.now() - 30 * 86400000;

  return {
    people,
    totals: {
      staff: people.length,
      officers: people.filter((p) => p.borrowers > 0).length,
      onCallFloor: people.filter((p) => p.desk).length,
      branches: new Set(people.map((p) => p.branchId).filter((n) => n > 0)).size,
      entities: [...new Set(people.map((p) => p.entityId))].sort(),
      activeLast30d: people.filter((p) => p.lastLoginAt && p.lastLoginAt.getTime() > thirtyDaysAgo).length,
    },
    branches: branchRows
      .map((b) => ({
        id: num(b.UnitId), name: str(b.UnitTitle) || "—",
        staff: num(b.staff), borrowers: num(b.borrowers), olb: num(b.olb),
      }))
      .filter((b) => b.staff > 0 || b.borrowers > 0)
      .sort((a, b) => b.borrowers - a.borrowers),
    roles: roleRows.map((r) => ({ id: num(r.RoleID), name: str(r.Title) || `Role ${num(r.RoleID)}`, n: num(r.n) })),
    emptySources: [
      { table: "Serviceconnect.AgentPerformanceHistory", rows: num(empties?.perf), wouldPower: "Appraisals and performance history over time" },
      { table: "Serviceconnect.LoanAgentMetrics", rows: num(empties?.metrics), wouldPower: "Per-officer origination quality and portfolio-at-risk" },
      { table: "Serviceconnect.UserProfile", rows: num(empties?.profile), wouldPower: "Contracts, grades, reporting lines and photographs" },
    ],
  };
}
