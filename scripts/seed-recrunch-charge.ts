// Turn ON the customer-paid Statement Refresh for a lender.
//
//   npx tsx scripts/seed-recrunch-charge.ts <org-slug> [priceKES]   # on (default 50)
//   npx tsx scripts/seed-recrunch-charge.ts <org-slug> --down       # off
//
// It's just a Charge (code RECRUNCH) — the portal reads its price, and the lender
// can re-price or switch it off from the Charges screen like any other fee. Set to
// MANUAL/ON_INSTALLMENTS so it never gets swept into the before-disbursement gate
// that blocks a loan.
import "dotenv/config";
import { platformPrisma } from "../prisma/seed-client";

const prisma = platformPrisma();

async function main() {
  const slug = process.argv[2]?.trim();
  const remove = process.argv.includes("--down");
  const price = Number(process.argv[3]) || 50;
  if (!slug || slug.startsWith("--")) {
    console.error("Usage: npx tsx scripts/seed-recrunch-charge.ts <org-slug> [priceKES] [--down]");
    process.exit(1);
  }

  const org = await prisma.org.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!org) { console.error(`No org with slug "${slug}".`); process.exit(1); }

  if (remove) {
    const { count } = await prisma.charge.deleteMany({ where: { orgId: org.id, code: "RECRUNCH" } });
    console.log(`Removed the Statement Refresh charge from ${org.name} (${count}).`);
    return;
  }

  const existing = await prisma.charge.findFirst({ where: { orgId: org.id, code: "RECRUNCH" }, select: { id: true } });
  if (existing) {
    await prisma.charge.update({ where: { id: existing.id }, data: { amount: price, isPercent: false, isActive: true, name: "Statement Refresh" } });
    console.log(`Updated Statement Refresh on ${org.name} → KES ${price}.`);
  } else {
    await prisma.charge.create({
      data: {
        orgId: org.id, name: "Statement Refresh", code: "RECRUNCH",
        description: "Customer-paid Internal Report refresh on the portal.",
        amount: price, isPercent: false, beneficiary: "LENDER",
        trigger: "MANUAL", applyAt: "ON_INSTALLMENTS", isActive: true,
      },
    });
    console.log(`Created Statement Refresh on ${org.name} → KES ${price}.`);
  }
  console.log("Customers can now refresh their Internal Report from /myloan (pay-before-crunch).");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
