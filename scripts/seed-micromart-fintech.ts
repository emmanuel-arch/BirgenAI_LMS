// The Micromart pilot shelf: ONE product — MIROMART FINTECH — exactly as it is
// configured in the boss's ServiceSuite deployment (the separate "fintech" DB).
//
//   npx tsx scripts/seed-micromart-fintech.ts                 (product id unknown yet)
//   npx tsx scripts/seed-micromart-fintech.ts --ss-id=<Products.ID in the fintech DB>
//
// WHY A LOCAL MIRROR ON A BRIDGED ORG. Micromart's portal shelf normally reads
// their LIVE Products table (30+ products: 4 WEEKS, DAILY…). The pilot sells
// exactly one product, and it lives in a DIFFERENT database (the boss's separate
// MIROMART FINTECH ServiceSuite) that the portal cannot list from. So the shelf
// for the pilot is curated here, in OUR product table, and /api/lms/products
// prefers a bridged org's local products whenever any exist. Nothing in
// Micromart's own DB is touched — their 4 WEEKS book keeps running as-is.
//
// THE NUMBERS, transcribed from the boss's product page (verified 2026-07-17):
//   Principal        KES 5,000 – 20,000
//   Interest         Flat 8.25% PER WEEK × 10 weekly installments = 82.5% for the term
//                    (our schedule engine reads interestRate as the WHOLE-term rate —
//                    see src/lib/lms/servicesuite-products.ts for the proof on real loans)
//   Rollover penalty 20%
//   Guarantor        not required; a standing guarantor cannot borrow (reborrow=false)
//   Security         not required
//   Workflows        new + repeat both "FINTECH APPROVAL" — that approval lives in the
//                    boss's system, which is why newWorkflowId stays null here.
//   Charge           PROCESSING FEES (PF), before disbursement, 6% of principal
//                    clamped to KES 650 – 1,000,000, on the 5k–20k band.
//                    ⚠ The page renders the value as "Ksh6.00" — a FIXED KES 6 fee with a
//                    KES 650 floor makes no sense, so this is mirrored as 6% + clamp
//                    (6% of 5,000 = 300 → floor 650; of 20,000 = 1,200). CONFIRM on the
//                    fee's edit screen and re-run with the numbers corrected if wrong.
//
// Idempotent: matched by (orgId, name). Every OTHER local product on the org is
// switched off — the pilot shelf is this product alone.
import "dotenv/config";
import { platformPrisma } from "../prisma/seed-client";
import { enterPlatform } from "../src/lib/db/context";

const PRODUCT_NAME = "MIROMART FINTECH";

async function main() {
  const ssIdArg = process.argv.find((a) => a.startsWith("--ss-id="));
  const ssId = ssIdArg ? Number(ssIdArg.split("=")[1]) : null;
  if (ssIdArg && (!Number.isInteger(ssId) || ssId! <= 0)) throw new Error("--ss-id must be a positive integer (Products.ID in the fintech DB).");

  const p = platformPrisma();
  enterPlatform();
  const org = await p.org.findUnique({ where: { slug: "micromart" }, select: { id: true, name: true } });
  if (!org) throw new Error('No org with slug "micromart".');
  console.log(`Org: ${org.name} (micromart)`);

  const data = {
    orgId: org.id,
    name: PRODUCT_NAME,
    description: "Weekly working-capital credit — ten equal weekly installments at 8.25% per week, no guarantor, no security.",
    minPrincipal: 5_000,
    maxPrincipal: 20_000,
    interestRate: 82.5, // 8.25%/week × 10 weeks — whole-term, what buildSchedule() expects
    interestMethod: "flat",
    interestType: "fixed",
    principalType: "standard",
    interestPeriodUnit: "term",
    repaymentPeriod: 10,
    repaymentPeriodUnit: "week",
    gracePeriodDays: 0,
    penaltyRate: 20, // the 20% rollover penalty on the product page
    earlySettlementEnabled: false,
    earlySettlementDays: null,
    earlySettlementRate: null,
    repaymentOrder: "penalty,interest,principal,fees",
    minLoanLimit: null,
    minCreditScore: null,
    guarantorRequired: false,
    guarantorReborrow: false, // "Guarantor Status: In-Active (Can not Borrow)"
    securityRequired: false,
    securityCoverPct: 100,
    disbursementMode: "B2C_MPESA" as const,
    isActive: true,
    // Products.ID in the BOSS's fintech DB — the id sp_InsertLoan must book against.
    // Null until the fintech DB is reachable / the id is confirmed; posting is
    // impossible without it, the portal shelf works fine.
    serviceSuiteProductId: ssId,
    newWorkflowId: null, // approval happens in the fintech DB's FINTECH APPROVAL workflow
    repeatWorkflowId: null,
  };

  const existing = await p.product.findFirst({ where: { orgId: org.id, name: PRODUCT_NAME }, select: { id: true } });
  const product = existing
    ? await p.product.update({ where: { id: existing.id }, data })
    : await p.product.create({ data });
  console.log(`  ${existing ? "updated" : "created"}  ${PRODUCT_NAME} — KES 5,000–20,000 · 8.25%/week × 10 = 82.5% flat · rollover penalty 20%`);
  console.log(`  fintech Products.ID: ${ssId ?? "NOT SET — run again with --ss-id=<id> before posting can work"}`);

  // The pilot shelf is ONE product. Anything else local goes dark (never deleted —
  // loans/applications may point at it).
  const others = await p.product.updateMany({
    where: { orgId: org.id, id: { not: product.id }, isActive: true },
    data: { isActive: false },
  });
  if (others.count) console.log(`  switched off ${others.count} other local product(s)`);

  // ── PROCESSING FEES (PF) ──────────────────────────────────────────────────
  const charge = {
    orgId: org.id,
    name: "PROCESSING FEES",
    code: "PF",
    description: "Loan processing fee, collected before disbursement.",
    amount: 6, // 6% — see header; CONFIRM against the fee's edit screen
    isPercent: true,
    minValue: 650,
    maxValue: 1_000_000,
    minPrincipal: 5_000,
    maxPrincipal: 20_000,
    applyAt: "BEFORE_DISBURSEMENT" as const,
    trigger: "ON_APPLICATION" as const,
    beneficiary: "LENDER" as const,
    productId: product.id,
    isActive: true,
  };
  const existingCharge = await p.charge.findFirst({ where: { orgId: org.id, code: "PF" }, select: { id: true } });
  if (existingCharge) await p.charge.update({ where: { id: existingCharge.id }, data: charge });
  else await p.charge.create({ data: charge });
  console.log(`  ${existingCharge ? "updated" : "created"}  PF — PROCESSING FEES: 6% clamped KES 650–1,000,000, before disbursement`);

  const live = await p.product.count({ where: { orgId: org.id, isActive: true } });
  console.log(`\nmicromart: ${live} product on the pilot shelf. The portal now sells ${PRODUCT_NAME} alone.`);
  await p.$disconnect();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
