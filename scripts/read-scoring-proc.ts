// Read a stored procedure out of Micromart's live database, so this platform's
// graduation ladder can be checked against the one their book actually runs
// rather than against a description of it.
//
//   npx tsx scripts/read-scoring-proc.ts --list
//   npx tsx scripts/read-scoring-proc.ts --name=sp_CreditScoringAndGraduation
//
// Read-only, through the SQL relay like every other live read.
//
// NOTE: runReadOnlyQuery returns a QueryResult ({ columns, rows, rowCount }),
// NOT an array. Iterating the result object directly yields nothing and reports
// "(none)" for a database full of matches — which is exactly how the first run
// of this script concluded the procedure did not exist.
import "dotenv/config";
import { getOrg, getEntityId } from "../src/lib/enterprise/connections";
import { runReadOnlyQuery, mssql, type QueryParam } from "../src/lib/enterprise/mssql";

const arg = (k: string, d = "") =>
  process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;

const ORG = arg("org", "micromart");
const NAME = arg("name", "sp_CreditScoringAndGraduation");
const LIST = process.argv.includes("--list");

async function main() {
  const org = getOrg(ORG);
  if (!org) {
    console.error(`No connection registered for org "${ORG}".`);
    process.exit(1);
  }
  const q = async (sql: string, params: QueryParam[] = []) =>
    (await runReadOnlyQuery(org, sql, params, { timeoutMs: 60_000 })).rows;

  const db = (await q(`SELECT DB_NAME() AS d`))[0]?.d;
  console.log(`org ${ORG} · entity ${getEntityId(org)} · database ${db}\n`);

  if (LIST) {
    const rows = await q(
      `SELECT o.name, o.type_desc, o.modify_date
         FROM sys.objects o
        WHERE o.type IN ('P','FN','IF','TF','V')
          AND (o.name LIKE '%Scor%' OR o.name LIKE '%Graduat%'
               OR o.name LIKE '%Limit%' OR o.name LIKE '%Ladder%' OR o.name LIKE '%Credit%')
        ORDER BY o.name`,
    );
    if (!rows.length) return console.log("(nothing matched)");
    for (const r of rows) {
      console.log(
        `${String(r.type_desc).padEnd(20)} ${String(r.name).padEnd(46)} ${new Date(r.modify_date as string).toISOString().slice(0, 10)}`,
      );
    }
    return;
  }

  const params = await q(
    `SELECT p.name, t.name AS type, p.is_output
       FROM sys.parameters p
       JOIN sys.types t ON t.user_type_id = p.user_type_id
      WHERE p.object_id = OBJECT_ID(@n)
      ORDER BY p.parameter_id`,
    [{ name: "n", type: mssql.NVarChar(200), value: NAME }],
  );
  console.log(`── ${NAME} — parameters ──`);
  if (!params.length) console.log("  (none, or not found)");
  for (const p of params) console.log(`  ${p.name} ${p.type}${p.is_output ? " OUTPUT" : ""}`);

  const def = await q(`SELECT OBJECT_DEFINITION(OBJECT_ID(@n)) AS body`, [
    { name: "n", type: mssql.NVarChar(200), value: NAME },
  ]);
  const body = (def[0]?.body as string | null) ?? null;
  if (!body) return console.log(`\n${NAME} not found, or encrypted.`);
  console.log(`\n── definition (${body.length} chars) ──\n`);
  console.log(body);
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
