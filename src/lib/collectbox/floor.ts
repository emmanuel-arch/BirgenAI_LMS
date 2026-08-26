// ─────────────────────────────────────────────────────────────────────────────
// THE COLLECTIONS FLOOR — what ConnectDesk reads, live, every time it renders.
//
// ── THE JOIN THAT NOBODY HAD MADE ────────────────────────────────────────────
// CollectBox and Serviceconnect have sat on the same SQL Server for years
// without a single application reading both. Verified on 18 Aug 2026:
//
//   CollectBox.dbo.CollectionTracker.LoanId → Serviceconnect.dbo.Loans.id
//       93,376 rows, ZERO orphans.
//   CollectBox.dbo.CallLogs.RecordID       → Serviceconnect.dbo.Loans.id
//       73,050 rows since 2025, 100% resolved.
//   CollectBox.dbo.PayedAmount.LoanId      → Serviceconnect.dbo.Loans.id
//       1,149,026 rows, live to the minute.
//
// So a queue row can carry the borrower's real name, their real balance, their
// real product and their real relationship officer — not a name copied into a
// campaign spreadsheet in 2024 and stale ever since. Every query in this file is
// a single server-side plan; nothing is stitched together in Node.
//
// ── WHY `ContractData` IS NOT USED ───────────────────────────────────────────
// It is the biggest contact table in the database (276,724 rows) and it is a
// trap. Its most recent row is from December 2024, its names and balances are
// campaign-era snapshots, and its `LoanID` is a varchar of a different id space.
// Reading it would produce a floor that looks plausible and is eighteen months
// wrong. `CollectionTracker` is the live object — 250 new rows a day, last
// written minutes ago — and it is what this module reads.
//
// ── ENTITY ───────────────────────────────────────────────────────────────────
// Every tracked loan in CollectBox today belongs to EntityId 3002, Micromart's
// main book. Entity 3005 (Micromart Fintech) has no collections presence at all.
// That is not hidden here: `entityId` is selected on every row and surfaced in
// the UI, and `fintechPipeline()` computes what 3005 WOULD contribute the moment
// the pipeline is turned on. See pipeline.ts.
// ─────────────────────────────────────────────────────────────────────────────

import type { OrgDef } from "@/lib/enterprise/connections";
import { CB, SC, cbQuery, cbOne, num, str, dt, msisdn, P } from "./client";
import { CATEGORY_LIST, category, categoryForDays, type Category, type CategoryId } from "./taxonomy";

// ── The floor summary ────────────────────────────────────────────────────────

export type QueueBand = {
  category: Category;
  loans: number;
  /** Balance carried in this band, from the tracker's own band column. */
  balance: number;
  /** Total outstanding on those loans, from the lending ledger. */
  olb: number;
  /** How many have an agent on them. */
  assigned: number;
  /** How many have been actioned since they entered the band. */
  actioned: number;
  /** Open promises against this band. */
  promises: number;
  /** Recovered against this band today. */
  recoveredToday: number;
};

export type FloorSummary = {
  bands: QueueBand[];
  totals: {
    loans: number;
    olb: number;
    assigned: number;
    actioned: number;
    agentsOnFloor: number;
    recoveredToday: number;
    paymentsToday: number;
    callsToday: number;
    promisesOpen: number;
  };
  /** When the tracker was last written — proof this is live, shown on screen. */
  trackerLastWrite: Date | null;
  /** When the last shilling landed. */
  lastPaymentAt: Date | null;
  entityIds: number[];
};

/**
 * The whole floor in one shape.
 *
 * Four queries rather than one: the band rollup, today's money, today's calls,
 * and the freshness probes. They are independent, so they are issued together
 * and awaited as a set — the floor renders in the time of the slowest, not the
 * sum of all four.
 */
