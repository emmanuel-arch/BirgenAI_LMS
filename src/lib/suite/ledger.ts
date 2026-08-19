// ─────────────────────────────────────────────────────────────────────────────
// LEDGERLY — the books, read from the journal Micromart already keep.
//
// ── THE FIND ─────────────────────────────────────────────────────────────────
// `Serviceconnect.dbo.Journals` is a real double-entry journal: 6,422,048 rows
// for these two entities, every one carrying `AccountFrom`, `AccountTo`,
// `TransAmount`, `TransType` and a narration, posting against an 18-row chart of
// accounts typed INCOME / EXPENSE / LIABILITY / ASSET. It was last written 12
// minutes before this module was first run.
//
// Micromart have been keeping proper books for three years. What they have never
// had is a screen that reads them — the journal is written by the lending system
// and consumed by nothing.
//
// So Ledgerly does not invent an accounting model. It reads theirs: the same
// accounts, the same types, the same postings, aggregated the way a trial
// balance is aggregated. Every figure traces to a row somebody can look up.
//
// ── WHAT IS HONEST ABOUT THE LIMITS ──────────────────────────────────────────
// This is a JOURNAL, not a full general ledger: there are no opening balances,
// no period locks and no closing entries in the schema. So Ledgerly reports
// MOVEMENT over a window — which is exactly what the data supports — and says
// so, rather than presenting a balance sheet it cannot actually derive.
// ─────────────────────────────────────────────────────────────────────────────

import type { OrgDef } from "@/lib/enterprise/connections";
import { CB, SC, TX, cbQuery, cbOne, num, str, dt, P } from "@/lib/collectbox/client";

export type AccountType = "INCOME" | "EXPENSE" | "LIABILITY" | "ASSET";

export type LedgerAccount = {
  id: number;
  name: string;
  type: AccountType;
  entityId: number;
  /** Movement INTO this account in the window (it was the AccountTo). */
  debits: number;
  /** Movement OUT of this account in the window (it was the AccountFrom). */
  credits: number;
  net: number;
  entries: number;
};

export type LedgerEntry = {
  id: number;
  at: Date | null;
  amount: number;
  narration: string;
  from: string;
  to: string;
  loanId: number;
  borrowerId: number;
  entityId: number;
};

export type Books = {
  accounts: LedgerAccount[];
  recent: LedgerEntry[];
  totals: {
    income: number;
    expense: number;
    entries: number;
    /** Loans disbursed in the window, from the ledger. */
    disbursed: number;
    disbursedCount: number;
    /** Cash collected in the window, from the collections money table. */
    collected: number;
    collectedCount: number;
  };
  daily: { day: string; income: number; entries: number }[];
  windowDays: number;
  lastEntryAt: Date | null;
  journalRows: number;
  entityIds: number[];
};

const TYPE_OF: Record<number, AccountType> = { 1: "INCOME", 2: "EXPENSE", 3: "LIABILITY", 4: "ASSET" };

