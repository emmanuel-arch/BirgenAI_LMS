// Does the graduation UPDATE actually persist? Compare each borrower's current
// LoanLimit with the NewLimit the proc last wrote for them.
import "dotenv/config";
import { getOrg } from "../src/lib/enterprise/connections";
import { runReadOnlyQuery } from "../src/lib/enterprise/mssql";
const org = getOrg("micromart")!;
const n = (v: unknown) => Number(v ?? 0).toLocaleString();
(async () => {
  for (const e of [3002, 3005]) {
    const r = (await runReadOnlyQuery(org, `
      WITH Newest AS (
        SELECT h.BorrowerId, h.NewLimit,
               ROW_NUMBER() OVER (PARTITION BY h.BorrowerId ORDER BY h.GraduationDate DESC) rn
          FROM dbo.LoanGraduationHistory h WHERE h.EntityId=${e}
      )
      SELECT COUNT(*) AS borrowers,
             SUM(CASE WHEN ISNULL(b.LoanLimit,0) = nw.NewLimit THEN 1 ELSE 0 END) AS agrees,
             SUM(CASE WHEN ISNULL(b.LoanLimit,0) = 0 AND nw.NewLimit > 0 THEN 1 ELSE 0 END) AS wiped_to_zero,
             SUM(CASE WHEN ISNULL(b.LoanLimit,0) <> 0 AND ISNULL(b.LoanLimit,0) <> nw.NewLimit THEN 1 ELSE 0 END) AS other_value,
             SUM(CASE WHEN ISNULL(b.LoanLimit,0)=0 AND nw.NewLimit>0 THEN nw.NewLimit ELSE 0 END) AS kes_owed
        FROM Newest nw
        JOIN serviceconnect.dbo.borrowers b ON b.ID = nw.BorrowerId
       WHERE nw.rn = 1 AND b.EntityId = ${e}`, [], { timeoutMs: 180_000 })).rows[0];
    console.log(`\nentity ${e} · ${n(r.borrowers)} borrowers with graduation history`);
    console.log(`   limit matches what the proc last wrote : ${n(r.agrees)}`);
    console.log(`   proc wrote a limit, row now reads ZERO  : ${n(r.wiped_to_zero)}   (KES ${n(r.kes_owed)} of earned limit missing)`);
    console.log(`   row holds some other value              : ${n(r.other_value)}`);
  }
})().catch((e) => { console.error("FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
