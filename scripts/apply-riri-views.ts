// Applies prisma/riri-views.sql — Riri's governed read surface — over the DIRECT
// (owner) connection, then GRANTs SELECT on the views to the restricted runtime
// role and ASSERTS the property the whole guard rests on.
//
//   npm run db:riri-views      (idempotent)
//
// The assertion is the point. These views are owned by `postgres`, which carries
// BYPASSRLS on Supabase. Without `security_invoker = true` a view executes with
// the owner's privileges and RLS on the base tables is bypassed entirely — every
// lender would read every other lender's book through them. So we do not trust
// the DDL to have said it: we read `reloptions` back out of the catalogue and
// refuse to finish if a single view is missing the flag.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const ROLE = "lms_app";

async function main() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DIRECT_URL (or DATABASE_URL) is required.");
  const sql = readFileSync(join(process.cwd(), "prisma", "riri-views.sql"), "utf8");

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows: ver } = await client.query<{ v: string }>("SHOW server_version");
    const major = parseInt(ver[0].v, 10);
    if (major < 15) {
      throw new Error(
        `security_invoker views need PostgreSQL 15+; this server is ${ver[0].v}. ` +
          `Do NOT create these views without it — they would bypass RLS.`,
      );
    }

    await client.query(sql);

    const { rows } = await client.query<{ viewname: string; reloptions: string[] | null }>(`
      SELECT c.relname AS viewname, c.reloptions
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'v' AND c.relname LIKE 'riri\\_%'
      ORDER BY c.relname
    `);

    if (rows.length === 0) throw new Error("No riri_* views were created.");

    const unsafe: string[] = [];
    for (const r of rows) {
      const invoker = (r.reloptions ?? []).some((o) => o.replace(/\s/g, "").toLowerCase() === "security_invoker=true");
      if (!invoker) unsafe.push(r.viewname);
      await client.query(`GRANT SELECT ON ${r.viewname} TO ${ROLE}`);
      console.log(`  ${r.viewname}${invoker ? "" : "  ⚠ NOT security_invoker"}`);
    }

    if (unsafe.length) {
      // Leaving these in place would be worse than having no views at all.
      for (const v of unsafe) await client.query(`DROP VIEW IF EXISTS ${v} CASCADE`);
      throw new Error(
        `DROPPED ${unsafe.join(", ")} — created without security_invoker, which would bypass RLS ` +
          `and expose every tenant's book. Fix prisma/riri-views.sql and re-run.`,
      );
    }

    console.log(`\n${rows.length} views, all security_invoker, all granted SELECT to ${ROLE}. ✓`);
    console.log("RLS on the base tables now scopes every one of them to the caller's org.");
  } finally {
    await client.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
