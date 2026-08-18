// ─────────────────────────────────────────────────────────────────────────────
// PROMISES, TASKS AND RECOVERIES — the three things a floor is measured on.
//
// ── WHY THESE ARE ONE MODULE ─────────────────────────────────────────────────
// They are the same story at three moments: what was committed to, what was
// scheduled to make it happen, and what actually arrived. Keeping them together
// makes it hard to build a screen that shows one without the others, which is
// the mistake every collections dashboard makes — a promise board with no
// settlement column is a list of hopes.
//
// ── THE ONE RULE ─────────────────────────────────────────────────────────────
// A promise's state is DERIVED, never trusted. `PromisedToPay.PaymentStatus` is
// written by their app and is not updated when a promise simply lapses — 150,345
// rows and the overwhelming majority sit at 0 forever. So "kept" and "broken"
// are computed from the money and the calendar (see ptpState in taxonomy.ts),
// which is the only version an agent can act on and the only one a keep-rate can
// honestly be built from.
// ─────────────────────────────────────────────────────────────────────────────

import type { OrgDef } from "@/lib/enterprise/connections";
import { CB, SC, cbQuery, cbOne, num, str, dt, msisdn, P } from "./client";
import { category, ptpState, type Category } from "./taxonomy";

// ── Promises ─────────────────────────────────────────────────────────────────

export type Promise_ = {
  id: number;
  loanId: number;
  borrowerId: number;
  name: string;
  phone: string;
  amount: number;
  paid: number;
  dueAt: Date | null;
  takenAt: Date | null;
  agentId: number;
  agentName: string | null;
  /** Derived, not read. */
  state: ReturnType<typeof ptpState>;
  band: Category | null;
  olb: number;
  /** Money that landed on this loan since the promise was taken. */
  recoveredSince: number;
};

export type PromiseFilter = "open" | "due-today" | "overdue" | "kept" | "all";

/**
 * The promise board.
 *
 * `recoveredSince` is the honest settlement column: it counts what landed on the
 * loan AFTER the promise was taken, from the money table, rather than trusting
 * `AmountPaid` on the promise row — which their app only fills in when somebody
 * remembers to reconcile it.
 */
export async function listPromises(
  org: OrgDef,
  opts: { filter?: PromiseFilter; agentId?: number; limit?: number } = {},
): Promise<Promise_[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const where: string[] = ["p.CreatedDate > DATEADD(year,-2,GETDATE())"];
  const params = [P.int("limit", limit)];

  if (opts.agentId != null) { where.push("p.CreatedBy = @agentId"); params.push(P.int("agentId", opts.agentId)); }
  switch (opts.filter) {
    case "due-today": where.push("CAST(p.PromisedDate AS date) = CAST(GETDATE() AS date)"); break;
    case "overdue": where.push("p.PromisedDate < CAST(GETDATE() AS date)"); break;
    case "open": where.push("p.PromisedDate >= CAST(GETDATE() AS date)"); break;
    default: break;
  }

  const rows = await cbQuery<Record<string, unknown>>(
    org,
    `SELECT TOP (@limit)
            p.ID, p.RecordID AS loanId, p.PromisedAmount AS amount, p.PromisedDate AS dueAt,
            p.AmountPaid AS paid, p.CreatedDate AS takenAt, p.CreatedBy AS agentId,
            um.FirstName AS agFirst, um.OtherName AS agOther,
            l.BorrowerId AS borrowerId, l.LoanBalance AS olb,
            b.firstName, b.otherName, b.PhoneNumber AS phone,
            ct.Loantype AS band
       FROM ${CB}.PromisedToPay p
       JOIN ${SC}.Loans l     ON l.id = p.RecordID
       JOIN ${SC}.Borrowers b ON b.ID = l.BorrowerId
       LEFT JOIN ${CB}.UserMaster ag ON ag.ID = p.CreatedBy
       LEFT JOIN ${CB}.UserMaster um ON um.ID = p.CreatedBy
       LEFT JOIN ${CB}.CollectionTracker ct ON ct.LoanId = p.RecordID
      WHERE ${where.join(" AND ")}
      ORDER BY p.PromisedDate DESC`,
    params, { timeoutMs: 40000, maxRows: limit },
  );

  // The settlement column, for exactly these loans, in one pass.
  const ids = [...new Set(rows.map((r) => num(r.loanId)).filter((n) => n > 0))];
  const since = new Map<number, number>();
  if (ids.length > 0) {
    const paid = await cbQuery<{ LoanId: number; amt: number }>(
      org,
      `SELECT LoanId, SUM(CAST(AmountPaid AS decimal(18,2))) AS amt
         FROM ${CB}.PayedAmount
        WHERE LoanId IN (${ids.join(",")}) AND DatePaid > DATEADD(day,-90,GETDATE())
        GROUP BY LoanId`,
      [], { timeoutMs: 30000, maxRows: ids.length + 10 },
    );
    for (const p of paid) since.set(num(p.LoanId), num(p.amt));
  }

  return rows.map((r): Promise_ => {
    const amount = num(r.amount);
    const paid = num(r.paid);
    const dueAt = dt(r.dueAt);
    const recoveredSince = since.get(num(r.loanId)) ?? 0;
    return {
      id: num(r.ID),
      loanId: num(r.loanId),
      borrowerId: num(r.borrowerId),
      name: [str(r.firstName), str(r.otherName)].filter(Boolean).join(" ") || "Unnamed borrower",
      phone: msisdn(r.phone),
      amount,
      paid,
      dueAt,
      takenAt: dt(r.takenAt),
      agentId: num(r.agentId),
      agentName: [str(r.agFirst), str(r.agOther)].filter(Boolean).join(" ") || null,
      // Settlement counts money that actually landed, not the promise row's own
      // AmountPaid — which their reconciler fills in only sometimes.
      state: ptpState(amount, Math.max(paid, recoveredSince), dueAt),
      band: category(num(r.band)),
      olb: num(r.olb),
      recoveredSince,
    };
  });
}

