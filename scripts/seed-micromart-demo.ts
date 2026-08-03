// ─────────────────────────────────────────────────────────────────────────────
// MICROMART AFRICA — a whole lender, every module, ready for a demo room.
//
//   npx tsx scripts/seed-micromart-demo.ts            # seed (idempotent)
//   npx tsx scripts/seed-micromart-demo.ts --down     # remove it, cleanly
//
// WHY THIS EXISTS. Micromart's org carried one branch, one role, two customers and
// no loans, because it is a BRIDGED pilot: their real book lives in their own
// ServiceSuite and only the funnel crosses over. That is fine for a pilot and
// useless in a demo — a lending platform shown against an empty book demonstrates
// nothing except that the screens render. This plants a believable Nairobi
// microlender across every module the console has, so the demo can be walked
// end-to-end: a customer, their application, the decision, the money out, the
// schedule, the miss, the call, the promise, the money back in, and the reports
// that describe all of it.
//
// ── THREE THINGS IT WILL NOT TOUCH ──────────────────────────────────────────
//
//   1. THE LIVE PILOT PRODUCT. MIROMART FINTECH (ServiceSuite Products.ID 31418)
//      and its PROCESSING FEES charge are the real, posting, revenue-earning
//      configuration. They are read and booked against; they are never written to
//      and never deleted.
//   2. THE REAL CUSTOMERS. The borrowers and applications already on the org are
//      untagged, so every query in here — including the teardown — is fenced to
//      rows this script created.
//   3. THE CUSTOMER PORTAL SHELF. Every product it adds is created isActive:false
//      ON PURPOSE. /api/lms/products treats a bridged org's ACTIVE local products
//      as its curated shelf, so switching these on would put demo products in front
//      of real applicants. They populate Products, Charges and the loan book from
//      the console side while the live shelf stays exactly one product — and
//      flipping one on during the demo is a better moment than seeding it on.
//
// ── HOW IT STAYS REVERSIBLE ─────────────────────────────────────────────────
// Everything is tagged: borrowers carry deviceFingerprint SEED_TAG, branches and
// products carry a code/name prefix, staff sit on @micromart.birgenai.com, and the
// org-level rows (SMS, float, exceptions, audit) carry an MMSEED- reference. A
// re-run tears its own data down first, so the numbers are stable across runs, and
// `--down` leaves the org exactly as the pilot had it.
//
// ── WHAT IT AIMS THE NUMBERS AT ─────────────────────────────────────────────
// The book is shaped, not random. There is money falling due TODAY, arrears in all
// four ageing buckets, promises dated TODAY, receipts already banked this morning,
// payouts waiting on a second pair of eyes and unmatched money in reconciliation —
// because those are the figures the ServiceSuite OS lock screen reads, and a demo
// where the phone says "nothing needs you" is a demo of a phone.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { platformPrisma } from "../prisma/seed-client";

const prisma = platformPrisma();

const SLUG = "micromart";
const SEED_TAG = "seed:micromart";
const REF_TAG = "MMSEED-";
const BRANCH_CODE_PREFIX = "MM-";
const STAFF_DOMAIN = "micromart.birgenai.com";
const PASSWORD = "Micromart1234!";

/** The live pilot. Read, booked against, never modified. */
const PILOT_PRODUCT = "MIROMART FINTECH";
const PILOT_CHARGE_CODE = "PF";

// ── Deterministic PRNG ───────────────────────────────────────────────────────
// A demo whose numbers move every time it is seeded is a demo nobody can rehearse.
let _s = 20260803;
const rand = () => { _s = (_s * 1664525 + 1013904223) % 4294967296; return _s / 4294967296; };
const pick = <T>(a: readonly T[]): T => a[Math.floor(rand() * a.length)];
const int = (lo: number, hi: number) => Math.floor(lo + rand() * (hi - lo + 1));
const money = (lo: number, hi: number, step = 500) => Math.round(int(lo, hi) / step) * step;
const chance = (p: number) => rand() < p;

const DAY = 86_400_000;
const daysAgo = (d: number) => new Date(Date.now() - d * DAY);
const daysAhead = (d: number) => new Date(Date.now() + d * DAY);
const addMonths = (d: Date, m: number) => { const x = new Date(d); x.setMonth(x.getMonth() + m); return x; };
const addWeeks = (d: Date, w: number) => new Date(d.getTime() + w * 7 * DAY);
const atHour = (d: Date, h: number) => { const x = new Date(d); x.setHours(h, 0, 0, 0); return x; };
const todayAt = (h: number) => atHour(new Date(), h);
const jitter = (v: number, span = 0.03) => v + (rand() - 0.5) * span;

// ── Nairobi reference data ───────────────────────────────────────────────────
type BranchSpec = { key: string; name: string; code: string; level: string; parent: string | null; lat: number; lng: number };

// A REAL TREE, not a flat list — because the demo has to show a Regional Manager
// seeing a region and a Branch Manager seeing one office, and neither is
// expressible without a middle level to sit at.
const BRANCHES: BranchSpec[] = [
  { key: "hq", name: "Nairobi Head Office", code: "HQ", level: "Head Office", parent: null, lat: -1.2864, lng: 36.8172 },
  { key: "nbo", name: "Nairobi Region", code: "NBO-R", level: "Region", parent: "hq", lat: -1.2864, lng: 36.8172 },
  { key: "coast", name: "Coast & Rift Region", code: "CRR-R", level: "Region", parent: "hq", lat: -3.5, lng: 38.5 },
  { key: "gikomba", name: "Gikomba", code: "GKB", level: "Branch", parent: "nbo", lat: -1.2842, lng: 36.8358 },
  { key: "eastleigh", name: "Eastleigh", code: "EST", level: "Branch", parent: "nbo", lat: -1.2716, lng: 36.8474 },
  { key: "kawangware", name: "Kawangware", code: "KWG", level: "Branch", parent: "nbo", lat: -1.2871, lng: 36.7526 },
  { key: "kasarani", name: "Kasarani", code: "KSR", level: "Branch", parent: "nbo", lat: -1.2166, lng: 36.8983 },
  { key: "mombasa", name: "Mombasa — Kongowea", code: "MSA", level: "Branch", parent: "coast", lat: -4.0300, lng: 39.6800 },
  { key: "nakuru", name: "Nakuru", code: "NKR", level: "Branch", parent: "coast", lat: -0.3031, lng: 36.0800 },
];
// Only the six trading branches carry a book; the two region nodes are structure,
// which is exactly what makes a Regional Manager's scope worth demonstrating.
const MARKETS: Record<string, { name: string; lat: number; lng: number }[]> = {
  gikomba: [
    { name: "Gikomba Market — Shoe Line", lat: -1.2842, lng: 36.8358 },
    { name: "Gikomba Market — Mitumba Section", lat: -1.2851, lng: 36.8341 },
    { name: "Majengo Kombo Munyiri Rd", lat: -1.2867, lng: 36.8395 },
  ],
  eastleigh: [
    { name: "Eastleigh First Avenue", lat: -1.2716, lng: 36.8474 },
    { name: "Garissa Lodge Mall", lat: -1.2733, lng: 36.8461 },
    { name: "Eastleigh Section Three", lat: -1.2762, lng: 36.8502 },
  ],
  kawangware: [
    { name: "Kawangware 46 Stage", lat: -1.2871, lng: 36.7526 },
    { name: "Congo Market", lat: -1.2836, lng: 36.7482 },
    { name: "Dagoretti Corner", lat: -1.2938, lng: 36.7443 },
  ],
  kasarani: [
    { name: "Mwiki Road Shops", lat: -1.2166, lng: 36.8983 },
    { name: "Kasarani Hunters", lat: -1.2231, lng: 36.8975 },
    { name: "Zimmerman Stage", lat: -1.2135, lng: 36.8905 },
  ],
  mombasa: [
    { name: "Kongowea Market", lat: -4.0300, lng: 39.6800 },
    { name: "Marikiti Mombasa", lat: -4.0616, lng: 39.6684 },
    { name: "Likoni Ferry Stalls", lat: -4.0771, lng: 39.6626 },
  ],
  nakuru: [
    { name: "Wakulima Market Nakuru", lat: -0.2870, lng: 36.0665 },
    { name: "Free Area Shops", lat: -0.2965, lng: 36.0921 },
    { name: "Bondeni Stage", lat: -0.2827, lng: 36.0724 },
  ],
};

const FIRST = ["Mercy", "Joseph", "Amina", "Peter", "Njeri", "Hassan", "Grace", "Daniel", "Halima", "Stephen", "Wanjiku", "Omar", "Esther", "Kelvin", "Zainab", "Patrick", "Beatrice", "Ali", "Caroline", "Michael", "Fatuma", "Simon", "Rose", "Abdi", "Lydia", "George", "Salma", "Charles", "Purity", "Ibrahim", "Naomi", "Vincent", "Asha", "Anthony", "Jacinta", "Yusuf", "Mary", "Elijah", "Rahma", "Duncan"];
const LAST = ["Wanjiru", "Mwangi", "Abdullahi", "Otieno", "Kamau", "Noor", "Achieng", "Kariuki", "Sheikh", "Mutua", "Njoroge", "Farah", "Wambui", "Ochieng", "Ahmed", "Gitau", "Adhiambo", "Hussein", "Nyambura", "Odhiambo", "Ismail", "Maina", "Atieno", "Barre", "Muthoni", "Omondi", "Yusuf", "Karanja", "Akinyi", "Osman"];
const TRADES = ["second-hand clothes", "vegetables & greengrocery", "cereals & pulses", "hardware & paint", "M-Pesa & airtime shop", "shoe repair & sales", "salon & cosmetics", "electronics repair", "furniture workshop", "butchery", "boda boda transport", "tailoring & fabric", "poultry & eggs", "cyber café & printing", "fish trading"];
const RELATIONS = ["Brother", "Sister", "Business partner", "Spouse", "Neighbour", "Colleague", "Cousin"];
const DEVICES = ["Chrome on Android", "Chrome on Windows", "Safari on iPhone", "Edge on Windows", "Opera Mini on Android"];
const IPS = ["105.163.2.44", "197.248.12.7", "41.90.64.133", "102.215.34.20", "196.201.214.20", "105.166.9.88"];

// ── Sequences ────────────────────────────────────────────────────────────────
let _phone = 31000000;
const nextPhone = () => "2547" + String(_phone++);
let _loose = 68000000;
const loosePhone = () => "2547" + String(_loose++);
let _receipt = 0;
const receiptRef = () => `${REF_TAG}R${String(++_receipt).padStart(6, "0")}`;

type StaffSpec = {
  first: string; last: string; role: string; branch: string; title: string;
  tiers?: { i?: boolean; a?: boolean; v?: boolean }; field?: boolean;
};

