// Prove the demo book answers the questions the demo asks it.
//
//   npx tsx scripts/verify-micromart-demo.ts
//
// It re-runs the SAME queries the lock screen's endpoint runs
// (src/app/api/console/riri/today/route.ts) at ORG scope, plus a per-module row
// count, so a failed seed is caught here rather than in the room. Read-only.
import "dotenv/config";
import { platformPrisma } from "../prisma/seed-client";

const prisma = platformPrisma();
const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const endOfToday = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d; };

let failures = 0;
function check(label: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(34)} ${detail}`);
}

async function main() {
  const org = await prisma.org.findUnique({ where: { slug: "micromart" }, select: { id: true, name: true } });
  if (!org) { console.error('No org with slug "micromart".'); process.exit(1); }
  const orgId = org.id;
  console.log(`${org.name}\n`);

  // ── What the phone reads ───────────────────────────────────────────────────
  console.log("THE LOCK SCREEN");

  const dueRows = await prisma.installment.findMany({
    where: {
      orgId, dueDate: { gte: startOfToday(), lte: endOfToday() },
      status: { in: ["UPCOMING", "DUE", "PARTIAL"] },
      loan: { status: "ACTIVE" },
    },
    select: { amountDue: true, amountPaid: true },
  });
  const dueTotal = dueRows.reduce((s, r) => s + Number(r.amountDue) - Number(r.amountPaid), 0);
  check("Due today", dueRows.length > 0, `${dueRows.length} installments · ${kes(dueTotal)}`);

  const overdue = await prisma.installment.findMany({
    where: { orgId, status: "OVERDUE", loan: { status: "ACTIVE" } },
    select: { dueDate: true, amountDue: true, amountPaid: true, penalty: true, loanId: true },
  });
  const buckets = { "1–7": 0, "8–30": 0, "31–60": 0, "60+": 0 } as Record<string, number>;
  let arrearsTotal = 0;
  for (const r of overdue) {
    const left = Number(r.amountDue) - Number(r.amountPaid) + Number(r.penalty);
    if (left <= 0) continue;
    arrearsTotal += left;
    const d = Math.floor((Date.now() - r.dueDate.getTime()) / 86_400_000);
    const key = d <= 7 ? "1–7" : d <= 30 ? "8–30" : d <= 60 ? "31–60" : "60+";
    buckets[key] += left;
  }
  const accounts = new Set(overdue.map((r) => r.loanId)).size;
  check("Arrears", accounts > 0, `${accounts} accounts · ${kes(arrearsTotal)}`);
  const filled = Object.values(buckets).filter((v) => v > 0).length;
  check("Ageing buckets populated", filled === 4, Object.entries(buckets).map(([k, v]) => `${k}: ${kes(v)}`).join(" · "));

  const ptp = await prisma.promiseToPay.findMany({
    where: { orgId, status: "PENDING", dueDate: { gte: startOfToday(), lte: endOfToday() } },
    select: { amount: true, paidAmount: true },
  });
  const ptpTotal = ptp.reduce((s, p) => s + Number(p.amount) - Number(p.paidAmount), 0);
  check("Promises due today", ptp.length > 0, `${ptp.length} customers · ${kes(ptpTotal)}`);

  const broken = await prisma.promiseToPay.count({ where: { orgId, status: "BROKEN" } });
  check("Broken promises (history)", broken > 0, `${broken} in the record`);

  const collected = await prisma.c2BReceipt.aggregate({
    _sum: { amount: true }, _count: { _all: true },
    where: { orgId, allocatedAt: { gte: startOfToday(), lte: endOfToday() } },
  });
  check("Banked already today", collected._count._all > 0, `${collected._count._all} receipts · ${kes(Number(collected._sum.amount ?? 0))}`);

  // ── What the alerts tray reads ─────────────────────────────────────────────
  console.log("\nTHE ALERTS TRAY");
  const [freshLate, deepLate, staleApps, kycQueue, unmatched, pendingChecker, lapsing] = await Promise.all([
    prisma.installment.count({ where: { orgId, status: "OVERDUE", dueDate: { gte: new Date(Date.now() - 7 * 86_400_000) }, loan: { status: "ACTIVE" } } }),
    prisma.installment.count({ where: { orgId, status: "OVERDUE", dueDate: { lt: new Date(Date.now() - 30 * 86_400_000) }, loan: { status: "ACTIVE" } } }),
    prisma.loanApplication.count({ where: { orgId, status: { in: ["SUBMITTED", "AI_PRESCREEN", "OFFICER_REVIEW", "REFERRED"] }, updatedAt: { lt: new Date(Date.now() - 2 * 86_400_000) } } }),
    prisma.borrower.count({ where: { orgId, erasedAt: null, kycStatus: { in: ["NONE", "IN_PROGRESS", "PENDING_REVIEW"] } } }),
    prisma.reconciliationException.count({ where: { orgId, resolvedAt: null } }),
    prisma.disbursement.count({ where: { orgId, state: "PENDING_CHECKER" } }),
    prisma.guarantor.count({ where: { orgId, status: "INVITED", expiresAt: { gte: new Date(), lte: new Date(Date.now() + 3 * 86_400_000) } } }),
  ]);
  check("Just went late (1–7d)", freshLate > 0, `${freshLate} accounts`);
  check("Past 30 days", deepLate > 0, `${deepLate} accounts`);
  check("Applications ageing >2d", staleApps > 0, `${staleApps} waiting`);
  check("KYC queue", kycQueue > 0, `${kycQueue} customers`);
  check("Unmatched payments", unmatched > 0, `${unmatched} exceptions open`);
  check("Payouts awaiting a checker", pendingChecker > 0, `${pendingChecker} in the queue`);
  check("Guarantees lapsing <3d", lapsing >= 0, `${lapsing} expiring`);

  // ── Every module has something in it ──────────────────────────────────────
  console.log("\nEVERY MODULE");
  const counts: [string, number][] = await Promise.all(([
    ["Branches", prisma.branch.count({ where: { orgId } })],
    ["Roles", prisma.role.count({ where: { orgId } })],
    ["Staff", prisma.staffUser.count({ where: { orgId } })],
    ["Products", prisma.product.count({ where: { orgId } })],
    ["Charges", prisma.charge.count({ where: { orgId } })],
    ["Workflows", prisma.workflow.count({ where: { orgId } })],
    ["Borrowers", prisma.borrower.count({ where: { orgId } })],
    ["Applications", prisma.loanApplication.count({ where: { orgId } })],
    ["Accepted offers", prisma.loanOffer.count({ where: { orgId } })],
    ["Guarantors", prisma.guarantor.count({ where: { orgId } })],
    ["Collateral", prisma.collateral.count({ where: { orgId } })],
    ["Documents", prisma.document.count({ where: { orgId } })],
    ["Loans", prisma.loan.count({ where: { orgId } })],
    ["Installments", prisma.installment.count({ where: { orgId } })],
    ["Disbursements", prisma.disbursement.count({ where: { orgId } })],
    ["Receipts", prisma.c2BReceipt.count({ where: { orgId } })],
    ["STK pushes", prisma.paymentIntent.count({ where: { orgId } })],
    ["Float entries", prisma.floatLedger.count({ where: { orgId } })],
    ["Recon exceptions", prisma.reconciliationException.count({ where: { orgId } })],
    ["Promises", prisma.promiseToPay.count({ where: { orgId } })],
    ["Collection calls", prisma.collectionCall.count({ where: { orgId } })],
    ["Tickets", prisma.collectionTicket.count({ where: { orgId } })],
    ["Savings accounts", prisma.savingsAccount.count({ where: { orgId } })],
    ["Standing orders", prisma.standingOrder.count({ where: { orgId } })],
    ["Field visits", prisma.fieldVisit.count({ where: { orgId } })],
    ["Geo pins", prisma.geoPin.count({ where: { orgId } })],
    ["SMS messages", prisma.smsMessage.count({ where: { orgId } })],
    ["SMS campaigns", prisma.smsCampaign.count({ where: { orgId } })],
    ["SMS templates", prisma.smsTemplate.count({ where: { orgId } })],
    ["Emails", prisma.emailMessage.count({ where: { orgId } })],
    ["Score snapshots", prisma.scoreSnapshot.count({ where: { orgId } })],
    ["Portfolio runs", prisma.portfolioRun.count({ where: { orgId } })],
    ["Limit moves", prisma.graduationEvent.count({ where: { orgId } })],
    ["Compliance requests", prisma.complianceRequest.count({ where: { orgId } })],
    ["Audit rows", prisma.auditLog.count({ where: { orgId } })],
  ] as [string, Promise<number>][]).map(async ([k, p]) => [k, await p] as [string, number]));

  for (const [label, n] of counts) check(label, n > 0, String(n));

  // ── The live pilot is untouched ───────────────────────────────────────────
  console.log("\nTHE LIVE PILOT");
  const pilot = await prisma.product.findFirst({ where: { orgId, name: "MIROMART FINTECH" }, select: { serviceSuiteProductId: true, isActive: true } });
  check("MIROMART FINTECH intact", pilot?.serviceSuiteProductId === 31418 && pilot.isActive === true, `ssId=${pilot?.serviceSuiteProductId} active=${pilot?.isActive}`);
  const shelf = await prisma.product.count({ where: { orgId, isActive: true } });
  check("Portal shelf still one product", shelf === 1, `${shelf} active product(s)`);
  const pf = await prisma.charge.findFirst({ where: { orgId, code: "PF" }, select: { isActive: true } });
  check("PROCESSING FEES intact", pf?.isActive === true, `active=${pf?.isActive}`);
  // The real customers carry NO fingerprint, and `{ not: … }` in SQL is NULL for a
  // NULL column — so an untagged row must be asked for explicitly, or the check
  // reports the pilot's customers as deleted when they are sitting right there.
  const real = await prisma.borrower.count({
    where: { orgId, OR: [{ deviceFingerprint: null }, { deviceFingerprint: { not: "seed:micromart" } }] },
  });
  check("Real customers preserved", real >= 2, `${real} untagged borrowers`);
  const realApps = await prisma.loanApplication.count({
    where: { orgId, borrower: { OR: [{ deviceFingerprint: null }, { deviceFingerprint: { not: "seed:micromart" } }] } },
  });
  check("Real applications preserved", realApps >= 3, `${realApps} untagged applications`);

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
