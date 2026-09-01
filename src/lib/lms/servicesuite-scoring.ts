// ─────────────────────────────────────────────────────────────────────────────
// THE LENDER'S REPAYMENT RECORD, IN THE SHAPE OUR SCORING ENGINE ALREADY EATS.
//
// ── THE PROBLEM THIS FIXES ───────────────────────────────────────────────────
// A bridged lender's customers are read through to their ServiceSuite and only
// get a Postgres row when an officer opens one (see borrowers/resolve). That row
// has no loans, because we did not originate them. So every engine downstream —
// the behavioural scorer, the graduation ladder, the four risk bands — was
// looking at a borrower with zero instalments and correctly concluding it had
// nothing to say.
//
// What filled the silence was worse than silence. The resolve step copied
// ServiceSuite's `Borrowers.CreditScore` into our `creditScore`, which is read as
// a 300–900 figure; on Micromart's book that column carries values like 4,500,
// and 4,500 clears the PRIME floor of 750 by a mile. Every such customer
// rendered as "pays on time, every time" on the strength of a number from a
// scale nobody had checked — a borrower 47 days in arrears could read as the
// best customer on the book.
//
// The honest fix is not a better guess. It is to score the repayment record that
// has been sitting in their database for years: ~2M instalments across entity
// 3005. This module reads that record and hands back `LoanFact[]` — the exact
// input `scoreBehaviour()` and `assessLadder()` already take from Postgres — so
// the SAME engine, the SAME credit policy and the SAME four bands answer for a
// bridged lender as for a native one. Nothing downstream learns there are two
// books.
//
// ── THE THREE THINGS THIS SCHEMA WILL PUNISH YOU FOR ─────────────────────────
//
//  1. NEVER FILTER LoanSchedule BY EntityId. Entity 3005 was split out of 3002
//     and the transfer left 298,202 child rows carrying the old id; the column
//     is populated inconsistently besides. The LOAN establishes the entity.
//     Joining the schedule on `Loanid` alone is not laziness — it is the only
//     way to see a customer's whole history.
//
//  2. READ THE LOANS FIRST, THEN THE SCHEDULE IN ONE PASS. `Loanid` has no
//     usable index, so the natural OUTER APPLY shape measured ~6,000ms for five
//     rows. Two queries — a handful of loan ids, then one IN() over the schedule
//     — is the difference between a page and a timeout.
//
//  3. SCORE ON `InstallmentAmount`, NOT `amounttopay`. Both exist, and they
//     answer different questions. The lender's own sp_CreditScoringAndGraduation
//     divides paid by InstallmentAmount, and our ladder was verified against
//     what that procedure actually wrote (npm run test:ladder — 25 real
//     borrowers, 0 mismatches). Arrears is the other question, and
//     `amounttopay - AmountPaid` is its only correct form; that lives in
//     servicesuite-loans.ts and stays there.
// ─────────────────────────────────────────────────────────────────────────────
import { runReadOnlyQuery, mssql, type QueryParam } from "@/lib/enterprise/mssql";
import { type OrgDef } from "@/lib/enterprise/connections";
import type { LoanFact, InstallmentFact } from "@/lib/scoring/behaviour";

/**
 * Does this deployment record WHEN a loan cleared?
 *
 * Micromart's box has `Loans.DateCleared`; Axe's does not — same product, two
 * schemas, found by running against both rather than by reading either. Recency
 * decay weights recent loans more heavily, so the date genuinely matters; where
 * it is absent we fall back to the borrow date, which is the closest honest
 * answer rather than a null that would flatten the decay to nothing.
 *
 * Detected once per connection and cached, like the studio's capability probe.
 */
const CLEARED_DATE_CACHE = new Map<string, Promise<boolean>>();

function hasDateCleared(org: OrgDef): Promise<boolean> {
  const key = (org as { slug?: string }).slug ?? "default";
  const hit = CLEARED_DATE_CACHE.get(key);
  if (hit) return hit;
  const p = runReadOnlyQuery(
    org,
    `SELECT CASE WHEN COL_LENGTH('Serviceconnect.dbo.Loans','DateCleared') IS NULL THEN 0 ELSE 1 END AS a`,
    [],
    { timeoutMs: 15000, maxRows: 1 },
  )
    .then(({ rows }) => Number(rows[0]?.a ?? 0) === 1)
    // A probe that cannot answer must not decide the schema. False is the shape
    // every deployment supports.
    .catch(() => false);
  CLEARED_DATE_CACHE.set(key, p);
  return p;
}

/**
 * A SQL Server date as the calendar date it actually is.
 *
 * The driver returns `date` at LOCAL midnight, so in Nairobi (UTC+3) a due date
 * of the 7th arrives as 2026-09-06T21:00:00Z. Scoring counts the days between a
 * due date and a payment date — an hours-level skew across every instalment
 * moves people between lateness bands, which moves their band, which moves their
 * limit. Rebuilt from the local parts, so the date means the day it says.
 */