// Six roles that describe SIX DIFFERENT MORNINGS. This is the part of the seed
// the demo actually turns on: the same console, signed into as four people, shows
// four different books — which is the thing a spreadsheet can never do.
const ROLES: { title: string; scope: "OWN" | "BRANCH" | "BRANCH_TREE" | "ORG"; rights: string[] }[] = [
  {
    title: "Relationship Officer", scope: "OWN",
    rights: ["borrowers.view", "borrowers.create", "applications.view", "loans.view", "loans.apply", "collections.view", "collections.manage", "repayments.view", "repayments.collect", "field.view", "field.manage", "documents.view", "riri.use", "products.view"],
  },
  {
    title: "Branch Manager", scope: "BRANCH",
    rights: ["borrowers.view", "borrowers.create", "borrowers.manage", "kyc.verify", "applications.view", "applications.decide", "loans.view", "loans.apply", "collections.view", "collections.manage", "disbursements.view", "disbursements.manage", "repayments.view", "repayments.collect", "field.view", "field.manage", "reports.view", "reports.portfolio", "team.view", "products.view", "riri.use", "intelligence.view"],
  },
  {
    title: "Regional Manager", scope: "BRANCH_TREE",
    rights: ["borrowers.view", "borrowers.manage", "kyc.verify", "applications.view", "applications.decide", "loans.view", "collections.view", "collections.manage", "disbursements.view", "disbursements.manage", "float.view", "repayments.view", "reconciliation.view", "intelligence.view", "reports.view", "reports.portfolio", "reports.income", "reports.analytics", "field.view", "branches.view", "team.view", "products.view", "sms.view", "riri.use", "metrics.view"],
  },
  {
    title: "Call Centre Agent", scope: "ORG",
    rights: ["borrowers.view", "collections.view", "collections.manage", "repayments.view", "repayments.collect", "sms.view", "riri.use"],
  },
  {
    title: "Credit Manager", scope: "ORG",
    rights: ["borrowers.view", "borrowers.manage", "kyc.verify", "kyc.vouch", "applications.view", "applications.decide", "loans.view", "loans.apply", "collections.view", "intelligence.view", "intelligence.tune", "reports.view", "reports.portfolio", "reports.income", "reports.analytics", "reports.builder", "products.view", "products.manage", "workflows.view", "documents.view", "documents.parse", "riri.use", "metrics.view", "metrics.manage"],
  },
  {
    title: "Finance Officer", scope: "ORG",
    rights: ["loans.view", "disbursements.view", "disbursements.manage", "float.view", "float.manage", "repayments.view", "repayments.collect", "reconciliation.view", "reconciliation.resolve", "reports.view", "reports.income", "billing.view", "riri.use"],
  },
];

const STAFF: StaffSpec[] = [
  { first: "Wanjiru", last: "Kimani", role: "Regional Manager", branch: "nbo", title: "Regional Manager — Nairobi", tiers: { a: true } },
  { first: "Salim", last: "Bakari", role: "Regional Manager", branch: "coast", title: "Regional Manager — Coast & Rift", tiers: { a: true } },
  { first: "Dennis", last: "Kiptoo", role: "Branch Manager", branch: "gikomba", title: "Branch Manager", tiers: { a: true } },
  { first: "Faith", last: "Muthoni", role: "Branch Manager", branch: "eastleigh", title: "Branch Manager", tiers: { a: true } },
  { first: "Brian", last: "Ochieng", role: "Branch Manager", branch: "kasarani", title: "Branch Manager", tiers: { a: true } },
  { first: "Halima", last: "Noor", role: "Relationship Officer", branch: "eastleigh", title: "Relationship Officer", tiers: { i: true }, field: true },
  { first: "Kevin", last: "Mwangi", role: "Relationship Officer", branch: "gikomba", title: "Relationship Officer", tiers: { i: true }, field: true },
  { first: "Alice", last: "Nyambura", role: "Relationship Officer", branch: "kawangware", title: "Relationship Officer", tiers: { i: true }, field: true },
  { first: "Musa", last: "Abdi", role: "Relationship Officer", branch: "kasarani", title: "Relationship Officer", tiers: { i: true }, field: true },
  { first: "Zainab", last: "Omar", role: "Relationship Officer", branch: "mombasa", title: "Relationship Officer", tiers: { i: true }, field: true },
  { first: "Peter", last: "Njoroge", role: "Relationship Officer", branch: "nakuru", title: "Relationship Officer", tiers: { i: true }, field: true },
  { first: "Caroline", last: "Atieno", role: "Call Centre Agent", branch: "hq", title: "Call Centre Agent" },
  { first: "Victor", last: "Kariuki", role: "Call Centre Agent", branch: "hq", title: "Call Centre Agent" },
  { first: "Grace", last: "Wambui", role: "Credit Manager", branch: "hq", title: "Credit Manager", tiers: { v: true } },
  { first: "Samuel", last: "Mutua", role: "Finance Officer", branch: "hq", title: "Finance Officer", tiers: { v: true } },
];

// ── Products (INACTIVE — see the header) ─────────────────────────────────────
type ProductSpec = {
  name: string; description: string; min: number; max: number; rate: number;
  term: number; unit: "month" | "week"; mode: "B2C_MPESA" | "TO_THIRD_PARTY";
  guarantor: boolean; security?: boolean;
};
const PRODUCTS: ProductSpec[] = [
  { name: "Micromart Biashara", description: "Working capital for a trading business — four monthly installments against stock and takings.", min: 20_000, max: 300_000, rate: 13, term: 4, unit: "month", mode: "B2C_MPESA", guarantor: true },
  { name: "Stock Advance", description: "A short top-up to restock, repaid over three months. For customers already on the book.", min: 10_000, max: 150_000, rate: 10, term: 3, unit: "month", mode: "B2C_MPESA", guarantor: false },
  { name: "Boda & Asset Finance", description: "Motorcycle and equipment finance, secured on the asset, over six months.", min: 30_000, max: 250_000, rate: 12, term: 6, unit: "month", mode: "B2C_MPESA", guarantor: true, security: true },
  { name: "Salary Advance", description: "One-month advance against a payslip, disbursed the same day.", min: 5_000, max: 80_000, rate: 8, term: 1, unit: "month", mode: "B2C_MPESA", guarantor: false },
];

const CHARGES = [
  { name: "Registration Fee", code: "REG", description: "One-off fee to open a customer file.", amount: 100, isPercent: false, trigger: "ON_REGISTRATION", applyAt: "BEFORE_DISBURSEMENT" },
  { name: "Credit Life Insurance", code: "INS", description: "Loan protection cover, netted off the principal at disbursement.", amount: 1.5, isPercent: true, minValue: 250, maxValue: 6_000, trigger: "ON_APPLICATION", applyAt: "DEDUCT_FROM_PRINCIPAL" },
  { name: "Late Payment Fee", code: "LATE", description: "Charged on an installment that misses its date.", amount: 5, isPercent: true, minValue: 200, maxValue: 5_000, trigger: "MANUAL", applyAt: "ON_INSTALLMENTS" },
] as const;

// The shape of the book. Each kind is a story the demo can walk into.
type Kind = "cleared" | "clean" | "dueToday" | "late1_7" | "late8_30" | "late31_60" | "late60" | "writeoff" | "pending";
// SHAPED TO A REAL LENDER, not to fill screens. A microlender running well sits
// around 8–12% of the book in arrears with PAR30 in single figures; anything much
// worse describes a business in trouble, and a demo that opens on a failing book
// argues against the platform showing it.
const PLAN: [Kind, number][] = [
  ["cleared", 55], ["clean", 88], ["dueToday", 22],
  ["late1_7", 10], ["late8_30", 7], ["late31_60", 4], ["late60", 3],
  ["writeoff", 4], ["pending", 6],
];

type Ctx = {
  orgId: string;
  branchIds: Record<string, string>;
  roleIds: Record<string, string>;
  staff: { id: string; name: string; email: string; branchKey: string; branchId: string; role: string; field: boolean }[];
  products: { id: string; name: string; term: number; unit: "month" | "week"; rate: number; min: number; max: number; mode: string }[];
};

// ─────────────────────────────────────────────────────────────────────────────
// TEARDOWN
//
// Ordered by foreign key, child first. Every filter is fenced to rows this script
// created — the pilot product, the pilot charge, the real customers and the two
// real staff accounts are outside every `where` in here.
// ─────────────────────────────────────────────────────────────────────────────
async function teardown(orgId: string): Promise<void> {
  const borrowers = await prisma.borrower.findMany({ where: { orgId, deviceFingerprint: SEED_TAG }, select: { id: true } });
  const bIds = borrowers.map((b) => b.id);

  const staff = await prisma.staffUser.findMany({ where: { orgId, email: { endsWith: `@${STAFF_DOMAIN}` } }, select: { id: true } });
  const sIds = staff.map((s) => s.id);

  if (bIds.length) {
    const loans = await prisma.loan.findMany({ where: { orgId, borrowerId: { in: bIds } }, select: { id: true } });
    const lIds = loans.map((l) => l.id);

    const accounts = await prisma.savingsAccount.findMany({ where: { orgId, borrowerId: { in: bIds } }, select: { id: true } });
    if (accounts.length) {
      await prisma.savingsTransaction.deleteMany({ where: { accountId: { in: accounts.map((a) => a.id) } } });
      await prisma.savingsAccount.deleteMany({ where: { id: { in: accounts.map((a) => a.id) } } });
    }

    await prisma.standingOrder.deleteMany({ where: { orgId, borrowerId: { in: bIds } } });
    await prisma.promiseToPay.deleteMany({ where: { orgId, borrowerId: { in: bIds } } });
    await prisma.collectionCall.deleteMany({ where: { orgId, borrowerId: { in: bIds } } });
    await prisma.collectionTicket.deleteMany({ where: { orgId, borrowerId: { in: bIds } } });
    await prisma.paymentIntent.deleteMany({ where: { orgId, borrowerId: { in: bIds } } });
    await prisma.scoreSnapshot.deleteMany({ where: { orgId, borrowerId: { in: bIds } } });
    await prisma.graduationEvent.deleteMany({ where: { orgId, borrowerId: { in: bIds } } });
    await prisma.geoPin.deleteMany({ where: { orgId, borrowerId: { in: bIds } } });
    await prisma.fieldVisit.deleteMany({ where: { orgId, borrowerId: { in: bIds } } });
    await prisma.kycCheck.deleteMany({ where: { orgId, borrowerId: { in: bIds } } });
    await prisma.consent.deleteMany({ where: { orgId, borrowerId: { in: bIds } } });
    await prisma.document.deleteMany({ where: { orgId, borrowerId: { in: bIds } } });
    await prisma.collateral.deleteMany({ where: { orgId, borrowerId: { in: bIds } } });

    if (lIds.length) {
      await prisma.installment.deleteMany({ where: { loanId: { in: lIds } } });
      await prisma.disbursement.deleteMany({ where: { loanId: { in: lIds } } });
      await prisma.c2BReceipt.deleteMany({ where: { orgId, allocatedLoanId: { in: lIds } } });
    }
    // Offers and guarantors point at the application; loans point at it too — all
    // three go before the applications themselves.
    await prisma.loanOffer.deleteMany({ where: { orgId, borrowerId: { in: bIds } } });
    await prisma.guarantor.deleteMany({ where: { orgId, borrowerId: { in: bIds } } });
    await prisma.loan.deleteMany({ where: { orgId, borrowerId: { in: bIds } } });
    await prisma.loanApplication.deleteMany({ where: { orgId, borrowerId: { in: bIds } } });
    await prisma.borrower.deleteMany({ where: { id: { in: bIds } } });
  }

  // Org-level rows, found by their MMSEED- reference or by our staff.
  await prisma.c2BReceipt.deleteMany({ where: { orgId, transId: { startsWith: REF_TAG } } });
  await prisma.reconciliationException.deleteMany({ where: { orgId, reference: { startsWith: REF_TAG } } });
  await prisma.floatLedger.deleteMany({ where: { orgId, ref: { startsWith: REF_TAG } } });
  await prisma.smsMessage.deleteMany({ where: { orgId, providerRef: { startsWith: REF_TAG } } });
  await prisma.smsTemplate.deleteMany({ where: { orgId, key: { in: ["app_received", "approved", "disbursed", "payment", "reminder", "arrears", "ptp_due"] } } });
  await prisma.emailMessage.deleteMany({ where: { orgId, to: { endsWith: `@${STAFF_DOMAIN}` } } });
  await prisma.smsTopUp.deleteMany({ where: { orgId, note: { startsWith: REF_TAG } } });
  await prisma.portfolioRun.deleteMany({ where: { orgId, trigger: "seed" } });
  await prisma.auditLog.deleteMany({ where: { orgId, entity: SEED_TAG } });
  await prisma.document.deleteMany({ where: { orgId, storageKey: { startsWith: "sim/mmseed/" } } });
  if (sIds.length) {
    await prisma.smsCampaign.deleteMany({ where: { orgId, createdBy: { in: sIds } } });
    await prisma.complianceRequest.deleteMany({ where: { orgId, requestedById: { in: sIds } } });
    await prisma.fieldVisit.deleteMany({ where: { orgId, agentId: { in: sIds } } });
    await prisma.staffUser.deleteMany({ where: { id: { in: sIds } } });
  }

  // Catalogue last, and never the pilot's.
  await prisma.charge.deleteMany({ where: { orgId, code: { in: CHARGES.map((c) => c.code) }, NOT: { code: PILOT_CHARGE_CODE } } });
  await prisma.product.deleteMany({ where: { orgId, name: { in: PRODUCTS.map((p) => p.name) }, NOT: { name: PILOT_PRODUCT } } });

  const wfs = await prisma.workflow.findMany({ where: { orgId, title: { in: ["MICROMART APPROVAL", "REPEAT / TOP-UP"] } }, select: { id: true } });
  if (wfs.length) {
    const ids = wfs.map((w) => w.id);
    // Stages form a tree; children reference parents, so clear the leaves first.
    await prisma.workflowStage.deleteMany({ where: { workflowId: { in: ids }, parentId: { not: null } } });
    await prisma.workflowStage.deleteMany({ where: { workflowId: { in: ids } } });
    await prisma.workflow.deleteMany({ where: { id: { in: ids } } });
  }

  await prisma.role.deleteMany({ where: { orgId, title: { in: ROLES.map((r) => r.title) } } });
  // Deepest branches first — the tree is only three levels, so two passes do it.
  await prisma.branch.deleteMany({ where: { orgId, code: { startsWith: BRANCH_CODE_PREFIX }, levelName: "Branch" } });
  await prisma.branch.deleteMany({ where: { orgId, code: { startsWith: BRANCH_CODE_PREFIX }, parentId: { not: null } } });

  console.log(`  teardown: cleared ${bIds.length} seeded customers, ${sIds.length} seeded staff and their book`);
}

