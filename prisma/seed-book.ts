// ─────────────────────────────────────────────────────────────────────────────
// SEED A NATIVE BOOK — additive test data for a REAL org.
//
//   npm run db:seed:book -- techcrast
//
// The demo org gets wiped and rebuilt; a real org must never be. This script
// ADDS a working loan book to an existing NATIVE org so its team can see every
// screen with something on it — dashboard, portfolio health, early warning,
// collections, KYC review, the closed ML loop — without touching a single row
// they created themselves.
//
// Everything it creates is marked: borrowers carry phones in the 254708555xxx
// Safaricom TEST range and portfolio runs carry trigger "seed", so re-running
// replaces ONLY its own previous output (delete-by-marker, child→parent), and
// a cleanup later can remove it surgically.
//
// The money is real double-entry, same as the demo: every paid installment has
// the allocated C2B receipt that paid it, every disbursement has its float
// ledger entry — so "collected" and reconciliation read true, not zero.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import type { Prisma } from "@prisma/client";
import { platformPrisma } from "./seed-client";
import { runWithOrg } from "../src/lib/db/context";
import { portfolioEarlyWarning } from "../src/lib/intelligence/earlywarning";
import { runPortfolio, compactRows, movementBetween, type CompactRow } from "../src/lib/intelligence/portfolio";
import { buildSchedule } from "../src/lib/lending/schedule";
import { hashTerms } from "../src/lib/lending/terms";
import { computeApprovedLimit } from "../src/lib/lending/limits";

const prisma = platformPrisma();

const PHONE_PREFIX = "254708555"; // Safaricom test range — the marker for everything this script owns
const D = (n: number) => new Date(Date.now() - n * 86400000);
const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => Math.round(n);

type Persona = {
  first: string; other: string; nid: string; phoneSuffix: string; score: number;
  biz: string; lat: number; lng: number;
  book: "cleared2" | "active" | "arrears" | "pending" | "review" | "fresh";
};

// A believable small book: history, health, trouble, a decision waiting, a
// review case for the vouch feature, and one fresh unverified walk-in.
const PERSONAS: Persona[] = [
  { first: "Naomi", other: "Wanjiru", nid: "28114455", phoneSuffix: "001", score: 742, biz: "Gikomba stall", lat: -1.2833, lng: 36.8344, book: "cleared2" },
  { first: "Dennis", other: "Otieno", nid: "30225566", phoneSuffix: "002", score: 715, biz: "Boda spares", lat: -1.2726, lng: 36.8509, book: "cleared2" },
  { first: "Faith", other: "Chebet", nid: "31336677", phoneSuffix: "003", score: 698, biz: "Salon", lat: -1.2676, lng: 36.8108, book: "active" },
  { first: "Kevin", other: "Mutua", nid: "27447788", phoneSuffix: "004", score: 671, biz: "Greengrocer", lat: -1.2867, lng: 36.7517, book: "active" },
  { first: "Aisha", other: "Adhiambo", nid: "32558899", phoneSuffix: "005", score: 705, biz: "Tailoring", lat: -1.32, lng: 36.914, book: "active" },
  { first: "Samuel", other: "Kiplagat", nid: "26669900", phoneSuffix: "006", score: 588, biz: "Hardware", lat: -1.22, lng: 36.8969, book: "arrears" },
  { first: "Grace", other: "Njeri", nid: "33770011", phoneSuffix: "007", score: 688, biz: "Cereal shop", lat: -1.273, lng: 36.828, book: "pending" },
  { first: "Josephat", other: "Barasa", nid: "25881122", phoneSuffix: "008", score: 640, biz: "Butchery", lat: -1.319, lng: 36.706, book: "review" },
];

