// Generate a drop-in ALTER PROCEDURE for sp_CreditScoringAndGraduation from the
// LIVE definition, so everything except the inserted guard is byte-identical to
// what is running now. Retyping an 18k-character procedure by hand is how a
// review comment becomes an outage.
//
//   npx tsx scripts/make-graduation-fix.ts
//
// Writes sql/micromart/sp_CreditScoringAndGraduation.fixed.sql. Applying it is a
// WRITE, which this machine cannot do (the relay is armed read-only) — run the
// generated file in SSMS so it lands in Micromart's own audit trail.
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { getOrg } from "../src/lib/enterprise/connections";
import { runReadOnlyQuery, mssql } from "../src/lib/enterprise/mssql";

const NAME = "sp_CreditScoringAndGraduation";
const OUT = "sql/micromart/sp_CreditScoringAndGraduation.fixed.sql";

/** Anchors must match EXACTLY once, or the live procedure has moved under us. */
function once(src: string, anchor: string, label: string): void {
  const n = src.split(anchor).length - 1;
  if (n !== 1)
    throw new Error(
      `anchor "${label}" matched ${n} times, expected exactly 1 — the live ` +
        `procedure has changed. Re-read it before trusting this generator.`,
    );
}
const insertBefore = (src: string, a: string, t: string, l: string) => (once(src, a, l), src.replace(a, t + a));
const insertAfter = (src: string, a: string, t: string, l: string) => (once(src, a, l), src.replace(a, a + t));

const DECLS = `
    -- ADDED: what the guard below skipped, so that a quiet night is legible
    -- rather than looking like a failed run.
    DECLARE @SkippedNoChange INT = 0;
    DECLARE @SkippedWouldDrop INT = 0;
`;

// Inserted at the top of the line holding the `IF @DebugMode = 1` that guards
// the candidate preview, so it ends with the indentation that line expects.
const GUARD = `---------------------------------------------------------------------
        -- ADDED: DO NOT RE-GRADUATE SOMEBODY TO THE LIMIT THEY ALREADY HOLD.
        --
        -- NewLoanLimit is a pure function of the LAST CLEARED PRINCIPAL and the
        -- risk band. It never reads the borrower's current limit, and the
        -- eligibility gate above never stops matching, so without this guard the
        -- same borrower is "graduated" to the same number every single night:
        -- GraduationCount counts cron runs instead of graduations,
        -- PreviousLoanLimit is overwritten with the value it already holds (so
        -- what the limit actually rose FROM is lost after the second run), and
        -- LoanGraduationHistory fills up with rows that record no movement.
        --
        -- '<=' rather than '=' on purpose. A borrower whose last two cleared
        -- loans were SMALLER than their current limit computes a NewLoanLimit
        -- BELOW it, and the unguarded UPDATE below silently cuts them — a
        -- demotion this ladder was never asked to perform and no customer is
        -- told about. Skipping leaves an officer's manual limit standing, which
        -- is the conservative direction.
        --
        -- NULL is skipped too. LastLoanPrincipal cannot be NULL for a candidate
        -- with two cleared loans, but if it ever were, the comparison would be
        -- UNKNOWN, the row would survive, and b.LoanLimit = NULL would wipe the
        -- limit outright.
        ---------------------------------------------------------------------
        SELECT
            @SkippedNoChange  = SUM(CASE WHEN NewLoanLimit = CurrentLoanLimit THEN 1 ELSE 0 END),
            @SkippedWouldDrop = SUM(CASE WHEN NewLoanLimit < CurrentLoanLimit THEN 1 ELSE 0 END)
        FROM #GraduationCandidates;

        IF OBJECT_ID('tempdb..#SkippedCandidates') IS NOT NULL DROP TABLE #SkippedCandidates;
        CREATE TABLE #SkippedCandidates (
            BorrowerId INT,
            CurrentLoanLimit DECIMAL(18,2),
            NewLoanLimit DECIMAL(18,2),
            RiskScore DECIMAL(5,2),
            Reason VARCHAR(30)
        );

        DELETE gc
        OUTPUT deleted.BorrowerId, deleted.CurrentLoanLimit, deleted.NewLoanLimit, deleted.RiskScore,
               CASE WHEN deleted.NewLoanLimit IS NULL THEN 'No principal to grow from'
                    WHEN deleted.NewLoanLimit < deleted.CurrentLoanLimit THEN 'Would have demoted'
                    ELSE 'Already at this limit' END
          INTO #SkippedCandidates (BorrowerId, CurrentLoanLimit, NewLoanLimit, RiskScore, Reason)
        FROM #GraduationCandidates AS gc
        WHERE gc.NewLoanLimit IS NULL
           OR gc.NewLoanLimit <= gc.CurrentLoanLimit;

        IF @DebugMode = 1
        BEGIN
            PRINT 'Skipped (already at that limit): ' + CAST(@SkippedNoChange AS VARCHAR)
                + ' | skipped (would have demoted): ' + CAST(@SkippedWouldDrop AS VARCHAR);
            SELECT TOP 50 * FROM #SkippedCandidates ORDER BY BorrowerId;
        END;

        `;

