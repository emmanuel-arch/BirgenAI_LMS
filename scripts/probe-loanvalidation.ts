// What does the lender's own gate actually require?
//
// dbo.LoanValidation refused our rehearsal with "code 2: Insufficient account
// balance to cover loan charges". Making charges deduct-from-principal on OUR side
// only helps if THEIR gate reads the fee's type too — otherwise the console stops
// asking for the money and sp_InsertLoan still refuses. READ-ONLY.
import "dotenv/config";
import mssql from "mssql";
import { runReadOnlyQuery } from "../src/lib/enterprise/mssql";
import { getPostingOrg, getEntityId } from "../src/lib/enterprise/connections";

async function main() {
  const org = getPostingOrg("micromart")!;
  const eid = getEntityId(org);

  for (const name of ["LoanValidation", "sp_InsertLoan"]) {
    console.log(`\n================ ${name} ================`);
    try {
      const r = await runReadOnlyQuery(org,
        `SELECT m.definition FROM sys.sql_modules m
         JOIN sys.objects o ON o.object_id = m.object_id
         WHERE o.name = @n`,
        [{ name: "n", type: mssql.NVarChar(128), value: name }], { timeoutMs: 30000 });
      const def = String(r.rows[0]?.definition ?? "");
      if (!def) { console.log("  (no definition returned)"); continue; }

      // Only the fee/balance logic matters here, so print the lines that mention it
      // rather than several hundred lines of unrelated SQL.
      const lines = def.split(/\r?\n/);
      const hits = lines
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => /FeeType|ProductFees|Savings|Balance|charge|Code\s*=\s*2|AccountBalance/i.test(l));
      console.log(`  ${lines.length} lines; ${hits.length} mention fees/balance:`);
      for (const { l, i } of hits.slice(0, 60)) console.log(`   ${String(i + 1).padStart(4)}: ${l.trim().slice(0, 160)}`);
    } catch (e) {
      console.log("  FAIL:", e instanceof Error ? e.message : e);
    }
  }

  console.log(`\n================ ProductFees.FeeType on entity ${eid} ================`);
  console.log("  1 = before disbursement (must be pre-funded) · 2 = deducted from principal · 3 = on installments");
  try {
    const r = await runReadOnlyQuery(org,
      `SELECT f.ID, f.ProductId, f.FeeName, f.FeeValue, f.FeeValueType, f.FeeType
       FROM ProductFees f JOIN Products p ON p.ID = f.ProductId
       WHERE p.EntityId = @e ORDER BY f.ProductId, f.ID`,
      [{ name: "e", type: mssql.Int, value: eid }], { timeoutMs: 30000 });
    for (const x of r.rows) console.log(`  product ${x.ProductId}  ${String(x.FeeName).padEnd(24)} FeeType=${x.FeeType}`);
  } catch (e) { console.log("  FAIL:", e instanceof Error ? e.message : e); }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
