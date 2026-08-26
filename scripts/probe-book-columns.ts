// Confirm the Serviceconnect columns the Interchange node ingest depends on.
//
//   npx tsx scripts/probe-book-columns.ts [orgSlug]
//
// Reading the schema beats assuming it. An invalid column name in an aggregate
// throws at query time, and the Sprint 2 post-mortem in the build plan is
// exactly that mistake made against an enum.
import "dotenv/config";
import { ORGS, isOrgConfigured, type OrgSlug } from "../src/lib/enterprise/connections";
import { runReadOnlyQuery } from "../src/lib/enterprise/mssql";

const WANTED: Record<string, string[]> = {
  Borrowers: ["ID", "EntityId", "NationalID", "PhoneNumber", "CreatedDate"],
  Loans: ["ID", "EntityId", "BorrowerId", "LoanBalance", "LoanAmount", "LoanCleared", "isApproved", "BorrowDate", "ExpectedClearDate"],
};

async function main() {
  const slug = (process.argv[2] ?? "micromart-fintech") as OrgSlug;
  const org = ORGS[slug];
  if (!org) throw new Error(`Unknown org "${slug}".`);
  if (!isOrgConfigured(org)) throw new Error(`${org.name} is not configured (${org.connEnv}).`);

  for (const [table, cols] of Object.entries(WANTED)) {
    const { rows } = await runReadOnlyQuery(
      org,
      `SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @t`,
      [{ name: "t", type: (await import("mssql")).default.NVarChar(128), value: table }],
      { timeoutMs: 20000, maxRows: 500 },
    );
    const have = new Map(rows.map((r) => [String(r.COLUMN_NAME).toLowerCase(), String(r.DATA_TYPE)]));
    console.log(`\n\x1b[1m${table}\x1b[0m \x1b[2m${rows.length} columns\x1b[0m`);
    for (const c of cols) {
      const t = have.get(c.toLowerCase());
      console.log(t ? `  \x1b[32m✓\x1b[0m ${c.padEnd(20)} ${t}` : `  \x1b[31m✗\x1b[0m ${c.padEnd(20)} NOT FOUND`);
    }
    // Anything that looks like an identifier we might have missed.
    const idish = [...have.keys()].filter((k) => /national|idno|idnumber|phone|msisdn|mobile/.test(k));
    if (idish.length) console.log(`  \x1b[2midentifier-ish: ${idish.join(", ")}\x1b[0m`);
  }
  console.log("");
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