export async function getBooks(org: OrgDef, opts: { days?: number; entityIds?: number[] } = {}): Promise<Books> {
  const days = Math.min(Math.max(opts.days ?? 30, 1), 365);
  const entityIds = opts.entityIds ?? [3002, 3005];
  const entities = entityIds.join(",");

  const [accountRows, movement, recentRows, daily, money, meta] = await Promise.all([
    cbQuery<Record<string, unknown>>(
      org,
      `SELECT a.Id, a.AccountName, a.AccountTypeId, a.EntityId, t.AccountTypeName
         FROM ${SC}.Accounts a
         LEFT JOIN ${SC}.AccountTypes t ON t.id = a.AccountTypeId
        ORDER BY a.AccountTypeId, a.AccountName`,
      [], { timeoutMs: 20000, maxRows: 200 },
    ),
    // Both sides of every posting in the window, in one pass.
    cbQuery<{ acct: number; side: string; amt: number; n: number }>(
      org,
      `SELECT AccountTo AS acct, 'to' AS side, SUM(CAST(TransAmount AS decimal(18,2))) AS amt, COUNT(*) AS n
         FROM ${SC}.Journals
        WHERE TransDate > DATEADD(day,-@days,GETDATE()) AND EntityId IN (${entities})
        GROUP BY AccountTo
       UNION ALL
       SELECT AccountFrom AS acct, 'from' AS side, SUM(CAST(TransAmount AS decimal(18,2))) AS amt, COUNT(*) AS n
         FROM ${SC}.Journals
        WHERE TransDate > DATEADD(day,-@days,GETDATE()) AND EntityId IN (${entities})
        GROUP BY AccountFrom`,
      [P.int("days", days)], { timeoutMs: 60000, maxRows: 200 },
    ),
    cbQuery<Record<string, unknown>>(
      org,
      `SELECT TOP 80 j.Id, j.TransDate, j.TransAmount, j.Narration, j.LoanId, j.BorrowerId,
              j.EntityId, af.AccountName AS fromName, at2.AccountName AS toName
         FROM ${SC}.Journals j
         LEFT JOIN ${SC}.Accounts af  ON af.Id = j.AccountFrom
         LEFT JOIN ${SC}.Accounts at2 ON at2.Id = j.AccountTo
        WHERE j.EntityId IN (${entities})
        ORDER BY j.Id DESC`,
      [], { timeoutMs: 30000, maxRows: 100 },
    ),
    cbQuery<{ d: Date; amt: number; n: number }>(
      org,
      `SELECT CAST(j.TransDate AS date) AS d,
              SUM(CASE WHEN a.AccountTypeId = 1 THEN CAST(j.TransAmount AS decimal(18,2)) ELSE 0 END) AS amt,
              COUNT(*) AS n
         FROM ${SC}.Journals j
         LEFT JOIN ${SC}.Accounts a ON a.Id = j.AccountTo
        WHERE j.TransDate > DATEADD(day,-@days,GETDATE()) AND j.EntityId IN (${entities})
        GROUP BY CAST(j.TransDate AS date)
        ORDER BY CAST(j.TransDate AS date)`,
      [P.int("days", days)], { timeoutMs: 60000, maxRows: 400 },
    ),
    cbOne<{ disbursed: number; disbursedN: number; collected: number; collectedN: number }>(
      org,
      `SELECT (SELECT SUM(CAST(LoanAmount AS decimal(18,2))) FROM ${SC}.Loans
                WHERE EntityId IN (${entities}) AND BorrowDate > DATEADD(day,-@days,GETDATE())) AS disbursed,
              (SELECT COUNT(*) FROM ${SC}.Loans
                WHERE EntityId IN (${entities}) AND BorrowDate > DATEADD(day,-@days,GETDATE())) AS disbursedN,
              (SELECT SUM(CAST(AmountPaid AS decimal(18,2))) FROM ${CB}.PayedAmount
                WHERE DatePaid > DATEADD(day,-@days,GETDATE())) AS collected,
              (SELECT COUNT(*) FROM ${CB}.PayedAmount
                WHERE DatePaid > DATEADD(day,-@days,GETDATE())) AS collectedN`,
      [P.int("days", days)], { timeoutMs: 45000 },
    ),
    cbOne<{ lastAt: Date; n: number }>(
      org,
      `SELECT MAX(TransDate) AS lastAt, COUNT(*) AS n FROM ${SC}.Journals WHERE EntityId IN (${entities})`,
      [], { timeoutMs: 45000 },
    ),
  ]);

  const to = new Map<number, { amt: number; n: number }>();
  const from = new Map<number, { amt: number; n: number }>();
  for (const m of movement) {
    const target = str(m.side) === "to" ? to : from;
    target.set(num(m.acct), { amt: num(m.amt), n: num(m.n) });
  }

  const accounts: LedgerAccount[] = accountRows
    .map((a): LedgerAccount => {
      const id = num(a.Id);
      const d = to.get(id), c = from.get(id);
      return {
        id,
        name: str(a.AccountName),
        type: (str(a.AccountTypeName) as AccountType) || TYPE_OF[num(a.AccountTypeId)] || "ASSET",
        entityId: num(a.EntityId),
        debits: d?.amt ?? 0,
        credits: c?.amt ?? 0,
        net: (d?.amt ?? 0) - (c?.amt ?? 0),
        entries: (d?.n ?? 0) + (c?.n ?? 0),
      };
    })
    .sort((a, b) => b.entries - a.entries);

  const income = accounts.filter((a) => a.type === "INCOME").reduce((s, a) => s + a.debits, 0);
  const expense = accounts.filter((a) => a.type === "EXPENSE").reduce((s, a) => s + a.debits, 0);

  return {
    accounts,
    recent: recentRows.map((r): LedgerEntry => ({
      id: num(r.Id),
      at: dt(r.TransDate),
      amount: num(r.TransAmount),
      narration: str(r.Narration) || "—",
      from: str(r.fromName) || "—",
      to: str(r.toName) || "—",
      loanId: num(r.LoanId),
      borrowerId: num(r.BorrowerId),
      entityId: num(r.EntityId),
    })),
    totals: {
      income,
      expense,
      entries: accounts.reduce((s, a) => s + a.entries, 0) / 2, // each posting touches two accounts
      disbursed: num(money?.disbursed),
      disbursedCount: num(money?.disbursedN),
      collected: num(money?.collected),
      collectedCount: num(money?.collectedN),
    },
    daily: daily.map((d) => ({
      day: (dt(d.d) ?? new Date()).toISOString().slice(0, 10),
      income: num(d.amt),
      entries: num(d.n),
    })),
    windowDays: days,
    lastEntryAt: dt(meta?.lastAt),
    journalRows: num(meta?.n),
    entityIds,
  };
}
