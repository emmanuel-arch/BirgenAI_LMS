// Seed a lender's charge catalogue, and connect the M-Pesa Till that collects them.
//
//   npx tsx scripts/seed-charges.ts techcrast
//
// TWO THINGS, and the second is the one that makes the first useful:
//
//   1. THE CHARGES. Techcrast charges KES 100 to register a customer and KES 200 to
//      process a loan application. Both are the LENDER's fees — their money, their
//      paybill. Idempotent: re-running updates the price rather than duplicating.
//
//   2. THE CREDENTIALS. The founder's instruction was that Techcrast collects on the
//      SAME M-Pesa Till the Hub uses. Those credentials live in the Hub's own .env, so
//      this script READS THEM FROM THERE and writes them into Techcrast's encrypted
//      vault (OrgIntegration, AES-256-GCM). They are never printed, never committed,
//      and never passed on a command line.
//
//      ⚠ The Hub's Till is a BUY GOODS till, not a paybill: BusinessShortCode signs the
//      request and the TILL number is what the money lands in (PartyB). Sending it as
//      CustomerPayBillOnline would push the customer a prompt that credits nothing.
//      That is why MpesaStkConfig now carries transactionType + tillNumber.
import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { platformPrisma } from "../prisma/seed-client";
import { setIntegration } from "../src/lib/vault/integrations";
import { enterPlatform } from "../src/lib/db/context";

const HUB_ENV = "../BIRGEN AI 1.0.0/birgen-ai-frontend/.env";

/** Read one key out of the Hub's .env without importing (or logging) the whole file. */
function hubEnv(file: string, key: string): string | undefined {
  const line = file.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  if (!line) return undefined;
  return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "") || undefined;
}

async function main() {
  const slug = (process.argv[2] ?? "techcrast").trim().toLowerCase();
  const p = platformPrisma();
  enterPlatform();

  const org = await p.org.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!org) throw new Error(`No org with slug "${slug}".`);
  console.log(`Org: ${org.name} (${slug})`);

  // ── 1. The charges ─────────────────────────────────────────────────────────
  const CHARGES = [
    {
      code: "REGFEE",
      name: "Registration fee",
      description: "One-off fee to open an account with us.",
      amount: 100,
      trigger: "ON_REGISTRATION" as const,
    },
    {
      code: "PROCFEE",
      name: "Processing fee",
      description: "Charged when a loan application is submitted.",
      amount: 200,
      trigger: "ON_APPLICATION" as const,
    },
  ];

  for (const c of CHARGES) {
    const existing = await p.charge.findFirst({ where: { orgId: org.id, code: c.code } });
    if (existing) {
      await p.charge.update({
        where: { id: existing.id },
        data: { name: c.name, description: c.description, amount: c.amount, trigger: c.trigger, isActive: true },
      });
      console.log(`  updated  ${c.code.padEnd(8)} ${c.name} — KES ${c.amount}`);
    } else {
      await p.charge.create({
        data: {
          orgId: org.id, code: c.code, name: c.name, description: c.description,
          amount: c.amount, isPercent: false, trigger: c.trigger, beneficiary: "LENDER", isActive: true,
        },
      });
      console.log(`  created  ${c.code.padEnd(8)} ${c.name} — KES ${c.amount}`);
    }
  }

  // ── 2. The Till ────────────────────────────────────────────────────────────
  if (!existsSync(HUB_ENV)) {
    console.log(`\n⚠ Hub .env not found at ${HUB_ENV} — M-Pesa credentials NOT seeded.`);
    console.log("  Fill them in yourself at Settings → Vault, or run this from the lms/ directory.");
  } else {
    const file = readFileSync(HUB_ENV, "utf8");
    const consumerKey = hubEnv(file, "MPESA_CONSUMER_KEY");
    const consumerSecret = hubEnv(file, "MPESA_CONSUMER_SECRET");
    const shortCode = hubEnv(file, "MPESA_BUSINESS_SHORTCODE");
    const tillNumber = hubEnv(file, "MPESA_TILL_NUMBER");
    const passkey = hubEnv(file, "MPESA_PASSKEY");
    const environment = (hubEnv(file, "MPESA_ENVIRONMENT") ?? "production") as "production" | "sandbox";
    const txType = (hubEnv(file, "MPESA_TRANSACTION_TYPE") ?? "CustomerBuyGoodsOnline") as
      | "CustomerBuyGoodsOnline"
      | "CustomerPayBillOnline";

    const missing = [
      !consumerKey && "MPESA_CONSUMER_KEY",
      !consumerSecret && "MPESA_CONSUMER_SECRET",
      !shortCode && "MPESA_BUSINESS_SHORTCODE",
      !passkey && "MPESA_PASSKEY",
    ].filter(Boolean);

    if (missing.length) {
      console.log(`\n⚠ Hub .env is missing ${missing.join(", ")} — M-Pesa credentials NOT seeded.`);
    } else {
      await setIntegration(org.id, "MPESA_STK", {
        consumerKey: consumerKey!,
        consumerSecret: consumerSecret!,
        shortCode: shortCode!,
        passkey: passkey!,
        transactionType: txType,
        ...(tillNumber ? { tillNumber } : {}),
        environment,
      });
      console.log(`\n  M-Pesa STK connected for ${slug}:`);
      console.log(`    environment      ${environment}`);
      console.log(`    transaction type ${txType}`);
      console.log(`    shortcode        ${"•".repeat(String(shortCode).length)} (${String(shortCode).length} digits)`);
      console.log(`    till             ${tillNumber ? "•".repeat(String(tillNumber).length) + ` (${String(tillNumber).length} digits)` : "— (paybill mode)"}`);
      console.log("    (secrets encrypted into the vault; nothing printed)");
    }
  }

  const total = await p.charge.count({ where: { orgId: org.id } });
  console.log(`\n${slug}: ${total} charge(s) on the catalogue.`);
  await p.$disconnect();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
