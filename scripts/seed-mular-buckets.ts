// Reseed MULAR CREDIT's product catalogue to the real FADHILI / KUZA / INUKA tiers
// (the exact buckets, terms and fees the lender runs), so the internal-score →
// starting-limit → product-match engine has real products to offer.
//
//   npx tsx scripts/seed-mular-buckets.ts            # apply (idempotent)
//   npx tsx scripts/seed-mular-buckets.ts --dry      # print the plan, write nothing
//   npx tsx scripts/seed-mular-buckets.ts --down     # revert (safe on prod)
//
// SAFE ON PROD (Mular is live):
//   • The four legacy monthly products are DEACTIVATED, never deleted — existing
//     loans/applications keep their productId. --down reactivates them.
//   • The 15 tier products + their charges are the only rows created. --down removes
//     each tier product that carries no loan/application, and deactivates (not deletes)
//     any that somehow booked one, so nothing is ever orphaned.
//   • Everything is upserted by a stable key (product name / charge code) → re-runnable.
import "dotenv/config";
import { platformPrisma } from "../prisma/seed-client";

const prisma = platformPrisma();

const DRY = process.argv.includes("--dry");
const DOWN = process.argv.includes("--down");

// The legacy catalogue we retire (by name). Deactivated on apply, restored on --down.
const LEGACY = ["Business Loan", "School Fees Loan", "Salary Advance", "Boda & Asset Finance"];

// The tiers, exactly as the lender runs them. Interest scales 6.25%/week (25%→50%);
// processing is a flat KES 500 on the two lower tiers and 5% on FADHILI.
type Tier = { key: "INUKA" | "KUZA" | "FADHILI"; min: number; max: number; processing: { percent: boolean; amount: number } };
const TIERS: Tier[] = [
  { key: "INUKA", min: 1000, max: 5000, processing: { percent: false, amount: 500 } },
  { key: "KUZA", min: 6000, max: 10000, processing: { percent: false, amount: 500 } },
  { key: "FADHILI", min: 11000, max: 1_000_000, processing: { percent: true, amount: 5 } }, // "Unlimited" → 1M working ceiling
];
const WEEKS = [4, 5, 6, 7, 8];
const interestForWeeks = (w: number) => +(6.25 * w).toFixed(2); // 25 / 31.25 / 37.5 / 43.75 / 50
const productName = (t: Tier["key"], w: number) => `${t} ${w} WEEKS`;
const procCode = (t: Tier["key"], w: number) => `PROC-${t}-${w}W`;

const money = (n: number) => `KES ${Math.round(n).toLocaleString()}`;

async function down(orgId: string) {
  // 1) restore the legacy catalogue
  const restored = await prisma.product.updateMany({ where: { orgId, name: { in: LEGACY } }, data: { isActive: true } });
  console.log(`  restored ${restored.count} legacy product(s) to active`);

  // 2) remove tier products (delete when unused, deactivate when they carry a loan/app)
  let deleted = 0, kept = 0;
  for (const t of TIERS) for (const w of WEEKS) {
    const p = await prisma.product.findFirst({ where: { orgId, name: productName(t.key, w) }, select: { id: true, _count: { select: { loans: true, applications: true } } } });
    if (!p) continue;
    await prisma.charge.deleteMany({ where: { orgId, code: procCode(t.key, w) } });
    if (p._count.loans === 0 && p._count.applications === 0) { await prisma.product.delete({ where: { id: p.id } }); deleted++; }
    else { await prisma.product.update({ where: { id: p.id }, data: { isActive: false } }); kept++; }
  }
  await prisma.charge.deleteMany({ where: { orgId, code: "JOINING" } });
  console.log(`  tier products: deleted ${deleted}, deactivated ${kept} (had loans); charges removed`);
}

