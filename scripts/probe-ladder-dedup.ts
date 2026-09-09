// Test the rung-collapsing logic before the portal depends on it.
import "dotenv/config";
import { getOrg } from "../src/lib/enterprise/connections";
import { runReadOnlyQuery, mssql } from "../src/lib/enterprise/mssql";
const org = getOrg("micromart")!;
const SQL = `
;WITH Ordered AS (
    SELECT h.BorrowerId, h.PreviousLimit, h.NewLimit, h.RiskScore, h.RiskCategory,
           h.GraduationPercentage, h.GraduationDate,
           ROW_NUMBER() OVER (PARTITION BY h.BorrowerId ORDER BY h.GraduationDate, h.Id) AS seq,
           LAG(h.NewLimit)      OVER (PARTITION BY h.BorrowerId ORDER BY h.GraduationDate, h.Id) AS PrevNewLimit,
           LAG(h.PreviousLimit) OVER (PARTITION BY h.BorrowerId ORDER BY h.GraduationDate, h.Id) AS PrevPrevLimit
      FROM dbo.LoanGraduationHistory h WHERE h.BorrowerId = @b
)
SELECT GraduationDate, PreviousLimit, NewLimit, NewLimit - PreviousLimit AS Movement,
       RiskScore, RiskCategory, GraduationPercentage
  FROM Ordered
 WHERE NewLimit <> PreviousLimit
   AND (seq = 1 OR PrevNewLimit <> NewLimit OR PrevPrevLimit <> PreviousLimit)
 ORDER BY GraduationDate DESC`;
(async () => {
  for (const b of [22, 136508, 140360]) {
    const raw = (await runReadOnlyQuery(org, `SELECT COUNT(*) c FROM dbo.LoanGraduationHistory WHERE BorrowerId=@b`,
      [{ name: "b", type: mssql.Int, value: b }], { timeoutMs: 60_000 })).rows[0];
    const rows = (await runReadOnlyQuery(org, SQL,
      [{ name: "b", type: mssql.Int, value: b }], { timeoutMs: 60_000 })).rows;
    console.log(`\n── borrower ${b}: ${raw.c} raw rows -> ${rows.length} rungs ──`);
    for (const r of rows.slice(0, 8))
      console.log(`   ${String(r.GraduationDate).slice(4,15)}  ${String(r.PreviousLimit).padStart(9)} -> ${String(r.NewLimit).padStart(9)}  (+${r.Movement})  score ${r.RiskScore} ${r.GraduationPercentage}%`);
    if (rows.length > 8) console.log(`   ... and ${rows.length - 8} more`);
  }
})().catch((e) => { console.error("FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