// Appended to the summary result set. The new columns go at the very END —
// after ScoringFramework, not before Status — so anything reading the existing
// four by ordinal keeps reading the same values.
const SUMMARY_ANCHOR = "'Simplified Matrix: Repayment History (50%) + Days in Arrears (50%)' AS ScoringFramework;";
const SUMMARY = `'Simplified Matrix: Repayment History (50%) + Days in Arrears (50%)' AS ScoringFramework,
            @SkippedNoChange AS SkippedAlreadyAtLimit,
            @SkippedWouldDrop AS SkippedWouldHaveDemoted;`;

const CLEANUP = `
        IF OBJECT_ID('tempdb..#SkippedCandidates') IS NOT NULL DROP TABLE #SkippedCandidates;`;

const HEADER = `/* ---------------------------------------------------------------------------
   sp_CreditScoringAndGraduation — no-op / demotion guard.

   Generated from the LIVE definition by scripts/make-graduation-fix.ts. Every
   line except the four inserted blocks is byte-identical to what is running
   now. The scoring maths, the bands, the cap and the gates are untouched.

   WHAT CHANGES
     A candidate whose computed NewLoanLimit is not strictly ABOVE the limit
     they already hold is dropped before anything is written. Nothing else.

   WHAT IT FIXES
     - GraduationCount becomes a count of graduations, not of nightly runs.
     - PreviousLoanLimit keeps the limit the borrower actually rose FROM.
     - LoanGraduationHistory records movements only, so it can be read as a
       ladder by staff and by the customer app.
     - Borrowers stop being silently DEMOTED when their last two cleared loans
       were smaller than an officer-set limit.

   WHAT IT DOES NOT DO
     It does not freeze anybody. Once a borrower clears two loans at their NEW
     principal, LastLoanPrincipal moves, NewLoanLimit rises above the current
     limit, and they graduate exactly as before.

     It also does NOT address entity 3002's real problem, which is that
     something OUTSIDE this procedure sets Borrowers.LoanLimit back to 0
     between runs. Under this guard those borrowers still re-graduate nightly,
     correctly — 0 -> 6500 is a genuine increase every time — because the
     procedure is repairing a wipe it did not cause. Find that writer before
     reading 3002's history as a ladder.

   Apply in SSMS: the relay this repo reads through is armed read-only, and a
   change made in ServiceSuite lands in Micromart's own audit trail.
   --------------------------------------------------------------------------- */

`;

async function main() {
  const org = getOrg("micromart");
  if (!org) throw new Error('no connection registered for org "micromart"');

  const rows = (
    await runReadOnlyQuery(org, `SELECT OBJECT_DEFINITION(OBJECT_ID(@n)) AS d`, [
      { name: "n", type: mssql.NVarChar(200), value: NAME },
    ], { timeoutMs: 60_000 })
  ).rows;
  const live = String(rows[0]?.d ?? "");
  if (!live) throw new Error("could not read the live definition");
  console.log(`live definition: ${live.length} chars`);

  let out = live;
  out = insertAfter(out, "DECLARE @ErrorMessage NVARCHAR(MAX);", DECLS, "declarations");
  // The guard belongs BEFORE the whole debug-preview block, not inside it, so
  // anchor on the unique PRINT and walk back to the `IF @DebugMode = 1` opening
  // that block. Inserting at the PRINT itself would land the guard between
  // BEGIN and its body and leave the BEGIN unmatched.
  const previewAnchor = "PRINT 'Graduation candidate preview:';";
  once(out, previewAnchor, "candidate preview");
  const ifAt = out.lastIndexOf("IF @DebugMode = 1", out.indexOf(previewAnchor));
  if (ifAt < 0) throw new Error("could not find the IF that opens the candidate preview block");
  out = out.slice(0, ifAt) + GUARD + out.slice(ifAt);
  once(out, SUMMARY_ANCHOR, "summary result set");
  out = out.replace(SUMMARY_ANCHOR, SUMMARY);
  // "DROP TABLE #GraduationCandidates;" appears twice — once in the defensive
  // drop at the top, once in the cleanup at the end. We want the cleanup.
  const dropAnchor = "DROP TABLE #GraduationCandidates;";
  const dropAt = out.lastIndexOf(dropAnchor);
  if (dropAt < 0) throw new Error("could not find the temp table cleanup");
  out = out.slice(0, dropAt + dropAnchor.length) + CLEANUP + out.slice(dropAt + dropAnchor.length);

  // CREATE -> ALTER so it replaces the running procedure rather than colliding.
  once(out, "CREATE PROCEDURE", "CREATE PROCEDURE");
  out = out.replace("CREATE PROCEDURE", "ALTER PROCEDURE");

  writeFileSync(OUT, HEADER + out.replace(/^[\r\n]+/, ""), "utf8");
  console.log(`wrote ${OUT} — +${out.length - live.length} chars vs live`);
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
