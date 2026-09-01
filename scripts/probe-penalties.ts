// Discover how penalties are recorded in Micromart's live book.
//
//   npx tsx scripts/probe-penalties.ts [orgSlug]
//
// Read-only. Reads schema, the ServiceSuite procedure the Arrears report
// mirrors, and a shape sample — because guessing a column name here throws at
// query time in front of whoever is watching the report load.
import "dotenv/config";
import { ORGS, isOrgConfigured, type OrgSlug } from "../src/lib/enterprise/connections";
import { runReadOnlyQuery } from "../src/lib/enterprise/mssql";

const B = (s: string) => `\x1b[1m${s}\x1b[0m`;
const D = (s: string) => `\x1b[2m${s}\x1b[0m`;

async function main() {
  const slug = (process.argv[2] ?? "micromart-fintech") as OrgSlug;
  const org = ORGS[slug];
  if (!org) throw new Error(`Unknown org "${slug}".`);
  if (!isOrgConfigured(org)) throw new Error(`${org.name} not configured (${org.connEnv}).`);
  const q = (sql: string, max = 200) => runReadOnlyQuery(org, sql, [], { timeoutMs: 120000, maxRows: max });

  // 1 ── Anything named like a penalty, in BOTH databases.
  for (const db of ["Serviceconnect", "Transactions"]) {
    console.log(`\n${B(`${db} — columns matching penal/fine/charge/fee`)}`);
    const { rows } = await q(`
      SELECT TABLE_SCHEMA + '.' + TABLE_NAME AS tbl, COLUMN_NAME AS col, DATA_TYPE AS typ
        FROM ${db}.INFORMATION_SCHEMA.COLUMNS
       WHERE COLUMN_NAME LIKE '%penal%' OR COLUMN_NAME LIKE '%fine%'
          OR COLUMN_NAME LIKE '%charge%' OR COLUMN_NAME LIKE '%fee%'
       ORDER BY tbl, col`, 400);
    if (!rows.length) console.log(D("  none"));
    for (const r of rows) console.log(`  ${String(r.tbl).padEnd(38)} ${String(r.col).padEnd(28)} ${r.typ}`);

    console.log(`${B(`${db} — TABLES matching penal/fine/charge`)}`);
    const { rows: t } = await q(`
      SELECT TABLE_SCHEMA + '.' + TABLE_NAME AS tbl
        FROM ${db}.INFORMATION_SCHEMA.TABLES
       WHERE TABLE_NAME LIKE '%penal%' OR TABLE_NAME LIKE '%fine%' OR TABLE_NAME LIKE '%charge%'
       ORDER BY tbl`, 200);
    if (!t.length) console.log(D("  none"));
    for (const r of t) console.log(`  ${r.tbl}`);
  }

  // 2 ── What the Arrears report mirrors. How do THEY compute it?
  console.log(`\n${B("sp_arrearsLoans — source")}`);
  const { rows: src } = await q(`
    SELECT m.definition AS def
      FROM Serviceconnect.sys.sql_modules m
      JOIN Serviceconnect.sys.objects o ON o.object_id = m.object_id
     WHERE o.name = 'sp_arrearsLoans'`, 5);
  console.log(src.length ? String(src[0].def) : D("  not found"));

  // 3 ── The arrears table the report already joins.
  console.log(`\n${B("Transactions.dbo.LoansInArrears — full column list")}`);
  const { rows: ia } = await q(`
    SELECT COLUMN_NAME AS col, DATA_TYPE AS typ
      FROM Transactions.INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_NAME = 'LoansInArrears' ORDER BY ORDINAL_POSITION`, 200);
  for (const r of ia) console.log(`  ${String(r.col).padEnd(28)} ${r.typ}`);

  console.log("");
  process.exit(0);
}

main().catch((e) => { console.error(`\n✗ ${e.message}\n`); process.exit(1); });
