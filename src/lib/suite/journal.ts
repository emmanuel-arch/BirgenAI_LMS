// ─────────────────────────────────────────────────────────────────────────────
// THE JOURNAL, AND THE CASH FLOWS — Ledgerly's two detail screens.
//
// `Serviceconnect.dbo.Journals` holds 6.4 million double-entry postings. Every
// row names both sides (`AccountFrom`, `AccountTo`), the amount, the narration
// and — this is the part that matters for the suite — the `LoanId` and
// `BorrowerId` the posting was made for. That last pair is what turns an
// accounting screen into a connected one: a line in the accountant's journal is
// the SAME loan the officer originated, the customer sees in the portal and the
// agent is calling about. Nobody has to agree on a reconciliation file, because
// there is nothing to reconcile — it is one row.
//
// ── TWO HONEST LIMITS, STATED IN THE DATA RATHER THAN THE COPY ───────────────
//   · MOVEMENT, NOT BALANCES. The journal has no opening balances and no period
//     closes, so a balance derived from it would have no defensible starting
//     point. Both screens here report movement over a window and say so.
//   · DISBURSEMENT IS READ FROM `Loans`, NOT FROM THE JOURNAL. The posting that
//     represents a disbursement is not reliably typed across three years of
//     data, whereas `Loans.BorrowDate` + `Loans.LoanAmount` is unambiguous.
//     Collection is read from `PayedAmount` for the same reason. So the flows
//     screen compares two authoritative sources rather than one inferred one —
//     and because they come from different databases, agreeing is meaningful.
// ─────────────────────────────────────────────────────────────────────────────

import type { OrgDef } from "@/lib/enterprise/connections";
import { CB, SC, cbQuery, cbOne, num, str, dt, P } from "@/lib/collectbox/client";
import type { LedgerEntry } from "./ledger";

export type JournalPage = {
  rows: LedgerEntry[];
  /** Chart of accounts, for the filter. */
  accounts: { id: number; name: string; type: string }[];
  page: number;
  pageSize: number;
  /** Rows matching the current filter, not the whole journal. */
  matched: number;
  /** The whole journal, for scale. */
  journalRows: number;
  windowDays: number;
  accountId: number | null;
  lastEntryAt: Date | null;
};

