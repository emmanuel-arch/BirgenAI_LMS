// ─────────────────────────────────────────────────────────────────────────────
// ADD `MPESA_RATIBA` TO THE IntegrationKind ENUM.
//
//   npx tsx scripts/add-ratiba-kind.ts            # report what it would do
//   npx tsx scripts/add-ratiba-kind.ts --commit
//
// ── WHY THIS VALUE HAS TO EXIST ──────────────────────────────────────────────
// `src/lib/workflow/checks.ts` has always declared the Ratiba mandate step as
// requiring a vault entry of kind MPESA_RATIBA — and that kind was never in the
// enum. So the requirement could not be satisfied by any configuration: the
// Finance stage answered "This will not run until Ratiba credentials is
// connected" no matter what an administrator put in the vault, because there was
// no drawer to put it in.
//
// ── WHY NOT JUST REUSE MPESA_STK ─────────────────────────────────────────────
// Because the credentials are genuinely different. Standing Order is subscribed
// per DARAJA APP, and Micromart runs two:
//
//   entity 3002 · paybill 4038021 — STK collections. Standing Order returns 401
//                                    "Unauthorised-Invalid Access Token" on a
//                                    token the same app's STK endpoint accepts.
//   entity 3005 · paybill 4329635 — the Micro Eazy book. Standing Order returns
//                                    200 "Request accepted for processing".
//
// (Both verified on 19 Sep 2026 — `npm run ratiba:diagnose`.) The org's single
// MPESA_STK entry holds 3002's app, which is the one Ratiba is NOT on. Pointing
// the mandate at it produces a 401 at the exact moment a customer is waiting for
// a prompt on their handset.
//
// ── WHY BY HAND ──────────────────────────────────────────────────────────────
// `prisma db push` wants `--accept-data-loss` on this database because of
// pre-existing drift unrelated to this change (see add-staff-access.ts). Passing
// that flag to add an enum value would drop somebody's tables as a side effect.
//
// The statement is additive and idempotent, and `ALTER TYPE … ADD VALUE` cannot
// run inside a transaction block — so it goes out on its own, against DIRECT_URL
// rather than the pooler, which is how DDL gets lost.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { Client } from "pg";

const COMMIT = process.argv.includes("--commit");
const SQL = `ALTER TYPE "IntegrationKind" ADD VALUE IF NOT EXISTS 'MPESA_RATIBA'`;

async function main() {
  const client = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
  await client.connect();

  const labels = async () =>
    (
      await client.query<{ enumlabel: string }>(
        `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'IntegrationKind' ORDER BY e.enumsortorder`,
      )
    ).rows.map((r) => r.enumlabel);

  const before = await labels();
  console.log(`\nIntegrationKind — ${COMMIT ? "\x1b[33mCOMMIT\x1b[0m" : "\x1b[2mdry run\x1b[0m"}\n`);
  console.log(`  now      ${before.join(", ")}`);

  if (before.includes("MPESA_RATIBA")) {
    console.log(`\n  \x1b[32mMPESA_RATIBA is already there — nothing to do.\x1b[0m\n`);
    await client.end();
    return;
  }

  console.log(`  ${COMMIT ? "→" : "·"} ${SQL}`);
  if (!COMMIT) {
    console.log(`\n  \x1b[2mNothing written. Re-run with --commit.\x1b[0m\n`);
    await client.end();
    return;
  }

  await client.query(SQL);
  console.log(`\n  after    ${(await labels()).join(", ")}`);
  console.log(`  \x1b[32mAdded.\x1b[0m Run \`npx prisma generate\`, then \`npm run vault:ratiba-micromart\`.\n`);
  await client.end();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n\x1b[31m" + (e instanceof Error ? e.message : String(e)) + "\x1b[0m\n");
    process.exit(1);
  });
