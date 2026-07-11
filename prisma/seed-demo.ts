// ─────────────────────────────────────────────────────────────────────────────
// DEMO ENVIRONMENT — "BirgenAI Demo Microfinance".
//
// One command builds a living, breathing lender you can walk any stakeholder
// through: a full team (every role), borrowers at every lifecycle stage, loans
// active/cleared/in-arrears, geolocated field agents with pending visits, KYC
// sessions, and — crucially — the CLOSED ML LOOP: score snapshots with realised
// good/bad outcomes so the intelligence layer has real training signal on day 1.
//
//   npm run db:seed:demo         (idempotent — wipes & rebuilds the demo org)
//
// All demo accounts share the password: Demo1234! (shown on /demo).
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { OrgMode, OrgStatus, OrgPlan } from "@prisma/client";
import bcrypt from "bcryptjs";
import { platformPrisma } from "./seed-client";
import { buildSchedule } from "../src/lib/lending/schedule";
import { hashTerms } from "../src/lib/lending/terms";

// Seeds write across orgs, so they connect platform-scoped (see seed-client.ts).
const prisma = platformPrisma();

const SLUG = "demo";
const PASSWORD = "Demo1234!";
const D = (n: number) => new Date(Date.now() - n * 86400000);
const pick = <T,>(arr: T[], i: number) => arr[i % arr.length];
const money = (n: number) => Math.round(n);

// Nairobi-ish coordinates for agents + borrower businesses.
const SPOTS = [
  { name: "Gikomba Market", lat: -1.2833, lng: 36.8344 },
  { name: "Westlands", lat: -1.2676, lng: 36.8108 },
  { name: "Kawangware", lat: -1.2867, lng: 36.7517 },
  { name: "Embakasi", lat: -1.32, lng: 36.914 },
  { name: "Kasarani", lat: -1.22, lng: 36.8969 },
  { name: "Karen", lat: -1.319, lng: 36.706 },
  { name: "Eastleigh", lat: -1.2726, lng: 36.8509 },
  { name: "Ngara", lat: -1.273, lng: 36.828 },
];

const STAFF = [
  { first: "Amina", other: "Yusuf", email: "admin@demo.birgenai.com", title: "Org Admin", role: "Org Admin", tiers: [1, 1, 1], field: false },
  { first: "Brian", other: "Otieno", email: "officer@demo.birgenai.com", title: "Loan Officer", role: "Loan Officer", tiers: [1, 0, 0], field: false },
  { first: "Carol", other: "Njeri", email: "manager@demo.birgenai.com", title: "Branch Manager", role: "Branch Manager", tiers: [0, 1, 0], field: false },
  { first: "David", other: "Kimani", email: "risk@demo.birgenai.com", title: "Credit Risk Manager", role: "Risk Manager", tiers: [0, 0, 1], field: false },
  { first: "Esther", other: "Wafula", email: "finance@demo.birgenai.com", title: "Finance Officer", role: "Finance", tiers: [0, 1, 1], field: false },
  { first: "Felix", other: "Barasa", email: "ro1@demo.birgenai.com", title: "Relationship Officer", role: "Relationship Officer", tiers: [1, 0, 0], field: true, spot: 0 },
  { first: "Grace", other: "Auma", email: "ro2@demo.birgenai.com", title: "Relationship Officer", role: "Relationship Officer", tiers: [1, 0, 0], field: true, spot: 3 },
  { first: "Henry", other: "Mutua", email: "ro3@demo.birgenai.com", title: "Relationship Officer", role: "Relationship Officer", tiers: [1, 0, 0], field: true, spot: 5 },
];

