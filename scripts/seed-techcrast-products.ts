// Seed Techcrast's product shelf — a graduated lineup, on purpose.
//
//   npx tsx scripts/seed-techcrast-products.ts techcrast
//
// The point of the shelf is to SHOW the limit engine working: one borrower, one
// crunched statement, and the affordability-first engine (lib/lending/limits.ts)
// clearing them for a DIFFERENT NUMBER of products depending on their cashflow and
// their history with us. A thin-cashflow first-timer clears only the universal
// "4 Weeks Loan"; a stronger book clears three; a graduated trader clears five or
// more. Nothing here decides that — the product FLOORS (minLoanLimit) do, against a
// principal the engine sizes from the statement and caps on the new-borrower ladder.
//
// The universal product the founder asked for is PRODUCT 1: a 4-week loan, four
// EQUAL weekly installments (flat interest makes them equal), priced at ~6.25% a
// week. Our schedule reads `interestRate` as the rate for the WHOLE term
// (lib/lending/schedule.ts), so 4 × 6.25% = 25% flat over the four weeks.
//
// Idempotent: matched by (orgId, name), so re-running reprices rather than duplicating.
//
// ⚠ Run `npm run db:push` FIRST — this seeds the new curated product columns
//   (interestType, earlySettlement*, repaymentOrder, minLoanLimit, guarantorReborrow).
import "dotenv/config";
import { platformPrisma } from "../prisma/seed-client";
import { enterPlatform } from "../src/lib/db/context";

type Seed = {
  name: string;
  description: string;
  minPrincipal: number;
  maxPrincipal: number;
  interestRate: number; // percent for the whole term
  interestMethod: "flat" | "reducing";
  repaymentPeriod: number;
  repaymentPeriodUnit: "day" | "week" | "month";
  minLoanLimit: number;
  guarantorRequired?: boolean;
  securityRequired?: boolean;
  securityCoverPct?: number;
  earlySettlementEnabled?: boolean;
  earlySettlementDays?: number;
  earlySettlementRate?: number;
  tier: string;
};

// Ordered small → large. The `tier` label is only for the console summary.
const PRODUCTS: Seed[] = [
  {
    tier: "Universal",
    name: "4 Weeks Loan",
    description: "The starter everyone qualifies for. Four equal weekly installments at about 6.25% a week (25% over the four weeks). No guarantor.",
    minPrincipal: 500, maxPrincipal: 20_000, interestRate: 25, interestMethod: "flat",
    repaymentPeriod: 4, repaymentPeriodUnit: "week", minLoanLimit: 500,
    earlySettlementEnabled: false,
  },
  {
    tier: "Small",
    name: "Daily Duka Float",
    description: "A short working-capital float for a shop, repaid in 20 small daily drops.",
    minPrincipal: 500, maxPrincipal: 15_000, interestRate: 20, interestMethod: "flat",
    repaymentPeriod: 20, repaymentPeriodUnit: "day", minLoanLimit: 1_000,
  },
  {
    tier: "Small",
    name: "Boda Weekly",
    description: "Eight weekly installments for riders and hawkers.",
    minPrincipal: 1_000, maxPrincipal: 30_000, interestRate: 24, interestMethod: "flat",
    repaymentPeriod: 8, repaymentPeriodUnit: "week", minLoanLimit: 2_000,
  },
  {
    tier: "Mid",
    name: "Biashara Boost",
    description: "Reducing-balance working capital over three months for established traders.",
    minPrincipal: 5_000, maxPrincipal: 80_000, interestRate: 15, interestMethod: "reducing",
    repaymentPeriod: 3, repaymentPeriodUnit: "month", minLoanLimit: 10_000,
    earlySettlementEnabled: true, earlySettlementDays: 30, earlySettlementRate: 50,
  },
  {
    tier: "Mid",
    name: "Stawi Growth",
    description: "A four-month growth loan. One guarantor required.",
    minPrincipal: 10_000, maxPrincipal: 150_000, interestRate: 14, interestMethod: "reducing",
    repaymentPeriod: 4, repaymentPeriodUnit: "month", minLoanLimit: 20_000,
    guarantorRequired: true,
    earlySettlementEnabled: true, earlySettlementDays: 45, earlySettlementRate: 50,
  },
  {
    tier: "Upper",
    name: "SME Advance",
    description: "Six-month term finance for a small business with a repayment record. Guarantor required.",
    minPrincipal: 30_000, maxPrincipal: 300_000, interestRate: 13, interestMethod: "reducing",
    repaymentPeriod: 6, repaymentPeriodUnit: "month", minLoanLimit: 50_000,
    guarantorRequired: true,
  },
  {
    tier: "Upper",
    name: "Asset Finance",
    description: "Nine-month secured finance. Guarantor and collateral covering 120% of principal.",
    minPrincipal: 50_000, maxPrincipal: 500_000, interestRate: 12, interestMethod: "reducing",
    repaymentPeriod: 9, repaymentPeriodUnit: "month", minLoanLimit: 100_000,
    guarantorRequired: true, securityRequired: true, securityCoverPct: 120,
  },
  {
    tier: "Top",
    name: "Corporate Line",
    description: "A twelve-month secured line for graduated corporate borrowers. Guarantor and security required.",
    minPrincipal: 100_000, maxPrincipal: 1_000_000, interestRate: 11, interestMethod: "reducing",
    repaymentPeriod: 12, repaymentPeriodUnit: "month", minLoanLimit: 250_000,
    guarantorRequired: true, securityRequired: true, securityCoverPct: 125,
  },
];

