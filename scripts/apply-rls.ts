// Applies prisma/rls.sql over the DIRECT (session-pooler) connection.
// Idempotent: policies are dropped and recreated, RLS enable/force is a no-op
// when already set. Run after every `prisma db push` that adds a tenant table.
//
//   npm run db:rls
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

async function main() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DIRECT_URL (or DATABASE_URL) is required.");
  const sql = readFileSync(join(process.cwd(), "prisma", "rls.sql"), "utf8");

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(sql);
    const { rows } = await client.query<{ tablename: string; rowsecurity: boolean; forced: boolean }>(`
      SELECT c.relname AS tablename, c.relrowsecurity AS rowsecurity, c.relforcerowsecurity AS forced
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
      ORDER BY c.relname
    `);
    console.log(`RLS enabled on ${rows.length} tables:`);
    for (const r of rows) console.log(`  ${r.tablename}${r.forced ? "" : "  ⚠ NOT FORCED"}`);
    const unforced = rows.filter((r) => !r.forced);
    if (unforced.length) throw new Error(`Tables not FORCEd: ${unforced.map((r) => r.tablename).join(", ")}`);
    console.log("\nAll protected tables are ENABLE + FORCE. ✓");
  } finally {
    await client.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
