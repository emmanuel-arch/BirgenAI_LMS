// Seed a realistic, demo-ready book for MULAR CREDIT (slug: mular).
//
//   npx tsx scripts/seed-mular-demo.ts            # seed (idempotent)
//   npx tsx scripts/seed-mular-demo.ts --activate # seed + flip org ACTIVE
//
// Idempotent: everything it creates is tagged (borrowers carry deviceFingerprint
// SEED_TAG; audit rows carry entity SEED_TAG). A re-run tears the tagged data down
// first, so the numbers stay stable. Branches / products / officers are upserted.
// Data-only — no live M-Pesa; disbursements/receipts are records so every module
// and the dashboard populate. Scale: a growing Kitale microlender.
import "dotenv/config";
import bcrypt from "bcryptjs";
import { platformPrisma } from "../prisma/seed-client";

const prisma = platformPrisma();
const SEED_TAG = "seed:mular";
const PASSWORD = "Mular1234!";

// ── deterministic PRNG ────────────────────────────────────────────────────────
let _s = 20260722;
const rand = () => { _s = (_s * 1664525 + 1013904223) % 4294967296; return _s / 4294967296; };
const pick = <T>(a: T[]): T => a[Math.floor(rand() * a.length)];
const int = (lo: number, hi: number) => Math.floor(lo + rand() * (hi - lo + 1));
const money = (lo: number, hi: number, step = 500) => Math.round(int(lo, hi) / step) * step;
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);
// Phones for non-borrower rows (disbursement/receipt/guarantor) — no uniqueness constraint.
let _p = 79000000;
const nextPhoneSafe = () => "2547" + String(_p++);
const addMonths = (d: Date, m: number) => { const x = new Date(d); x.setMonth(x.getMonth() + m); return x; };
const monthsElapsed = (from: Date) => Math.max(0, Math.floor((Date.now() - from.getTime()) / (30 * 86_400_000)));

// ── Kitale-area reference data ────────────────────────────────────────────────
const BRANCHES = [
  { name: "Kitale Head Office", root: true, lat: 1.0157, lng: 35.0062, code: "KHO" },
  { name: "Kitale East", lat: 1.0203, lng: 35.0201, code: "KE" },
  { name: "Kitale West", lat: 1.0098, lng: 34.9901, code: "KW" },
  { name: "Endebess", lat: 1.1386, lng: 34.9331, code: "END" },
  { name: "Kiminini", lat: 0.9223, lng: 34.9459, code: "KIM" },
];
const FIRST = ["Titus", "Derrick", "Carol", "Joseph", "Mwende", "Brian", "Faith", "Kevin", "Mercy", "Peter", "Ann", "Dennis", "Grace", "Samuel", "Ruth", "Ian", "Lucy", "Victor", "Esther", "Collins", "Nancy", "Elijah", "Sharon", "Moses", "Beatrice", "Amos", "Caroline", "Isaac", "Janet", "Felix"];
const LAST = ["Masua", "Maloba", "Ndiso", "Brongo", "Mutiso", "Wafula", "Barasa", "Simiyu", "Nasimiyu", "Wanjala", "Cheruiyot", "Kiptoo", "Chumba", "Wekesa", "Nabwera", "Otieno", "Mueni", "Kirwa", "Naliaka", "Juma"];
const RELATIONS = ["Brother", "Sister", "Business partner", "Spouse", "Neighbour", "Colleague"];
const DEVICES = ["Chrome on Windows", "Chrome on Android", "Safari on iPhone", "Edge on Windows"];
const IPS = ["105.164.7.191", "102.215.34.20", "197.248.12.7", "41.90.64.133", "196.201.214.20"];
const RISK_BANDS = ["PRIME", "STRONG", "WATCH", "HIGH"];

const jitter = (v: number) => v + (rand() - 0.5) * 0.02;

async function findOrCreateBranch(orgId: string, b: typeof BRANCHES[number], parentId: string | null) {
  const found = await prisma.branch.findFirst({ where: { orgId, name: b.name }, select: { id: true } });
  if (found) return found.id;
  const created = await prisma.branch.create({
    data: { orgId, name: b.name, parentId, levelName: b.root ? "Head Office" : "Branch", code: b.code, lat: b.lat, lng: b.lng, radiusMeters: 400, active: true },
    select: { id: true },
  });
  return created.id;
}