export async function getFloorSummary(org: OrgDef): Promise<FloorSummary> {
  const [bandRows, money, calls, fresh] = await Promise.all([
    cbQuery<{
      Loantype: number; loans: number; balance: number; olb: number;
      assigned: number; actioned: number; promises: number;
    }>(
      org,
      `SELECT ct.Loantype AS Loantype,
              COUNT(*) AS loans,
              SUM(CAST(COALESCE(ct.Watch1,0)+COALESCE(ct.Watch2,0)+COALESCE(ct.Watch3,0)+COALESCE(ct.Npl,0)+COALESCE(ct.AmountDue,0) AS decimal(18,2))) AS balance,
              SUM(CAST(COALESCE(l.LoanBalance,0) AS decimal(18,2))) AS olb,
              SUM(CASE WHEN ct.IsAgentAssigned = 1 THEN 1 ELSE 0 END) AS assigned,
              SUM(CASE WHEN ct.IsActioned = 1 THEN 1 ELSE 0 END) AS actioned,
              SUM(CASE WHEN ct.PtpStatus = 0 AND ct.PtpDate IS NOT NULL THEN 1 ELSE 0 END) AS promises
         FROM ${CB}.CollectionTracker ct
         JOIN ${SC}.Loans l ON l.id = ct.LoanId
        GROUP BY ct.Loantype`,
      [], { timeoutMs: 40000 },
    ),
    cbQuery<{ LoanCategory: number; n: number; amt: number }>(
      org,
      `SELECT LoanCategory, COUNT(*) AS n, SUM(CAST(AmountPaid AS decimal(18,2))) AS amt
         FROM ${CB}.PayedAmount
        WHERE DatePaid >= CAST(GETDATE() AS date)
        GROUP BY LoanCategory`,
    ),
    cbOne<{ calls: number; agents: number }>(
      org,
      `SELECT COUNT(*) AS calls, COUNT(DISTINCT CreatedBy) AS agents
         FROM ${CB}.CallLogs
        WHERE CreatedDate >= CAST(GETDATE() AS date)`,
    ),
    cbOne<{ trackerAt: Date; payAt: Date; agentsToday: number }>(
      org,
      // TOP 1 … ORDER BY DESC rather than MAX() on both: neither column has an
      // index MAX can use, so each one scanned its whole table — 1.16M rows for
      // PayedAmount, measured at 4.5s against 1.2s this way. These two figures
      // are the freshness stamps in the /desk header, so they are on the
      // critical path of the first collections screen anyone opens.
      `SELECT (SELECT TOP 1 Last_update FROM ${CB}.CollectionTracker ORDER BY Last_update DESC) AS trackerAt,
              (SELECT TOP 1 DatePaid    FROM ${CB}.PayedAmount       ORDER BY DatePaid DESC)    AS payAt,
              (SELECT COUNT(DISTINCT AgentId) FROM ${CB}.PayedAmount
                WHERE DatePaid >= CAST(GETDATE() AS date))           AS agentsToday`,
    ),
  ]);

  const moneyByCat = new Map<number, { n: number; amt: number }>();
  for (const r of money) moneyByCat.set(num(r.LoanCategory), { n: num(r.n), amt: num(r.amt) });

  const byType = new Map<number, (typeof bandRows)[number]>();
  for (const r of bandRows) byType.set(num(r.Loantype), r);

  const bands: QueueBand[] = CATEGORY_LIST.map((cat) => {
    const row = byType.get(cat.id);
    const m = moneyByCat.get(cat.id);
    return {
      category: cat,
      loans: num(row?.loans),
      balance: num(row?.balance),
      olb: num(row?.olb),
      assigned: num(row?.assigned),
      actioned: num(row?.actioned),
      promises: num(row?.promises),
      recoveredToday: m?.amt ?? 0,
    };
  });

  const recoveredToday = [...moneyByCat.values()].reduce((s, m) => s + m.amt, 0);
  const paymentsToday = [...moneyByCat.values()].reduce((s, m) => s + m.n, 0);

  return {
    bands,
    totals: {
      loans: bands.reduce((s, b) => s + b.loans, 0),
      olb: bands.reduce((s, b) => s + b.olb, 0),
      assigned: bands.reduce((s, b) => s + b.assigned, 0),
      actioned: bands.reduce((s, b) => s + b.actioned, 0),
      agentsOnFloor: num(fresh?.agentsToday),
      recoveredToday,
      paymentsToday,
      callsToday: num(calls?.calls),
      promisesOpen: bands.reduce((s, b) => s + b.promises, 0),
    },
    trackerLastWrite: dt(fresh?.trackerAt),
    lastPaymentAt: dt(fresh?.payAt),
    entityIds: [3002],
  };
}

