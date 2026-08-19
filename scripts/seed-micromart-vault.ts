// ─────────────────────────────────────────────────────────────────────────────
// SEED MICROMART'S LIVE VAULT — M-Pesa (STK + Ratiba) and Metropol CRB.
//
//   npx tsx scripts/seed-micromart-vault.ts            # DRY RUN — writes nothing
//   npx tsx scripts/seed-micromart-vault.ts --commit   # writes to the live DB
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
// The VAULT_MASTER_KEY was rotated and every OrgIntegration row predates the
// rotation, so `scripts/vault-audit.ts` reports 0 readable / 5 unreadable and
// Micromart has NO working credentials in production. The credentials are not
// lost: the live ServiceSuite system is still running on them, and this platform
// already holds a read-only connection to it.
//
// So this reads the M-Pesa credentials back out of ServiceSuite, re-encrypts
// them under the CURRENT key (AES-256-GCM, src/lib/vault/crypto), and stores
// them as OrgIntegration rows. One row lights up BOTH features, because
// createStandingOrder() reads the same MPESA_STK config that STK does.
//
// ── TWO THINGS IT DELIBERATELY DOES NOT COPY ─────────────────────────────────
//   · THEIR CallBackUrl. Their STK callbacks must keep landing on their server.
//     Ours is derived per-org from PUBLIC_BASE_URL, so the field is left unset
//     and the platform default applies. Copying it would silently hand our
//     callbacks to their endpoint — or worse, theirs to ours.
//   · Their SMS credentials. Sending SMS spends real money, and the standing
//     rule in .env keeps AFRICASTALKING_* blank on purpose.
//
// ── DRY RUN BY DEFAULT ───────────────────────────────────────────────────────
// This is a production write. Without --commit it reads everything, verifies
// what it can, prints a masked plan and exits without touching the database.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { runAsPlatform } from "../src/lib/db/context";
import { ORGS } from "../src/lib/enterprise/connections";
import { readStkParams } from "../src/lib/enterprise/servicesuite-config";
import { setIntegration, setIntegrationStatus, type MpesaStkConfig, type CrbConfig } from "../src/lib/vault/integrations";

const COMMIT = process.argv.includes("--commit");
const SLUG = "micromart";

const mask = (v: string | null | undefined) =>
  !v ? "—" : v.length <= 8 ? `${v.slice(0, 2)}${"•".repeat(Math.max(1, v.length - 2))}` : `${v.slice(0, 3)}${"•".repeat(8)}${v.slice(-3)}`;

const pick = (...names: string[]) => {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) return v.trim().replace(/^["']|["']$/g, "");
  }
  return "";
};