async function main() {
  const slug = (process.argv[2] ?? "techcrast").trim().toLowerCase();
  const p = platformPrisma();
  enterPlatform();

  const org = await p.org.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!org) throw new Error(`No org with slug "${slug}".`);
  console.log(`Org: ${org.name} (${slug})`);

  // Attach the org's default approval workflow when it has one; the product falls
  // back to the platform two-tier default when newWorkflowId is null.
  const wf = await p.workflow.findFirst({ where: { orgId: org.id }, orderBy: { createdAt: "asc" }, select: { id: true, title: true } });
  if (wf) console.log(`Workflow: ${wf.title}\n`);
  else console.log("Workflow: (none found — products use the default two-tier)\n");

  for (const s of PRODUCTS) {
    const data = {
      orgId: org.id,
      name: s.name,
      description: s.description,
      minPrincipal: s.minPrincipal,
      maxPrincipal: s.maxPrincipal,
      interestRate: s.interestRate,
      interestMethod: s.interestMethod,
      interestType: "fixed",
      principalType: "standard",
      interestPeriodUnit: "term",
      repaymentPeriod: s.repaymentPeriod,
      repaymentPeriodUnit: s.repaymentPeriodUnit,
      gracePeriodDays: 0,
      penaltyRate: 5,
      earlySettlementEnabled: s.earlySettlementEnabled ?? false,
      earlySettlementDays: s.earlySettlementDays ?? null,
      earlySettlementRate: s.earlySettlementRate ?? null,
      repaymentOrder: "penalty,interest,principal,fees",
      minLoanLimit: s.minLoanLimit,
      guarantorRequired: s.guarantorRequired ?? false,
      guarantorReborrow: false,
      securityRequired: s.securityRequired ?? false,
      securityCoverPct: s.securityCoverPct ?? 100,
      disbursementMode: "B2C_MPESA" as const,
      isActive: true,
      newWorkflowId: wf?.id ?? null,
      repeatWorkflowId: wf?.id ?? null,
    };

    const existing = await p.product.findFirst({ where: { orgId: org.id, name: s.name }, select: { id: true } });
    if (existing) {
      await p.product.update({ where: { id: existing.id }, data });
      console.log(`  updated  [${s.tier.padEnd(9)}] ${s.name}`);
    } else {
      await p.product.create({ data });
      console.log(`  created  [${s.tier.padEnd(9)}] ${s.name}`);
    }
    const req = [s.guarantorRequired && "guarantor", s.securityRequired && "security"].filter(Boolean).join(" + ") || "none";
    console.log(
      `           KES ${s.minPrincipal.toLocaleString()}–${s.maxPrincipal.toLocaleString()} · ` +
      `${s.interestRate}% ${s.interestMethod} · ${s.repaymentPeriod}×${s.repaymentPeriodUnit} · ` +
      `floor KES ${s.minLoanLimit.toLocaleString()} · requires ${req}`,
    );
  }

  const total = await p.product.count({ where: { orgId: org.id, isActive: true } });
  console.log(`\n${slug}: ${total} active product(s) on the shelf.`);
  console.log(
    "\nWhy the spread: the engine sizes a principal from the statement, caps a first-timer\n" +
    "on the KES 25,000 new-borrower ladder, then drops any product whose minimum (floor)\n" +
    "sits above it. Thin cashflow + no history → only '4 Weeks Loan'. Stronger cashflow →\n" +
    "the small and mid tiers. A graduated book lifts the ladder and unlocks the upper tiers.",
  );
  await p.$disconnect();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
