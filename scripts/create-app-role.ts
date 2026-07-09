// Creates the RESTRICTED database role the app connects as.
//
// Why this exists: Supabase's `postgres` role carries BYPASSRLS. A role with
// BYPASSRLS ignores row-level security entirely — even `FORCE ROW LEVEL
// SECURITY`. So policies alone buy nothing; the application must connect as a
// role that CANNOT bypass them. `postgres` stays the owner (migrations, seeds,
// this script); `lms_app` is what serves traffic.
//
//   npm run db:app-role        (idempotent — re-run to rotate the password)
//
// Reads APP_DB_PASSWORD from .env, or generates one and prints it.
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { Client } from "pg";

const ROLE = "lms_app";

async function main() {
  const direct = process.env.DIRECT_URL;
  if (!direct) throw new Error("DIRECT_URL (owner connection) is required.");
  const password = process.env.APP_DB_PASSWORD || randomBytes(24).toString("base64url");
  const lit = `'${password.replace(/'/g, "''")}'`;

  const client = new Client({ connectionString: direct });
  await client.connect();
  try {
    // A new role defaults to NOSUPERUSER + NOBYPASSRLS, which is exactly what we
    // want. We must not *set* those attributes explicitly: Supabase's supautils
    // extension rejects ALTER ROLE touching SUPERUSER/BYPASSRLS ("permission
    // denied to alter role"). So we create plainly, set only the password, and
    // then assert the attributes below.
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
          CREATE ROLE ${ROLE} LOGIN;
        END IF;
      END $$;
    `);
    await client.query(`ALTER ROLE ${ROLE} WITH LOGIN PASSWORD ${lit}`);

    await client.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE}`);
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE}`);
    await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${ROLE}`);
    // Tables created by future `prisma db push` runs must be reachable too.
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ROLE}`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${ROLE}`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ${ROLE}`);

    const { rows } = await client.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = '${ROLE}'`,
    );
    if (rows[0]?.rolbypassrls || rows[0]?.rolsuper) throw new Error(`${ROLE} must be NOSUPERUSER + NOBYPASSRLS`);
    console.log(`Role ${ROLE}: LOGIN, NOSUPERUSER, NOBYPASSRLS ✓  (grants applied)`);

    if (!process.env.APP_DB_PASSWORD) {
      console.log(`\nGenerated password (store as APP_DB_PASSWORD):\n  ${password}`);
    }
    // Build the pooled runtime URL for this role from the existing DATABASE_URL.
    const db = process.env.DATABASE_URL;
    if (db) {
      const u = new URL(db);
      const ref = decodeURIComponent(u.username).split(".")[1]; // postgres.<projectref>
      u.username = ref ? `${ROLE}.${ref}` : ROLE;
      u.password = password;
      console.log(`\nSet DATABASE_URL to (also mirror in Vercel):\n  ${u.toString()}`);
    }
  } finally {
    await client.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
