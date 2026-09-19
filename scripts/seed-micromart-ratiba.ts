// ─────────────────────────────────────────────────────────────────────────────
// PUT MICROMART'S RATIBA CREDENTIALS IN THE VAULT.
//
//   npx tsx scripts/seed-micromart-ratiba.ts            # report
//   npx tsx scripts/seed-micromart-ratiba.ts --commit
//
// Reads the Daraja credentials for the entity Standing Order is actually enabled
// on out of Micromart's own ServiceSuite database, and writes them into this
// platform's encrypted vault as MPESA_RATIBA.
//
// ── WHICH ENTITY, AND WHY IT IS NOT THE OBVIOUS ONE ──────────────────────────
// Micromart run two Daraja apps, and Standing Order is subscribed per app. On
// 19 Sep 2026 both were probed against production:
//
//   entity 3002 · paybill 4038021   STK 500 (business error — app is fine)
//                                   Standing Order 401 Unauthorised
//   entity 3005 · paybill 4329635   STK 500 (business error — app is fine)
//                                   Standing Order 200 accepted
//
// One token, two products, two answers: the credentials are good on both and the
// PRODUCT is only on 3005 — which is the Micro Eazy book, and therefore the
// right entity for a mandate raised against a Micro Eazy loan anyway.
//
// The org's existing MPESA_STK entry holds 3002 and is left exactly as it is:
// collections still run on the paybill customers already pay into. This adds the
// second drawer rather than editing the first.
//
// ── THE CREDENTIALS ARE NOT TYPED IN ─────────────────────────────────────────
// They are read from `Transactions.dbo.StkParams` on Micromart's server and
// decrypted with the legacy ServiceSuite cipher, for three reasons: nobody has
// to handle a consumer secret by hand, the vault cannot drift from what the
// lender's own system believes, and if Micromart rotate the key in ServiceSuite
// this is one command rather than an investigation.
//
// The read is READ-ONLY and scoped to one table. See [[never-disrupt-
// micromarts-shared-server]].
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { runAsPlatform } from "../src/lib/db/context";
import { getOrg } from "../src/lib/enterprise/connections";
import { runReadOnlyQuery } from "../src/lib/enterprise/mssql";
import { decipherLegacy } from "../src/lib/enterprise/servicesuite-config";
import { getIntegration, setIntegration } from "../src/lib/vault/integrations";

const COMMIT = process.argv.includes("--commit");
const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d;
};

const ok = (s: string) => `\x1b[32m${s}\x1b[0m`;
const bad = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
/** A secret is never printed. Enough to tell two apps apart, not enough to use. */
const fingerprint = (s: string) => (s ? `${s.slice(0, 4)}…${s.slice(-3)} (${s.length} chars)` : "—");

async function main() {
  const slug = arg("org", "micromart");
  const entityId = Number(arg("entity", "3005"));

  console.log(`\n\x1b[1mRatiba credentials → vault\x1b[0m — ${COMMIT ? "\x1b[33mCOMMIT\x1b[0m" : dim("dry run")}\n`);

  const source = getOrg(slug);
  if (!source) throw new Error(`No connection-registry entry for "${slug}" (lib/enterprise/connections).`);

  // Interpolated rather than bound, and safe because of the line above it: the
  // value has already been narrowed to a finite integer, so there is nothing
  // left that could be a fragment of SQL. runReadOnlyQuery's parameter list
  // takes typed mssql params, which is more ceremony than one integer is worth.
  if (!Number.isInteger(entityId)) throw new Error(`--entity must be an integer, got "${arg("entity", "")}".`);
  const { rows } = await runReadOnlyQuery(
    source,
    `SELECT EntityId, ConsumerKey, ConsumerSecrete, passkey, shortCode
       FROM Transactions.dbo.StkParams WHERE EntityId = ${entityId}`,
    [],
    { timeoutMs: 30000 },
  );
  if (!rows.length) throw new Error(`No StkParams row for EntityId ${entityId} on ${source.name}'s server.`);

  const row = rows[0] as Record<string, unknown>;
  const consumerKey = decipherLegacy(String(row.ConsumerKey ?? "")) ?? "";
  const consumerSecret = decipherLegacy(String(row.ConsumerSecrete ?? "")) ?? "";
  const passkey = decipherLegacy(String(row.passkey ?? "")) ?? "";
  const shortCode = decipherLegacy(String(row.shortCode ?? "")) ?? "";

  if (!consumerKey || !consumerSecret || !shortCode) {
    throw new Error(`EntityId ${entityId}'s credentials could not be decrypted — the legacy cipher did not read them.`);
  }

  console.log(`  source         ${source.name} · Transactions.dbo.StkParams · EntityId ${entityId}`);
  console.log(`  paybill        ${ok(shortCode)}`);
  console.log(`  consumer key   ${dim(fingerprint(consumerKey))}`);
  console.log(`  secret         ${dim(fingerprint(consumerSecret))}`);
  console.log(`  passkey        ${dim(passkey ? "present" : "absent")}`);

  await runAsPlatform(async () => {
    const org = await prisma.org.findFirst({ where: { slug }, select: { id: true, name: true } });
    if (!org) throw new Error(`No org with slug "${slug}".`);

    const stk = await getIntegration(org.id, "MPESA_STK");
    console.log(`\n  existing STK   ${stk ? `paybill ${stk.shortCode} ${dim("(left untouched — collections keep running on it)")}` : dim("none")}`);
    if (stk && stk.shortCode === shortCode) {
      console.log(dim(`  Note: the same paybill as STK. A dedicated entry is harmless, just redundant.`));
    }

    if (!COMMIT) {
      console.log(dim(`\n  Nothing written. Re-run with --commit.\n`));
      return;
    }

    await setIntegration(
      org.id,
      "MPESA_RATIBA",
      {
        consumerKey,
        consumerSecret,
        shortCode,
        passkey,
        // Paybill, not Buy Goods: the mandate credits a loan account under an
        // AccountReference, which is what ReceiverPartyIdentifierType "4" means.
        transactionType: "CustomerPayBillOnline",
        environment: "production",
      },
      "scripts/seed-micromart-ratiba",
    );

    const back = await getIntegration(org.id, "MPESA_RATIBA");
    console.log(
      back?.shortCode === shortCode
        ? `\n  ${ok("Written and read back.")} Ratiba mandates now sign as paybill ${shortCode}.`
        : bad("\n  Written, but it did not read back. Check VAULT_MASTER_KEY."),
    );
    console.log(dim(`  The Finance stage's "Ratiba credentials" requirement is now satisfiable.\n`));
  });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n" + bad(e instanceof Error ? e.message : String(e)) + "\n");
    process.exit(1);
  });
