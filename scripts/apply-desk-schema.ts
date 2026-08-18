// ─────────────────────────────────────────────────────────────────────────────
// CREATE THE CONNECTDESK TABLES — additively, and without `prisma db push`.
//
// ── WHY THIS SCRIPT EXISTS INSTEAD OF `db push` ──────────────────────────────
// The live database carries two tables that are not in schema.prisma and were
// not put there by this work — `AllocationPolicy` (1 row) and
// `MarketplaceListing` (2 rows). `prisma db push` reconciles the WHOLE schema,
// so it refuses to run without `--accept-data-loss`, and passing that flag would
// drop both of those tables as a side effect of adding two unrelated ones.
//
// Destroying somebody else's data to install your own is not an acceptable
// trade, and "the flag told me to" is not a defence. So the two new tables are
// created here explicitly. Everything is IF NOT EXISTS, so it is safe to re-run,
// and it touches nothing that already exists.
//
// The pre-existing drift is left alone deliberately. It should be resolved by
// whoever owns those tables — either by adding them to the schema or by
// confirming they can go — as its own change, on purpose, not as debris.
//
//   DOTENV_CONFIG_PATH=.env npx tsx scripts/apply-desk-schema.ts
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) { console.error("DIRECT_URL / DATABASE_URL not set"); process.exit(1); }

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const STATEMENTS: { label: string; sql: string }[] = [
  {
    label: "enum DeskInteractionKind",
    sql: `DO $$ BEGIN
            CREATE TYPE "DeskInteractionKind" AS ENUM ('CALL','PTP','NOTE','TASK','SMS','ASSIGN','ESCALATE','PIPELINE');
          EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  },
  {
    label: "enum DeskMirrorState",
    sql: `DO $$ BEGIN
            CREATE TYPE "DeskMirrorState" AS ENUM ('SHADOW','MIRRORED','FAILED','SKIPPED');
          EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  },
  {
    label: "table DeskInteraction",
    sql: `CREATE TABLE IF NOT EXISTS "DeskInteraction" (
            "id"             TEXT PRIMARY KEY,
            "orgId"          TEXT NOT NULL,
            "entityId"       INTEGER NOT NULL,
            "liveLoanId"     INTEGER NOT NULL,
            "liveBorrowerId" INTEGER,
            "subjectName"    TEXT,
            "subjectPhone"   TEXT,
            "kind"           "DeskInteractionKind" NOT NULL,
            "dispositionId"  INTEGER,
            "categoryId"     INTEGER,
            "headline"       TEXT NOT NULL,
            "detail"         TEXT,
            "amount"         DECIMAL(18,2),
            "dueDate"        TIMESTAMP(3),
            "actorStaffId"   TEXT,
            "actorAgentId"   INTEGER,
            "actorName"      TEXT NOT NULL,
            "source"         TEXT NOT NULL DEFAULT 'desk',
            "mirrorState"    "DeskMirrorState" NOT NULL DEFAULT 'SHADOW',
            "shadowSql"      TEXT,
            "mirrorRowId"    INTEGER,
            "mirrorError"    TEXT,
            "mirroredAt"     TIMESTAMP(3),
            "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "DeskInteraction_orgId_fkey"
              FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE
          );`,
  },
  {
    label: "table DeskShift",
    sql: `CREATE TABLE IF NOT EXISTS "DeskShift" (
            "id"            TEXT PRIMARY KEY,
            "orgId"         TEXT NOT NULL,
            "agentId"       INTEGER NOT NULL,
            "agentName"     TEXT NOT NULL,
            "startedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "endedAt"       TIMESTAMP(3),
            "queues"        JSONB NOT NULL DEFAULT '[]',
            "extension"     TEXT,
            "casesWorked"   INTEGER NOT NULL DEFAULT 0,
            "callsLogged"   INTEGER NOT NULL DEFAULT 0,
            "promisesTaken" INTEGER NOT NULL DEFAULT 0,
            "recovered"     DECIMAL(18,2) NOT NULL DEFAULT 0,
            CONSTRAINT "DeskShift_orgId_fkey"
              FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE
          );`,
  },
  { label: "idx DeskInteraction case",   sql: `CREATE INDEX IF NOT EXISTS "DeskInteraction_orgId_entityId_liveLoanId_createdAt_idx" ON "DeskInteraction"("orgId","entityId","liveLoanId","createdAt");` },
  { label: "idx DeskInteraction recent", sql: `CREATE INDEX IF NOT EXISTS "DeskInteraction_orgId_createdAt_idx" ON "DeskInteraction"("orgId","createdAt");` },
  { label: "idx DeskInteraction agent",  sql: `CREATE INDEX IF NOT EXISTS "DeskInteraction_orgId_actorAgentId_createdAt_idx" ON "DeskInteraction"("orgId","actorAgentId","createdAt");` },
  { label: "idx DeskInteraction mirror", sql: `CREATE INDEX IF NOT EXISTS "DeskInteraction_orgId_mirrorState_idx" ON "DeskInteraction"("orgId","mirrorState");` },
  { label: "idx DeskShift agent",        sql: `CREATE INDEX IF NOT EXISTS "DeskShift_orgId_agentId_startedAt_idx" ON "DeskShift"("orgId","agentId","startedAt");` },
  { label: "idx DeskShift open",         sql: `CREATE INDEX IF NOT EXISTS "DeskShift_orgId_endedAt_idx" ON "DeskShift"("orgId","endedAt");` },
];

// ── Tenant isolation ─────────────────────────────────────────────────────────
// Every other tenant-scoped table in this database runs under FORCE row security
// with a policy comparing orgId to the transaction's `app.org_id` stamp. A new
// table without one is not merely unprotected — under this codebase's read path
// it is the ONE table where a cross-tenant read would succeed. So the policies
// are part of creating the table, not a follow-up chore.
const RLS = ["DeskInteraction", "DeskShift"].flatMap((t) => [
  { label: `rls enable ${t}`, sql: `ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY;` },
  { label: `rls force ${t}`,  sql: `ALTER TABLE "${t}" FORCE ROW LEVEL SECURITY;` },
  { label: `rls policy ${t}`, sql: `DO $$ BEGIN
      CREATE POLICY "${t}_tenant_isolation" ON "${t}"
        USING ("orgId" = current_setting('app.org_id', true))
        WITH CHECK ("orgId" = current_setting('app.org_id', true));
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;` },
]);

async function main() {
  console.log(`Applying ConnectDesk schema to ${new URL(url!).host}\n`);
  for (const { label, sql } of [...STATEMENTS, ...RLS]) {
    try {
      await prisma.$executeRawUnsafe(sql);
      console.log(`  \x1b[32m✓\x1b[0m ${label}`);
    } catch (e) {
      console.log(`  \x1b[31m✗\x1b[0m ${label}: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
      throw e;
    }
  }

  const [check] = await prisma.$queryRawUnsafe<{ interactions: bigint; shifts: bigint }[]>(
    `SELECT (SELECT COUNT(*) FROM "DeskInteraction") AS interactions,
            (SELECT COUNT(*) FROM "DeskShift")       AS shifts`,
  );
  console.log(`\n\x1b[32mDone.\x1b[0m DeskInteraction: ${check.interactions} rows · DeskShift: ${check.shifts} rows`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(`\nFAILED: ${e instanceof Error ? e.message : String(e)}`);
  await prisma.$disconnect();
  process.exit(1);
});
