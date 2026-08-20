// ─────────────────────────────────────────────────────────────────────────────
// ADD StaffUser.dob AND StaffUser.access — by hand, and here is why.
//
//   npx tsx scripts/add-staff-access.ts            # report what it would do
//   npx tsx scripts/add-staff-access.ts --commit
//
// `prisma db push` refuses to apply these two additive columns without
// `--accept-data-loss`, because the live database contains two tables that are
// NOT in schema.prisma — `AllocationPolicy` (1 row) and `MarketplaceListing`
// (2 rows) — and push wants to drop them to make the database match the file.
//
// That is pre-existing drift and has nothing to do with these columns. Passing
// the flag to get an unrelated migration through would delete three rows of
// somebody's data as a side effect of adding a column, which is exactly the
// class of accident that flag exists to make you think about.
//
// So the two columns go on directly, with IF NOT EXISTS so re-running is safe,
// and the drift is left alone for whoever owns those tables to resolve. Once it
// is resolved, `prisma db push` works again and this script can be deleted.
//
// Both statements are additive: a nullable column, and a NOT NULL column with a
// default, which Postgres backfills without rewriting the table.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { Client } from "pg";

const COMMIT = process.argv.includes("--commit");

const STATEMENTS = [
  `ALTER TABLE "StaffUser" ADD COLUMN IF NOT EXISTS "dob" TIMESTAMP(3)`,
  `ALTER TABLE "StaffUser" ADD COLUMN IF NOT EXISTS "access" JSONB NOT NULL DEFAULT '{}'`,
];

async function main() {
  // The DIRECT url, not the pooler: DDL through a transaction pooler is the
  // classic way to get a statement that appears to succeed and never lands.
  const client = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
  await client.connect();

  console.log(`\nStaffUser columns — ${COMMIT ? "COMMIT" : "DRY RUN (nothing will be written)"}\n`);

  const look = async () =>
    (
      await client.query<{ column_name: string; data_type: string }>(
        `SELECT column_name, data_type FROM information_schema.columns
          WHERE table_name = 'StaffUser' AND column_name IN ('dob','access')`,
      )
    ).rows;

  const before = await look();
  console.log(`  present now: ${before.length ? before.map((c) => `${c.column_name}(${c.data_type})`).join(", ") : "neither"}`);

  for (const sql of STATEMENTS) console.log(`  ${COMMIT ? "→" : "·"} ${sql}`);

  if (!COMMIT) {
    console.log(`\n  Nothing written. Re-run with --commit.\n`);
    await client.end();
    return;
  }

  for (const sql of STATEMENTS) await client.query(sql);

  const after = await look();
  console.log(`\n  present after: ${after.map((c) => `${c.column_name}(${c.data_type})`).join(", ")}`);
  console.log(`\n  Now run: npx prisma generate\n`);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