async function main() {
  const org = ORGS[SLUG];
  const entityId = Number(process.env.SERVICESUITE_ENTITYID_MICROMART || org.defaultEntityId);
  console.log(`\nSeed Micromart vault — ${COMMIT ? "COMMIT (writes to the live database)" : "DRY RUN (nothing will be written)"}`);
  console.log(`  ServiceSuite entity: ${entityId}\n`);

  const dbOrg = await prisma.org.findFirst({ where: { slug: SLUG }, select: { id: true, name: true } });
  if (!dbOrg) {
    console.error(`✗ No org with slug "${SLUG}" in this database. Nothing seeded.`);
    process.exit(1);
  }
  console.log(`  Target org: ${dbOrg.name} (${dbOrg.id})\n`);

  // ── 1. M-Pesa, read back from the live ServiceSuite system ─────────────────
  console.log("── M-Pesa STK + Ratiba ──────────────────────────────────────");
  const findings = await readStkParams(org, entityId);
  const valueOf = (field: string) => findings.find((f) => f.entityId === entityId && f.field === field)?.value ?? null;

  const consumerKey = valueOf("ConsumerKey");
  const consumerSecret = valueOf("ConsumerSecrete"); // their column spelling
  const passkey = valueOf("passkey");
  const shortCode = valueOf("shortCode");

  const missing = [
    ["ConsumerKey", consumerKey], ["ConsumerSecrete", consumerSecret],
    ["passkey", passkey], ["shortCode", shortCode],
  ].filter(([, v]) => !v).map(([k]) => k);

  let mpesaOk = false;
  let mpesaCfg: MpesaStkConfig | null = null;
  if (missing.length) {
    console.log(`  ✗ Could not read: ${missing.join(", ")} — M-Pesa will be skipped.`);
  } else {
    mpesaCfg = {
      consumerKey: consumerKey!,
      consumerSecret: consumerSecret!,
      shortCode: shortCode!,
      passkey: passkey!,
      // Confirmed against their own STK call (Models/Payments.cs): PartyB is the
      // shortcode itself, so this is a PAYBILL, not a till. Ratiba depends on the
      // same fact — it sends ReceiverPartyIdentifierType 4 for pay bill.
      transactionType: "CustomerPayBillOnline",
      // callbackUrl deliberately unset — see the header.
      environment: "production",
    };
    console.log(`  consumerKey    ${mask(consumerKey)}`);
    console.log(`  consumerSecret ${mask(consumerSecret)}`);
    console.log(`  passkey        ${mask(passkey)}`);
    console.log(`  shortCode      ${mask(shortCode)}  (paybill)`);
    console.log(`  callbackUrl    (unset — platform default from PUBLIC_BASE_URL)`);

    // Prove the credentials before storing them. An OAuth token costs nothing
    // and moves no money, but it is the difference between "we wrote a row" and
    // "STK and Ratiba will work".
    try {
      const res = await fetch("https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials", {
        headers: { Authorization: `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64")}` },
        signal: AbortSignal.timeout(20000),
      });
      const j = (await res.json()) as { access_token?: string; errorMessage?: string };
      mpesaOk = !!j.access_token;
      console.log(`  ${mpesaOk ? "✓" : "✗"} Daraja OAuth: ${mpesaOk ? "token issued — credentials are live" : j.errorMessage ?? `HTTP ${res.status}`}`);
    } catch (e) {
      console.log(`  ✗ Daraja OAuth: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── 2. Metropol CRB, from the environment ──────────────────────────────────
  console.log("\n── Metropol CRB ─────────────────────────────────────────────");
  const publicKey = pick("METROPOL_PUBLIC_KEY", "Metropol_Public_Key");
  const privateKey = pick("METROPOL_PRIVATE_KEY", "Metropol_Private_Key");
  let crbCfg: CrbConfig | null = null;
  if (!publicKey || !privateKey) {
    console.log("  ✗ Metropol keys not in env — CRB will be skipped.");
  } else {
    crbCfg = {
      bureau: "metropol",
      publicKey,
      privateKey,
      host: pick("METROPOL_HOST") || "api.metropol.co.ke",
      port: pick("METROPOL_PORT") || "5555",
      apiVersion: pick("METROPOL_VERSION") || "v2_1",
      reportDepth: "full",
    };
    console.log(`  publicKey      ${mask(publicKey)} (${publicKey.length} chars)`);
    console.log(`  privateKey     ${mask(privateKey)} (${privateKey.length} chars)`);
    console.log(`  endpoint       https://${crbCfg.host}:${crbCfg.port}/${crbCfg.apiVersion}`);
    console.log("  ! These PRODUCTION keys currently return E003 on every report endpoint.");
    console.log("    They are stored so the switch-on is a Metropol-side change only, and the");
    console.log("    row is marked with that reason rather than left looking healthy.");
  }

  // ── 3. Write ───────────────────────────────────────────────────────────────
  console.log("\n── Write ────────────────────────────────────────────────────");
  if (!COMMIT) {
    console.log("  DRY RUN — nothing written. Re-run with --commit to apply.\n");
    await prisma.$disconnect();
    return;
  }

  if (mpesaCfg) {
    await setIntegration(dbOrg.id, "MPESA_STK", mpesaCfg);
    // TESTED means a real call succeeded, which is exactly what the OAuth probe
    // established. Claiming it without the probe would be the same dishonesty
    // the rotation left behind.
    if (mpesaOk) await setIntegrationStatus(dbOrg.id, "MPESA_STK", "TESTED").catch(() => {});
    else await setIntegrationStatus(dbOrg.id, "MPESA_STK", "CONFIGURED", "Stored from ServiceSuite entity 3005, but the Daraja OAuth probe did not return a token.").catch(() => {});
    console.log(`  ✓ MPESA_STK written — status ${mpesaOk ? "TESTED" : "CONFIGURED"} (STK + Ratiba)`);
  }

  if (crbCfg) {
    await setIntegration(dbOrg.id, "CRB", crbCfg);
    await setIntegrationStatus(
      dbOrg.id, "CRB", "CONFIGURED",
      "Metropol PRODUCTION keys stored. Bureau returns E003 (not authorized for any report service) — awaiting Metropol to confirm the production port/API version and enable report types. Verify with: npm run test:crb:prod",
    ).catch(() => {});
    console.log("  ✓ CRB written — status CONFIGURED, with the E003 blocker recorded as lastError");
  }

  console.log("\n  Confirm with: npx tsx scripts/vault-audit.ts\n");
  await prisma.$disconnect();
}

// Row-level security needs a tenant context, and this script legitimately acts
// across orgs' own boundaries on the platform's behalf — so it enters platform
// context explicitly rather than impersonating the org.
runAsPlatform(main).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
