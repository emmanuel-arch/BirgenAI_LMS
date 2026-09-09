// When did Borrowers.LoanLimit start being wiped? The procedure records the
// limit it FOUND (PreviousLimit), so the day that value collapses to zero at
// scale is the day the wipe began.
import "dotenv/config";
import { getOrg } from "../src/lib/enterprise/connections";
import { runReadOnlyQuery } from "../src/lib/enterprise/mssql";
const org = getOrg("micromart")!;
(async () => {
  for (const e of [3002, 3005]) {
    console.log(`\n── entity ${e}: share of each run that found a ZERO limit ──`);
    const rows = (await runReadOnlyQuery(org, `
      SELECT CAST(GraduationDate AS DATE) AS d, COUNT(*) AS runs,
             SUM(CASE WHEN PreviousLimit = 0 THEN 1 ELSE 0 END) AS found_zero
        FROM dbo.LoanGraduationHistory WHERE EntityId = ${e}
       GROUP BY CAST(GraduationDate AS DATE) ORDER BY d`, [], { timeoutMs: 180_000 })).rows;
    let prev = -1;
    for (const r of rows) {
      const pct = Math.round((Number(r.found_zero) / Number(r.runs)) * 100);
      // print the first few days, and every day the picture changes by >20 points
      if (prev < 0 || Math.abs(pct - prev) >= 20 || rows.indexOf(r) < 3)
        console.log(`   ${String(r.d).slice(4, 15)}  runs ${String(r.runs).padStart(6)}  found-zero ${String(r.found_zero).padStart(6)}  ${String(pct).padStart(3)}%`);
      prev = pct;
    }
    const last = rows[rows.length - 1];
    console.log(`   (latest) ${String(last.d).slice(4,15)}  runs ${last.runs}  found-zero ${last.found_zero}`);
  }
})().catch((e) => { console.error("FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