export type PromiseStats = {
  open: number; openValue: number;
  dueToday: number; dueTodayValue: number;
  overdue: number; overdueValue: number;
  takenThisMonth: number; takenThisMonthValue: number;
  /** Of promises whose date has passed, the share that saw any money. */
  keepRate: number;
  keepSample: number;
};

export async function getPromiseStats(org: OrgDef): Promise<PromiseStats> {
  const row = await cbOne<Record<string, unknown>>(
    org,
    `SELECT
       (SELECT COUNT(*) FROM ${CB}.PromisedToPay WHERE PromisedDate >= CAST(GETDATE() AS date)) AS openN,
       (SELECT SUM(CAST(PromisedAmount AS decimal(18,2))) FROM ${CB}.PromisedToPay WHERE PromisedDate >= CAST(GETDATE() AS date)) AS openV,
       (SELECT COUNT(*) FROM ${CB}.PromisedToPay WHERE CAST(PromisedDate AS date) = CAST(GETDATE() AS date)) AS todayN,
       (SELECT SUM(CAST(PromisedAmount AS decimal(18,2))) FROM ${CB}.PromisedToPay WHERE CAST(PromisedDate AS date) = CAST(GETDATE() AS date)) AS todayV,
       (SELECT COUNT(*) FROM ${CB}.PromisedToPay WHERE PromisedDate < CAST(GETDATE() AS date) AND PromisedDate > DATEADD(day,-90,GETDATE())) AS lateN,
       (SELECT SUM(CAST(PromisedAmount AS decimal(18,2))) FROM ${CB}.PromisedToPay WHERE PromisedDate < CAST(GETDATE() AS date) AND PromisedDate > DATEADD(day,-90,GETDATE())) AS lateV,
       (SELECT COUNT(*) FROM ${CB}.PromisedToPay WHERE CreatedDate >= DATEADD(day, 1-DAY(GETDATE()), CAST(GETDATE() AS date))) AS monthN,
       (SELECT SUM(CAST(PromisedAmount AS decimal(18,2))) FROM ${CB}.PromisedToPay WHERE CreatedDate >= DATEADD(day, 1-DAY(GETDATE()), CAST(GETDATE() AS date))) AS monthV`,
    [], { timeoutMs: 40000 },
  );

  // The keep-rate, measured properly: of promises whose date has passed in the
  // last 90 days, how many saw ANY money on the loan in the week around the date.
  const keep = await cbOne<{ n: number; kept: number }>(
    org,
    // The flag has to be produced BEFORE it is aggregated — SQL Server will not
    // accept SUM(CASE WHEN EXISTS(...)) directly. The window is -3/+7 days
    // around the promised date on purpose: a customer who pays two days early or
    // three days late kept their promise in every sense that matters to an agent,
    // and scoring only the exact date would report a floor as failing when it is
    // working.
    `WITH lapsed AS (
       SELECT p.RecordID, p.PromisedDate,
              CASE WHEN EXISTS (
                     SELECT 1 FROM ${CB}.PayedAmount pa
                      WHERE pa.LoanId = p.RecordID
                        AND pa.DatePaid BETWEEN DATEADD(day,-3,p.PromisedDate) AND DATEADD(day,7,p.PromisedDate)
                   ) THEN 1 ELSE 0 END AS kept
         FROM ${CB}.PromisedToPay p
        WHERE p.PromisedDate < CAST(GETDATE() AS date)
          AND p.PromisedDate > DATEADD(day,-90,GETDATE())
     )
     SELECT COUNT(*) AS n, SUM(kept) AS kept FROM lapsed`,
    [], { timeoutMs: 90000 },
  );

  const n = num(keep?.n), kept = num(keep?.kept);
  return {
    open: num(row?.openN), openValue: num(row?.openV),
    dueToday: num(row?.todayN), dueTodayValue: num(row?.todayV),
    overdue: num(row?.lateN), overdueValue: num(row?.lateV),
    takenThisMonth: num(row?.monthN), takenThisMonthValue: num(row?.monthV),
    keepRate: n > 0 ? (kept / n) * 100 : 0,
    keepSample: n,
  };
}

