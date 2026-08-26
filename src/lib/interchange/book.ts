// ─────────────────────────────────────────────────────────────────────────────
// THE MEMBER'S OWN BOOK — the inside of the tokenisation boundary.
//
// This file reads live Serviceconnect and returns, for each borrower with money
// still owed, the aggregates the ecosystem is allowed to know plus the raw
// identifier needed to derive their subject token. It is the ONLY file in the
// Interchange path that ever holds a national ID, and nothing it returns should
// leave this process un-tokenised. Callers must map `identifier` through the
// OPRF and then drop it — see scripts/interchange-publish.ts.
//
// ── THE MEMBER IS AN ENTITY, NOT A COMPANY ───────────────────────────────────
// Axe runs TWO books on one server — Boresha (3003) and Stawi (3004) — and
// Micromart runs three. Each EntityId is a separate borrower population with
// separate phone numbers, and on the shared .198 server ten unrelated companies
// are separated by nothing else. So every read here is scoped to one EntityId
// and the scope is a parameter, never a default: a query that forgets it does
// not return slightly too much, it returns another company's book.
//
// ── WHAT COUNTS AS EXPOSURE ──────────────────────────────────────────────────
// Approved, not cleared, and a balance above zero. `isApproved = 0` is an
// application rather than a debt; `LoanCleared = 1` is finished; a zero balance
// is settled but not yet flagged. Any of the three counted as exposure would
// tell another lender this person owes money they do not owe, and a declined
// applicant is not a borrower.
// ─────────────────────────────────────────────────────────────────────────────
import mssql from "mssql";
import { runReadOnlyQuery } from "@/lib/enterprise/mssql";
import type { OrgDef } from "@/lib/enterprise/connections";
import { normaliseNationalId } from "./oprf";

/** One borrower's position with this member. Identifier is INSIDE the boundary. */
export type BookRow = {
  /** Raw national ID, straight from Serviceconnect. Never persist, never log. */
  identifier: string;
  activeLoans: number;
  outstandingKes: number;
  worstBucket: Bucket;
  newestDisbursedAt: Date | null;
};

export type Bucket = "prepayment" | "due" | "watch_1" | "watch_2" | "watch_3" | "npl";

export type BookRead = {
  rows: BookRow[];
  /** Borrowers with open money but no usable national ID — they cannot be tokenised. */
  skippedNoIdentifier: number;
  elapsedMs: number;
};

/**
 * Days past the expected clear date → the CollectBox collections ladder.
 *
 * The bands are CollectBox's own (dbo.LoanCategories, mirrored in
 * lib/collectbox/taxonomy.ts) so a bucket means the same thing on the exposure
 * report as it does on the collections floor. A negative figure is a loan that
 * has not reached its clear date; it maps to the least severe rung because for
 * exposure the only question that rung answers is "is anything late here".
 */
export function bucketForDpd(dpd: number): Bucket {
  if (dpd > 90) return "npl";
  if (dpd > 60) return "watch_3";
  if (dpd > 30) return "watch_2";
  if (dpd > 0) return "watch_1";
  if (dpd === 0) return "due";
  return "prepayment";
}

/**
 * Re-exported from the identity boundary rather than defined here.
 *
 * It used to live in this file, and that was the bug: the ingest normalised and
 * the serving path did not, so the same borrower got two different tokens and
 * their exposure silently vanished. There is now exactly one normaliser, it sits
 * next to the OPRF, and every derive path runs through it.
 */
export { normaliseNationalId } from "./oprf";

/**
 * Read one entity's live exposure book.
 *
 * Grouped by national ID rather than by borrower row on purpose: a person who
 * was onboarded twice has two Borrowers rows and one real exposure, and the
 * ecosystem should be told the truth about the person.
 */
export async function readBook(
  org: OrgDef,
  entityId: number,
  opts: { timeoutMs?: number; maxRows?: number } = {},
): Promise<BookRead> {
  const started = Date.now();

  const { rows } = await runReadOnlyQuery(
    org,
    `SELECT b.NationalID                                        AS identifier,
            COUNT(l.ID)                                         AS activeLoans,
            SUM(CAST(l.LoanBalance AS BIGINT))                  AS outstandingKes,
            MAX(l.BorrowDate)                                   AS newestDisbursedAt,
            MAX(DATEDIFF(day, l.ExpectedClearDate, GETDATE()))  AS worstDpd
       FROM Loans l
       JOIN Borrowers b ON b.ID = l.BorrowerId AND b.EntityId = l.EntityId
      WHERE l.EntityId = @entityId
        AND l.isApproved = 1
        AND l.LoanCleared = 0
        AND l.LoanBalance > 0
        AND b.NationalID IS NOT NULL
        AND LTRIM(RTRIM(b.NationalID)) <> ''
      GROUP BY b.NationalID`,
    [{ name: "entityId", type: mssql.Int, value: entityId }],
    // A book read is a batch job, not a page render: it gets minutes, and a cap
    // high enough that a large member is never silently truncated. Micromart
    // Africa's entity alone carries ~59k open loans.
    { timeoutMs: opts.timeoutMs ?? 180_000, maxRows: opts.maxRows ?? 500_000 },
  );

  const out: BookRow[] = [];
  let skipped = 0;

  for (const r of rows) {
    const identifier = normaliseNationalId(r.identifier);
    if (!identifier) {
      skipped++;
      continue;
    }
    const outstanding = Math.round(Number(r.outstandingKes ?? 0));
    out.push({
      identifier,
      activeLoans: Number(r.activeLoans ?? 0),
      // Clamped because MemberHolding.outstandingKes is a 32-bit int, and a
      // corrupt balance in one row should not fail an entire publication.
      outstandingKes: Math.max(0, Math.min(outstanding, 2_147_483_647)),
      worstBucket: bucketForDpd(Number(r.worstDpd ?? 0)),
      newestDisbursedAt: r.newestDisbursedAt instanceof Date ? r.newestDisbursedAt : null,
    });
  }

  return { rows: out, skippedNoIdentifier: skipped, elapsedMs: Date.now() - started };
}

/** Headline contribution figures for the Registry's reciprocity check. */
export async function bookSummary(org: OrgDef, entityId: number) {
  const { rows } = await runReadOnlyQuery(
    org,
    `SELECT (SELECT COUNT(*) FROM Borrowers WHERE EntityId = @entityId) AS borrowers,
            (SELECT COUNT(*) FROM Loans WHERE EntityId = @entityId AND isApproved = 1) AS loans,
            (SELECT MAX(BorrowDate) FROM Loans WHERE EntityId = @entityId AND isApproved = 1) AS lastLoanAt`,
    [{ name: "entityId", type: mssql.Int, value: entityId }],
    { timeoutMs: 60_000 },
  );
  const r = rows[0] ?? {};
  return {
    borrowers: Number(r.borrowers ?? 0),
    loans: Number(r.loans ?? 0),
    lastLoanAt: r.lastLoanAt instanceof Date ? r.lastLoanAt : null,
  };
}