async function main() {
  const slug = process.argv[2]?.trim();
  if (!slug) { console.error("Usage: npm run db:seed:book -- <org-slug>"); process.exit(1); }

  const org = await prisma.org.findUnique({ where: { slug } });
  if (!org) { console.error(`No org with slug "${slug}".`); process.exit(1); }
  if (org.mode !== "NATIVE") { console.error(`${org.name} is ${org.mode} — this seeds NATIVE books only.`); process.exit(1); }

  // ── Remove ONLY what a previous run of this script created ────────────────
  const mine = await prisma.borrower.findMany({
    where: { orgId: org.id, phone: { startsWith: PHONE_PREFIX } },
    select: { id: true },
  });
  const ids = mine.map((b) => b.id);
  if (ids.length) {
    const loanIds = (await prisma.loan.findMany({ where: { orgId: org.id, borrowerId: { in: ids } }, select: { id: true } })).map((l) => l.id);
    await prisma.c2BReceipt.deleteMany({ where: { orgId: org.id, allocatedLoanId: { in: loanIds } } });
    await prisma.disbursement.deleteMany({ where: { orgId: org.id, loanId: { in: loanIds } } });
    await prisma.installment.deleteMany({ where: { orgId: org.id, loanId: { in: loanIds } } });
    await prisma.promiseToPay.deleteMany({ where: { orgId: org.id, borrowerId: { in: ids } } });
    await prisma.collectionCall.deleteMany({ where: { orgId: org.id, borrowerId: { in: ids } } });
    await prisma.collectionTicket.deleteMany({ where: { orgId: org.id, borrowerId: { in: ids } } });
    await prisma.loanOffer.deleteMany({ where: { orgId: org.id, borrowerId: { in: ids } } });
    await prisma.loan.deleteMany({ where: { orgId: org.id, id: { in: loanIds } } });
    await prisma.loanApplication.deleteMany({ where: { orgId: org.id, borrowerId: { in: ids } } });
    await prisma.scoreSnapshot.deleteMany({ where: { orgId: org.id, OR: [{ borrowerId: { in: ids } }, { capturedBy: "seed-book" }] } });
    await prisma.fieldVisit.deleteMany({ where: { orgId: org.id, borrowerId: { in: ids } } });
    await prisma.kycCheck.deleteMany({ where: { orgId: org.id, borrowerId: { in: ids } } });
    await prisma.kycSession.deleteMany({ where: { orgId: org.id, borrowerId: { in: ids } } });
    await prisma.consent.deleteMany({ where: { orgId: org.id, borrowerId: { in: ids } } });
    await prisma.geoPin.deleteMany({ where: { orgId: org.id, borrowerId: { in: ids } } });
    await prisma.borrower.deleteMany({ where: { orgId: org.id, id: { in: ids } } });
    await prisma.floatLedger.deleteMany({ where: { orgId: org.id, ref: { startsWith: "SEEDBOOK" } } });
    await prisma.portfolioRun.deleteMany({ where: { orgId: org.id, trigger: "seed" } });
    console.log(`Replaced this script's previous output (${ids.length} borrowers).`);
  }

  // ── The org's own furniture, never invented twice ──────────────────────────
  const branch =
    (await prisma.branch.findFirst({ where: { orgId: org.id, parentId: null }, orderBy: { createdAt: "asc" } })) ??
    (await prisma.branch.create({ data: { orgId: org.id, name: "Head Office", levelName: "Head Office", code: "HQ", lat: -1.2921, lng: 36.8219 } }));

  const staff = await prisma.staffUser.findMany({ where: { orgId: org.id, status: "ACTIVE" }, orderBy: { createdAt: "asc" }, take: 2 });
  if (!staff.length) { console.error("The org has no active staff to attribute the book to."); process.exit(1); }
  const officerId = staff[0].id;
  const checkerId = staff[1]?.id ?? staff[0].id;

  const product =
    (await prisma.product.findFirst({ where: { orgId: org.id, isActive: true }, orderBy: { createdAt: "asc" } })) ??
    (await prisma.product.create({
      data: {
        orgId: org.id, name: "Business Boost", description: "Working capital for traders",
        interestRate: 12, interestMethod: "flat", repaymentPeriod: 3, repaymentPeriodUnit: "month",
        minPrincipal: 5000, maxPrincipal: 150000, isActive: true,
      },
    }));
  const rate = Number(product.interestRate);
  const n = product.repaymentPeriod;

  // Float to disburse from — one marked top-up.
  const lastFloat = await prisma.floatLedger.findFirst({ where: { orgId: org.id }, orderBy: { createdAt: "desc" } });
  let floatBalance = round2(Number(lastFloat?.balanceAfter ?? 0) + 500_000);
  await prisma.floatLedger.create({
    data: { orgId: org.id, kind: "TOPUP", amount: 500_000, balanceAfter: floatBalance, ref: "SEEDBOOK-TOPUP", note: "Test-book float", createdBy: officerId, createdAt: D(220) },
  });

  const counts = { borrowers: 0, loans: 0, receipts: 0, snapshots: 0 };

  for (const [i, p] of PERSONAS.entries()) {
    const phone = `${PHONE_PREFIX}${p.phoneSuffix}`;
    const verified = p.book !== "review" && p.book !== "fresh";

    const borrower = await prisma.borrower.create({
      data: {
        orgId: org.id, branchId: branch.id, createdById: officerId,
        phone, nationalId: p.nid, firstName: p.first, otherName: p.other,
        kycStatus: verified ? "VERIFIED" : "PENDING_REVIEW",
        kycVerifiedAt: verified ? D(150 - i) : null,
        creditScore: p.score, graduationCount: p.book === "cleared2" ? 2 : 0,
        livenessPassed: verified ? true : null,
        faceMatchScore: verified ? 90 + (i % 8) : 74,
        iprsVerified: true,
        lat: p.lat, lng: p.lng, locationType: "business", locationAddress: `${p.biz}, Nairobi`,
      },
    });
    counts.borrowers++;

    await prisma.kycSession.create({
      data: {
        orgId: org.id, borrowerId: borrower.id, phone, nationalId: p.nid, provider: "simulation",
        idQualityScore: 88 + (i % 9), idOcrName: `${p.first} ${p.other}`, idOcrNumber: p.nid,
        livenessScore: verified ? 88 + (i % 9) : 81, livenessPassed: true,
        faceMatchScore: verified ? 90 + (i % 8) : 74, // 74 = the review band: a human must look
        iprsMatched: true, iprsName: `${p.first} ${p.other}`,
        status: verified ? "VERIFIED" : "PENDING_REVIEW",
        riskFlags: verified ? [] : ["face-mismatch"],
        completedAt: D(150 - i),
      },
    });

    const makeApp = async (opts: { amount: number; score: number; pd: number; outcome: string; daysAgo: number; status?: string; withLimit?: boolean }) => {
      const limit = computeApprovedLimit({
        pd: opts.pd, decision: "APPROVE",
        avgMonthlyNet: 18_000 + i * 4_000,
        priorLoanCount: p.book === "cleared2" ? 2 : 0, graduated: false,
        largestCleared: p.book === "cleared2" ? 30_000 : null,
        productMin: Number(product.minPrincipal), productMax: Number(product.maxPrincipal),
      });
      const app = await prisma.loanApplication.create({
        data: {
          orgId: org.id, officerId, branchId: branch.id, borrowerId: borrower.id,
          productId: product.id, productName: product.name,
          phone, nationalId: p.nid, borrowerName: `${p.first} ${p.other}`,
          amountRequested: opts.amount, status: (opts.status ?? "DISBURSED") as never, stageTitle: opts.status ?? "DISBURSED",
          score: opts.score, pd: opts.pd, scoreModelVersion: "fused(thinfile-v2+origination-v2)", fusionEngine: "fused",
          decision: "APPROVE",
          approvedLimit: opts.withLimit === false ? null : limit.approvedLimit,
          reasonCodes: [
            { code: "STB", factor: "Income stability", points: 48, direction: "up", detail: "Regular paybill takings" },
            { code: "AFF", factor: "Affordability", points: opts.score > 650 ? 36 : -20, direction: opts.score > 650 ? "up" : "down", detail: "Cashflow vs installment" },
            ...limit.reasons,
          ] as unknown as Prisma.InputJsonValue,
          featuresSnapshot: { avgMonthlyIncome: 42_000 + i * 6_000, avgMonthlyNet: 18_000 + i * 4_000, incomeVolatility: 0.18 + (i % 5) * 0.04, gamblingRatio: 0 },
          outcome: opts.outcome, outcomeObservedAt: opts.outcome !== "PENDING" ? D(opts.daysAgo - 6) : null,
          createdAt: D(opts.daysAgo), decidedAt: D(opts.daysAgo),
        },
      });
      await prisma.scoreSnapshot.create({
        data: {
          orgId: org.id, borrowerId: borrower.id, applicationId: app.id, modelKind: "fused", modelVersion: "fused-v2",
          score: opts.score, pd: opts.pd, riskBand: opts.score >= 700 ? "Low risk" : opts.score >= 620 ? "Moderate risk" : "Elevated risk",
          outcome: opts.outcome, outcomeObservedAt: opts.outcome !== "PENDING" ? D(opts.daysAgo - 6) : null,
          loanContextAmount: opts.amount, capturedBy: "seed-book", createdAt: D(opts.daysAgo),
        },
      });
      counts.snapshots++;
      return app;
    };

    const bookLoan = async (app: { id: string }, amount: number, daysAgo: number, state: "active" | "cleared" | "arrears") => {
      const interest = round2((amount * rate) / 100);
      const total = round2(amount + interest);
      const per = round2(total / n);
      const perP = round2(amount / n);
      const rows = Array.from({ length: n }, (_, s) => ({
        seq: s + 1,
        due: s === n - 1 ? round2(total - per * (n - 1)) : per,
        prin: perP, int: round2(per - perP),
        date: new Date(D(daysAgo).getTime() + (s + 1) * 30 * 86400000),
      }));
      const cleared = state === "cleared";
      const loan = await prisma.loan.create({
        data: {
          orgId: org.id, borrowerId: borrower.id, applicationId: app.id, productId: product.id,
          principal: amount, interest, loanAmount: total,
          balance: cleared ? 0 : state === "arrears" ? total : round2(total * 0.55),
          status: cleared ? "CLEARED" : "ACTIVE", borrowDate: D(daysAgo), disbursedAt: D(daysAgo - 1),
          expectedClearDate: rows[rows.length - 1].date, clearedAt: cleared ? D(daysAgo - 15) : null,
          createdBy: officerId, branchId: branch.id,
        },
      });
      counts.loans++;
      const isPaid = (idx: number) => cleared || (state === "active" && idx < Math.floor(n * 0.4));
      await prisma.installment.createMany({
        data: rows.map((r, idx) => ({
          orgId: org.id, loanId: loan.id, seq: r.seq,
          dueDate: state === "arrears" && idx === 0 ? D(daysAgo - 48) : r.date,
          amountDue: r.due, principalDue: r.prin, interestDue: r.int,
          amountPaid: isPaid(idx) ? r.due : 0,
          status: cleared ? "PAID" : state === "arrears" && idx === 0 ? "OVERDUE" : isPaid(idx) ? "PAID" : "UPCOMING",
          penalty: state === "arrears" && idx === 0 ? round2(r.due * 0.05) : 0,
        })),
      });
      for (const [idx, r] of rows.entries()) {
        if (!isPaid(idx)) continue;
        const receivedAt = new Date(Math.min(r.date.getTime(), Date.now() - 3_600_000));
        await prisma.c2BReceipt.create({
          data: {
            orgId: org.id, transId: `SBK${loan.id.slice(0, 6).toUpperCase()}${r.seq}`,
            amount: r.due, phone, billRef: p.nid,
            allocatedLoanId: loan.id, allocatedAt: receivedAt, createdAt: receivedAt,
          },
        });
        counts.receipts++;
      }
      await prisma.disbursement.create({
        data: { orgId: org.id, loanId: loan.id, amount, phone, state: "CONFIRMED", makerId: officerId, checkerId, receiptRef: `SEEDBOOK${daysAgo}${i}`, createdAt: D(daysAgo - 1) },
      });
      floatBalance = round2(floatBalance - amount);
      await prisma.floatLedger.create({
        data: { orgId: org.id, kind: "DISBURSE", amount: -amount, balanceAfter: floatBalance, ref: `SEEDBOOK${daysAgo}${i}`, note: `Loan ${loan.id.slice(0, 8)}`, createdBy: checkerId, createdAt: D(daysAgo - 1) },
      });
      return loan;
    };

    if (p.book === "cleared2") {
      for (let k = 0; k < 2; k++) {
        const amount = 20_000 + k * 10_000;
        const app = await makeApp({ amount, score: p.score - 12 + k * 6, pd: 0.09, outcome: "REPAID", daysAgo: 210 - k * 60 });
        await bookLoan(app, amount, 210 - k * 60, "cleared");
      }
      const app = await makeApp({ amount: 45_000, score: p.score, pd: 0.08, outcome: "PENDING", daysAgo: 35 });
      await bookLoan(app, 45_000, 35, "active");
    }
    if (p.book === "active") {
      const app = await makeApp({ amount: 25_000 + i * 5_000, score: p.score, pd: 0.11, outcome: "PENDING", daysAgo: 30 + i * 5 });
      await bookLoan(app, 25_000 + i * 5_000, 30 + i * 5, "active");
    }
    if (p.book === "arrears") {
      const app = await makeApp({ amount: 30_000, score: p.score, pd: 0.31, outcome: "PENDING", daysAgo: 75 });
      const loan = await bookLoan(app, 30_000, 75, "arrears");
      const ptp = await prisma.promiseToPay.create({
        data: {
          orgId: org.id, loanId: loan.id, borrowerId: borrower.id,
          amount: 6_000, dueDate: D(9), status: "BROKEN", paidAmount: 0,
          note: "Hardware supplies stuck at the border; promised by end of week.",
          createdBy: officerId, createdAt: D(13), resolvedAt: D(8),
        },
      });
      await prisma.collectionCall.create({
        data: { orgId: org.id, loanId: loan.id, borrowerId: borrower.id, outcome: "PROMISE_TO_PAY", note: "Reached him at the shop; promised KES 6,000.", ptpId: ptp.id, createdBy: officerId, createdAt: D(13) },
      });
    }
    if (p.book === "pending") {
      const app = await makeApp({ amount: 35_000, score: p.score, pd: 0.14, outcome: "PENDING", daysAgo: 2, status: "OFFICER_REVIEW" });
      // A signed agreement, built by the live path's own code, so approval can book.
      const borrowDate = D(2);
      const sched = buildSchedule({ principal: 35_000, rate, count: n, unit: product.repaymentPeriodUnit, method: "flat", graceDays: product.gracePeriodDays ?? 0, borrowDate });
      const terms = {
        principal: 35_000, interestRate: rate, interestMethod: "flat" as const,
        termCount: n, termUnit: product.repaymentPeriodUnit, graceDays: product.gracePeriodDays ?? 0,
        totalInterest: sched.interest, totalRepayable: sched.loanAmount, borrowDate,
      };
      await prisma.loanOffer.create({
        data: {
          orgId: org.id, applicationId: app.id, borrowerId: borrower.id, productId: product.id,
          principal: 35_000, interestRate: rate, interestMethod: "flat",
          termCount: n, termUnit: product.repaymentPeriodUnit, graceDays: product.gracePeriodDays ?? 0,
          totalInterest: sched.interest, totalRepayable: sched.loanAmount,
          borrowDate, firstDueDate: sched.firstDueDate, expectedClearDate: sched.expectedClearDate,
          schedule: sched.rows.map((r) => ({ seq: r.seq, dueDate: r.dueDate.toISOString(), amountDue: r.amountDue, principalDue: r.principalDue, interestDue: r.interestDue })),
          termsHash: hashTerms(terms),
          status: "ACCEPTED", acceptedAt: borrowDate, channel: "BRANCH",
          recordedBy: officerId, branchNote: "Signed at the counter; national ID sighted.",
          expiresAt: new Date(borrowDate.getTime() + 7 * 86400000),
        },
      });
    }
    // "review" and "fresh" personas carry no loans — they are the KYC showcase.
  }

  // ── Drift cohorts: months of scoring history + realised outcomes ────────────
  const seededBorrowers = await prisma.borrower.findMany({ where: { orgId: org.id, phone: { startsWith: PHONE_PREFIX } }, select: { id: true } });
  const pick = <T,>(arr: T[], i: number) => arr[i % arr.length];
  const cohort: Prisma.ScoreSnapshotCreateManyInput[] = [];
  for (let i = 0; i < 28; i++) {
    const outcome = i >= 24 ? "PENDING" : [4, 13, 22].includes(i) ? "DEFAULTED" : "REPAID";
    cohort.push({
      orgId: org.id, borrowerId: pick(seededBorrowers, i).id, modelKind: "pooled-v3", modelVersion: "pooled-v3.1",
      score: 620 + ((i * 13) % 182), pd: 0.06 + (i % 7) * 0.01, riskBand: "Moderate risk",
      outcome, outcomeObservedAt: outcome !== "PENDING" ? D(220 - i * 4 - 45) : null,
      capturedBy: "seed-book", createdAt: D(220 - i * 4),
    });
  }
  for (let i = 0; i < 18; i++) {
    cohort.push({
      orgId: org.id, borrowerId: pick(seededBorrowers, i + 3).id, modelKind: "pooled-v3", modelVersion: "pooled-v3.1",
      score: 605 + ((i * 13) % 182), pd: 0.1 + (i % 6) * 0.015, riskBand: "Moderate risk",
      outcome: "PENDING", capturedBy: "seed-book", createdAt: D(80 - i * 4),
    });
  }
  await prisma.scoreSnapshot.createMany({ data: cohort });
  counts.snapshots += cohort.length;

  // ── Two weeks of portfolio runs, then today's by the real engine ────────────
  const ewNow = await runWithOrg(org.id, () => portfolioEarlyWarning(org.id));
  if (ewNow.rows.length) {
    const rowsNow = compactRows(ewNow.rows);
    let prevRows: CompactRow[] | null = null;
    for (let d = 13; d >= 1; d--) {
      const ramp = 0.8 + (0.2 * (13 - d)) / 13;
      let rows = rowsNow.map((r) => ({ ...r, dpd: Math.max(0, r.dpd - d), s: Math.max(20, r.s - d) }));
      if (d === 1) {
        if (rows.length > 1) rows = rows.slice(0, -1);
        if (rows[0]?.band === "HIGH") rows[0] = { ...rows[0], band: "ELEVATED", s: Math.min(rows[0].s, 60) };
      }
      const move = movementBetween(prevRows, rows);
      await prisma.portfolioRun.create({
        data: {
          orgId: org.id, ranAt: D(d), trigger: "seed", policy: "default",
          activeLoans: ewNow.rows.length + 3,
          olb: money(ewNow.tiles.olb),
          atRiskValue: money(ewNow.tiles.atRiskValue * ramp),
          projectedLoss: money(ewNow.tiles.projectedLoss * ramp),
          watchlist: rows.length,
          high: rows.filter((r) => r.band === "HIGH").length,
          elevated: rows.filter((r) => r.band === "ELEVATED").length,
          entered: prevRows ? move.entered.length : 0, left: move.left.length,
          escalated: move.escalated.length, improved: move.improved.length,
          rows: rows as never,
        },
      });
      prevRows = rows;
    }
    await runWithOrg(org.id, () => runPortfolio(org.id, "seed"));
  }

  console.log(`Seeded ${org.name}:`, JSON.stringify({
    ...counts,
    portfolioRuns: await prisma.portfolioRun.count({ where: { orgId: org.id, trigger: "seed" } }),
  }));
  console.log("Real customers and staff untouched. Re-running replaces only this script's own rows.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