// ─────────────────────────────────────────────────────────────────────────────
// STRUCTURE — branches, roles, staff, products, charges, workflows
// ─────────────────────────────────────────────────────────────────────────────
async function seedStructure(orgId: string): Promise<Ctx> {
  // ── Branches ──────────────────────────────────────────────────────────────
  // The org's existing root is reused, never duplicated: exactly one head office
  // per lender is a schema invariant, not a preference.
  const existingRoot = await prisma.branch.findFirst({ where: { orgId, parentId: null }, select: { id: true } });
  const branchIds: Record<string, string> = {};
  for (const b of BRANCHES) {
    if (!b.parent && existingRoot) { branchIds[b.key] = existingRoot.id; continue; }
    const code = BRANCH_CODE_PREFIX + b.code;
    const found = await prisma.branch.findFirst({ where: { orgId, code }, select: { id: true } });
    if (found) { branchIds[b.key] = found.id; continue; }
    const created = await prisma.branch.create({
      data: {
        orgId, name: b.name, code, levelName: b.level,
        parentId: b.parent ? branchIds[b.parent] : null,
        lat: b.lat, lng: b.lng, radiusMeters: 500, active: true,
        disbursementLimit: b.level === "Branch" ? 500_000 : b.level === "Region" ? 2_000_000 : null,
      },
      select: { id: true },
    });
    branchIds[b.key] = created.id;
  }
  console.log(`  branches: ${Object.keys(branchIds).length} (head office reused, ${BRANCHES.length - 1} added)`);

  // ── Roles ─────────────────────────────────────────────────────────────────
  const roleIds: Record<string, string> = {};
  for (const r of ROLES) {
    const up = await prisma.role.upsert({
      where: { orgId_title: { orgId, title: r.title } },
      create: { orgId, title: r.title, rights: r.rights, menu: [], dataScope: r.scope },
      update: { rights: r.rights, dataScope: r.scope },
      select: { id: true },
    });
    roleIds[r.title] = up.id;
  }
  console.log(`  roles: ${ROLES.length} — ${ROLES.map((r) => `${r.title}[${r.scope}]`).join(", ")}`);

  // ── Staff ─────────────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const staff: Ctx["staff"] = [];
  for (let i = 0; i < STAFF.length; i++) {
    const s = STAFF[i];
    const email = `${s.first.toLowerCase()}.${s.last.toLowerCase()}@${STAFF_DOMAIN}`;
    const branchId = branchIds[s.branch];
    const spec = BRANCHES.find((b) => b.key === s.branch)!;
    const up = await prisma.staffUser.upsert({
      where: { orgId_email: { orgId, email } },
      create: {
        orgId, email, firstName: s.first, otherName: s.last, title: s.title,
        phone: "2547" + String(80000000 + i), passwordHash,
        roleId: roleIds[s.role], branchId,
        isInitiator: s.tiers?.i ?? false, isAuthorizer: s.tiers?.a ?? false, isValidator: s.tiers?.v ?? false,
        isFieldAgent: s.field ?? false,
        ...(s.field ? { lat: jitter(spec.lat), lng: jitter(spec.lng), lastLocationAt: daysAgo(int(0, 2)) } : {}),
        avatarSeed: email, status: "ACTIVE", lastLoginAt: daysAgo(int(0, 3)),
      },
      update: {
        roleId: roleIds[s.role], branchId, title: s.title, status: "ACTIVE",
        isInitiator: s.tiers?.i ?? false, isAuthorizer: s.tiers?.a ?? false, isValidator: s.tiers?.v ?? false,
        isFieldAgent: s.field ?? false, lastLoginAt: daysAgo(int(0, 3)),
      },
      select: { id: true },
    });
    staff.push({ id: up.id, name: `${s.first} ${s.last}`, email, branchKey: s.branch, branchId, role: s.role, field: s.field ?? false });
  }
  console.log(`  staff: ${staff.length} (password ${PASSWORD})`);

  // ── Products ──────────────────────────────────────────────────────────────
  const products: Ctx["products"] = [];
  const pilot = await prisma.product.findFirst({
    where: { orgId, name: PILOT_PRODUCT },
    select: { id: true, name: true, repaymentPeriod: true, repaymentPeriodUnit: true, interestRate: true, minPrincipal: true, maxPrincipal: true, disbursementMode: true },
  });
  if (pilot) {
    products.push({
      id: pilot.id, name: pilot.name, term: pilot.repaymentPeriod,
      unit: pilot.repaymentPeriodUnit === "week" ? "week" : "month",
      rate: Number(pilot.interestRate), min: Number(pilot.minPrincipal), max: Number(pilot.maxPrincipal),
      mode: String(pilot.disbursementMode),
    });
    console.log(`  pilot product found and left untouched: ${pilot.name}`);
  }

  for (const p of PRODUCTS) {
    const found = await prisma.product.findFirst({ where: { orgId, name: p.name }, select: { id: true } });
    const data = {
      orgId, name: p.name, description: p.description,
      minPrincipal: p.min, maxPrincipal: p.max, interestRate: p.rate,
      interestMethod: "flat", interestPeriodUnit: "term",
      repaymentPeriod: p.term, repaymentPeriodUnit: p.unit,
      guarantorRequired: p.guarantor, securityRequired: p.security ?? false,
      disbursementMode: p.mode as never,
      // OFF by design — an active local product becomes the live portal shelf on a
      // bridged org. See the header.
      isActive: false,
    };
    const row = found
      ? await prisma.product.update({ where: { id: found.id }, data, select: { id: true } })
      : await prisma.product.create({ data, select: { id: true } });
    products.push({ id: row.id, name: p.name, term: p.term, unit: p.unit, rate: p.rate, min: p.min, max: p.max, mode: p.mode });
  }
  console.log(`  products: ${PRODUCTS.length} added (inactive — live shelf untouched), ${products.length} bookable`);

  // ── Charges ───────────────────────────────────────────────────────────────
  for (const c of CHARGES) {
    const found = await prisma.charge.findFirst({ where: { orgId, code: c.code }, select: { id: true } });
    const data = {
      orgId, name: c.name, code: c.code, description: c.description,
      amount: c.amount, isPercent: c.isPercent,
      minValue: "minValue" in c ? c.minValue : null,
      maxValue: "maxValue" in c ? c.maxValue : null,
      trigger: c.trigger as never, applyAt: c.applyAt as never,
      beneficiary: "LENDER" as const, isActive: true,
    };
    if (found) await prisma.charge.update({ where: { id: found.id }, data });
    else await prisma.charge.create({ data });
  }
  console.log(`  charges: ${CHARGES.length} (the pilot's PROCESSING FEES left untouched)`);

  // ── Workflows ─────────────────────────────────────────────────────────────
  const WF: { title: string; description: string; stages: { title: string; tier: number; finalize?: boolean; max?: number }[] }[] = [
    {
      title: "MICROMART APPROVAL",
      description: "New customer, first loan. Officer takes it, the branch approves it, credit signs anything above half a million.",
      stages: [
        { title: "Officer Review", tier: 1 },
        { title: "Branch Approval", tier: 2, finalize: true, max: 300_000 },
        { title: "Credit Committee", tier: 3, finalize: true, max: 5_000_000 },
      ],
    },
    {
      title: "REPEAT / TOP-UP",
      description: "A customer already on the book. One approval, because the record is the evidence.",
      stages: [
        { title: "Officer Check", tier: 1 },
        { title: "Branch Sign-off", tier: 2, finalize: true, max: 500_000 },
      ],
    },
  ];
  for (const w of WF) {
    const found = await prisma.workflow.findFirst({ where: { orgId, title: w.title }, select: { id: true } });
    const wf = found ?? await prisma.workflow.create({ data: { orgId, title: w.title, description: w.description }, select: { id: true } });
    const have = await prisma.workflowStage.count({ where: { workflowId: wf.id } });
    if (!have) {
      await prisma.workflowStage.createMany({
        data: w.stages.map((s, i) => ({
          workflowId: wf.id, title: s.title, order: i + 1, accessTier: s.tier,
          roleIds: [], canFinalize: s.finalize ?? false, canUpdate: s.tier === 1,
          otpRequired: s.tier >= 2, maxAmount: s.max ?? null,
        })),
      });
    }
  }
  console.log(`  workflows: ${WF.length}`);

  return { orgId, branchIds, roleIds, staff, products };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE BOOK
// ─────────────────────────────────────────────────────────────────────────────

type Inst = { seq: number; dueDate: Date; amountDue: number; principalDue: number; interestDue: number; amountPaid: number; penalty: number; status: string; paidAt: Date | null };

/**
 * A schedule shaped to the story the loan is telling.
 *
 * The ageing buckets are NOT left to chance. Collections DPD keys off the earliest
 * unpaid installment, so a loan that must appear in "31–60 days" has its earliest
 * miss dated into that window on purpose — otherwise the bucket that the demo is
 * about is the one that happens to be empty.
 */
function buildSchedule(kind: Kind, term: number, unit: "month" | "week", perDue: number, perPrin: number, borrowDate: Date): { insts: Inst[]; balance: number } {
  const now = Date.now();
  const add = (n: number) => (unit === "week" ? addWeeks(borrowDate, n) : addMonths(borrowDate, n));
  const perInt = perDue - perPrin;
  const insts: Inst[] = [];

  // How many days late the EARLIEST unpaid installment should be.
  const lateBy =
    kind === "late1_7" ? int(1, 7)
      : kind === "late8_30" ? int(8, 29)
        : kind === "late31_60" ? int(32, 58)
          : kind === "late60" ? int(65, 190)
            : 0;

  for (let s = 0; s < term; s++) {
    const due = add(s + 1);
    const isPast = due.getTime() < now;
    let paid = 0, status = "UPCOMING", paidAt: Date | null = null, penalty = 0;

    if (kind === "cleared") { paid = perDue; status = "PAID"; paidAt = due; }
    else if (kind === "pending") { status = "UPCOMING"; }
    else if (kind === "writeoff") { if (isPast) { status = "OVERDUE"; penalty = Math.round(perDue * 0.05); } }
    else if (isPast) { paid = perDue; status = "PAID"; paidAt = new Date(due.getTime() - int(0, 3) * DAY); }

    insts.push({ seq: s + 1, dueDate: due, amountDue: perDue, principalDue: perPrin, interestDue: perInt, amountPaid: paid, penalty, status, paidAt });
  }

  // Now impose the story on top of the mechanical schedule.
  if (lateBy > 0) {
    // WHERE THE MISS SITS decides everything about how this loan reads.
    //
    // It is the first still-unpaid installment — and when the whole schedule has
    // already elapsed, it is the LAST one, not the first. That distinction is the
    // difference between "paid three of four and then stopped", which is what a
    // real defaulting customer looks like, and "never paid a shilling", which
    // would put the entire loan amount into arrears and hand the demo a lender
    // running 40% PAR.
    //
    // The deep buckets back up a step or two, because an account sixty days down
    // has usually missed more than once, and a 60+ bucket carrying one installment
    // understates the only thing that bucket exists to say.
    const firstUnpaid = insts.findIndex((i) => i.status !== "PAID");
    const anchor = firstUnpaid === -1 ? insts.length - 1 : firstUnpaid;
    const depth = kind === "late60" ? 2 : kind === "late31_60" ? 1 : 0;
    const target = Math.max(0, anchor - depth);
    for (let s = target; s < insts.length; s++) {
      insts[s].amountPaid = 0;
      insts[s].paidAt = null;
      insts[s].status = "OVERDUE";
      insts[s].penalty = s === target ? Math.round(perDue * 0.05) : 0;
    }
    insts[target].dueDate = atHour(daysAgo(lateBy), 9);
    // Installments after the miss keep their cadence from the miss date.
    for (let s = target + 1; s < insts.length; s++) {
      const step = unit === "week" ? (s - target) * 7 * DAY : 0;
      insts[s].dueDate = unit === "week"
        ? new Date(insts[target].dueDate.getTime() + step)
        : addMonths(insts[target].dueDate, s - target);
      // Only the ones that have actually arrived are overdue.
      if (insts[s].dueDate.getTime() > now) { insts[s].status = "UPCOMING"; insts[s].penalty = 0; }
    }
  }

  if (kind === "dueToday") {
    // The whole point of the Due Today app: money that falls due before close of
    // business TODAY. The first not-yet-paid installment is moved onto today and
    // marked DUE, which is what the endpoint counts.
    const idx = insts.findIndex((i) => i.status === "UPCOMING");
    const target = idx === -1 ? insts.length - 1 : idx;
    insts[target].dueDate = todayAt(int(9, 16));
    insts[target].status = "DUE";
    // A few are already part-paid — a demo where every figure is a whole number
    // looks like a demo.
    if (chance(0.25)) { insts[target].amountPaid = Math.round(perDue * 0.4); insts[target].status = "PARTIAL"; }
    for (let s = target + 1; s < insts.length; s++) {
      insts[s].dueDate = unit === "week"
        ? new Date(insts[target].dueDate.getTime() + (s - target) * 7 * DAY)
        : addMonths(insts[target].dueDate, s - target);
      insts[s].status = "UPCOMING";
      insts[s].amountPaid = 0;
      insts[s].paidAt = null;
    }
  }

  const balance = kind === "cleared" ? 0 : insts.reduce((sum, i) => sum + (i.amountDue - i.amountPaid), 0);
  return { insts, balance };
}

async function seedBook(ctx: Ctx) {
  const { orgId, staff, products } = ctx;
  const officers = staff.filter((s) => s.role === "Relationship Officer");
  const managers = staff.filter((s) => s.role === "Branch Manager");
  const agents = staff.filter((s) => s.role === "Call Centre Agent");
  const finance = staff.find((s) => s.role === "Finance Officer")!;
  const credit = staff.find((s) => s.role === "Credit Manager")!;

  const plan: Kind[] = PLAN.flatMap(([k, n]) => Array<Kind>(n).fill(k));
  for (let i = plan.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [plan[i], plan[j]] = [plan[j], plan[i]]; }

  // Rows are accumulated and written in bulk. Ids are minted here rather than read
  // back, which turns ~1,500 round trips into a dozen.
  const borrowerRows: Record<string, unknown>[] = [];
  const loanRows: Record<string, unknown>[] = [];
  const instRows: Record<string, unknown>[] = [];
  const disbRows: Record<string, unknown>[] = [];
  const receiptRows: Record<string, unknown>[] = [];
  const consentRows: Record<string, unknown>[] = [];
  const kycRows: Record<string, unknown>[] = [];
  const geoRows: Record<string, unknown>[] = [];
  const scoreRows: Record<string, unknown>[] = [];

  type BookLoan = { id: string; borrowerId: string; officerId: string; branchId: string; kind: Kind; balance: number; perDue: number; phone: string; name: string; productId: string };
  const bookLoans: BookLoan[] = [];
  const borrowers: { id: string; name: string; phone: string; officerId: string; branchId: string; branchKey: string; kyc: string; limit: number; cleared: number }[] = [];

  for (let n = 0; n < plan.length; n++) {
    const kind = plan[n];
    // A repeat customer is a real thing and the graduation engine needs them, so a
    // quarter of loans after the book has some depth go to somebody already on it.
    const reuse = borrowers.length > 20 && chance(0.24);
    let b: typeof borrowers[number];

    if (reuse) {
      b = pick(borrowers);
    } else {
      const officer = pick(officers);
      const branchKey = officer.branchKey;
      const spot = pick(MARKETS[branchKey] ?? MARKETS.gikomba);
      const homeSpot = pick(MARKETS[branchKey] ?? MARKETS.gikomba);
      const first = pick(FIRST), last = pick(LAST);
      const id = randomUUID();
      const phone = nextPhone();
      // Most of the book is verified; a real lender always has a queue waiting,
      // and an empty KYC screen in a demo is a screen that looks unused.
      const kyc = chance(0.86) ? "VERIFIED" : pick(["PENDING_REVIEW", "IN_PROGRESS", "NONE"]);
      const verified = kyc === "VERIFIED";
      const score = int(430, 830);
      const band = score >= 720 ? "PRIME" : score >= 640 ? "STRONG" : score >= 550 ? "WATCH" : "HIGH";
      const limit = money(20_000, 320_000, 5_000);

      borrowerRows.push({
        id, orgId, phone, firstName: first, otherName: last,
        nationalId: String(int(21_000_000, 39_999_999)),
        dob: daysAgo(int(22, 58) * 365), gender: chance(0.52) ? "F" : "M",
        language: chance(0.35) ? "sw" : "en",
        nextOfKin: { name: `${pick(FIRST)} ${pick(LAST)}`, relationship: pick(RELATIONS), phone: loosePhone() },
        kycStatus: kyc, kycVerifiedAt: verified ? daysAgo(int(10, 420)) : null,
        iprsVerified: verified, livenessPassed: verified ? true : null,
        faceMatchScore: verified ? Number((0.82 + rand() * 0.17).toFixed(2)) : null,
        creditScore: verified ? score : null, riskBand: verified ? band : null,
        behaviouralScore: verified && chance(0.6) ? Number((45 + rand() * 52).toFixed(1)) : null,
        lastScoredAt: verified ? daysAgo(int(1, 60)) : null,
        loanLimit: verified ? limit : null,
        graduationCount: 0,
        lat: jitter(spot.lat, 0.004), lng: jitter(spot.lng, 0.004),
        locationType: "business", locationAddress: `${spot.name} — ${pick(TRADES)}`,
        ...(chance(0.45) ? { homeLat: jitter(homeSpot.lat, 0.01), homeLng: jitter(homeSpot.lng, 0.01), homeAddress: homeSpot.name } : {}),
        geoConsentAt: daysAgo(int(5, 300)),
        createdById: officer.id, branchId: officer.branchId,
        deviceFingerprint: SEED_TAG,
        createdAt: daysAgo(int(10, 700)),
      });

      b = { id, name: `${first} ${last}`, phone, officerId: officer.id, branchId: officer.branchId, branchKey, kyc, limit, cleared: 0 };
      borrowers.push(b);

      consentRows.push({
        orgId, borrowerId: id, version: "2026-07-08",
        grants: { mpesaAnalysis: true, automatedScoring: true, crbCheck: true, iprs: true, modelImprovement: chance(0.8), crossBorder: false, geoTagging: true },
        ip: pick(IPS), createdAt: daysAgo(int(5, 300)),
      });

      if (verified) {
        for (const k of ["ID_QUALITY", "ID_OCR", "LIVENESS", "FACE_MATCH", "IPRS"]) {
          kycRows.push({ orgId, borrowerId: id, kind: k, passed: true, score: Number((0.8 + rand() * 0.19).toFixed(2)), provider: "simulation", createdAt: daysAgo(int(10, 400)) });
        }
      } else if (kyc === "PENDING_REVIEW") {
        kycRows.push({ orgId, borrowerId: id, kind: "ID_QUALITY", passed: true, score: 0.91, provider: "simulation", createdAt: daysAgo(int(0, 4)) });
        kycRows.push({ orgId, borrowerId: id, kind: "FACE_MATCH", passed: false, score: 0.61, provider: "simulation", createdAt: daysAgo(int(0, 4)) });
      }

      geoRows.push({
        orgId, borrowerId: id, label: spot.name, lat: jitter(spot.lat, 0.004), lng: jitter(spot.lng, 0.004),
        accuracyMeters: int(8, 45), locationType: "business", address: spot.name, phone,
        source: chance(0.6) ? "self-onboard" : "ro-visit", capturedBy: officer.id, createdAt: daysAgo(int(5, 300)),
      });

      if (verified) {
        scoreRows.push({
          orgId, borrowerId: id, modelKind: "thin-file", modelVersion: "v2.1-micromart",
          score, pd: Number((0.02 + (830 - score) / 830 * 0.28).toFixed(5)), riskBand: band,
          features: { mpesaInflow30d: money(18_000, 420_000, 1_000), mpesaOutflow30d: money(15_000, 380_000, 1_000), tillCount: int(0, 3), activeDays: int(12, 30) },
          reasons: [{ code: "CASHFLOW_STABLE", detail: "Inflows steady over the last three months" }],
          capturedBy: "batch", createdAt: daysAgo(int(1, 90)),
        });
      }
    }

    // ── The loan ────────────────────────────────────────────────────────────
    const product = pick(products);
    const term = product.term;
    const principal = money(Math.round(product.min + (product.max - product.min) * 0.25), product.max, 1_000);
    const interest = Math.round(principal * (product.rate / 100));
    const loanAmount = principal + interest;
    const perDue = Math.round(loanAmount / term);
    const perPrin = Math.round(principal / term);

    const ageDays =
      kind === "cleared" ? int(120, 640)
        : kind === "writeoff" ? int(260, 620)
          : kind === "late60" ? int(150, 420)
            : kind === "late31_60" ? int(90, 260)
              : kind === "late8_30" ? int(60, 200)
                : kind === "late1_7" ? int(45, 180)
                  : kind === "pending" ? int(0, 2)
                    : int(10, 130);
    const borrowDate = atHour(daysAgo(ageDays), 10);
    const { insts, balance } = buildSchedule(kind, term, product.unit, perDue, perPrin, borrowDate);

    const status = kind === "cleared" ? "CLEARED" : kind === "writeoff" ? "WRITTEN_OFF" : kind === "pending" ? "PENDING_DISBURSEMENT" : "ACTIVE";
    const loanId = randomUUID();
    const officer = staff.find((s) => s.id === b.officerId) ?? pick(officers);

    loanRows.push({
      id: loanId, orgId, borrowerId: b.id, productId: product.id,
      principal, interest, loanAmount, balance,
      status, borrowDate,
      disbursedAt: kind === "pending" ? null : borrowDate,
      expectedClearDate: insts[insts.length - 1].dueDate,
      clearedAt: kind === "cleared" ? insts[insts.length - 1].dueDate : null,
      createdBy: officer.id, branchId: officer.branchId,
      createdAt: borrowDate, updatedAt: borrowDate,
    });
    if (kind === "cleared") b.cleared += 1;

    for (const i of insts) {
      instRows.push({
        orgId, loanId, seq: i.seq, dueDate: i.dueDate,
        amountDue: i.amountDue, principalDue: i.principalDue, interestDue: i.interestDue,
        amountPaid: i.amountPaid, penalty: i.penalty, status: i.status, paidAt: i.paidAt,
      });
    }

    // Disbursement. A handful sit in the maker-checker queue on purpose — a
    // payments module with an empty queue never shows the control that makes it
    // a lending system rather than a payments button.
    const disbState = kind === "pending"
      ? (chance(0.6) ? "PENDING_CHECKER" : "PENDING_MAKER")
      : product.mode === "TO_THIRD_PARTY" ? "MANUAL_CONFIRMED" : "CONFIRMED";
    disbRows.push({
      orgId, loanId, amount: principal, phone: b.phone, state: disbState,
      makerId: officer.id,
      checkerId: disbState === "CONFIRMED" || disbState === "MANUAL_CONFIRMED" ? pick(managers).id : null,
      receiptRef: disbState.startsWith("PENDING") ? null : `${REF_TAG}D${String(int(100000, 999999))}`,
      createdAt: borrowDate, updatedAt: borrowDate,
    });

    // Receipts behind the paid installments. These are what the Repayments screen
    // and the "already in today" figure both read.
    for (const i of insts.filter((x) => x.status === "PAID" || x.status === "PARTIAL")) {
      if (i.amountPaid <= 0) continue;
      receiptRows.push({
        orgId, transId: receiptRef(), amount: i.amountPaid, phone: b.phone,
        billRef: String(int(21_000_000, 39_999_999)),
        allocatedLoanId: loanId, allocatedAt: i.paidAt ?? i.dueDate, createdAt: i.paidAt ?? i.dueDate,
      });
    }

    bookLoans.push({ id: loanId, borrowerId: b.id, officerId: officer.id, branchId: officer.branchId, kind, balance, perDue, phone: b.phone, name: b.name, productId: product.id });
  }

  // MONEY IN THIS MORNING. Ten receipts dated today so the lock screen's
  // counterweight — "already receipted today" — is a real number rather than a
  // zero that makes the whole panel look like it only knows how to bring bad news.
  const payingToday = bookLoans.filter((l) => l.kind === "clean" || l.kind === "dueToday").slice(0, 10);
  for (const l of payingToday) {
    receiptRows.push({
      orgId, transId: receiptRef(), amount: Math.round(l.perDue * (chance(0.5) ? 1 : 0.5)),
      phone: l.phone, billRef: String(int(21_000_000, 39_999_999)),
      allocatedLoanId: l.id, allocatedAt: todayAt(int(7, 11)), createdAt: todayAt(int(7, 11)),
    });
  }

  console.log(`  writing ${borrowerRows.length} customers…`);
  await prisma.borrower.createMany({ data: borrowerRows as never });
  await prisma.consent.createMany({ data: consentRows as never });
  await prisma.kycCheck.createMany({ data: kycRows as never });
  await prisma.geoPin.createMany({ data: geoRows as never });
  await prisma.scoreSnapshot.createMany({ data: scoreRows as never });
  console.log(`  writing ${loanRows.length} loans and ${instRows.length} installments…`);
  await prisma.loan.createMany({ data: loanRows as never });
  await prisma.installment.createMany({ data: instRows as never });
  await prisma.disbursement.createMany({ data: disbRows as never });
  await prisma.c2BReceipt.createMany({ data: receiptRows as never, skipDuplicates: true });

  const active = bookLoans.filter((l) => l.kind !== "cleared" && l.kind !== "writeoff" && l.kind !== "pending");
  const olb = active.reduce((s, l) => s + l.balance, 0);
  const inArrears = active.filter((l) => l.kind.startsWith("late")).reduce((s, l) => s + l.balance, 0);
  // PAR30 the way the metric catalogue defines it: the BALANCE of every active loan
  // carrying an installment more than thirty days overdue, over the outstanding book.
  const par30 = active.filter((l) => l.kind === "late31_60" || l.kind === "late60").reduce((s, l) => s + l.balance, 0);
  console.log(`  book: ${loanRows.length} loans over ${borrowers.length} customers · OLB≈${olb.toLocaleString()} · arrears≈${((inArrears / Math.max(1, olb)) * 100).toFixed(1)}% · PAR30≈${((par30 / Math.max(1, olb)) * 100).toFixed(1)}%`);

  return { borrowers, bookLoans, officers, managers, agents, finance, credit };
}

// ─────────────────────────────────────────────────────────────────────────────
// ORIGINATION — applications, offers, guarantors, security, documents
// ─────────────────────────────────────────────────────────────────────────────
async function seedOrigination(ctx: Ctx, book: Awaited<ReturnType<typeof seedBook>>) {
  const { orgId, products } = ctx;
  const { borrowers, officers, managers } = book;

  const STATUSES: { status: string; n: number; decision: string | null; stale?: boolean }[] = [
    { status: "SUBMITTED", n: 7, decision: null },
    { status: "AI_PRESCREEN", n: 5, decision: null },
    { status: "OFFICER_REVIEW", n: 8, decision: "REFER", stale: true },
    { status: "REFERRED", n: 4, decision: "REFER", stale: true },
    { status: "APPROVED", n: 6, decision: "APPROVE" },
    { status: "DISBURSED", n: 9, decision: "APPROVE" },
    { status: "DECLINED", n: 6, decision: "DECLINE" },
    { status: "WITHDRAWN", n: 2, decision: null },
  ];

  const appRows: Record<string, unknown>[] = [];
  const offerRows: Record<string, unknown>[] = [];
  const guarantorRows: Record<string, unknown>[] = [];
  const collateralRows: Record<string, unknown>[] = [];
  const docRows: Record<string, unknown>[] = [];
  const scoreRows: Record<string, unknown>[] = [];

  let bi = 0;
  for (const spec of STATUSES) {
    for (let k = 0; k < spec.n; k++) {
      const b = borrowers[(bi++ * 3) % borrowers.length];
      const product = pick(products);
      const appId = randomUUID();
      const amount = money(Math.max(product.min, 15_000), Math.min(product.max, 260_000), 5_000);
      const score = int(420, 840);
      const officer = officers.find((o) => o.id === b.officerId) ?? pick(officers);
      // A queue that is only ever fresh never shows the ageing alert the platform
      // is sold on, so the review stages carry applications that have been sitting.
      const created = spec.stale ? daysAgo(int(3, 11)) : daysAgo(int(0, 6));

      appRows.push({
        id: appId, orgId, borrowerId: b.id, productId: product.id,
        productName: product.name,
        phone: b.phone, borrowerName: b.name,
        amountRequested: amount, status: spec.status,
        stageTitle: spec.status === "OFFICER_REVIEW" ? "Officer Review" : spec.status === "REFERRED" ? "Branch Approval" : null,
        score, pd: Number((0.02 + (840 - score) / 840 * 0.3).toFixed(5)),
        scoreModelVersion: "v2.1-micromart", fusionEngine: "fused",
        decision: spec.decision,
        reasonCodes: spec.decision === "DECLINE"
          ? [{ code: "AFFORDABILITY", detail: "Requested amount above assessed capacity" }]
          : [{ code: "CASHFLOW_STABLE", detail: "Till inflows steady across three months" }],
        featuresSnapshot: { mpesaInflow30d: money(20_000, 380_000, 1_000), tillCount: int(0, 2), activeDays: int(14, 30) },
        approvedLimit: b.limit,
        officerId: officer.id, branchId: officer.branchId,
        consentVersion: "2026-07-08",
        outcome: "PENDING",
        decidedAt: spec.decision ? daysAgo(int(0, 8)) : null,
        createdAt: created, updatedAt: created,
      });

      scoreRows.push({
        orgId, borrowerId: b.id, applicationId: appId,
        modelKind: "origination-v2", modelVersion: "v2.1-micromart",
        score, pd: Number((0.02 + (840 - score) / 840 * 0.3).toFixed(5)),
        riskBand: score >= 720 ? "PRIME" : score >= 640 ? "STRONG" : score >= 550 ? "WATCH" : "HIGH",
        loanContextAmount: amount, capturedBy: "apply", createdAt: created,
      });

      // An accepted offer for the ones that got that far — the legal artifact the
      // booking gate refuses to work without.
      if (spec.status === "APPROVED" || spec.status === "DISBURSED") {
        const interest = Math.round(amount * (product.rate / 100));
        const first = product.unit === "week" ? addWeeks(created, 1) : addMonths(created, 1);
        const last = product.unit === "week" ? addWeeks(created, product.term) : addMonths(created, product.term);
        offerRows.push({
          orgId, applicationId: appId, borrowerId: b.id, productId: product.id,
          principal: amount, interestRate: product.rate, interestMethod: "flat",
          termCount: product.term, termUnit: product.unit, graceDays: 0,
          totalInterest: interest, totalRepayable: amount + interest,
          borrowDate: created, firstDueDate: first, expectedClearDate: last,
          schedule: Array.from({ length: product.term }, (_, i) => ({
            seq: i + 1,
            dueDate: (product.unit === "week" ? addWeeks(created, i + 1) : addMonths(created, i + 1)).toISOString(),
            amountDue: Math.round((amount + interest) / product.term),
          })),
          termsHash: `sha256:${appId.replace(/-/g, "").slice(0, 40)}`,
          status: "ACCEPTED", expiresAt: daysAhead(int(3, 14)),
          acceptedAt: daysAgo(int(0, 5)), channel: chance(0.7) ? "PORTAL" : "BRANCH",
          acceptedIp: pick(IPS), recordedBy: chance(0.7) ? null : pick(managers).id,
        });
      }

      // Guarantors on the products that ask for them.
      if (chance(0.45)) {
        guarantorRows.push({
          orgId, applicationId: appId, borrowerId: b.id,
          fullName: `${pick(FIRST)} ${pick(LAST)}`, phone: loosePhone(),
          nationalId: String(int(21_000_000, 39_999_999)), relationship: pick(RELATIONS),
          status: pick(["CONSENTED", "CONSENTED", "INVITED", "DECLINED"]),
          amountGuaranteed: amount,
          // Some expire inside three days — that is the guarantee-lapsing alert.
          expiresAt: chance(0.3) ? daysAhead(int(1, 3)) : daysAhead(int(7, 30)),
          invitedAt: daysAgo(int(1, 14)),
          consentedAt: chance(0.6) ? daysAgo(int(0, 8)) : null,
          createdAt: daysAgo(int(1, 14)), updatedAt: daysAgo(int(0, 3)),
        });
      }

      if (product.name === "Boda & Asset Finance") {
        collateralRows.push({
          orgId, applicationId: appId, borrowerId: b.id, kind: "VEHICLE",
          description: `${pick(["Boxer BM150", "TVS HLX 125", "Honda Ace 125", "Bajaj Boxer 150"])} motorcycle`,
          estimatedValueKes: money(95_000, 190_000, 5_000),
          registrationRef: `KM${pick(["A", "B", "C", "D"])}${int(100, 999)}${pick(["K", "L", "M", "P"])}`,
          status: chance(0.6) ? "VERIFIED" : "REGISTERED",
          verifiedBy: chance(0.6) ? pick(managers).id : null,
          verifiedAt: chance(0.6) ? daysAgo(int(1, 20)) : null,
          createdAt: created, updatedAt: created,
        });
      }

      if (chance(0.5)) {
        const kind = pick(["BANK_STATEMENT", "NATIONAL_ID", "PERMIT", "INVOICE"] as const);
        const parsed = chance(0.75);
        docRows.push({
          orgId, borrowerId: b.id, applicationId: appId, kind,
          filename: `${kind.toLowerCase()}-${b.phone.slice(-4)}.pdf`,
          contentType: "application/pdf", bytes: int(90_000, 1_400_000), pages: int(1, 6),
          storageKey: `sim/mmseed/${appId}.pdf`,
          status: parsed ? "PARSED" : "NEEDS_REVIEW",
          confidence: parsed ? Number((0.82 + rand() * 0.17).toFixed(2)) : Number((0.4 + rand() * 0.3).toFixed(2)),
          fields: kind === "BANK_STATEMENT"
            ? { accountName: b.name, period: "3 months", averageBalance: money(4_000, 90_000, 500) }
            : { name: b.name, number: String(int(21_000_000, 39_999_999)) },
          note: parsed ? null : "An expected field was missing — a human should check it.",
          parserMode: "simulation", uploadedBy: officer.id,
          createdAt: created, updatedAt: created,
        });
      }
    }
  }

  await prisma.loanApplication.createMany({ data: appRows as never });
  await prisma.loanOffer.createMany({ data: offerRows as never });
  await prisma.guarantor.createMany({ data: guarantorRows as never });
  await prisma.collateral.createMany({ data: collateralRows as never });
  await prisma.document.createMany({ data: docRows as never });
  await prisma.scoreSnapshot.createMany({ data: scoreRows as never });
  console.log(`  origination: ${appRows.length} applications · ${offerRows.length} accepted offers · ${guarantorRows.length} guarantors · ${collateralRows.length} security · ${docRows.length} documents`);
}

// ─────────────────────────────────────────────────────────────────────────────
// COLLECTIONS — the promises the lock screen is about, plus the calls and tickets
// ─────────────────────────────────────────────────────────────────────────────
async function seedCollections(ctx: Ctx, book: Awaited<ReturnType<typeof seedBook>>) {
  const { orgId } = ctx;
  const { bookLoans, agents, officers } = book;
  const chasers = [...agents, ...officers];

  const late = bookLoans.filter((l) => l.kind.startsWith("late"));
  const ptpRows: Record<string, unknown>[] = [];
  const callRows: Record<string, unknown>[] = [];
  const ticketRows: Record<string, unknown>[] = [];

  // ── PROMISES DUE TODAY ────────────────────────────────────────────────────
  // The founder's ask, literally: "all customers who promised to pay today".
  // Fourteen of them, taken on calls over the last few days, every one still
  // PENDING — which is what makes them a worklist rather than a history.
  const promisers = late.slice(0, 14);
  for (const l of promisers) {
    const by = pick(chasers);
    const takenAt = daysAgo(int(1, 5));
    const amount = Math.round(l.perDue * (chance(0.5) ? 1 : 0.6));
    const ptpId = randomUUID();
    ptpRows.push({
      id: ptpId, orgId, loanId: l.id, borrowerId: l.borrowerId,
      amount, dueDate: todayAt(int(12, 17)), status: "PENDING",
      note: pick([
        "Says the stock money comes in from the Gikomba run today",
        "Waiting on a customer who owes him — will pay by lunchtime",
        "Salary hits today, promised the full installment",
        "Will send half today and the balance on Friday",
        "Says the M-Pesa float is tied up until the evening",
        "Harvest payment expected this afternoon",
      ]),
      paidAmount: 0, createdBy: by.id, createdAt: takenAt,
    });
    callRows.push({
      orgId, loanId: l.id, borrowerId: l.borrowerId, outcome: "PROMISE_TO_PAY",
      note: "Reached them, took a promise for today.", ptpId, createdBy: by.id, createdAt: takenAt,
    });
  }

  // Promises that already went one way or the other — the history that makes
  // "3 broken in the last 30 days" a fact instead of a placeholder.
  for (const l of late.slice(14, 30)) {
    const by = pick(chasers);
    const dueDate = daysAgo(int(2, 26));
    const status = pick(["KEPT", "BROKEN", "BROKEN", "PARTIAL"]);
    const amount = Math.round(l.perDue * 0.8);
    ptpRows.push({
      orgId, loanId: l.id, borrowerId: l.borrowerId, amount, dueDate, status,
      paidAmount: status === "KEPT" ? amount : status === "PARTIAL" ? Math.round(amount * 0.45) : 0,
      note: status === "BROKEN" ? "Promised and nothing came." : "Taken on a follow-up call.",
      resolvedAt: daysAgo(int(0, 2)), createdBy: by.id, createdAt: new Date(dueDate.getTime() - int(1, 4) * DAY),
    });
  }

  // ── CALLS ─────────────────────────────────────────────────────────────────
  // Every outcome the enum knows about, so the dispositions chart has bars.
  const OUTCOMES = ["REACHED", "NO_ANSWER", "PHONE_OFF", "CALLBACK_LATER", "CLAIMS_PAID", "WRONG_NUMBER", "DISPUTED"];
  for (const l of late) {
    for (let k = 0; k < int(1, 4); k++) {
      callRows.push({
        orgId, loanId: l.id, borrowerId: l.borrowerId,
        outcome: pick(OUTCOMES),
        note: pick(["Rang twice, no answer.", "Spoke to them — says business is slow this month.", "Number goes to voicemail.", "Asked us to call back after 6pm.", "Insists a payment was made on Saturday.", "Disputes the penalty on the last installment."]),
        createdBy: pick(chasers).id, createdAt: daysAgo(int(0, 21)),
      });
    }
  }

  // ── TICKETS ───────────────────────────────────────────────────────────────
  const TICKETS: { kind: string; title: string; detail: string; status: string }[] = [
    { kind: "DISPUTE", title: "Says the last installment was paid twice", detail: "Customer has an M-Pesa message for 12,500 on the 14th; only one receipt is allocated.", status: "IN_PROGRESS" },
    { kind: "HARDSHIP", title: "Shop burnt in the Gikomba fire", detail: "Requests a three-month restructure. Branch has seen the county report.", status: "OPEN" },
    { kind: "FRAUD", title: "Loan taken in her name without consent", detail: "Claims her national ID was used by a relative. KYC portrait does not match.", status: "IN_PROGRESS" },
    { kind: "COMPLAINT", title: "Complaint about after-hours calls", detail: "Says an agent called at 9pm twice. Call log confirms it.", status: "RESOLVED" },
    { kind: "LEGAL", title: "Demand letter issued — Kongowea", detail: "Balance past 120 days. Handed to the panel advocate.", status: "OPEN" },
    { kind: "HARDSHIP", title: "Hospitalised — asking for a payment holiday", detail: "Discharge summary provided; one month requested.", status: "OPEN" },
    { kind: "OTHER", title: "Wants to change the repayment date", detail: "Salary now lands on the 5th, not the 28th.", status: "RESOLVED" },
  ];
  for (let i = 0; i < TICKETS.length; i++) {
    const t = TICKETS[i];
    const l = late[i % Math.max(1, late.length)];
    if (!l) break;
    const created = daysAgo(int(1, 30));
    ticketRows.push({
      orgId, borrowerId: l.borrowerId, loanId: l.id,
      kind: t.kind, status: t.status, title: t.title, detail: t.detail,
      assignedToId: pick(chasers).id,
      resolution: t.status === "RESOLVED" ? "Agreed with the customer and recorded on the file." : null,
      resolvedAt: t.status === "RESOLVED" ? daysAgo(int(0, 5)) : null,
      createdBy: pick(chasers).id, createdAt: created, updatedAt: created,
    });
  }

  await prisma.promiseToPay.createMany({ data: ptpRows as never });
  await prisma.collectionCall.createMany({ data: callRows as never });
  await prisma.collectionTicket.createMany({ data: ticketRows as never });
  console.log(`  collections: ${promisers.length} promises due TODAY · ${ptpRows.length} promises total · ${callRows.length} calls · ${ticketRows.length} tickets`);
}

// ─────────────────────────────────────────────────────────────────────────────
// MONEY — float, STK intents, reconciliation exceptions, savings, standing orders
// ─────────────────────────────────────────────────────────────────────────────
async function seedMoney(ctx: Ctx, book: Awaited<ReturnType<typeof seedBook>>) {
  const { orgId } = ctx;
  const { bookLoans, borrowers, finance, officers, agents } = book;

  // ── FLOAT ─────────────────────────────────────────────────────────────────
  // A running ledger, not a balance: the disbursements screen reads the LAST row,
  // and a single opening entry would make the treasury look like a constant.
  const floatRows: Record<string, unknown>[] = [];
  let balance = 0;
  const entries: { kind: string; amount: number; note: string; at: Date }[] = [];
  for (let d = 30; d >= 0; d--) {
    if (d % 6 === 0) entries.push({ kind: "TOPUP", amount: money(600_000, 1_800_000, 50_000), note: "Treasury top-up from the operations account", at: daysAgo(d) });
    if (d % 2 === 0) entries.push({ kind: "DISBURSE", amount: -money(120_000, 640_000, 10_000), note: "Day's disbursements", at: daysAgo(d) });
    if (d === 9) entries.push({ kind: "REVERSAL", amount: money(38_000, 60_000, 1_000), note: "Failed B2C reversed by Safaricom", at: daysAgo(d) });
    if (d === 3) entries.push({ kind: "ADJUSTMENT", amount: -4_500, note: "Transaction charges for the week", at: daysAgo(d) });
  }
  entries.sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const e of entries) {
    balance += e.amount;
    floatRows.push({ orgId, kind: e.kind, amount: e.amount, balanceAfter: balance, ref: `${REF_TAG}F${floatRows.length + 1}`, note: e.note, createdBy: finance.id, createdAt: e.at });
  }
  await prisma.floatLedger.createMany({ data: floatRows as never });

  // ── STK PUSHES ────────────────────────────────────────────────────────────
  const intentRows: Record<string, unknown>[] = [];
  for (const l of bookLoans.filter((x) => x.kind.startsWith("late") || x.kind === "dueToday").slice(0, 40)) {
    const state = pick(["SUCCESS", "SUCCESS", "FAILED", "TIMEOUT", "PENDING"]);
    const at = daysAgo(int(0, 12));
    intentRows.push({
      orgId, loanId: l.id, borrowerId: l.borrowerId, phone: l.phone,
      amount: Math.round(l.perDue * (chance(0.6) ? 1 : 0.5)),
      state, purpose: "INSTALLMENT", beneficiary: "LENDER",
      reference: `${REF_TAG}S${intentRows.length + 1}`,
      channel: pick(["collections", "c360", "field", "portal"]),
      requestedById: pick([...agents, ...officers]).id,
      resultCode: state === "SUCCESS" ? "0" : state === "FAILED" ? "1032" : null,
      resultDesc: state === "SUCCESS" ? "The service request is processed successfully."
        : state === "FAILED" ? "Request cancelled by user"
          : state === "TIMEOUT" ? "DS timeout user cannot be reached" : null,
      mpesaReceipt: state === "SUCCESS" ? `SF${int(10_000_000, 99_999_999)}` : null,
      settledAt: state === "SUCCESS" ? at : null,
      createdAt: at, updatedAt: at,
    });
  }
  await prisma.paymentIntent.createMany({ data: intentRows as never });

  // ── UNMATCHED MONEY ───────────────────────────────────────────────────────
  // Real money that arrived and has not landed anywhere. Six of them, and they
  // are genuine C2B rows with no allocation — the reconciliation screen derives
  // its own truth, so painting only the exception would show a queue that clears
  // nothing when a demo clicks Resolve.
  const strayRows: Record<string, unknown>[] = [];
  const exRows: Record<string, unknown>[] = [];
  for (let i = 0; i < 6; i++) {
    const transId = receiptRef();
    const amount = money(1_500, 24_000, 500);
    const at = daysAgo(int(0, 5));
    strayRows.push({ orgId, transId, amount, phone: loosePhone(), billRef: String(int(21_000_000, 39_999_999)), allocatedLoanId: null, allocatedAt: null, createdAt: at });
    exRows.push({
      orgId, kind: "C2B_UNALLOCATED", reference: transId, severity: amount > 12_000 ? "HIGH" : "MEDIUM",
      amountKes: amount,
      message: `KES ${amount.toLocaleString()} received on the paybill with an account number that matches no loan.`,
      meta: { transId, hint: "The payer typed their own phone number instead of the loan account." },
      status: "OPEN", detectedAt: at, lastSeenAt: at,
    });
  }
  exRows.push({
    orgId, kind: "DISB_STUCK", reference: `${REF_TAG}DISB1`, severity: "HIGH", amountKes: 45_000,
    message: "A payout has been SENDING for over an hour with no callback from Safaricom.",
    meta: { hint: "Check the B2C result queue before re-sending — a re-send pays twice." },
    status: "OPEN", detectedAt: daysAgo(1), lastSeenAt: daysAgo(0),
  });
  exRows.push({
    orgId, kind: "FLOAT_DRIFT", reference: `${REF_TAG}FLOATDRIFT`, severity: "LOW", amountKes: 4_500,
    message: "Float ledger and the day's disbursements differ by KES 4,500.",
    meta: { hint: "Transaction charges are posted separately." },
    status: "RESOLVED", detectedAt: daysAgo(4), lastSeenAt: daysAgo(4),
    resolvedAt: daysAgo(3), resolvedBy: finance.id, resolution: "Charges journal posted. Ledger agrees.",
  });
  await prisma.c2BReceipt.createMany({ data: strayRows as never, skipDuplicates: true });
  await prisma.reconciliationException.createMany({ data: exRows as never, skipDuplicates: true });

  // ── SAVINGS ───────────────────────────────────────────────────────────────
  const savers = borrowers.slice(0, 22);
  const accRows: Record<string, unknown>[] = [];
  const txRows: Record<string, unknown>[] = [];
  for (const b of savers) {
    const accId = randomUUID();
    let bal = 0;
    const n = int(2, 6);
    const entries: Record<string, unknown>[] = [];
    for (let k = 0; k < n; k++) {
      const credit = chance(0.7);
      const amt = money(500, 18_000, 100);
      if (!credit && bal < amt) continue;
      bal += credit ? amt : -amt;
      entries.push({
        orgId, accountId: accId, borrowerId: b.id,
        direction: credit ? "CREDIT" : "DEBIT", amount: amt, balanceAfter: bal,
        source: credit ? pick(["deposit", "loan_offset_remainder"]) : pick(["withdrawal", "charge_sweep"]),
        ref: `${REF_TAG}SV${txRows.length + entries.length + 1}`,
        createdAt: daysAgo(int(1, 180)),
      });
    }
    accRows.push({ id: accId, orgId, borrowerId: b.id, balance: bal, createdAt: daysAgo(int(30, 300)) });
    txRows.push(...entries);
  }
  await prisma.savingsAccount.createMany({ data: accRows as never, skipDuplicates: true });
  await prisma.savingsTransaction.createMany({ data: txRows as never });

  // ── STANDING ORDERS (M-Pesa Ratiba) ───────────────────────────────────────
  const soRows: Record<string, unknown>[] = [];
  for (const l of bookLoans.filter((x) => x.kind === "clean" || x.kind === "dueToday").slice(0, 18)) {
    soRows.push({
      orgId, borrowerId: l.borrowerId, loanId: l.id, phone: l.phone,
      amount: l.perDue, frequency: chance(0.6) ? "MONTHLY" : "WEEKLY",
      startDate: daysAgo(int(20, 120)), reference: `MM${String(int(100000, 999999))}`,
      name: `Micromart — ${l.name.split(" ")[0]}`,
      status: pick(["ACTIVE", "ACTIVE", "ACTIVE", "PENDING", "CANCELLED"]),
      simulated: true, createdById: l.officerId, createdAt: daysAgo(int(20, 120)), updatedAt: daysAgo(int(0, 10)),
    });
  }
  await prisma.standingOrder.createMany({ data: soRows as never });

  console.log(`  money: float ledger ${floatRows.length} entries (balance ${balance.toLocaleString()}) · ${intentRows.length} STK pushes · ${exRows.length} reconciliation exceptions · ${accRows.length} savings accounts · ${soRows.length} standing orders`);
}