async function up(orgId: string) {
  // 1) retire the legacy monthly catalogue (keep the rows so old loans resolve)
  const deact = await prisma.product.updateMany({ where: { orgId, name: { in: LEGACY }, isActive: true }, data: { isActive: false } });
  console.log(`  deactivated ${deact.count} legacy product(s)`);

  // 2) the joining fee — once per new customer, a borrower-level registration charge
  await prisma.charge.upsert({
    where: { orgId_code: { orgId, code: "JOINING" } },
    create: { orgId, code: "JOINING", name: "Joining fee", description: "Registration fee, once per new customer", amount: 300, isPercent: false, trigger: "ON_REGISTRATION", beneficiary: "LENDER", applyAt: "BEFORE_DISBURSEMENT", productId: null, isActive: true },
    update: { name: "Joining fee", amount: 300, isPercent: false, trigger: "ON_REGISTRATION", applyAt: "BEFORE_DISBURSEMENT", isActive: true },
  });
  console.log(`  joining fee: ${money(300)} once per new customer`);

  // 3) the 15 tier products + a per-product processing charge each
  let n = 0;
  for (const t of TIERS) for (const w of WEEKS) {
    const name = productName(t.key, w);
    const rate = interestForWeeks(w);
    const data = {
      orgId, name, description: `${t.key} tier · ${w}-week term`,
      minPrincipal: t.min, maxPrincipal: t.max, interestRate: rate,
      interestMethod: "flat", interestType: "fixed", principalType: "standard",
      interestPeriodUnit: "week", repaymentPeriod: w, repaymentPeriodUnit: "week",
      minLoanLimit: t.min, disbursementMode: "B2C_MPESA" as const, guarantorRequired: false, isActive: true,
    };
    const existing = await prisma.product.findFirst({ where: { orgId, name }, select: { id: true } });
    const prod = existing
      ? await prisma.product.update({ where: { id: existing.id }, data, select: { id: true } })
      : await prisma.product.create({ data, select: { id: true } });

    await prisma.charge.upsert({
      where: { orgId_code: { orgId, code: procCode(t.key, w) } },
      create: {
        orgId, code: procCode(t.key, w), name: "Processing fee",
        description: `${t.key} ${w}wk processing`, amount: t.processing.amount, isPercent: t.processing.percent,
        trigger: "ON_APPLICATION", beneficiary: "LENDER", applyAt: "DEDUCT_FROM_PRINCIPAL", productId: prod.id, isActive: true,
      },
      update: { amount: t.processing.amount, isPercent: t.processing.percent, applyAt: "DEDUCT_FROM_PRINCIPAL", productId: prod.id, isActive: true },
    });
    n++;
  }
  console.log(`  tier products: ${n} (INUKA/KUZA/FADHILI × ${WEEKS.length} terms) + processing charges`);
}

async function plan(orgId: string) {
  console.log("  DRY RUN — would apply:");
  console.log(`   · deactivate legacy: ${LEGACY.join(", ")}`);
  console.log(`   · joining fee ${money(300)} (ON_REGISTRATION)`);
  for (const t of TIERS) {
    console.log(`   · ${t.key}  ${money(t.min)}–${t.max >= 1_000_000 ? "Unlimited" : money(t.max)}  · processing ${t.processing.percent ? t.processing.amount + "%" : money(t.processing.amount)}`);
    for (const w of WEEKS) console.log(`       - ${productName(t.key, w)}  interest ${interestForWeeks(w)}%`);
  }
}

async function main() {
  const org = await prisma.org.findUnique({ where: { slug: "mular" }, select: { id: true, name: true } });
  if (!org) { console.error('No org with slug "mular".'); process.exit(1); }
  console.log(`${DOWN ? "Reverting" : DRY ? "Planning" : "Reseeding"} products for ${org.name} (${org.id})`);

  if (DRY) { await plan(org.id); }
  else if (DOWN) { await down(org.id); }
  else { await up(org.id); }

  const active = await prisma.product.findMany({ where: { orgId: org.id, isActive: true }, orderBy: [{ minPrincipal: "asc" }, { repaymentPeriod: "asc" }], select: { name: true, minPrincipal: true, maxPrincipal: true, interestRate: true } });
  console.log(`\n  ACTIVE catalogue now (${active.length}):`);
  for (const p of active) console.log(`   · ${p.name.padEnd(18)} ${money(Number(p.minPrincipal))}–${Number(p.maxPrincipal) >= 1_000_000 ? "∞" : money(Number(p.maxPrincipal))}  @ ${Number(p.interestRate)}%`);
  console.log(DRY ? "\n(dry run — nothing written)" : "\nDone.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
