// ─────────────────────────────────────────────────────────────────────────────
// Does our ladder agree with the lender's?
//
// lib/lending/ladder.ts restates sp_CreditScoringAndGraduation in TypeScript so
// the app can explain a limit without running the lender's write path. That is
// only worth anything if the two produce the SAME number, and the only way to
// know is to recompute the score for real borrowers and compare it against the
// RiskScore their procedure actually wrote to Borrowers.
//
//   npx tsx scripts/verify-ladder.mts
//
// It writes nothing. The procedure is never executed — it updates limits inside
// a transaction for a whole entity, and that is the lender's job to run.
//
// A MISMATCH HERE MEANS OUR FILE IS WRONG, not theirs. Their number is the one
// the customer's limit was actually set from.
//
// WHY "CLOSE" IS A BUCKET AND NOT A FAILURE. Their score was frozen when their
// job last ran (Borrowers.LastScoreUpdateDate); ours is computed now. The
// lateness rule measures an UNPAID instalment against TODAY, so a borrower who
// is still behind scores a little lower every day that passes. A small drift is
// therefore expected and correct — it is the score continuing to move after it
// was written down. A band disagreement or a gap beyond ~1.5 is not.
// ─────────────────────────────────────────────────────────────────────────────
import * as dotenv from "dotenv";
dotenv.config();

import { getOrg, getEntityId } from "../src/lib/enterprise/connections";
import { runReadOnlyQuery, mssql } from "../src/lib/enterprise/mssql";
import { scoreLoan, scoreBorrower, graduate, DEFAULT_LADDER, type LadderInstalment } from "../src/lib/lending/ladder";

const org = getOrg("micromart")!;
const entityId = getEntityId(org);
const SAMPLE = 25;

console.log(`\nLadder — ${org.name}, entity ${entityId}`);
console.log(
  `  policy: last ${DEFAULT_LADDER.lookbackClearedLoans} cleared · ` +
    `${DEFAULT_LADDER.weights.repaymentHistory * 100}/${DEFAULT_LADDER.weights.daysInArrears * 100} weights · ` +
    `bands >${DEFAULT_LADDER.riskBands[0].min} / >=${DEFAULT_LADDER.riskBands[1].min} · ` +
    `ceiling ${DEFAULT_LADDER.graduation.perStepCeiling}\n`,
);

// Borrowers their procedure has actually scored, with the two most recent
// cleared loans it would have looked at.
const { rows: subjects } = await runReadOnlyQuery(
  org,
  `SELECT TOP (${SAMPLE}) b.ID, b.RiskScore, b.RiskCategory, b.LoanLimit
   FROM Borrowers b
   WHERE b.EntityId = @entityId AND b.RiskScore IS NOT NULL AND b.LastScoreUpdateDate IS NOT NULL
   ORDER BY b.LastScoreUpdateDate DESC`,
  [{ name: "entityId", type: mssql.Int, value: entityId }],
  { timeoutMs: 45000, maxRows: SAMPLE },
);

let exact = 0;
let close = 0;
let off = 0;
const misses: string[] = [];