// ─────────────────────────────────────────────────────────────────────────────
// OPS — field visits, comms, intelligence runs, graduations, compliance, audit
// ─────────────────────────────────────────────────────────────────────────────
async function seedOps(ctx: Ctx, book: Awaited<ReturnType<typeof seedBook>>) {
  const { orgId, staff } = ctx;
  const { borrowers, bookLoans, officers, agents, credit, managers } = book;
  const fieldAgents = staff.filter((s) => s.field);

  // ── FIELD VISITS ──────────────────────────────────────────────────────────
  const visitRows: Record<string, unknown>[] = [];
  for (let i = 0; i < 26; i++) {
    const b = borrowers[(i * 5) % borrowers.length];
    const spot = pick(MARKETS[b.branchKey] ?? MARKETS.gikomba);
    const status = pick(["QUEUED", "ALLOCATED", "EN_ROUTE", "ARRIVED", "VERIFIED", "VERIFIED", "FAILED"]);
    const allocated = status !== "QUEUED";
    const agent = pick(fieldAgents);
    visitRows.push({
      orgId, borrowerId: b.id,
      kind: pick(["BUSINESS_VERIFICATION", "HOME_VERIFICATION", "COLLECTION_VISIT", "KYC_ASSIST"]),
      status, label: `${b.name} — ${spot.name}`, address: spot.name,
      lat: jitter(spot.lat, 0.004), lng: jitter(spot.lng, 0.004),
      agentId: allocated ? agent.id : null,
      allocatedAt: allocated ? daysAgo(int(0, 6)) : null,
      distanceKm: allocated ? Number((0.4 + rand() * 9).toFixed(1)) : null,
      visitedAt: status === "VERIFIED" || status === "FAILED" ? daysAgo(int(0, 5)) : null,
      outcome: status === "VERIFIED" ? "Shop confirmed at the pin, stock on the shelves." : status === "FAILED" ? "Nobody at the stall; neighbours say it closed two weeks ago." : null,
      createdBy: b.officerId, createdAt: daysAgo(int(0, 10)), updatedAt: daysAgo(int(0, 3)),
    });
  }
  await prisma.fieldVisit.createMany({ data: visitRows as never });

  // ── COMMS ─────────────────────────────────────────────────────────────────
  const TEMPLATES = [
    { key: "app_received", title: "Application received", body: "Hi {name}, Micromart has received your application for KES {amount}. We will come back to you within 24 hours." },
    { key: "approved", title: "Loan approved", body: "Good news {name} — your Micromart loan of KES {amount} is approved. Reply to accept the terms." },
    { key: "disbursed", title: "Money sent", body: "{name}, KES {amount} has been sent to {phone}. Your first installment of KES {installment} is due {date}." },
    { key: "payment", title: "Payment received", body: "Thank you {name}. We have received KES {amount}. Your balance is now KES {balance}." },
    { key: "reminder", title: "Installment due", body: "Hi {name}, your Micromart installment of KES {amount} falls due on {date}. Pay via paybill {paybill}, account {account}." },
    { key: "arrears", title: "Missed installment", body: "{name}, your installment of KES {amount} is now {days} days late. Please pay today or call us on 0709 000 000." },
    { key: "ptp_due", title: "Promise falls due", body: "Hi {name}, you promised KES {amount} today. Paying on time keeps your limit growing." },
  ];
  for (const t of TEMPLATES) {
    await prisma.smsTemplate.upsert({
      where: { orgId_key: { orgId, key: t.key } },
      create: { orgId, key: t.key, title: t.title, body: t.body, active: true },
      update: { title: t.title, body: t.body },
    });
  }

  const smsRows: Record<string, unknown>[] = [];
  for (let i = 0; i < 160; i++) {
    const b = borrowers[(i * 7) % borrowers.length];
    const tpl = pick(TEMPLATES);
    const state = pick(["DELIVERED", "DELIVERED", "DELIVERED", "SENT", "FAILED", "QUEUED"]);
    const at = daysAgo(int(0, 25));
    smsRows.push({
      orgId, phone: b.phone, templateKey: tpl.key,
      message: tpl.body.replace("{name}", b.name.split(" ")[0]).replace(/\{[a-z]+\}/g, () => String(money(1_500, 48_000, 500))),
      state, provider: "africastalking", providerRef: `${REF_TAG}SMS${i + 1}`,
      cost: 0.8, sentAt: state === "QUEUED" ? null : at, createdAt: at,
    });
  }
  await prisma.smsMessage.createMany({ data: smsRows as never });

  const campaignRows = [
    { name: "August restock offer — Gikomba", message: "Hi {name}, your Micromart limit is ready. Restock now and repay in 4 months.", audience: "CLEARED", recipients: 148, queued: 148, status: "SENT", sentAt: daysAgo(6) },
    { name: "Arrears sweep — over 30 days", message: "{name}, your loan is seriously behind. Talk to us today before it goes to recovery.", audience: "ARREARS", recipients: 24, queued: 24, status: "SENT", sentAt: daysAgo(2) },
    { name: "Broken promises follow-up", message: "Hi {name}, we did not receive the payment you promised. Please pay today.", audience: "BROKEN_PTP", recipients: 11, queued: 11, status: "SENT", sentAt: daysAgo(1) },
    { name: "Ramadan top-up (draft)", message: "{name}, a top-up is available on your account.", audience: "ACTIVE_LOANS", recipients: 0, queued: 0, status: "DRAFT", sentAt: null },
  ];
  await prisma.smsCampaign.createMany({
    data: campaignRows.map((c) => ({ orgId, ...c, createdBy: pick(agents).id, createdAt: c.sentAt ?? daysAgo(0) })) as never,
  });

  await prisma.emailMessage.createMany({
    data: staff.slice(0, 10).map((s, i) => ({
      orgId, to: s.email,
      subject: i % 3 === 0 ? "Your Micromart console sign-in code" : i % 3 === 1 ? "You have been invited to the Micromart console" : "Approval required: disbursement above your limit",
      template: i % 3 === 0 ? "login_otp" : i % 3 === 1 ? "staff_invite" : "approval_otp",
      state: i === 7 ? "FAILED" : "SENT",
      error: i === 7 ? "550 mailbox unavailable" : null,
      createdAt: daysAgo(int(0, 20)),
    })) as never,
  });

  await prisma.smsWallet.upsert({
    where: { orgId },
    create: { orgId, balance: 4_820 },
    update: { balance: 4_820 },
  });
  await prisma.smsTopUp.createMany({
    data: [
      { orgId, units: 5_000, amountKes: 4_000, source: "HUB", note: `${REF_TAG}wallet purchase`, createdAt: daysAgo(12) },
      { orgId, units: 2_000, amountKes: 0, source: "PLATFORM_GRANT", note: `${REF_TAG}pilot grant`, createdAt: daysAgo(40) },
    ] as never,
  });

  // ── INTELLIGENCE ──────────────────────────────────────────────────────────
  // Six weekly sweeps, so Early Warning opens on a TREND. One point is a number;
  // a lender cannot tell whether a number is good without the one before it.
  const active = bookLoans.filter((l) => !["cleared", "writeoff", "pending"].includes(l.kind));
  const olb = active.reduce((s, l) => s + l.balance, 0);
  const atRisk = bookLoans.filter((l) => l.kind.startsWith("late")).reduce((s, l) => s + l.balance, 0);
  const runRows: Record<string, unknown>[] = [];
  for (let w = 5; w >= 0; w--) {
    const drift = 1 - w * 0.035;
    const watch = Math.round(28 * drift) + int(-2, 2);
    runRows.push({
      orgId, ranAt: daysAgo(w * 7), trigger: "seed", policy: "default",
      activeLoans: Math.round(active.length * drift),
      olb: Math.round(olb * drift),
      atRiskValue: Math.round(atRisk * drift),
      projectedLoss: Math.round(atRisk * drift * 0.42),
      watchlist: watch,
      high: Math.round(watch * 0.35), elevated: Math.round(watch * 0.4),
      entered: int(1, 6), left: int(0, 5), escalated: int(0, 3), improved: int(0, 4),
      rows: bookLoans.filter((l) => l.kind.startsWith("late")).slice(0, 20).map((l) => ({
        b: l.borrowerId, l: l.id, n: l.name, s: int(380, 620),
        band: l.kind === "late60" ? "HIGH" : l.kind === "late31_60" ? "WATCH" : "STRONG",
        dpd: l.kind === "late60" ? int(61, 180) : l.kind === "late31_60" ? int(31, 60) : l.kind === "late8_30" ? int(8, 30) : int(1, 7),
        bal: Math.round(l.balance),
      })),
      drift: null,
    });
  }
  await prisma.portfolioRun.createMany({ data: runRows as never });

  // ── GRADUATIONS ───────────────────────────────────────────────────────────
  // The limit ladder, in both directions. A history that only ever goes up is a
  // marketing chart; the engine can demote, and the demo should show it.
  const graduated = borrowers.filter((b) => b.cleared > 0).slice(0, 24);
  const gradRows: Record<string, unknown>[] = [];
  for (const b of graduated) {
    const up = chance(0.82);
    const prev = b.limit;
    const pct = up ? int(15, 45) : -int(10, 30);
    const next = Math.max(5_000, Math.round((prev * (100 + pct)) / 100 / 1000) * 1000);
    const rep = up ? 60 + rand() * 38 : 20 + rand() * 30;
    const dia = up ? 55 + rand() * 42 : 18 + rand() * 32;
    gradRows.push({
      orgId, borrowerId: b.id,
      previousLimit: prev, newLimit: next, increase: next - prev,
      riskScore: Number(((rep + dia) / 2).toFixed(1)),
      riskBand: rep > 75 ? "PRIME" : rep > 60 ? "STRONG" : rep > 40 ? "WATCH" : "HIGH",
      repaymentHistoryScore: Number(rep.toFixed(1)), daysInArrearsScore: Number(dia.toFixed(1)),
      graduationPercent: pct, clearedLoans: b.cleared,
      provenPrincipal: Math.round(prev * 0.8),
      cappedByCeiling: up && chance(0.25),
      move: up ? "graduate" : "demote",
      policyVersion: 1, decidedBy: "cron", createdAt: daysAgo(int(1, 120)),
    });
  }
  await prisma.graduationEvent.createMany({ data: gradRows as never });
  // The ladder has to agree with the customer file, or Customer-360 and the
  // graduation history will tell a demo two different stories about one person.
  for (const g of gradRows) {
    await prisma.borrower.update({
      where: { id: g.borrowerId as string },
      data: {
        previousLoanLimit: g.previousLimit as number,
        loanLimit: g.newLimit as number,
        graduationCount: g.clearedLoans as number,
        lastGraduationAt: g.createdAt as Date,
        behaviouralScore: g.riskScore as number,
      },
    });
  }

  // ── COMPLIANCE ────────────────────────────────────────────────────────────
  const mask = (p: string) => `${p.slice(0, 4)}••••${p.slice(-4)}`;
  await prisma.complianceRequest.createMany({
    data: [
      {
        orgId, kind: "BORROWER_EXPORT", status: "COMPLETED",
        subjectId: borrowers[3].id, subjectLabel: mask(borrowers[3].phone),
        reason: "Customer asked for a copy of everything held about them (DPA 2019 s.26(a)).",
        requestedById: credit.id, decidedById: pick(managers).id,
        decidedAt: daysAgo(9), completedAt: daysAgo(9),
        result: { records: 41, tables: 12, format: "json" }, createdAt: daysAgo(10),
      },
      {
        orgId, kind: "BORROWER_ERASURE", status: "PENDING",
        subjectId: borrowers[11].id, subjectLabel: mask(borrowers[11].phone),
        reason: "Customer withdrew consent and asked to be erased. Loan cleared 14 months ago.",
        requestedById: credit.id, createdAt: daysAgo(2),
      },
      {
        orgId, kind: "ORG_EXPORT", status: "APPROVED",
        reason: "Annual internal audit — full book extract for the auditors.",
        requestedById: credit.id, decidedById: pick(managers).id, decidedAt: daysAgo(1),
        createdAt: daysAgo(3),
      },
    ] as never,
  });

  // ── OVERSIGHT ─────────────────────────────────────────────────────────────
  const ACTIONS = ["LOGIN", "LOGOUT", "BORROWER_CREATE", "KYC_VERIFY", "APPLICATION_DECIDE", "LOAN_APPROVE", "DISBURSEMENT_INITIATE", "DISBURSEMENT_CHECK", "PROMISE_TAKE", "CALL_LOG", "PRODUCT_EDIT", "ROLE_EDIT", "REPORT_EXPORT", "STK_REQUEST"];
  const auditRows: Record<string, unknown>[] = [];
  for (let i = 0; i < 220; i++) {
    const s = pick(staff);
    auditRows.push({
      orgId, actorId: s.id, actorType: "staff", action: pick(ACTIONS),
      entity: SEED_TAG, ip: pick(IPS),
      meta: { user: s.name, email: s.email, device: pick(DEVICES), location: s.branchKey === "mombasa" ? "Mombasa, Kenya" : s.branchKey === "nakuru" ? "Nakuru, Kenya" : "Nairobi, Kenya" },
      createdAt: daysAgo(int(0, 21)),
    });
  }
  await prisma.auditLog.createMany({ data: auditRows as never });

  console.log(`  ops: ${visitRows.length} field visits · ${smsRows.length} SMS · ${campaignRows.length} campaigns · ${runRows.length} portfolio runs · ${gradRows.length} limit moves · ${auditRows.length} audit rows`);
  void officers;
}

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const down = process.argv.includes("--down");

  const org = await prisma.org.findUnique({ where: { slug: SLUG }, select: { id: true, name: true, mode: true, status: true } });
  if (!org) { console.error(`No org with slug "${SLUG}".`); process.exit(1); }
  console.log(`${down ? "Removing demo data from" : "Seeding"} ${org.name} (${org.mode}, ${org.status})\n`);

  await teardown(org.id);
  if (down) {
    console.log("\nDone. The org is back to its pilot state — MIROMART FINTECH and the real customers untouched.");
    return;
  }

  const ctx = await seedStructure(org.id);
  const book = await seedBook(ctx);
  await seedOrigination(ctx, book);
  await seedCollections(ctx, book);
  await seedMoney(ctx, book);
  await seedOps(ctx, book);

  console.log(`
Done.

  Sign in at /login with any seeded staff account, password ${PASSWORD}:
    wanjiru.kimani@${STAFF_DOMAIN}    Regional Manager  — sees the whole Nairobi region
    dennis.kiptoo@${STAFF_DOMAIN}     Branch Manager    — sees Gikomba only
    halima.noor@${STAFF_DOMAIN}       Relationship Off. — sees only her own customers
    caroline.atieno@${STAFF_DOMAIN}   Call Centre Agent — collections and nothing else
    grace.wambui@${STAFF_DOMAIN}      Credit Manager    — the whole book, plus the models

  Open the ServiceSuite OS (the floating assistant, bottom-right) to see the lock
  screen read this book: money due today, arrears by age, and the promises taken
  for today.

  To remove every row of it:  npx tsx scripts/seed-micromart-demo.ts --down
`);
}

main()
  .then(async () => { await prisma.$disconnect(); process.exit(0); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
