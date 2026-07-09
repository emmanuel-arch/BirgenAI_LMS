// One-shot migration from the old 3-tier plan enum to the four packages.
//
//   npm run db:migrate:plans      (idempotent — safe to re-run)
//
// Postgres cannot DROP a value from an enum, and two orgs were already on GROWTH,
// so `prisma db push` alone would either fail or destroy data. We RENAME instead:
//
//   GROWTH → ADVANCED   (both are "the tier above the middle one")
//   + PREMIUM           (new top)
//
// Then the semantic fix. The new ladder is STARTER → ENTERPRISE → ADVANCED →
// PREMIUM, so "ENTERPRISE" now means TIER 2, not the top. Every org previously
// marked ENTERPRISE was on the old top tier and must be PROMOTED to PREMIUM —
// otherwise this rename would silently strip Riri, the route planner and
// early-warning from the flagship lender and the demo org.
//
// Run BEFORE `prisma db push` (the enum must exist before Prisma validates it).
import "dotenv/config";
import { Client } from "pg";

async function main() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DIRECT_URL (owner connection) is required.");

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const values = async () =>
      (await client.query<{ v: string }>(
        `SELECT e.enumlabel AS v FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'OrgPlan'`,
      )).rows.map((r) => r.v);

    const before = await values();
    console.log(`OrgPlan before: ${before.join(", ")}`);

    if (before.includes("GROWTH")) {
      await client.query(`ALTER TYPE "OrgPlan" RENAME VALUE 'GROWTH' TO 'ADVANCED'`);
      console.log("renamed GROWTH → ADVANCED (rows preserved)");
    }
    if (!before.includes("PREMIUM")) {
      // ADD VALUE cannot run inside a transaction block; pg runs this standalone.
      await client.query(`ALTER TYPE "OrgPlan" ADD VALUE IF NOT EXISTS 'PREMIUM'`);
      console.log("added PREMIUM");
    }

    // Promotion. Only orgs that predate this migration — a brand-new org created
    // on the four-tier enum and legitimately assigned ENTERPRISE must not jump.
    const cutoff = process.env.PLAN_MIGRATION_CUTOFF ?? "2026-07-10";
    const { rowCount } = await client.query(
      `UPDATE "Org" SET plan = 'PREMIUM' WHERE plan = 'ENTERPRISE' AND "createdAt" < $1::timestamptz`,
      [cutoff],
    );
    console.log(`promoted ${rowCount} legacy ENTERPRISE org(s) → PREMIUM (created before ${cutoff})`);

    const after = await client.query<{ slug: string; plan: string }>(`SELECT slug, plan FROM "Org" ORDER BY "createdAt"`);
    console.log(`\nOrgPlan after: ${(await values()).join(", ")}`);
    for (const o of after.rows) console.log(`  ${o.slug.padEnd(12)} ${o.plan}`);
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