for (const s of subjects) {
  const borrowerId = Number(s.ID);
  const theirScore = Number(s.RiskScore);
  const theirBand = String(s.RiskCategory ?? "").trim();

  // The same two loans their procedure picks: most recent cleared, ordered by
  // ExpectedClearDate then BorrowDate then id — all descending.
  const { rows: loans } = await runReadOnlyQuery(
    org,
    `SELECT TOP (${DEFAULT_LADDER.lookbackClearedLoans}) l.id, l.Principal
     FROM Loans l
     WHERE l.BorrowerId = @b AND l.LoanCleared = 1 AND l.EntityId = @entityId
     ORDER BY l.ExpectedClearDate DESC, l.BorrowDate DESC, l.id DESC`,
    [
      { name: "b", type: mssql.Int, value: borrowerId },
      { name: "entityId", type: mssql.Int, value: entityId },
    ],
    { timeoutMs: 45000, maxRows: 10 },
  );
  if (loans.length === 0) continue;

  const ids = loans.map((l) => Number(l.id)).filter((n) => Number.isInteger(n));
  const { rows: sched } = await runReadOnlyQuery(
    org,
    `SELECT s.Loanid, s.AmountPaid, s.InstallmentAmount, s.ExpectedDueDate, s.dateofpayment
     FROM LoanSchedule s WHERE s.Loanid IN (${ids.join(",")})`,
    [],
    { timeoutMs: 45000, maxRows: 2000 },
  );

  const byLoan = new Map<number, LadderInstalment[]>();
  for (const r of sched) {
    const id = Number(r.Loanid);
    const list = byLoan.get(id) ?? [];
    list.push({
      installmentAmount: Number(r.InstallmentAmount ?? 0),
      amountPaid: Number(r.AmountPaid ?? 0),
      expectedDueDate: r.ExpectedDueDate as string,
      dateOfPayment: (r.dateofpayment as string) ?? null,
    });
    byLoan.set(id, list);
  }

  // Their LEFT JOIN keeps a cleared loan with no schedule rows as one group of
  // NULLs, which averages to 0 rather than dropping the loan. Mirrored here.
  const perLoan = ids.map((id) => scoreLoan(byLoan.get(id) ?? [], DEFAULT_LADDER));
  const mine = scoreBorrower(
    perLoan.map((l) => (l.count === 0 ? { repaymentHistory: 0, daysInArrears: 0, count: 1 } : l)),
    DEFAULT_LADDER,
  );

  const delta = Math.abs(mine.riskScore - theirScore);
  const bandOk = mine.riskBand === theirBand || theirBand === "";
  if (delta < 0.01 && bandOk) exact++;
  else if (delta <= 1.5 && bandOk) close++;
  else {
    off++;
    if (misses.length < 6) {
      misses.push(
        `    borrower ${borrowerId}: theirs ${theirScore} (${theirBand}) · ours ${mine.riskScore} (${mine.riskBand}) · ` +
          `Δ${delta.toFixed(2)} · loans ${ids.join(",")} · instalments ${mine.instalmentsUsed}`,
      );
    }
  }
}

const n = exact + close + off;
console.log(`  compared ${n} scored borrowers`);
console.log(`    exact  (Δ<0.01): ${exact}`);
console.log(`    close  (Δ≤1.50): ${close}`);
console.log(`    off            : ${off}`);
if (misses.length) {
  console.log("\n  worst disagreements:");
  for (const m of misses) console.log(m);
}

// The graduation arithmetic is exact and needs no sampling — it is the part a
// screen quotes at a customer, so it is pinned here.
console.log("\n  graduation arithmetic");
const cases: [string, Parameters<typeof graduate>[0], Partial<ReturnType<typeof graduate>>][] = [
  [
    "score 80, two equal cleared, 10,000 → +30% uncapped",
    { riskScore: 80, clearedLoans: 2, clearedPrincipals: [10000, 10000], lastLoanPrincipal: 10000 },
    { eligible: true, percent: 30, increase: 3000, newLimit: 13000, cappedByCeiling: false },
  ],
  [
    "score 80, 50,000 → 30% is 15,000, ceiling pays 5,000",
    { riskScore: 80, clearedLoans: 2, clearedPrincipals: [50000, 50000], lastLoanPrincipal: 50000 },
    { eligible: true, percent: 30, increase: 5000, newLimit: 55000, cappedByCeiling: true },
  ],
  [
    "score 60 → the 15% band",
    { riskScore: 60, clearedLoans: 2, clearedPrincipals: [10000, 10000], lastLoanPrincipal: 10000 },
    { eligible: true, percent: 15, increase: 1500, newLimit: 11500, cappedByCeiling: false },
  ],
  [
    "score exactly 50 does NOT graduate (their rule is strictly above)",
    { riskScore: 50, clearedLoans: 2, clearedPrincipals: [10000, 10000], lastLoanPrincipal: 10000 },
    { eligible: false },
  ],
  [
    "unequal principals do not graduate",
    { riskScore: 90, clearedLoans: 2, clearedPrincipals: [10000, 20000], lastLoanPrincipal: 20000 },
    { eligible: false },
  ],
  [
    "one cleared loan is not enough",
    { riskScore: 90, clearedLoans: 1, clearedPrincipals: [10000], lastLoanPrincipal: 10000 },
    { eligible: false },
  ],
];

let gFail = 0;
for (const [label, input, want] of cases) {
  const got = graduate(input);
  const ok = Object.entries(want).every(([k, v]) => got[k as keyof typeof got] === v);
  console.log(ok ? `    \x1b[32mPASS\x1b[0m  ${label}` : `    \x1b[31mFAIL\x1b[0m  ${label} — got ${JSON.stringify(got)}`);
  if (!ok) gFail++;
}

const scoreOk = n > 0 && off === 0;
console.log(
  scoreOk && gFail === 0
    ? "\n\x1b[32mAll good\x1b[0m\n"
    : `\n\x1b[31m${off} score mismatches, ${gFail} graduation failures\x1b[0m\n`,
);
process.exit(scoreOk && gFail === 0 ? 0 : 1);