// ── Tasks ────────────────────────────────────────────────────────────────────

export type Task = {
  id: number;
  loanId: number;
  name: string;
  phone: string;
  action: number;
  actionName: string;
  dueAt: Date | null;
  createdAt: Date | null;
  note: string;
  open: boolean;
  agentName: string | null;
  olb: number;
  band: Category | null;
  overdue: boolean;
};

export async function listTasks(
  org: OrgDef,
  opts: { openOnly?: boolean; limit?: number } = {},
): Promise<Task[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const where = ["1=1"];
  if (opts.openOnly !== false) where.push("t.IsActive = 1");

  // Page first, enrich second — `Loans.id` has no index (see listRecoveries).
  const rows = await cbQuery<Record<string, unknown>>(
    org,
    `SELECT TOP (@limit)
            t.ID, t.RecordId AS loanId, t.TaskAction AS action, t.TaskDate AS dueAt,
            t.CreatedDate AS createdAt, t.Comments AS note, t.IsActive AS isOpen,
            ta.ActionName, um.FirstName AS agFirst, um.OtherName AS agOther
       FROM ${CB}.TaskScheduler t
       LEFT JOIN ${CB}.TaskAction ta ON ta.ID = t.TaskAction
       LEFT JOIN ${CB}.UserMaster um ON um.ID = t.CreatedBy
      WHERE ${where.join(" AND ")}
      ORDER BY t.TaskDate DESC`,
    [P.int("limit", limit)], { timeoutMs: 40000, maxRows: limit },
  );

  const ids = [...new Set(rows.map((r) => num(r.loanId)).filter((n) => n > 0))];
  const who = new Map<number, { name: string; phone: string; olb: number; band: Category | null }>();
  if (ids.length > 0) {
    const people = await cbQuery<Record<string, unknown>>(
      org,
      `SELECT l.id, l.LoanBalance AS olb, b.firstName, b.otherName, b.PhoneNumber AS phone,
              ct.Loantype AS band
         FROM ${SC}.Loans l
         LEFT JOIN ${SC}.Borrowers b ON b.ID = l.BorrowerId
         LEFT JOIN ${CB}.CollectionTracker ct ON ct.LoanId = l.id
        WHERE l.id IN (${ids.join(",")})`,
      [], { timeoutMs: 30000, maxRows: ids.length + 10 },
    );
    for (const p of people) {
      who.set(num(p.id), {
        name: [str(p.firstName), str(p.otherName)].filter(Boolean).join(" "),
        phone: msisdn(p.phone),
        olb: num(p.olb),
        band: category(num(p.band)),
      });
    }
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  return rows.map((r): Task => {
    const dueAt = dt(r.dueAt);
    const open = num(r.isOpen) === 1;
    const w = who.get(num(r.loanId));
    return {
      id: num(r.ID),
      loanId: num(r.loanId),
      name: w?.name || `Loan #${num(r.loanId)}`,
      phone: w?.phone ?? "",
      action: num(r.action),
      actionName: str(r.ActionName) || "Task",
      dueAt,
      createdAt: dt(r.createdAt),
      note: str(r.note),
      open,
      agentName: [str(r.agFirst), str(r.agOther)].filter(Boolean).join(" ") || null,
      olb: w?.olb ?? 0,
      band: w?.band ?? null,
      overdue: open && !!dueAt && dueAt < today,
    };
  });
}

// ── Recoveries ───────────────────────────────────────────────────────────────

export type Recovery = {
  id: number;
  loanId: number;
  name: string;
  phone: string;
  amount: number;
  paidAt: Date | null;
  mpesaCode: string;
  agentId: number;
  agentName: string | null;
  band: Category | null;
  /** Commission at the band's rate. */
  commission: number;
  olb: number;
  branch: string;
};

/** The money feed — every shilling, attributed, newest first. */
export async function listRecoveries(
  org: OrgDef,
  opts: { agentId?: number; days?: number; limit?: number } = {},
): Promise<Recovery[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const days = Math.min(Math.max(opts.days ?? 3, 1), 90);
  const where = [`pa.DatePaid > DATEADD(day,-${days},GETDATE())`];
  const params = [P.int("limit", limit)];
  if (opts.agentId != null) { where.push("pa.AgentId = @agentId"); params.push(P.int("agentId", opts.agentId)); }

  // ── Phase one: the payments themselves ────────────────────────────────────
  //
  // Joined to nothing but the agent table, which is 32 rows. This is the whole
  // reason the screen is usable: `Serviceconnect.dbo.Loans` is a 338,038-row
  // HEAP whose only indexes are on BorrowerId and isApproved — `id`, the column
  // every join in the system uses, HAS NO INDEX. Joining it inside this
  // statement made each of ~4,000 payment rows drive its own full scan, and the
  // page took 39 SECONDS. Same failure as loanSchedule, same fix.
  const rows = await cbQuery<Record<string, unknown>>(
    org,
    `SELECT TOP (@limit)
            pa.ID, pa.LoanId AS loanId, pa.AmountPaid AS amount, pa.DatePaid AS paidAt,
            pa.MpesaCode, pa.LoanCategory AS band, pa.AgentId AS agentId,
            um.FirstName AS agFirst, um.OtherName AS agOther
       FROM ${CB}.PayedAmount pa
       LEFT JOIN ${CB}.UserMaster um ON um.ID = pa.AgentId
      WHERE ${where.join(" AND ")}
      ORDER BY pa.DatePaid DESC`,
    params, { timeoutMs: 40000, maxRows: limit },
  );

  // ── Phase two: who those loans belong to ──────────────────────────────────
  // One query, one `IN` list of at most `limit` integers.
  const ids = [...new Set(rows.map((r) => num(r.loanId)).filter((n) => n > 0))];
  const who = new Map<number, { name: string; phone: string; olb: number; branch: string }>();
  if (ids.length > 0) {
    const people = await cbQuery<Record<string, unknown>>(
      org,
      `SELECT l.id, l.LoanBalance AS olb, b.firstName, b.otherName, b.PhoneNumber AS phone,
              ou.UnitTitle AS branch
         FROM ${SC}.Loans l
         JOIN ${SC}.Borrowers b ON b.ID = l.BorrowerId
         LEFT JOIN ${SC}.OrganizationUnits ou ON ou.UnitId = b.EntityUnit
        WHERE l.id IN (${ids.join(",")})`,
      [], { timeoutMs: 30000, maxRows: ids.length + 10 },
    );
    for (const p of people) {
      who.set(num(p.id), {
        name: [str(p.firstName), str(p.otherName)].filter(Boolean).join(" ") || "Customer",
        phone: msisdn(p.phone),
        olb: num(p.olb),
        branch: str(p.branch) || "—",
      });
    }
  }

  return rows.map((r): Recovery => {
    const amount = num(r.amount);
    const cat = category(num(r.band));
    const w = who.get(num(r.loanId));
    return {
      id: num(r.ID),
      loanId: num(r.loanId),
      name: w?.name ?? "Customer",
      phone: w?.phone ?? "",
      amount,
      paidAt: dt(r.paidAt),
      mpesaCode: str(r.MpesaCode),
      agentId: num(r.agentId),
      agentName: [str(r.agFirst), str(r.agOther)].filter(Boolean).join(" ") || null,
      band: cat,
      commission: amount * ((cat?.commission ?? 0) / 100),
      olb: w?.olb ?? 0,
      branch: w?.branch ?? "—",
    };
  });
}