// ── The work queue ───────────────────────────────────────────────────────────

export type QueueRow = {
  trackerId: number;
  loanId: number;
  borrowerId: number;
  name: string;
  phone: string;
  nationalId: string;
  /** Days in arrears as the tracker holds it. */
  dpd: number;
  category: Category;
  /** The balance in this loan's band. */
  bandBalance: number;
  /** Outstanding on the loan, from the ledger. */
  olb: number;
  amountDue: number;
  instalment: number;
  product: string;
  entityId: number;
  branch: string;
  /** The relationship officer who owns this borrower in the LMS. */
  officer: string | null;
  /** The collections agent this row is assigned to. */
  agentId: number | null;
  agentName: string | null;
  assignedAt: Date | null;
  actioned: boolean;
  lastActionAt: Date | null;
  lastComment: string;
  ptpDate: Date | null;
  ptpAmount: number;
  ptpStatus: number;
  /** Last time anybody called this loan, from CallLogs. */
  lastCallAt: Date | null;
  lastCallDisposition: number | null;
  callCount: number;
  /** Money recovered against this loan in the last 30 days. */
  recovered30d: number;
  expectedClearDate: Date | null;
};

export type QueueFilters = {
  categories?: CategoryId[];
  agentId?: number | null;
  /** Only rows nobody has worked yet today. */
  untouchedToday?: boolean;
  /** Only rows with an open promise. */
  withPromise?: boolean;
  search?: string;
  minBalance?: number;
  branch?: string;
  sort?: "value" | "dpd" | "oldest-touch" | "promise";
  limit?: number;
  offset?: number;
};

const SORTS: Record<NonNullable<QueueFilters["sort"]>, string> = {
  // Highest recoverable value first — the default, because an agent's day is
  // finite and the book is not.
  value: "ORDER BY CAST(COALESCE(l.LoanBalance,0) AS decimal(18,2)) DESC",
  dpd: "ORDER BY ct.DaysInArears DESC, CAST(COALESCE(l.LoanBalance,0) AS decimal(18,2)) DESC",
  // Longest since anyone spoke to them. This is the queue that prevents a book
  // going quietly cold while everyone works the same easy names.
  "oldest-touch": "ORDER BY COALESCE(ct.LastActionedDate, '1900-01-01') ASC, CAST(COALESCE(l.LoanBalance,0) AS decimal(18,2)) DESC",
  promise: "ORDER BY ct.PtpDate ASC",
};

/**
 * The work list an agent actually dials.
 *
 * ── WHY THIS IS TWO QUERIES AND NOT ONE ──────────────────────────────────────
 * The obvious version puts `OUTER APPLY (SELECT MAX(CreatedDate) FROM CallLogs
 * WHERE RecordID = ct.LoanId)` in the main statement. It is correct, it reads
 * beautifully, and it took **12.5 seconds** against the live server — because
 * `CallLogs` holds 1,342,610 rows with no index on `RecordID`, so a correlated
 * subquery scans the whole table once per candidate row, and the candidate set
 * before paging is all 93,376 tracked loans.
 *
 * So: PAGE FIRST, ENRICH SECOND. The first query resolves 50 rows out of the
 * tracker and the ledger. The second asks for the call history and the recent
 * recoveries of exactly those 50 loan ids. One table scan instead of thousands.
 *
 * The enrichment is not optional garnish, which is why it is worth this trouble:
 * the last call and the last payment are what turn a list of debts into a list
 * of *conversations*. An agent who cannot see that the customer paid 2,000
 * yesterday opens the call by demanding money that has already arrived, and that
 * single mistake costs more goodwill than the query ever cost milliseconds.
 *
 * The id list is interpolated rather than bound. That is safe here and nowhere
 * else: every value in it came out of `ct.LoanId`, an `int` column, and is
 * passed through Math.trunc + a finite check on the way. No caller-supplied
 * string reaches the statement.
 */