async function teardown(orgId: string) {
  const tagged = await prisma.borrower.findMany({ where: { orgId, deviceFingerprint: SEED_TAG }, select: { id: true } });
  const ids = tagged.map((b) => b.id);
  if (ids.length) {
    const loans = await prisma.loan.findMany({ where: { orgId, borrowerId: { in: ids } }, select: { id: true } });
    const loanIds = loans.map((l) => l.id);
    await prisma.installment.deleteMany({ where: { loanId: { in: loanIds } } });
    await prisma.disbursement.deleteMany({ where: { loanId: { in: loanIds } } });
    await prisma.c2BReceipt.deleteMany({ where: { orgId, allocatedLoanId: { in: loanIds } } });
    await prisma.guarantor.deleteMany({ where: { orgId, borrowerId: { in: ids } } });
    await prisma.loan.deleteMany({ where: { id: { in: loanIds } } });
    await prisma.loanApplication.deleteMany({ where: { orgId, borrowerId: { in: ids } } });
    await prisma.borrower.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.auditLog.deleteMany({ where: { orgId, entity: SEED_TAG } });
  console.log(`  teardown: cleared ${ids.length} prior seeded borrowers + their book`);
}

type Kind = "clean" | "arrears" | "npl" | "cleared" | "writeoff";

async function main() {
  const activate = process.argv.includes("--activate");
  const org = await prisma.org.findUnique({ where: { slug: "mular" }, select: { id: true, name: true, accent: true } });
  if (!org) { console.error('No org with slug "mular". Rename/create it first.'); process.exit(1); }
  console.log(`Seeding ${org.name} (${org.id})`);

  await teardown(org.id);

  // ── Branches ────────────────────────────────────────────────────────────────
  const rootId = await findOrCreateBranch(org.id, BRANCHES[0], null);
  const branchIds: string[] = [rootId];
  for (const b of BRANCHES.slice(1)) branchIds.push(await findOrCreateBranch(org.id, b, rootId));
  console.log(`  branches: ${branchIds.length}`);

  // ── Roles (reuse onboarding roles; officers get a non-admin role if present) ──
  const roles = await prisma.role.findMany({ where: { orgId: org.id }, select: { id: true, title: true } });
  const officerRole = roles.find((r) => /officer|relationship|agent|loan/i.test(r.title)) ?? roles[0] ?? null;

  // ── Products ──────────────────────────────────────────────────────────────────
  const productSpecs = [
    { name: "Business Loan", min: 10000, max: 200000, rate: 13, term: 4, unit: "month", mode: "B2C_MPESA", guarantor: true },
    { name: "School Fees Loan", min: 10000, max: 150000, rate: 10, term: 6, unit: "month", mode: "TO_THIRD_PARTY", guarantor: false },
    { name: "Salary Advance", min: 3000, max: 50000, rate: 8, term: 1, unit: "month", mode: "B2C_MPESA", guarantor: false },
    { name: "Boda & Asset Finance", min: 30000, max: 180000, rate: 12, term: 6, unit: "month", mode: "B2C_MPESA", guarantor: true },
  ];
  const products: { id: string; term: number; rate: number; mode: string; min: number; max: number }[] = [];
  for (const p of productSpecs) {
    let row = await prisma.product.findFirst({ where: { orgId: org.id, name: p.name }, select: { id: true } });
    if (!row) {
      row = await prisma.product.create({
        data: {
          orgId: org.id, name: p.name, minPrincipal: p.min, maxPrincipal: p.max, interestRate: p.rate,
          interestMethod: "flat", repaymentPeriod: p.term, repaymentPeriodUnit: p.unit,
          guarantorRequired: p.guarantor, disbursementMode: p.mode as never, isActive: true,
        },
        select: { id: true },
      });
    }
    products.push({ id: row.id, term: p.term, rate: p.rate, mode: p.mode, min: p.min, max: p.max });
  }
  console.log(`  products: ${products.length}`);

  // ── Officers (upsert by email) ────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const officerSpecs = [
    { first: "Nancy", last: "Wekesa", tiers: { i: true, a: false, v: false }, title: "Loan Officer", b: 1 },
    { first: "Collins", last: "Barasa", tiers: { i: true, a: false, v: false }, title: "Loan Officer", b: 2 },
    { first: "Mercy", last: "Nasimiyu", tiers: { i: false, a: true, v: false }, title: "Branch Manager", b: 3 },
    { first: "Dennis", last: "Simiyu", tiers: { i: false, a: true, v: false }, title: "Branch Manager", b: 4 },
    { first: "Faith", last: "Nabwera", tiers: { i: false, a: false, v: true }, title: "Credit Manager", b: 0 },
  ];
  const officers: { id: string; branchId: string; name: string; email: string }[] = [];
  for (const o of officerSpecs) {
    const email = `${o.first.toLowerCase()}.${o.last.toLowerCase()}@mular.birgenai.com`;
    const branchId = branchIds[o.b];
    const up = await prisma.staffUser.upsert({
      where: { orgId_email: { orgId: org.id, email } },
      create: {
        orgId: org.id, email, firstName: o.first, otherName: o.last, title: o.title,
        phone: "2547" + String(20000000 + officers.length),
        passwordHash, roleId: officerRole?.id ?? null, branchId,
        isInitiator: o.tiers.i, isAuthorizer: o.tiers.a, isValidator: o.tiers.v,
        avatarSeed: email, status: "ACTIVE",
      },
      update: { branchId, isInitiator: o.tiers.i, isAuthorizer: o.tiers.a, isValidator: o.tiers.v, status: "ACTIVE", title: o.title },
      select: { id: true },
    });
    officers.push({ id: up.id, branchId, name: `${o.first} ${o.last}`, email });
  }
  console.log(`  officers: ${officers.length}`);

  // ── The book: borrowers + loans + schedules ─────────────────────────────────
  // Distribution across ~90 loans over ~70 borrowers.
  // ~8% PAR: delinquent balance stays a small slice of a young, high-balance book.
  const plan: Kind[] = [
    ...Array(65).fill("clean"), ...Array(5).fill("arrears"),
    ...Array(2).fill("npl"), ...Array(15).fill("cleared"), ...Array(5).fill("writeoff"),
  ];
  // shuffle deterministically
  for (let i = plan.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [plan[i], plan[j]] = [plan[j], plan[i]]; }

  let phoneSeq = 12000000;
  const nextPhone = () => "2547" + String(phoneSeq++);
  const borrowerIds: string[] = [];
  const activeLoanIds: string[] = [];
  let olb = 0, arrearsOlb = 0, loanCount = 0;

  // Reuse borrowers across some loans (repeat customers), create fresh for others.
  for (let n = 0; n < plan.length; n++) {
    const kind = plan[n];
    const officer = pick(officers);
    const reuse = borrowerIds.length > 8 && rand() < 0.25;
    let borrowerId: string;
    if (reuse) {
      borrowerId = pick(borrowerIds);
    } else {
      const first = pick(FIRST), last = pick(LAST);
      const spot = BRANCHES[int(0, BRANCHES.length - 1)];
      const b = await prisma.borrower.create({
        data: {
          orgId: org.id, phone: nextPhone(), firstName: first, otherName: last,
          nationalId: String(int(20000000, 39999999)),
          dob: daysAgo(int(21, 55) * 365), gender: pick(["M", "F"]), language: pick(["en", "sw"]),
          kycStatus: "VERIFIED", kycVerifiedAt: daysAgo(int(20, 300)),
          creditScore: int(480, 820), riskBand: pick(RISK_BANDS), graduationCount: int(0, 4),
          loanLimit: money(30000, 250000, 5000),
          lat: jitter(spot.lat), lng: jitter(spot.lng), locationType: "business",
          locationAddress: `${spot.name} market`, geoConsentAt: daysAgo(int(10, 200)),
          createdById: officer.id, branchId: officer.branchId, deviceFingerprint: SEED_TAG,
        },
        select: { id: true },
      });
      borrowerId = b.id;
      borrowerIds.push(b.id);
    }

    const product = pick(products);
    const term = product.term;
    // Bias toward the upper half of the product band so the book carries real value.
    const principal = money(Math.round(product.min + (product.max - product.min) * 0.3), product.max, 1000);
    const interest = Math.round(principal * (product.rate / 100));
    const loanAmount = principal + interest;
    const perDue = Math.round(loanAmount / term);
    const perPrin = Math.round(principal / term);
    const perInt = perDue - perPrin;

    // age of the loan + schedule shape per kind
    // Clean loans run YOUNG (few installments elapsed → high balance → high OLB);
    // arrears/writeoff need an installment >30d overdue so PAR30 registers.
    const age = kind === "npl" ? int(400, 640) : kind === "cleared" ? int(150, 420)
      : kind === "writeoff" ? int(500, 800) : kind === "arrears" ? int(70, 240) : int(5, 70);
    const borrowDate = daysAgo(age);
    const status = kind === "cleared" ? "CLEARED" : kind === "writeoff" ? "WRITTEN_OFF" : "ACTIVE";

    const insts: { seq: number; dueDate: Date; amountDue: number; principalDue: number; interestDue: number; amountPaid: number; status: string; paidAt: Date | null }[] = [];
    let balance = 0;
    const elapsed = monthsElapsed(borrowDate);
    for (let s = 0; s < term; s++) {
      const due = addMonths(borrowDate, s + 1);
      const isPast = due.getTime() < Date.now();
      let paid = 0, st = "UPCOMING", paidAt: Date | null = null;
      if (kind === "cleared") { paid = perDue; st = "PAID"; paidAt = due; }
      else if (kind === "clean") { if (isPast) { paid = perDue; st = "PAID"; paidAt = due; } }
      else if (kind === "arrears") {
        // pay all but the last 1–2 past installments
        const overdueFrom = Math.max(0, elapsed - int(1, 2));
        if (isPast && s < overdueFrom) { paid = perDue; st = "PAID"; paidAt = due; }
        else if (isPast) { st = "OVERDUE"; }
      } else if (kind === "npl") {
        if (s === 0) { paid = perDue; st = "PAID"; paidAt = addMonths(borrowDate, 1); }
        else if (isPast) { st = "OVERDUE"; }
      } else if (kind === "writeoff") { if (isPast) st = "OVERDUE"; }
      balance += perDue - paid;
      insts.push({ seq: s + 1, dueDate: due, amountDue: perDue, principalDue: perPrin, interestDue: perInt, amountPaid: paid, status: st, paidAt });
    }
    if (kind === "cleared") balance = 0;

    const loan = await prisma.loan.create({
      data: {
        orgId: org.id, borrowerId, productId: product.id,
        principal, interest, loanAmount, balance,
        status: status as never, borrowDate, disbursedAt: borrowDate,
        expectedClearDate: addMonths(borrowDate, term),
        clearedAt: kind === "cleared" ? addMonths(borrowDate, term) : null,
        createdBy: officer.id, branchId: officer.branchId,
      },
      select: { id: true },
    });
    loanCount++;
    if (status === "ACTIVE") { olb += balance; activeLoanIds.push(loan.id); if (kind === "arrears" || kind === "npl") arrearsOlb += balance; }

    await prisma.installment.createMany({
      data: insts.map((i) => ({ orgId: org.id, loanId: loan.id, seq: i.seq, dueDate: i.dueDate, amountDue: i.amountDue, principalDue: i.principalDue, interestDue: i.interestDue, amountPaid: i.amountPaid, status: i.status as never, paidAt: i.paidAt })),
    });

    // Disbursement record (data-only; confirmed)
    await prisma.disbursement.create({
      data: {
        orgId: org.id, loanId: loan.id, amount: principal, phone: nextPhoneSafe(),
        state: product.mode === "TO_THIRD_PARTY" ? "MANUAL_CONFIRMED" : "CONFIRMED",
        receiptRef: "R" + String(int(100000, 999999)) + "MU", createdAt: borrowDate, updatedAt: borrowDate,
      },
    });

    // Repayment receipts for the paid installments (allocated) — a slice dated today
    for (const i of insts.filter((x) => x.status === "PAID")) {
      await prisma.c2BReceipt.create({
        data: {
          orgId: org.id, transId: "MU" + String(int(10000000, 99999999)) + i.seq, amount: i.amountPaid,
          phone: nextPhoneSafe(), billRef: String(int(20000000, 39999999)),
          allocatedLoanId: loan.id, allocatedAt: i.paidAt ?? borrowDate, createdAt: i.paidAt ?? borrowDate,
        },
      }).catch(() => { /* transId collision — skip */ });
    }
  }
  console.log(`  book: ${loanCount} loans over ${borrowerIds.length} borrowers · OLB≈${Math.round(olb).toLocaleString()} · PAR≈${((arrearsOlb / Math.max(1, olb)) * 100).toFixed(1)}%`);

  // ── A few applications across the pipeline (for the queue + Applications) ──────
  const appStatuses = ["SUBMITTED", "AI_PRESCREEN", "OFFICER_REVIEW", "REFERRED", "APPROVED", "DISBURSED", "DECLINED"];
  const pipelineBorrowers = borrowerIds.slice(0, 12);
  const guarantorApps: { appId: string; borrowerId: string }[] = [];
  for (let i = 0; i < pipelineBorrowers.length; i++) {
    const product = pick(products);
    const app = await prisma.loanApplication.create({
      data: {
        orgId: org.id, borrowerId: pipelineBorrowers[i], productId: product.id,
        amountRequested: money(10000, 150000, 5000), status: appStatuses[i % appStatuses.length] as never,
        officerId: pick(officers).id, branchId: pick(branchIds), score: int(480, 820),
        decision: pick(["APPROVE", "REFER", "DECLINE"]), createdAt: daysAgo(int(0, 25)),
      },
      select: { id: true },
    });
    if (i < 6) guarantorApps.push({ appId: app.id, borrowerId: pipelineBorrowers[i] });
  }
  console.log(`  applications: ${pipelineBorrowers.length}`);

  // ── Sureties (guarantors) ────────────────────────────────────────────────────
  for (const g of guarantorApps) {
    await prisma.guarantor.create({
      data: {
        orgId: org.id, applicationId: g.appId, borrowerId: g.borrowerId,
        fullName: `${pick(FIRST)} ${pick(LAST)}`, phone: nextPhoneSafe(), nationalId: String(int(20000000, 39999999)),
        relationship: pick(RELATIONS), status: pick(["CONSENTED", "INVITED", "CONSENTED"]) as never,
        amountGuaranteed: money(10000, 120000, 5000), expiresAt: daysAgo(-14),
        invitedAt: daysAgo(int(1, 20)), consentedAt: daysAgo(int(0, 10)),
      },
    });
  }
  console.log(`  guarantors: ${guarantorApps.length}`);

  // ── Audit trail (Oversight) — actions across officers, devices, IPs, geo ──────
  const actions = ["LOGIN", "LOGOUT", "LEAD_CREATE", "LOAN_APPROVE", "DISBURSEMENT_CHECK", "BORROWER_CREATE", "KYC_VERIFY", "REGISTRY_FILE_UPLOAD", "PRODUCT_EDIT"];
  const auditRows = [];
  for (let i = 0; i < 60; i++) {
    const o = pick(officers);
    auditRows.push({
      orgId: org.id, actorId: o.id, actorType: "staff", action: pick(actions), entity: SEED_TAG,
      ip: pick(IPS),
      meta: { user: o.name, email: o.email, device: pick(DEVICES), location: "Kitale, Kenya" },
      createdAt: daysAgo(int(0, 14)),
    });
  }
  await prisma.auditLog.createMany({ data: auditRows });
  console.log(`  audit rows: ${auditRows.length}`);

  if (activate) {
    await prisma.org.update({ where: { id: org.id }, data: { status: "ACTIVE" } });
    console.log("  org flipped ACTIVE");
  } else {
    console.log("  (org left as-is; pass --activate to flip ACTIVE)");
  }

  console.log("\nDone. Sign in as the founder to see the live dashboard; officers use /login with", PASSWORD);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