function localDate(v: unknown): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export type LiveFactsOptions = {
  /** How many loans back to read. Mirrors the credit policy's lookback window. */
  lookback?: number;
  /** Include the loan still being repaid — its instalments can still move a score. */
  includeActive?: boolean;
};

/**
 * One live customer's loans, as scoring facts.
 *
 * Newest first, because every consumer of LoanFact[] treats position 0 as the
 * most recent loan and decays recency from there.
 */
export async function liveLoanFacts(
  org: OrgDef,
  entityId: number,
  serviceSuiteBorrowerId: number,
  opts: LiveFactsOptions = {},
): Promise<LoanFact[]> {
  const lookback = Math.min(Math.max(opts.lookback ?? 4, 1), 12);
  const includeActive = opts.includeActive ?? true;
  const dateCleared = await hasDateCleared(org);

  const params: QueryParam[] = [
    { name: "borrowerId", type: mssql.Int, value: serviceSuiteBorrowerId },
    { name: "entityId", type: mssql.Int, value: entityId },
  ];

  // The entity IS asserted here, on the PARENT, and must be: borrower ids only
  // mean something within an entity — 3002 and 3005 hold different people — so a
  // loan list not scoped to the book we are standing in would be somebody else's
  // repayment record rendered under this customer's name.
  const { rows: loanRows } = await runReadOnlyQuery(
    org,
    `SELECT TOP (${lookback + 2})
            l.id, l.Principal, l.LoanCleared, l.BorrowDate${dateCleared ? ", l.DateCleared" : ""}
     FROM Loans l
     WHERE l.BorrowerId = @borrowerId
       AND l.EntityId = @entityId
       AND l.isApproved = 1
       ${includeActive ? "" : "AND l.LoanCleared = 1"}
     ORDER BY l.id DESC`,
    params,
    { timeoutMs: 30000, maxRows: 32 },
  );
  if (loanRows.length === 0) return [];

  // Ids come straight out of TOP(n) on a primary key and are never user input,
  // so the IN() list is built rather than parameterised. Filtered to finite
  // positive integers anyway, because "never" is a claim about today's callers.
  const ids = loanRows.map((r) => Number(r.id)).filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return [];

  // ONE pass over the schedule for every loan at once — see note 2 above. No
  // EntityId, and no join back to Loans — see note 1.
  const { rows: sched } = await runReadOnlyQuery(
    org,
    `SELECT s.Loanid, s.InstallmentAmount, s.AmountPaid, s.ExpectedDueDate, s.dateofpayment
     FROM LoanSchedule s
     WHERE s.Loanid IN (${ids.join(",")})
     ORDER BY s.Loanid, s.ExpectedDueDate`,
    [],
    { timeoutMs: 45000, maxRows: 4000 },
  );

  const byLoan = new Map<number, InstallmentFact[]>();
  for (const r of sched) {
    const loanId = Number(r.Loanid);
    const due = localDate(r.ExpectedDueDate);
    // An instalment with no due date cannot be scored for lateness, and counting
    // it would score it as on time. Dropped rather than flattered.
    if (!Number.isFinite(loanId) || !due) continue;
    const list = byLoan.get(loanId) ?? [];
    list.push({
      // The schedule carries no instalment number, so position in date order IS
      // the sequence. Every consumer uses `seq` for ordering and nothing else.
      seq: list.length + 1,
      amountDue: Number(r.InstallmentAmount ?? 0),
      amountPaid: Number(r.AmountPaid ?? 0),
      dueDate: due,
      paidAt: localDate(r.dateofpayment),
    });
    byLoan.set(loanId, list);
  }

  const facts: LoanFact[] = [];
  for (const r of loanRows) {
    const id = Number(r.id);
    const installments = byLoan.get(id) ?? [];
    // A loan with no schedule contributes nothing but would still consume a slot
    // in the lookback window, quietly shortening it.
    if (installments.length === 0) continue;
    const cleared = Number(r.LoanCleared ?? 0) === 1;
    const borrowDate = localDate(r.BorrowDate);
    facts.push({
      // Namespaced for the same reason every other live id is: it is a
      // ServiceSuite integer, not an LMS uuid, and the two must never be
      // confusable in a log line or a foreign key.
      id: `ss:${id}`,
      principal: Number(r.Principal ?? 0),
      status: cleared ? "CLEARED" : "ACTIVE",
      clearedAt: cleared ? (dateCleared ? localDate(r.DateCleared) : borrowDate) : null,
      // Their book holds loans with no BorrowDate. The engine sorts and decays on
      // it, so the last instalment's due date is the closest true stand-in.
      borrowDate: borrowDate ?? installments[installments.length - 1].dueDate,
      installments,
    });
  }
  return facts;
}
