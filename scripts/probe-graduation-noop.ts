// What a night of sp_CreditScoringAndGraduation actually does to Micromart's book.
//
// Answers three questions the fix depends on:
//   1. How much of LoanGraduationHistory is a real move vs a no-op vs a DEMOTION?
//   2. Would tonight's run move anybody, or just re-stamp the same numbers?
//   3. Is `NewLoanLimit = CurrentLoanLimit` enough of a guard, or does it need `<=`?
//
// Read-only, through the relay. Replicates the proc's candidate logic verbatim
// (2 cleared loans, equal principal, score > 50) so the counts are the real ones.
import "dotenv/config";
import { getOrg } from "../src/lib/enterprise/connections";
import { runReadOnlyQuery, type QueryParam } from "../src/lib/enterprise/mssql";

const org = getOrg("micromart")!;
const q = async (sql: string, params: QueryParam[] = []) =>
  (await runReadOnlyQuery(org, sql, params, { timeoutMs: 120_000 })).rows;

const n = (v: unknown) => Number(v ?? 0).toLocaleString();

async function main() {
  console.log("── LoanGraduationHistory, by what the row actually did ──\n");
  const shape = await q(`
    SELECT EntityId,
           SUM(CASE WHEN NewLimit > PreviousLimit THEN 1 ELSE 0 END) AS moved_up,
           SUM(CASE WHEN NewLimit = PreviousLimit THEN 1 ELSE 0 END) AS no_change,
           SUM(CASE WHEN NewLimit < PreviousLimit THEN 1 ELSE 0 END) AS moved_down,
           COUNT(*) AS total,
           COUNT(DISTINCT BorrowerId) AS borrowers
      FROM dbo.LoanGraduationHistory
     GROUP BY EntityId ORDER BY EntityId`);
  for (const r of shape) {
    const pct = (x: unknown) => ((Number(x) / Number(r.total)) * 100).toFixed(1) + "%";
    console.log(`entity ${r.EntityId} · ${n(r.total)} rows · ${n(r.borrowers)} borrowers`);
    console.log(`   up   ${n(r.moved_up).padStart(9)}  ${pct(r.moved_up)}`);
    console.log(`   same ${n(r.no_change).padStart(9)}  ${pct(r.no_change)}`);
    console.log(`   DOWN ${n(r.moved_down).padStart(9)}  ${pct(r.moved_down)}\n`);
  }

  console.log("── what tonight's run would do (proc's own candidate logic) ──\n");
  for (const entity of [3002, 3005]) {
    const rows = await q(
      `WITH LastTwo AS (
         SELECT l.BorrowerId, l.Principal,
                ROW_NUMBER() OVER (PARTITION BY l.BorrowerId
                                   ORDER BY l.ExpectedClearDate DESC, l.BorrowDate DESC, l.id DESC) AS rn
           FROM serviceconnect.dbo.loans l
          WHERE l.LoanCleared = 1 AND l.EntityId = @e
       ), Chk AS (
         SELECT BorrowerId, COUNT(*) AS cnt, MIN(Principal) AS mn, MAX(Principal) AS mx
           FROM LastTwo WHERE rn <= 2 GROUP BY BorrowerId
       ), Cand AS (
         SELECT b.ID, ISNULL(b.LoanLimit,0) AS CurrentLimit, c.mx AS LastPrincipal,
                CASE WHEN b.RiskScore > 76 THEN 30.0
                     WHEN b.RiskScore BETWEEN 51 AND 76 THEN 15.0 ELSE 0.0 END AS pct
           FROM serviceconnect.dbo.borrowers b
           JOIN Chk c ON c.BorrowerId = b.ID
          WHERE b.EntityId = @e AND c.cnt >= 2 AND c.mn = c.mx AND ISNULL(b.RiskScore,0) > 50
       ), Calc AS (
         SELECT ID, CurrentLimit,
                LastPrincipal + CASE WHEN (LastPrincipal * pct / 100) > 5000
                                     THEN 5000 ELSE (LastPrincipal * pct / 100) END AS NewLimit
           FROM Cand WHERE pct > 0
       )
       SELECT COUNT(*) AS candidates,
              SUM(CASE WHEN NewLimit > CurrentLimit THEN 1 ELSE 0 END) AS real_up,
              SUM(CASE WHEN NewLimit = CurrentLimit THEN 1 ELSE 0 END) AS noop,
              SUM(CASE WHEN NewLimit < CurrentLimit THEN 1 ELSE 0 END) AS demote,
              SUM(CASE WHEN NewLimit < CurrentLimit THEN CurrentLimit - NewLimit ELSE 0 END) AS kes_removed
         FROM Calc`,
      [{ name: "e", type: (await import("../src/lib/enterprise/mssql")).mssql.Int, value: entity }],
    );
    const r = rows[0];
    console.log(`entity ${entity} · ${n(r.candidates)} candidates tonight`);
    console.log(`   would rise    ${n(r.real_up).padStart(7)}`);
    console.log(`   no change     ${n(r.noop).padStart(7)}   <- pure noise`);
    console.log(`   would DROP    ${n(r.demote).padStart(7)}   KES ${n(r.kes_removed)} of limit removed\n`);
  }
}
main().catch((e) => { console.error("FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