export async function getJournalPage(
  org: OrgDef,
  opts: { page?: number; pageSize?: number; days?: number; accountId?: number | null; entityIds?: number[] } = {},
): Promise<JournalPage> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 100, 10), 250);
  const page = Math.max(opts.page ?? 1, 1);
  const days = Math.min(Math.max(opts.days ?? 30, 1), 365);
  const accountId = opts.accountId && opts.accountId > 0 ? opts.accountId : null;
  const entities = (opts.entityIds ?? [3002, 3005]).join(",");

  // The account filter is applied as a bound parameter on BOTH sides of the
  // posting: an account is interesting whether money moved into it or out of it,
  // and filtering only on AccountTo would silently hide half of its activity.
  const accountClause = accountId ? " AND (j.AccountFrom = @acct OR j.AccountTo = @acct)" : "";
  const params = accountId ? [P.int("days", days), P.int("acct", accountId)] : [P.int("days", days)];

  const [accountRows, countRow, rows, meta] = await Promise.all([
    cbQuery<Record<string, unknown>>(
      org,
      `SELECT a.Id, a.AccountName, t.AccountTypeName
         FROM ${SC}.Accounts a
         LEFT JOIN ${SC}.AccountTypes t ON t.id = a.AccountTypeId
        ORDER BY a.AccountName`,
      [], { timeoutMs: 20000, maxRows: 200 },
    ),
    cbOne<{ n: number }>(
      org,
      `SELECT COUNT(*) AS n FROM ${SC}.Journals j
        WHERE j.TransDate > DATEADD(day,-@days,GETDATE()) AND j.EntityId IN (${entities})${accountClause}`,
      params, { timeoutMs: 60000 },
    ),
    // OFFSET/FETCH rather than TOP: this is the one screen where somebody will
    // page deeply, and TOP-with-a-subquery re-sorts the whole window every time.
    cbQuery<Record<string, unknown>>(
      org,
      `SELECT j.Id, j.TransDate, j.TransAmount, j.Narration, j.LoanId, j.BorrowerId, j.EntityId,
              af.AccountName AS fromName, at2.AccountName AS toName
         FROM ${SC}.Journals j
         LEFT JOIN ${SC}.Accounts af  ON af.Id = j.AccountFrom
         LEFT JOIN ${SC}.Accounts at2 ON at2.Id = j.AccountTo
        WHERE j.TransDate > DATEADD(day,-@days,GETDATE()) AND j.EntityId IN (${entities})${accountClause}
        ORDER BY j.Id DESC
        OFFSET ${(page - 1) * pageSize} ROWS FETCH NEXT ${pageSize} ROWS ONLY`,
      params, { timeoutMs: 60000, maxRows: pageSize },
    ),
    cbOne<{ lastAt: Date; n: number }>(
      org,
      `SELECT MAX(TransDate) AS lastAt, COUNT(*) AS n FROM ${SC}.Journals WHERE EntityId IN (${entities})`,
      [], { timeoutMs: 45000 },
    ),
  ]);

  return {
    rows: rows.map((r): LedgerEntry => ({
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
    accounts: accountRows.map((a) => ({
      id: num(a.Id),
      name: str(a.AccountName) || `Account ${num(a.Id)}`,
      type: str(a.AccountTypeName) || "—",
    })),
    page,
    pageSize,
    matched: num(countRow?.n),
    journalRows: num(meta?.n),
    windowDays: days,
    accountId,
    lastEntryAt: dt(meta?.lastAt),
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export type FlowDay = {
  day: string;
  disbursed: number;
  disbursedN: number;
  collected: number;
  collectedN: number;
  /** Postings written that day — the journal keeping pace with the money. */
  postings: number;
};

export type Flows = {
  days: FlowDay[];
  totals: {
    disbursed: number;
    disbursedN: number;
    collected: number;
    collectedN: number;
    postings: number;
    /** Collected minus disbursed over the window. Negative means the book grew. */
    net: number;
  };
  windowDays: number;
  /** The busiest single day in the window, by cash collected. */
  peak: FlowDay | null;
};

export async function getFlows(org: OrgDef, opts: { days?: number; entityIds?: number[] } = {}): Promise<Flows> {
  const days = Math.min(Math.max(opts.days ?? 30, 1), 365);
  const entities = (opts.entityIds ?? [3002, 3005]).join(",");

  // Three independent daily series — two databases, three tables — aligned on
  // the date in memory. Aligning in SQL would need a calendar table this server
  // does not have, and a FULL OUTER JOIN of three grouped sets to fake one.
  const [disb, coll, post] = await Promise.all([
    cbQuery<{ d: Date; amt: number; n: number }>(
      org,
      `SELECT CAST(BorrowDate AS date) AS d,
              SUM(CAST(COALESCE(LoanAmount,0) AS decimal(18,2))) AS amt, COUNT(*) AS n
         FROM ${SC}.Loans
        WHERE BorrowDate > DATEADD(day,-@days,GETDATE()) AND EntityId IN (${entities})
        GROUP BY CAST(BorrowDate AS date)`,
      [P.int("days", days)], { timeoutMs: 60000, maxRows: 400 },
    ),
    cbQuery<{ d: Date; amt: number; n: number }>(
      org,
      `SELECT CAST(DatePaid AS date) AS d,
              SUM(CAST(COALESCE(AmountPaid,0) AS decimal(18,2))) AS amt, COUNT(*) AS n
         FROM ${CB}.PayedAmount
        WHERE DatePaid > DATEADD(day,-@days,GETDATE())
        GROUP BY CAST(DatePaid AS date)`,
      [P.int("days", days)], { timeoutMs: 60000, maxRows: 400 },
    ),
    cbQuery<{ d: Date; n: number }>(
      org,
      `SELECT CAST(TransDate AS date) AS d, COUNT(*) AS n
         FROM ${SC}.Journals
        WHERE TransDate > DATEADD(day,-@days,GETDATE()) AND EntityId IN (${entities})
        GROUP BY CAST(TransDate AS date)`,
      [P.int("days", days)], { timeoutMs: 60000, maxRows: 400 },
    ),
  ]);

  const key = (v: unknown) => (dt(v) ?? new Date()).toISOString().slice(0, 10);
  const map = new Map<string, FlowDay>();
  const at = (d: string) => {
    let row = map.get(d);
    if (!row) {
      row = { day: d, disbursed: 0, disbursedN: 0, collected: 0, collectedN: 0, postings: 0 };
      map.set(d, row);
    }
    return row;
  };

  for (const r of disb) {
    const row = at(key(r.d));
    row.disbursed = num(r.amt);
    row.disbursedN = num(r.n);
  }
  for (const r of coll) {
    const row = at(key(r.d));
    row.collected = num(r.amt);
    row.collectedN = num(r.n);
  }
  for (const r of post) at(key(r.d)).postings = num(r.n);

  const series = [...map.values()].sort((a, b) => a.day.localeCompare(b.day));

  return {
    days: series,
    totals: {
      disbursed: series.reduce((s, d) => s + d.disbursed, 0),
      disbursedN: series.reduce((s, d) => s + d.disbursedN, 0),
      collected: series.reduce((s, d) => s + d.collected, 0),
      collectedN: series.reduce((s, d) => s + d.collectedN, 0),
      postings: series.reduce((s, d) => s + d.postings, 0),
      net: series.reduce((s, d) => s + d.collected - d.disbursed, 0),
    },
    windowDays: days,
    peak: series.length ? series.reduce((a, b) => (b.collected > a.collected ? b : a)) : null,
  };
}
