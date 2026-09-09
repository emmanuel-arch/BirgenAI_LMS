// Read-only: confirm the conversation tables exist and are RLS-protected.
//
//   node scripts/show-conversation-tables.cjs
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const root = path.resolve(__dirname, "..");
const envText = fs.readFileSync(path.join(root, ".env"), "utf8");
const m = envText.match(/^DIRECT_URL\s*=\s*"?([^"\r\n]+)"?/m);
if (!m) {
  console.error("DIRECT_URL not found in .env");
  process.exit(1);
}

const TABLES = ["ConversationThread", "ConversationMessage"];

(async () => {
  const c = new Client({ connectionString: m[1], ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const cols = await c.query(
      `SELECT table_name, count(*)::int AS n
         FROM information_schema.columns
        WHERE table_name = ANY($1::text[])
        GROUP BY table_name ORDER BY table_name`,
      [TABLES],
    );
    for (const t of TABLES) {
      const row = cols.rows.find((r) => r.table_name === t);
      console.log(row ? `${t}: ${row.n} columns` : `${t}: MISSING`);
    }

    // FORCE matters: our connection role owns these tables, and an owner
    // bypasses RLS unless it is forced.
    const rls = await c.query(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
              (SELECT count(*)::int FROM pg_policies p
                WHERE p.tablename = c.relname) AS policies
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
        ORDER BY c.relname`,
      [TABLES],
    );
    console.log("");
    for (const r of rls.rows) {
      console.log(
        `${r.relname}: rls=${r.relrowsecurity} force=${r.relforcerowsecurity} policies=${r.policies}`,
      );
    }

    const enums = await c.query(
      `SELECT t.typname, string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) AS labels
         FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname IN ('ThreadKind','ThreadState')
        GROUP BY t.typname ORDER BY t.typname`,
    );
    console.log("");
    for (const r of enums.rows) console.log(`${r.typname}: ${r.labels}`);
    console.log("");
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