const BORROWERS = [
  { first: "Joyce", other: "Wanjiru", nid: "29381746", phone: "254712000001", biz: 0, score: 742, band: "Low risk", loans: "cleared3" },
  { first: "Kevin", other: "Omondi", nid: "31882910", phone: "254712000002", biz: 1, score: 688, band: "Moderate risk", loans: "active" },
  { first: "Lucy", other: "Chebet", nid: "27461829", phone: "254712000003", biz: 2, score: 801, band: "Low risk", loans: "graduated" },
  { first: "Martin", other: "Kariuki", nid: "33019284", phone: "254712000004", biz: 3, score: 604, band: "Moderate risk", loans: "arrears" },
  { first: "Nancy", other: "Adhiambo", nid: "28371904", phone: "254712000005", biz: 4, score: 559, band: "High risk", loans: "declined" },
  { first: "Oscar", other: "Mwangi", nid: "30284716", phone: "254712000006", biz: 6, score: 716, band: "Low risk", loans: "active" },
  { first: "Peris", other: "Nyambura", nid: "26483910", phone: "254712000007", biz: 7, score: 673, band: "Moderate risk", loans: "pending" },
  { first: "Quincy", other: "Owino", nid: "34910284", phone: "254712000008", biz: 1, score: 698, band: "Moderate risk", loans: "cleared1" },
];

