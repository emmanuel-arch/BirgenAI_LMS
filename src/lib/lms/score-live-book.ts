// ─────────────────────────────────────────────────────────────────────────────
// SCORE THE WHOLE BOOK, BEFORE ANYBODY APPLIES.
//
// Customer 360 scores one customer on demand, and that is the right shape for a
// page. It is the wrong shape for the question a lender actually asks, which is
// never "what is Moses?" — it is "who, out of these seventeen thousand, should I
// be lending more to, and who should I stop?" You cannot answer that one screen
// at a time, and you certainly cannot answer it at the moment somebody applies:
// by then the officer is already talking to them.
//
// So the book is swept. Every customer with a repayment history is scored by the
// same engine, under the same credit policy, and the answer is filed where the
// console can read it without anybody having opened their page.
//
// ── WHY THIS IS NOT A MIRROR ─────────────────────────────────────────────────
// The architecture refuses to copy a bridged lender's 17,021 borrowers into our
// Postgres, and that refusal stands: a copy is stale by morning and the console's
// one job is to never be confidently out of date about a balance. What is written
// here is not the book. It is the DERIVED NUMBER — a score, a band, and the
// evidence it was computed from — keyed on the lender's own borrower id in
// ScoreSnapshot, which already carries `serviceSuiteBorrowerId` for exactly this
// kind of row. The book stays where it is. Our opinion of it lives here.
//
// ── WHY IT IS SET-BASED ──────────────────────────────────────────────────────
// The per-customer path costs two round trips and measured ~195ms. Seventeen
// thousand of those is fifty-five minutes of serial waiting, which is not a job
// anybody will run nightly. This reads a PAGE of borrowers, then their loans in
// one query (ROW_NUMBER over BorrowerId, so each person's last few come back
// together), then every instalment for those loans in one more — three queries
// per few hundred customers instead of two per customer.
//
// And the same two schema traps as everywhere else: LoanSchedule is joined on
// `Loanid` ALONE (its EntityId is stale for the 3005 split — 298,202 rows kept
// the old id), and scoring divides by `InstallmentAmount`, which is the column
// the lender's own procedure uses and the one our ladder was verified against.
// ─────────────────────────────────────────────────────────────────────────────
import { runReadOnlyQuery, mssql, type QueryParam } from "@/lib/enterprise/mssql";
import type { OrgDef } from "@/lib/enterprise/connections";
import type { LoanFact, InstallmentFact } from "@/lib/scoring/behaviour";
import { assessLadder } from "@/lib/scoring/behaviour";
import type { CreditPolicy } from "@/lib/decision/policy";

export type ScoredCustomer = {
  serviceSuiteBorrowerId: number;
  name: string;
  phone: string | null;
  /** 0–100, our engine on their instalments. */
  score: number;
  band: string | null;
  /** Their own stored figure, for the comparison that proves the sweep is sane. */
  theirScore: number | null;
  theirCategory: string | null;
  currentLimit: number;
  /** What the ladder would move them to, or null for hold. */
  newLimit: number | null;
  move: "graduate" | "demote" | "hold";
  reason: string;
  clearedLoans: number;
  installmentsUsed: number;
};

export type SweepPage = {
  scored: ScoredCustomer[];
  /** Borrowers read on this page, including any that had nothing to score. */
  read: number;
  /** Pass this back as `afterId` to continue. Null when the book is exhausted. */
  nextAfterId: number | null;
};

/**
 * A SQL Server `date` as the calendar day it actually is — see the same note in
 * servicesuite-scoring.ts. An hours-level skew moves instalments between lateness
 * bands, which moves bands, which moves limits.
 */
function localDate(v: unknown): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Score one page of the lender's book.
 *
 * Paged by BORROWER ID rather than OFFSET: a sweep of a live book runs for
 * minutes while people are being registered, and OFFSET paging over a table that
 * is growing underneath you silently skips rows. A keyset cursor cannot.
 */