export async function getQueue(org: OrgDef, f: QueueFilters = {}): Promise<QueueRow[]> {
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 500);
  const offset = Math.max(f.offset ?? 0, 0);
  const where: string[] = ["1=1"];
  const params = [P.int("limit", limit), P.int("offset", offset)];

  if (f.categories?.length) {
    const ids = f.categories.filter((c) => category(c)).map((c) => Number(c));
    if (ids.length) where.push(`ct.Loantype IN (${ids.join(",")})`);
  }
  if (f.agentId != null) { where.push("ct.AgentAssigned = @agentId"); params.push(P.int("agentId", f.agentId)); }
  if (f.untouchedToday) where.push("(ct.LastActionedDate IS NULL OR ct.LastActionedDate < CAST(GETDATE() AS date))");
  if (f.withPromise) where.push("ct.PtpDate IS NOT NULL AND ct.PtpStatus = 0");
  if (f.minBalance != null) { where.push("CAST(COALESCE(l.LoanBalance,0) AS decimal(18,2)) >= @minBal"); params.push(P.dec("minBal", f.minBalance)); }
  if (f.branch) { where.push("ou.UnitTitle = @branch"); params.push(P.str("branch", f.branch)); }
  if (f.search?.trim()) {
    // Name, phone or national id — one box, because an agent holding a ringing
    // handset has one thing in front of them and it is not a labelled form.
    where.push("(b.firstName LIKE @q OR b.otherName LIKE @q OR b.PhoneNumber LIKE @q OR b.NationalID LIKE @q OR CAST(l.id AS varchar(20)) = @qExact)");
    params.push(P.str("q", `%${f.search.trim()}%`), P.str("qExact", f.search.trim()));
  }

  const rows = await cbQuery<Record<string, unknown>>(
    org,
    `SELECT ct.Id AS trackerId, ct.LoanId AS loanId, ct.DaysInArears AS dpd, ct.Loantype AS loantype,
            ct.AmountDue AS amountDue, ct.Installment AS instalment,
            CAST(COALESCE(ct.Watch1,0)+COALESCE(ct.Watch2,0)+COALESCE(ct.Watch3,0)+COALESCE(ct.Npl,0)+COALESCE(ct.AmountDue,0) AS decimal(18,2)) AS bandBalance,
            ct.IsActioned AS actioned, ct.LastActionedDate AS lastActionAt, ct.LastComment AS lastComment,
            ct.AgentAssigned AS agentId, ct.LastDateAssigned AS assignedAt,
            ct.PtpDate AS ptpDate, ct.ptpAmount AS ptpAmount, ct.PtpStatus AS ptpStatus,
            l.BorrowerId AS borrowerId, l.LoanBalance AS olb, l.EntityId AS entityId, l.ExpectedClearDate AS expectedClearDate,
            b.firstName, b.otherName, b.PhoneNumber AS phone, b.NationalID AS nationalId,
            p.ProductName AS product,
            ou.UnitTitle AS branch,
            ro.FirstName AS roFirst, ro.OtherName AS roOther,
            ag.FirstName AS agFirst, ag.OtherName AS agOther
       FROM ${CB}.CollectionTracker ct
       JOIN ${SC}.Loans l        ON l.id = ct.LoanId
       JOIN ${SC}.Borrowers b    ON b.ID = l.BorrowerId
       LEFT JOIN ${SC}.Products p          ON p.ID = l.ProductId
       LEFT JOIN ${SC}.OrganizationUnits ou ON ou.UnitId = b.EntityUnit
       LEFT JOIN ${SC}.UserMaster ro       ON ro.ID = b.EntityAgent
       LEFT JOIN ${CB}.UserMaster ag       ON ag.ID = ct.AgentAssigned
      WHERE ${where.join(" AND ")}
      ${SORTS[f.sort ?? "value"]}
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
    params,
    { timeoutMs: 45000, maxRows: limit },
  );

  const enriched = await enrichQueue(org, rows.map((r) => num(r.loanId)));
  return rows.map((r) => mapQueueRow(r, enriched.get(num(r.loanId))));
}

export type QueueEnrichment = {
  lastCallAt: Date | null;
  lastDisposition: number | null;
  callCount: number;
  recovered30d: number;
  lastPaymentAt: Date | null;
};

/**
 * Call history and recent recoveries for a known, bounded set of loan ids.
 *
 * Two aggregates over two big tables, each restricted by an `IN` list of at most
 * a few hundred integers. This is the half of `getQueue` that used to cost twelve
 * seconds and now costs tens of milliseconds.
 */
export async function enrichQueue(org: OrgDef, loanIds: number[]): Promise<Map<number, QueueEnrichment>> {
  const out = new Map<number, QueueEnrichment>();
  const ids = [...new Set(loanIds.map((n) => Math.trunc(n)).filter((n) => Number.isFinite(n) && n > 0))];
  if (ids.length === 0) return out;
  const list = ids.join(",");

  const [calls, pays] = await Promise.all([
    cbQuery<{ loanId: number; lastCallAt: Date; callCount: number; lastDisposition: number }>(
      org,
      `SELECT x.RecordID AS loanId, x.lastCallAt, x.callCount, cl.CallResponse AS lastDisposition
         FROM (
            SELECT RecordID, MAX(CreatedDate) AS lastCallAt, COUNT(*) AS callCount, MAX(ID) AS lastId
              FROM ${CB}.CallLogs WHERE RecordID IN (${list}) GROUP BY RecordID
         ) x
         LEFT JOIN ${CB}.CallLogs cl ON cl.ID = x.lastId`,
      [], { timeoutMs: 30000, maxRows: ids.length + 10 },
    ),
    cbQuery<{ loanId: number; recovered: number; lastPaymentAt: Date }>(
      org,
      `SELECT LoanId AS loanId, SUM(CAST(AmountPaid AS decimal(18,2))) AS recovered, MAX(DatePaid) AS lastPaymentAt
         FROM ${CB}.PayedAmount
        WHERE LoanId IN (${list}) AND DatePaid > DATEADD(day,-30,GETDATE())
        GROUP BY LoanId`,
      [], { timeoutMs: 30000, maxRows: ids.length + 10 },
    ),
  ]);

  for (const id of ids) out.set(id, { lastCallAt: null, lastDisposition: null, callCount: 0, recovered30d: 0, lastPaymentAt: null });
  for (const c of calls) {
    const e = out.get(num(c.loanId)); if (!e) continue;
    e.lastCallAt = dt(c.lastCallAt);
    e.callCount = num(c.callCount);
    e.lastDisposition = c.lastDisposition == null ? null : num(c.lastDisposition);
  }
  for (const p of pays) {
    const e = out.get(num(p.loanId)); if (!e) continue;
    e.recovered30d = num(p.recovered);
    e.lastPaymentAt = dt(p.lastPaymentAt);
  }
  return out;
}

function mapQueueRow(r: Record<string, unknown>, e?: QueueEnrichment): QueueRow {
  const dpd = num(r.dpd);
  const cat = category(num(r.loantype)) ?? categoryForDays(dpd);
  const roName = [str(r.roFirst), str(r.roOther)].filter(Boolean).join(" ");
  const agName = [str(r.agFirst), str(r.agOther)].filter(Boolean).join(" ");
  return {
    trackerId: num(r.trackerId),
    loanId: num(r.loanId),
    borrowerId: num(r.borrowerId),
    name: [str(r.firstName), str(r.otherName)].filter(Boolean).join(" ") || "Unnamed borrower",
    phone: msisdn(r.phone),
    nationalId: str(r.nationalId),
    dpd,
    category: cat,
    bandBalance: num(r.bandBalance),
    olb: num(r.olb),
    amountDue: num(r.amountDue),
    instalment: num(r.instalment),
    product: str(r.product) || "—",
    entityId: num(r.entityId),
    branch: str(r.branch) || "—",
    officer: roName || null,
    agentId: num(r.agentId) || null,
    agentName: agName || null,
    assignedAt: dt(r.assignedAt),
    actioned: num(r.actioned) === 1,
    lastActionAt: dt(r.lastActionAt),
    lastComment: str(r.lastComment),
    ptpDate: dt(r.ptpDate),
    ptpAmount: num(r.ptpAmount),
    ptpStatus: num(r.ptpStatus),
    lastCallAt: e?.lastCallAt ?? null,
    lastCallDisposition: e?.lastDisposition ?? null,
    callCount: e?.callCount ?? 0,
    recovered30d: e?.recovered30d ?? 0,
    expectedClearDate: dt(r.expectedClearDate),
  };
}

/** How many rows a given filter set matches — for the pager and the queue chips. */
export async function countQueue(org: OrgDef, f: QueueFilters = {}): Promise<number> {
  const where: string[] = ["1=1"];
  const params = [];
  if (f.categories?.length) {
    const ids = f.categories.filter((c) => category(c)).map(Number);
    if (ids.length) where.push(`ct.Loantype IN (${ids.join(",")})`);
  }
  if (f.agentId != null) { where.push("ct.AgentAssigned = @agentId"); params.push(P.int("agentId", f.agentId)); }
  if (f.untouchedToday) where.push("(ct.LastActionedDate IS NULL OR ct.LastActionedDate < CAST(GETDATE() AS date))");
  if (f.withPromise) where.push("ct.PtpDate IS NOT NULL AND ct.PtpStatus = 0");

  const row = await cbOne<{ n: number }>(
    org,
    `SELECT COUNT(*) AS n FROM ${CB}.CollectionTracker ct JOIN ${SC}.Loans l ON l.id = ct.LoanId WHERE ${where.join(" AND ")}`,
    params, { timeoutMs: 30000 },
  );
  return num(row?.n);
}

// ── One case, in full ────────────────────────────────────────────────────────

export type CaseFile = {
  row: QueueRow;
  borrower: {
    id: number;
    name: string;
    phone: string;
    altPhone: string;
    nationalId: string;
    email: string;
    branch: string;
    officer: string | null;
    officerPhone: string | null;
    creditScore: number;
    loanLimit: number;
    riskCategory: string;
    since: Date | null;
    address: string;
  };
  /** Every loan this borrower has ever taken — the relationship, not the debt. */
  loans: { id: number; product: string; amount: number; balance: number; borrowedAt: Date | null; clearedAt: Date | null; cleared: boolean; dpd: number }[];
  totals: { taken: number; repaid: number; outstanding: number; loansCleared: number; loansTotal: number };
};

export async function getCase(org: OrgDef, loanId: number): Promise<CaseFile | null> {
  const rows = await cbQuery<Record<string, unknown>>(
    org,
    `SELECT TOP 1 ct.Id AS trackerId, ct.LoanId AS loanId, ct.DaysInArears AS dpd, ct.Loantype AS loantype,
            ct.AmountDue AS amountDue, ct.Installment AS instalment,
            CAST(COALESCE(ct.Watch1,0)+COALESCE(ct.Watch2,0)+COALESCE(ct.Watch3,0)+COALESCE(ct.Npl,0)+COALESCE(ct.AmountDue,0) AS decimal(18,2)) AS bandBalance,
            ct.IsActioned AS actioned, ct.LastActionedDate AS lastActionAt, ct.LastComment AS lastComment,
            ct.AgentAssigned AS agentId, ct.LastDateAssigned AS assignedAt,
            ct.PtpDate AS ptpDate, ct.ptpAmount AS ptpAmount, ct.PtpStatus AS ptpStatus,
            l.BorrowerId AS borrowerId, l.LoanBalance AS olb, l.EntityId AS entityId, l.ExpectedClearDate AS expectedClearDate,
            b.firstName, b.otherName, b.PhoneNumber AS phone, b.AltContact AS altPhone, b.NationalID AS nationalId,
            b.EmailAddress AS email, b.CreditScore AS creditScore, b.LoanLimit AS loanLimit, b.RiskCategory AS riskCategory,
            b.CreatedDate AS since, b.PhysicalAddress AS address,
            p.ProductName AS product, ou.UnitTitle AS branch,
            ro.FirstName AS roFirst, ro.OtherName AS roOther, ro.PhoneNumber AS roPhone,
            ag.FirstName AS agFirst, ag.OtherName AS agOther
       FROM ${CB}.CollectionTracker ct
       JOIN ${SC}.Loans l     ON l.id = ct.LoanId
       JOIN ${SC}.Borrowers b ON b.ID = l.BorrowerId
       LEFT JOIN ${SC}.Products p           ON p.ID = l.ProductId
       LEFT JOIN ${SC}.OrganizationUnits ou ON ou.UnitId = b.EntityUnit
       LEFT JOIN ${SC}.UserMaster ro        ON ro.ID = b.EntityAgent
       LEFT JOIN ${CB}.UserMaster ag        ON ag.ID = ct.AgentAssigned
      WHERE ct.LoanId = @loanId`,
    [P.int("loanId", loanId)], { timeoutMs: 30000 },
  );
  const r = rows[0];
  if (!r) return null;

  const borrowerId = num(r.borrowerId);
  const enriched = await enrichQueue(org, [loanId]);
  const history = await cbQuery<Record<string, unknown>>(
    org,
    `SELECT l.id, l.LoanAmount AS amount, l.LoanBalance AS balance, l.BorrowDate AS borrowedAt,
            l.DateCleared AS clearedAt, l.LoanCleared AS cleared, p.ProductName AS product,
            COALESCE(ct.DaysInArears,0) AS dpd
       FROM ${SC}.Loans l
       LEFT JOIN ${SC}.Products p ON p.ID = l.ProductId
       LEFT JOIN ${CB}.CollectionTracker ct ON ct.LoanId = l.id
      WHERE l.BorrowerId = @b
      ORDER BY l.BorrowDate DESC`,
    [P.int("b", borrowerId)], { maxRows: 60 },
  );

  const loans = history.map((h) => ({
    id: num(h.id), product: str(h.product) || "—", amount: num(h.amount), balance: num(h.balance),
    borrowedAt: dt(h.borrowedAt), clearedAt: dt(h.clearedAt), cleared: num(h.cleared) === 1, dpd: num(h.dpd),
  }));

  const roName = [str(r.roFirst), str(r.roOther)].filter(Boolean).join(" ");

  return {
    row: mapQueueRow(r, enriched.get(loanId)),
    borrower: {
      id: borrowerId,
      name: [str(r.firstName), str(r.otherName)].filter(Boolean).join(" ") || "Unnamed borrower",
      phone: msisdn(r.phone),
      altPhone: msisdn(r.altPhone),
      nationalId: str(r.nationalId),
      email: str(r.email),
      branch: str(r.branch) || "—",
      officer: roName || null,
      officerPhone: msisdn(r.roPhone) || null,
      creditScore: num(r.creditScore),
      loanLimit: num(r.loanLimit),
      riskCategory: str(r.riskCategory) || "—",
      since: dt(r.since),
      address: str(r.address),
    },
    loans,
    totals: {
      taken: loans.reduce((s, l) => s + l.amount, 0),
      repaid: loans.reduce((s, l) => s + Math.max(0, l.amount - l.balance), 0),
      outstanding: loans.reduce((s, l) => s + l.balance, 0),
      loansCleared: loans.filter((l) => l.cleared).length,
      loansTotal: loans.length,
    },
  };
}

// ── Branches, for the filter rail ────────────────────────────────────────────

export async function listBranches(org: OrgDef): Promise<{ name: string; loans: number; olb: number }[]> {
  const rows = await cbQuery<{ name: string; loans: number; olb: number }>(
    org,
    `SELECT COALESCE(ou.UnitTitle,'Unassigned') AS name, COUNT(*) AS loans,
            SUM(CAST(COALESCE(l.LoanBalance,0) AS decimal(18,2))) AS olb
       FROM ${CB}.CollectionTracker ct
       JOIN ${SC}.Loans l     ON l.id = ct.LoanId
       JOIN ${SC}.Borrowers b ON b.ID = l.BorrowerId
       LEFT JOIN ${SC}.OrganizationUnits ou ON ou.UnitId = b.EntityUnit
      GROUP BY ou.UnitTitle
      ORDER BY SUM(CAST(COALESCE(l.LoanBalance,0) AS decimal(18,2))) DESC`,
    [], { timeoutMs: 40000, maxRows: 200 },
  );
  return rows.map((r) => ({ name: str(r.name), loans: num(r.loans), olb: num(r.olb) }));
}
