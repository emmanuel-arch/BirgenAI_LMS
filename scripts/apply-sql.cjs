// ─────────────────────────────────────────────────────────────────────────────
// APPLY AN IDEMPOTENT .sql FILE TO THIS DATABASE.
//
// `npm run db:push` fails with P1001 ("Can't reach database server") against the
// Supabase pooler on some machines while the SAME connection string works fine
// through the `pg` driver — both ports are open and the credentials are good. It
// is Prisma's native CLI connector, not the network. The app's own PrismaClient
// uses the pg driver adapter anyway, so schema deltas are applied here instead.
//
// DIRECT_URL, never DATABASE_URL: DDL must not go through the transaction
// pooler, which cannot hold the session state a CREATE TYPE needs.
//
// Every file this runs must be idempotent — CREATE TABLE IF NOT EXISTS, and
// enum/constraint creation wrapped in a DO block that swallows duplicate_object.
// This script is re-run, not migrated.
//
//   node scripts/apply-sql.cjs prisma/conversation.sql [Table1 Table2 ...]
//
// Any table names after the file are read back out of information_schema
// afterwards, because a write that is not read back is a write you hope
// happened.
// ─────────────────────────────────────────────────────────────────────────────
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const root = path.resolve(__dirname, "..");
const sqlPath = process.argv[2];
const verifyTables = process.argv.slice(3);

if (!sqlPath) {
  console.error("usage: node scripts/apply-sql.cjs <file.sql> [Table ...]");
  process.exit(1);
}

const envText = fs.readFileSync(path.join(root, ".env"), "utf8");
const m = envText.match(/^DIRECT_URL\s*=\s*"?([^"\r\n]+)"?/m);
if (!m) {
  console.error("DIRECT_URL not found in .env");
  process.exit(1);
}

const sql = fs.readFileSync(path.resolve(root, sqlPath), "utf8");

(async () => {
  const client = new Client({ connectionString: m[1], ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(sql);
    console.log(`applied ${sqlPath}`);

    if (verifyTables.length) {
      const r = await client.query(
        `SELECT table_name, column_name, data_type
           FROM information_schema.columns
          WHERE table_name = ANY($1::text[])
          ORDER BY table_name, ordinal_position`,
        [verifyTables],
      );
      let last = null;
      for (const row of r.rows) {
        if (row.table_name !== last) {
          console.log(`\n${row.table_name}`);
          last = row.table_name;
        }
        console.log(`  ${row.column_name} :: ${row.data_type}`);
      }
      console.log(`\n${r.rows.length} columns across ${verifyTables.length} table(s).`);
      if (!r.rows.length) {
        console.error("NOTHING WAS CREATED — the statement ran but the tables are absent.");
        process.exit(1);
      }
    }
  } finally {
    await client.end();
  }
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