// Child tables first, parents last — a swallowed FK failure here left stale
// borrowers behind once (P2002 on reseed), so keep this list in step with the
// schema whenever a new org-scoped model appears.
async function wipe(orgId: string) {
  const w = { orgId };
  for (const m of [
    "smsMessage", "smsCampaign", "emailMessage", "c2BReceipt", "paymentIntent", "floatLedger", "otpChallenge",
    "promiseToPay", "collectionCall", "collectionTicket",
    "reconciliationException", "usageEvent", "invoiceLine", "invoice", "smsTopUp", "smsWallet",
    "installment", "guarantor", "collateral", "disbursement", "loanOffer", "loan",
    "loanApplication", "consent", "geoPin", "scoreSnapshot", "kycCheck", "kycSession",
    "fieldVisit", "document", "borrower", "product", "workflowStage", "workflow",
    "orgIntegration", "tuningProfile", "auditLog", "staffUser", "role", "branch",
  ] as const) {
    try {
      // @ts-expect-error dynamic model access
      await prisma[m].deleteMany({ where: m === "workflowStage" ? { workflow: w } : w });
    } catch { /* table may not carry orgId directly */ }
  }
}

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  // 1) Org (idempotent wipe+rebuild).
  const existing = await prisma.org.findUnique({ where: { slug: SLUG } });
  if (existing) { await wipe(existing.id); }
  const org = await prisma.org.upsert({
    where: { slug: SLUG },
    update: { status: OrgStatus.ACTIVE, isDemo: true, mode: OrgMode.NATIVE, plan: OrgPlan.PREMIUM, name: "BirgenAI Demo Microfinance", accent: "#6d28d9", accentSoft: "rgba(109,40,217,0.12)", accent2: "#4c1d95", logoUrl: "/images/BirgenAI-logo.png" },
    create: { slug: SLUG, name: "BirgenAI Demo Microfinance", mode: OrgMode.NATIVE, status: OrgStatus.ACTIVE, plan: OrgPlan.PREMIUM, isDemo: true, accent: "#6d28d9", accentSoft: "rgba(109,40,217,0.12)", accent2: "#4c1d95", logoUrl: "/images/BirgenAI-logo.png", tagline: "Credit that understands your cashflow.", blurb: "The BirgenAI guided demo lender" },
  });

  // 2) Branch + roles. Each role's rights are its sidebar AND its API access —
  // signing in as each demo account shows a genuinely different console, which
  // is the role-visibility showcase the /demo page sells.
  const branch = await prisma.branch.create({ data: { orgId: org.id, name: "Nairobi CBD", levelName: "Branch", lat: -1.2841, lng: 36.8233, disbursementLimit: 500000 } });
  const ROLE_RIGHTS: Record<string, string[]> = {
    "Org Admin": ["*"],
    "Loan Officer": [
      "borrowers.view", "borrowers.create", "applications.view", "applications.decide", "loans.view", "loans.apply",
      "products.view", "documents.view", "documents.parse", "field.view", "reports.view", "riri.use",
      "collections.view", "collections.manage",
    ],
    "Branch Manager": [
      "borrowers.view", "borrowers.create", "applications.view", "applications.decide", "loans.view", "loans.apply",
      "products.view", "workflows.view", "documents.view", "documents.parse", "field.view", "field.manage",
      "disbursements.view", "disbursements.manage", "float.view", "repayments.view", "repayments.collect",
      "team.view", "reports.view", "intelligence.view", "riri.use",
      "collections.view", "collections.manage", "sms.view", "sms.manage",
    ],
    "Risk Manager": [
      "borrowers.view", "applications.view", "loans.view", "products.view", "reconciliation.view",
      "intelligence.view", "intelligence.tune", "documents.view", "reports.view", "riri.use",
    ],
    Finance: [
      "loans.view", "disbursements.view", "disbursements.manage", "float.view", "float.manage",
      "repayments.view", "repayments.collect", "reconciliation.view", "reconciliation.resolve",
      "billing.view", "reports.view", "riri.use", "collections.view",
    ],
    "Relationship Officer": [
      "borrowers.view", "borrowers.create", "loans.view", "field.view", "field.manage",
      "documents.view", "documents.parse", "reports.view",
    ],
  };
  const roles = new Map<string, string>();
  for (const [title, rights] of Object.entries(ROLE_RIGHTS)) {
    const r = await prisma.role.create({ data: { orgId: org.id, title, rights, menu: rights } });
    roles.set(title, r.id);
  }

  // 3) Staff — every role, field agents geolocated.
  const staffIds = new Map<string, string>();
  for (const s of STAFF) {
    const spot = s.field && s.spot != null ? SPOTS[s.spot] : null;
    const u = await prisma.staffUser.create({
      data: {
        orgId: org.id, email: s.email, firstName: s.first, otherName: s.other, title: s.title,
        phone: "2547" + Math.floor(10000000 + Math.random() * 89999999),
        passwordHash, roleId: roles.get(s.role), branchId: branch.id,
        isInitiator: !!s.tiers[0], isAuthorizer: !!s.tiers[1], isValidator: !!s.tiers[2],
        isFieldAgent: s.field, lat: spot?.lat, lng: spot?.lng, lastLocationAt: spot ? new Date() : null,
        avatarSeed: s.email, status: "ACTIVE",
      },
    });
    staffIds.set(s.email, u.id);
  }
  const officerId = staffIds.get("officer@demo.birgenai.com")!;
  const adminId = staffIds.get("admin@demo.birgenai.com")!;

  // 4) Workflow + products.
  const wf = await prisma.workflow.create({
    data: {
      orgId: org.id, title: "Standard 3-Tier",
      stages: { create: [
        { title: "Officer Review", order: 1, accessTier: 1, canFinalize: false, otpRequired: false },
        { title: "Manager Review", order: 2, accessTier: 2, canFinalize: false, otpRequired: false },
        { title: "Final Approval", order: 3, accessTier: 3, canFinalize: true, otpRequired: true },
      ] },
    },
  });
  const bizProduct = await prisma.product.create({
    data: { orgId: org.id, name: "Biashara Boost", description: "Working capital for traders", minPrincipal: 5000, maxPrincipal: 200000, interestRate: 12, interestMethod: "reducing", repaymentPeriod: 4, repaymentPeriodUnit: "month", penaltyRate: 5, disbursementMode: "B2C_MPESA", newWorkflowId: wf.id, repeatWorkflowId: wf.id },
  });
  const quickProduct = await prisma.product.create({
    data: { orgId: org.id, name: "Quick Duka", description: "Fast weekly advances", minPrincipal: 1000, maxPrincipal: 30000, interestRate: 10, interestMethod: "flat", repaymentPeriod: 8, repaymentPeriodUnit: "week", penaltyRate: 5, disbursementMode: "B2C_MPESA" },
  });

  // 5) Float + integrations (marked configured so the demo shows "connected").
  await prisma.floatLedger.create({ data: { orgId: org.id, kind: "TOPUP", amount: 2000000, balanceAfter: 2000000, ref: "SEED-FLOAT", note: "Opening float", createdBy: adminId } });

  const round2 = (n: number) => Math.round(n * 100) / 100;

  // 6) Borrowers + their lifecycle.
  let floatBalance = 2000000;
  for (let i = 0; i < BORROWERS.length; i++) {
    const b = BORROWERS[i];
    const spot = SPOTS[b.biz];
    const borrower = await prisma.borrower.create({
      data: {
        orgId: org.id, phone: b.phone, nationalId: b.nid, firstName: b.first, otherName: b.other,
        kycStatus: b.loans === "declined" ? "PENDING_REVIEW" : "VERIFIED", kycVerifiedAt: b.loans === "declined" ? null : D(60 - i),
        faceMatchScore: 88 + (i % 10), livenessPassed: true, iprsVerified: b.loans !== "declined",
        creditScore: b.score, riskBand: b.band, loanLimit: 50000 + i * 15000, graduationCount: b.loans === "graduated" ? 5 : b.loans.startsWith("cleared") ? Number(b.loans.replace("cleared", "")) : 0,
        lat: spot.lat, lng: spot.lng, locationType: "business", locationAddress: `${spot.name}, Nairobi`,
        portraitKey: `portrait/demo-${i}`, createdAt: D(90 - i * 3),
      },
    });

    // KYC session (verified trail).
    await prisma.kycSession.create({
      data: {
        orgId: org.id, borrowerId: borrower.id, phone: b.phone, nationalId: b.nid, provider: "simulation",
        idQualityScore: 90 + (i % 8), idOcrName: `${b.first} ${b.other}`, idOcrNumber: b.nid,
        livenessScore: 85 + (i % 12), livenessPassed: true, faceMatchScore: 88 + (i % 10),
        iprsMatched: b.loans !== "declined", iprsName: `${b.first} ${b.other}`,
        status: b.loans === "declined" ? "PENDING_REVIEW" : "VERIFIED", completedAt: D(60 - i),
      },
    });

    // Helper: a scored application + optional loan + ML snapshot with outcome.
    const makeApp = async (opts: { amount: number; product: typeof bizProduct; status: string; decision: string; score: number; pd: number; outcome: string; daysAgo: number; loanStatus?: string; arrears?: boolean }) => {
      const app = await prisma.loanApplication.create({
        data: {
          orgId: org.id, borrowerId: borrower.id, productId: opts.product.id, productName: opts.product.name,
          phone: b.phone, nationalId: b.nid, borrowerName: `${b.first} ${b.other}`,
          amountRequested: opts.amount, status: opts.status as never, stageTitle: opts.status,
          score: opts.score, pd: opts.pd, scoreModelVersion: "fused(thinfile-v2+origination-v2)",
          fusionEngine: "fused", decision: opts.decision,
          reasonCodes: [
            { code: "STB", factor: "Income stability", points: 50, direction: "up", detail: "Regular deposits" },
            { code: "AFF", factor: "Affordability", points: opts.score > 650 ? 40 : -30, direction: opts.score > 650 ? "up" : "down", detail: "Cashflow vs installment" },
          ],
          featuresSnapshot: { avgMonthlyIncome: 40000 + i * 5000, avgMonthlyNet: 12000 + i * 1500, incomeVolatility: 0.2 + (i % 5) * 0.05, gamblingRatio: 0 },
          outcome: opts.outcome, outcomeObservedAt: opts.outcome !== "PENDING" ? D(opts.daysAgo - 5) : null,
          createdAt: D(opts.daysAgo), decidedAt: D(opts.daysAgo),
        },
      });
      // ML snapshot (closed loop: features X now, realised outcome y).
      await prisma.scoreSnapshot.create({
        data: {
          orgId: org.id, borrowerId: borrower.id, applicationId: app.id, modelKind: "fused", modelVersion: "fused-v2",
          score: opts.score, pd: opts.pd, riskBand: b.band,
          features: { avgMonthlyIncome: 40000 + i * 5000, priorLoans: borrower.graduationCount },
          outcome: opts.outcome, outcomeObservedAt: opts.outcome !== "PENDING" ? D(opts.daysAgo - 5) : null,
          loanContextAmount: opts.amount, capturedBy: "demo-seed", createdAt: D(opts.daysAgo),
        },
      });
      return app;
    };

    // A signed credit agreement, built by the SAME code the live path uses — so the
    // demo's terms hash and reproduce exactly the way a real borrower's would, and
    // final approval passes the consent gate in book.ts rather than working around it.
    const makeAcceptedOffer = async (
      applicationId: string, borrowerId: string, product: typeof bizProduct,
      amount: number, daysAgo: number, recordedBy: string,
    ) => {
      const borrowDate = D(daysAgo);
      const method = product.interestMethod === "reducing" ? "reducing" : "flat";
      const sched = buildSchedule({
        principal: amount, rate: Number(product.interestRate),
        count: product.repaymentPeriod, unit: product.repaymentPeriodUnit,
        method, graceDays: product.gracePeriodDays ?? 0, borrowDate,
      });
      const terms = {
        principal: amount, interestRate: Number(product.interestRate), interestMethod: method as "flat" | "reducing",
        termCount: product.repaymentPeriod, termUnit: product.repaymentPeriodUnit,
        graceDays: product.gracePeriodDays ?? 0,
        totalInterest: sched.interest, totalRepayable: sched.loanAmount, borrowDate,
      };
      return prisma.loanOffer.create({
        data: {
          orgId: org.id, applicationId, borrowerId, productId: product.id,
          principal: amount, interestRate: Number(product.interestRate), interestMethod: method,
          termCount: product.repaymentPeriod, termUnit: product.repaymentPeriodUnit,
          graceDays: product.gracePeriodDays ?? 0,
          totalInterest: sched.interest, totalRepayable: sched.loanAmount,
          borrowDate, firstDueDate: sched.firstDueDate, expectedClearDate: sched.expectedClearDate,
          schedule: sched.rows.map((r) => ({
            seq: r.seq, dueDate: r.dueDate.toISOString(),
            amountDue: r.amountDue, principalDue: r.principalDue, interestDue: r.interestDue,
          })),
          termsHash: hashTerms(terms),
          status: "ACCEPTED", acceptedAt: borrowDate, channel: "BRANCH",
          recordedBy, branchNote: "Signed in person at the demo branch; national ID sighted.",
          expiresAt: new Date(borrowDate.getTime() + 7 * 86400000),
        },
      });
    };

    // Book a native loan with schedule (reducing or flat) + disbursement.
    const bookLoan = async (app: { id: string }, product: typeof bizProduct, amount: number, daysAgo: number, state: "active" | "cleared" | "arrears") => {
      const rate = Number(product.interestRate); const n = product.repaymentPeriod; const reducing = product.interestMethod === "reducing";
      let interest = 0; const rows: { seq: number; due: number; prin: number; int: number; date: Date }[] = [];
      if (reducing) {
        const per = rate / 100 / n; const perP = round2(amount / n); let out = amount;
        for (let s = 1; s <= n; s++) { const int = round2(out * per); const prin = s === n ? round2(amount - perP * (n - 1)) : perP; rows.push({ seq: s, due: round2(prin + int), prin, int, date: new Date(D(daysAgo).getTime() + s * 30 * 86400000) }); interest = round2(interest + int); out = round2(out - prin); }
      } else {
        interest = round2(amount * rate / 100); const total = amount + interest; const per = round2(total / n); const perP = round2(amount / n);
        for (let s = 1; s <= n; s++) rows.push({ seq: s, due: s === n ? round2(total - per * (n - 1)) : per, prin: perP, int: round2(per - perP), date: new Date(D(daysAgo).getTime() + s * 7 * 86400000) });
      }
      const loanAmount = round2(amount + interest);
      const cleared = state === "cleared";
      const loan = await prisma.loan.create({
        data: {
          orgId: org.id, borrowerId: borrower.id, applicationId: app.id, productId: product.id,
          principal: amount, interest, loanAmount, balance: cleared ? 0 : state === "arrears" ? loanAmount : round2(loanAmount * 0.6),
          status: cleared ? "CLEARED" : "ACTIVE", borrowDate: D(daysAgo), disbursedAt: D(daysAgo - 1),
          expectedClearDate: rows[rows.length - 1].date, clearedAt: cleared ? D(daysAgo - 20) : null, createdBy: officerId,
        },
      });
      await prisma.installment.createMany({
        data: rows.map((r, idx) => ({
          orgId: org.id, loanId: loan.id, seq: r.seq, dueDate: state === "arrears" && idx === 0 ? D(daysAgo - 40) : r.date,
          amountDue: r.due, principalDue: r.prin, interestDue: r.int,
          amountPaid: cleared ? r.due : state === "active" && idx < Math.floor(n * 0.4) ? r.due : 0,
          status: cleared ? "PAID" : state === "arrears" && idx === 0 ? "OVERDUE" : state === "active" && idx < Math.floor(n * 0.4) ? "PAID" : "UPCOMING",
          penalty: state === "arrears" && idx === 0 ? round2(r.due * 0.05) : 0,
        })),
      });
      await prisma.disbursement.create({ data: { orgId: org.id, loanId: loan.id, amount, phone: b.phone, state: "CONFIRMED", makerId: officerId, checkerId: adminId, receiptRef: `DEMO${daysAgo}${i}`, createdAt: D(daysAgo - 1) } });
      floatBalance = round2(floatBalance - amount);
      await prisma.floatLedger.create({ data: { orgId: org.id, kind: "DISBURSE", amount: -amount, balanceAfter: floatBalance, ref: `DEMO${daysAgo}${i}`, note: `Loan ${loan.id.slice(0, 8)}`, createdBy: adminId, createdAt: D(daysAgo - 1) } });
      return loan;
    };

    // Lifecycle wiring per persona.
    if (b.loans === "cleared3" || b.loans === "cleared1" || b.loans === "graduated") {
      const times = b.loans === "graduated" ? 5 : b.loans === "cleared3" ? 3 : 1;
      for (let k = 0; k < times; k++) {
        const app = await makeApp({ amount: 20000 + k * 10000, product: bizProduct, status: "DISBURSED", decision: "APPROVE", score: b.score - 10 + k * 5, pd: 0.08, outcome: "REPAID", daysAgo: 200 - k * 40 });
        await bookLoan(app, bizProduct, 20000 + k * 10000, 200 - k * 40, "cleared");
      }
    }
    if (b.loans === "active") {
      const app = await makeApp({ amount: 45000, product: bizProduct, status: "DISBURSED", decision: "APPROVE", score: b.score, pd: 0.12, outcome: "PENDING", daysAgo: 40 });
      await bookLoan(app, bizProduct, 45000, 40, "active");
    }
    if (b.loans === "arrears") {
      const app = await makeApp({ amount: 30000, product: quickProduct, status: "DISBURSED", decision: "APPROVE", score: b.score, pd: 0.34, outcome: "PENDING", daysAgo: 70 });
      const loan = await bookLoan(app, quickProduct, 30000, 70, "arrears");
      // Collections showcase: this loan has been WORKED — a call that took a
      // promise (broken: the money never came), a fresher no-answer attempt,
      // and a hardship ticket sitting with the manager. The demo queue shows a
      // lender mid-chase, not a blank slate.
      const managerId = staffIds.get("manager@demo.birgenai.com")!;
      const ptp = await prisma.promiseToPay.create({
        data: {
          orgId: org.id, loanId: loan.id, borrowerId: borrower.id,
          amount: 8000, dueDate: D(10), status: "BROKEN", paidAmount: 0,
          note: "Says the market has been slow; will sell stock over the weekend.",
          createdBy: officerId, createdAt: D(14), resolvedAt: D(9),
        },
      });
      await prisma.collectionCall.createMany({
        data: [
          { orgId: org.id, loanId: loan.id, borrowerId: borrower.id, outcome: "PROMISE_TO_PAY", note: "Reached him at the stall. Promised KES 8,000 by Friday.", ptpId: ptp.id, createdBy: officerId, createdAt: D(14) },
          { orgId: org.id, loanId: loan.id, borrowerId: borrower.id, outcome: "NO_ANSWER", note: "Rang through twice, no pick. Try evenings.", createdBy: officerId, createdAt: D(3) },
        ],
      });
      await prisma.collectionTicket.create({
        data: {
          orgId: org.id, borrowerId: borrower.id, loanId: loan.id,
          kind: "HARDSHIP", status: "IN_PROGRESS",
          title: "Requests restructuring after stall flooding",
          detail: "Stock lost to flooding at Gikomba. Asking for the schedule to be spread over two extra months.",
          assignedToId: managerId, createdBy: officerId, createdAt: D(8),
        },
      });
    }
    if (b.loans === "declined") {
      await makeApp({ amount: 25000, product: quickProduct, status: "DECLINED", decision: "DECLINE", score: b.score, pd: 0.61, outcome: "PENDING", daysAgo: 10 });
    }
    if (b.loans === "pending") {
      const app = await makeApp({ amount: 35000, product: bizProduct, status: "OFFICER_REVIEW", decision: "REFER", score: b.score, pd: 0.28, outcome: "PENDING", daysAgo: 2 });
      // Nothing books without a signed agreement, so the approval queue needs one
      // or the demo dead-ends at final approval. This borrower signed at a counter;
      // the portal e-signature path is what a walk-through of the funnel exercises.
      await makeAcceptedOffer(app.id, borrower.id, bizProduct, 35000, 2, officerId);
      // A field verification visit auto-created for the SME (nearest agent).
      const agents = await prisma.staffUser.findMany({ where: { orgId: org.id, isFieldAgent: true, lat: { not: null } } });
      let best = agents[0], bestKm = Infinity;
      for (const a of agents) { const km = Math.hypot((a.lat! - spot.lat) * 111, (a.lng! - spot.lng) * 111); if (km < bestKm) { bestKm = km; best = a; } }
      await prisma.fieldVisit.create({
        data: { orgId: org.id, borrowerId: borrower.id, applicationId: app.id, kind: "BUSINESS_VERIFICATION", label: `${b.first}'s shop — ${spot.name}`, address: `${spot.name}, Nairobi`, lat: spot.lat, lng: spot.lng, status: "ALLOCATED", agentId: best.id, allocatedAt: new Date(), distanceKm: Number(bestKm.toFixed(2)), createdBy: officerId },
      });
    }
  }

  const counts = {
    staff: await prisma.staffUser.count({ where: { orgId: org.id } }),
    borrowers: await prisma.borrower.count({ where: { orgId: org.id } }),
    loans: await prisma.loan.count({ where: { orgId: org.id } }),
    snapshots: await prisma.scoreSnapshot.count({ where: { orgId: org.id } }),
    outcomes: await prisma.scoreSnapshot.count({ where: { orgId: org.id, outcome: { not: "PENDING" } } }),
    visits: await prisma.fieldVisit.count({ where: { orgId: org.id } }),
  };
  console.log("Demo org rebuilt:", JSON.stringify(counts));
  console.log(`Sign in at /login with any @demo.birgenai.com account · password ${PASSWORD}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