export async function scoreBookPage(
  org: OrgDef,
  entityId: number,
  policy: CreditPolicy,
  opts: { afterId?: number; pageSize?: number; now?: Date } = {},
): Promise<SweepPage> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 250, 1), 500);
  const afterId = opts.afterId ?? 0;
  const now = opts.now ?? new Date();
  const lookback = Math.min(Math.max(policy.behaviour.window.lookbackLoans, 1), 8);
  const includeActive = policy.behaviour.window.includeActive;

  const params: QueryParam[] = [
    { name: "entityId", type: mssql.Int, value: entityId },
    { name: "afterId", type: mssql.Int, value: afterId },
  ];

  // Only people with something to score. EXISTS rather than a join, so a customer
  // with forty loans still produces one row.
  const { rows: people } = await runReadOnlyQuery(
    org,
    `SELECT TOP (${pageSize})
            b.ID, b.firstName, b.otherName, b.PhoneNumber,
            b.RiskScore, b.RiskCategory, b.LoanLimit
     FROM Borrowers b
     WHERE b.EntityId = @entityId
       AND b.ID > @afterId
       AND EXISTS (
         SELECT 1 FROM Loans l
         WHERE l.BorrowerId = b.ID AND l.EntityId = @entityId AND l.isApproved = 1
       )
     ORDER BY b.ID`,
    params,
    { timeoutMs: 60000, maxRows: pageSize },
  );
  if (people.length === 0) return { scored: [], read: 0, nextAfterId: null };

  const ids = people.map((r) => Number(r.ID)).filter((n) => Number.isInteger(n) && n > 0);
  const lastId = ids[ids.length - 1];
  if (ids.length === 0) return { scored: [], read: people.length, nextAfterId: null };

  // Each person's most recent loans, all in one pass. ROW_NUMBER partitioned by
  // borrower is what turns "the last four loans of each of 250 people" from 250
  // queries into one.
  const { rows: loanRows } = await runReadOnlyQuery(
    org,
    `SELECT id, BorrowerId, Principal, LoanCleared, BorrowDate
     FROM (
       SELECT l.id, l.BorrowerId, l.Principal, l.LoanCleared, l.BorrowDate,
              ROW_NUMBER() OVER (PARTITION BY l.BorrowerId ORDER BY l.id DESC) AS rn
       FROM Loans l
       WHERE l.EntityId = @entityId
         AND l.isApproved = 1
         ${includeActive ? "" : "AND l.LoanCleared = 1"}
         AND l.BorrowerId IN (${ids.join(",")})
     ) x
     WHERE x.rn <= ${lookback + 1}
     ORDER BY x.BorrowerId, x.id DESC`,
    [{ name: "entityId", type: mssql.Int, value: entityId }],
    { timeoutMs: 120000, maxRows: pageSize * (lookback + 1) + 64 },
  );
  if (loanRows.length === 0) return { scored: [], read: people.length, nextAfterId: lastId };

  const loanIds = loanRows.map((r) => Number(r.id)).filter((n) => Number.isInteger(n) && n > 0);

  // Every instalment for every loan on this page — one query. No EntityId here:
  // see the header.
  const { rows: sched } = await runReadOnlyQuery(
    org,
    `SELECT s.Loanid, s.InstallmentAmount, s.AmountPaid, s.ExpectedDueDate, s.dateofpayment
     FROM LoanSchedule s
     WHERE s.Loanid IN (${loanIds.join(",")})
     ORDER BY s.Loanid, s.ExpectedDueDate`,
    [],
    { timeoutMs: 180000, maxRows: loanIds.length * 60 + 1024 },
  );

  const byLoan = new Map<number, InstallmentFact[]>();
  for (const r of sched) {
    const loanId = Number(r.Loanid);
    const due = localDate(r.ExpectedDueDate);
    if (!Number.isFinite(loanId) || !due) continue;
    const list = byLoan.get(loanId) ?? [];
    list.push({
      seq: list.length + 1,
      amountDue: Number(r.InstallmentAmount ?? 0),
      amountPaid: Number(r.AmountPaid ?? 0),
      dueDate: due,
      paidAt: localDate(r.dateofpayment),
    });
    byLoan.set(loanId, list);
  }

  const factsByBorrower = new Map<number, LoanFact[]>();
  for (const r of loanRows) {
    const loanId = Number(r.id);
    const borrowerId = Number(r.BorrowerId);
    const installments = byLoan.get(loanId);
    if (!installments || installments.length === 0) continue;
    const cleared = Number(r.LoanCleared ?? 0) === 1;
    const borrowDate = localDate(r.BorrowDate);
    const list = factsByBorrower.get(borrowerId) ?? [];
    list.push({
      id: `ss:${loanId}`,
      principal: Number(r.Principal ?? 0),
      status: cleared ? "CLEARED" : "ACTIVE",
      // The sweep does not probe for Loans.DateCleared (Axe's box has no such
      // column) and does not need to: the borrow date preserves the ORDER the
      // recency decay cares about, and the loans arrive newest-first already.
      clearedAt: cleared ? borrowDate : null,
      borrowDate: borrowDate ?? installments[installments.length - 1].dueDate,
      installments,
    });
    factsByBorrower.set(borrowerId, list);
  }

  const scored: ScoredCustomer[] = [];
  for (const p of people) {
    const id = Number(p.ID);
    const facts = factsByBorrower.get(id);
    if (!facts || facts.length === 0) continue;
    const currentLimit = Number(p.LoanLimit ?? 0);
    const a = assessLadder({ loans: facts, currentLimit }, policy.behaviour, policy.graduation, now);
    if (!a.behaviour.scored) continue;
    scored.push({
      serviceSuiteBorrowerId: id,
      name: `${String(p.firstName ?? "").trim()} ${String(p.otherName ?? "").trim()}`.trim(),
      phone: p.PhoneNumber != null ? String(p.PhoneNumber).replace(/\D/g, "") || null : null,
      score: a.behaviour.score,
      band: a.behaviour.category?.key ?? null,
      theirScore: p.RiskScore != null ? Number(p.RiskScore) : null,
      theirCategory: p.RiskCategory != null ? String(p.RiskCategory) : null,
      currentLimit,
      newLimit: a.newLimit,
      move: a.move,
      reason: a.reason,
      clearedLoans: a.clearedLoans,
      installmentsUsed: a.behaviour.installmentsUsed,
    });
  }

  // A full page means there is probably more; a short one means the book ended.
  return { scored, read: people.length, nextAfterId: people.length < pageSize ? null : lastId };
}
