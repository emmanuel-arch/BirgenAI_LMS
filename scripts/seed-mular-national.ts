// Light up the RISK MAP: a countrywide layer for MULAR CREDIT (slug: mular).
//
//   npx tsx scripts/seed-mular-national.ts            # add the national layer
//   npx tsx scripts/seed-mular-national.ts --down      # remove it, cleanly
//
// This is a SEPARATE, REVERSIBLE layer on top of the core Kitale book — it never
// touches it. Everything it creates is tagged (borrowers carry deviceFingerprint
// NAT_TAG; branches carry a code prefixed MN-), so a re-run tears its own data
// down first and `--down` removes it entirely, leaving the tuned core numbers
// exactly as they were.
//
// It plants a branch in every major Kenyan town and spreads a book around each —
// most current (green), some slipping (amber, 1–29 days late), a few in default
// (red, 30+). The arrears are REAL installment rows dated into the past, so the
// map's dot colours and its pulsing worst-account are computed, not painted.
import "dotenv/config";
import { platformPrisma } from "../prisma/seed-client";

const prisma = platformPrisma();
const NAT_TAG = "seed:mular-national";
const CODE_PREFIX = "MN-";

// ── deterministic PRNG ────────────────────────────────────────────────────────
let _s = 20260723;
const rand = () => { _s = (_s * 1664525 + 1013904223) % 4294967296; return _s / 4294967296; };
const pick = <T>(a: T[]): T => a[Math.floor(rand() * a.length)];
const int = (lo: number, hi: number) => Math.floor(lo + rand() * (hi - lo + 1));
const money = (lo: number, hi: number, step = 1000) => Math.round(int(lo, hi) / step) * step;
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);
const addMonths = (d: Date, m: number) => { const x = new Date(d); x.setMonth(x.getMonth() + m); return x; };
const jitter = (v: number, span = 0.05) => v + (rand() - 0.5) * span;

let _p = 88000000;
const nextPhone = () => "2547" + String(_p++);

// ── The national network — a real town, a real pin, an area code. ─────────────
// HQ first; it renders as an anchor on the map (root stays Kitale, per schema).
const TOWNS: { name: string; code: string; lat: number; lng: number; hq?: boolean; n: number }[] = [
  { name: "Nairobi HQ", code: "HQ", lat: -1.2921, lng: 36.8219, hq: true, n: 14 },
  { name: "Mombasa", code: "MSA", lat: -4.0435, lng: 39.6682, n: 10 },
  { name: "Kisumu", code: "KSM", lat: -0.0917, lng: 34.7680, n: 10 },
  { name: "Nakuru", code: "NKR", lat: -0.3031, lng: 36.0800, n: 9 },
  { name: "Eldoret", code: "ELD", lat: 0.5143, lng: 35.2698, n: 9 },
  { name: "Thika", code: "THK", lat: -1.0333, lng: 37.0693, n: 8 },
  { name: "Nyeri", code: "NYR", lat: -0.4169, lng: 36.9514, n: 7 },
  { name: "Meru", code: "MRU", lat: 0.0463, lng: 37.6559, n: 7 },
  { name: "Machakos", code: "MCK", lat: -1.5177, lng: 37.2634, n: 7 },
  { name: "Kakamega", code: "KKG", lat: 0.2827, lng: 34.7519, n: 7 },
  { name: "Kericho", code: "KER", lat: -0.3689, lng: 35.2831, n: 6 },
  { name: "Kisii", code: "KSI", lat: -0.6817, lng: 34.7680, n: 6 },
  { name: "Kitui", code: "KTU", lat: -1.3670, lng: 38.0106, n: 6 },
  { name: "Garissa", code: "GRS", lat: -0.4536, lng: 39.6461, n: 5 },
  { name: "Malindi", code: "MLD", lat: -3.2192, lng: 40.1169, n: 6 },
  { name: "Naivasha", code: "NVS", lat: -0.7172, lng: 36.4310, n: 6 },
  { name: "Embu", code: "EMB", lat: -0.5310, lng: 37.4575, n: 6 },
  { name: "Bungoma", code: "BGM", lat: 0.5635, lng: 34.5606, n: 6 },
  { name: "Homa Bay", code: "HBY", lat: -0.5273, lng: 34.4571, n: 5 },
  { name: "Voi", code: "VOI", lat: -3.3961, lng: 38.5561, n: 5 },
  { name: "Nanyuki", code: "NYK", lat: 0.0167, lng: 37.0733, n: 6 },
  { name: "Narok", code: "NRK", lat: -1.0833, lng: 35.8667, n: 5 },
  { name: "Kilifi", code: "KLF", lat: -3.6305, lng: 39.8499, n: 5 },
  { name: "Isiolo", code: "ISL", lat: 0.3546, lng: 37.5822, n: 5 },
  { name: "Lodwar", code: "LDW", lat: 3.1191, lng: 35.5973, n: 4 },
  { name: "Wajir", code: "WJR", lat: 1.7471, lng: 40.0573, n: 4 },
  { name: "Kajiado", code: "KJD", lat: -1.8523, lng: 36.7766, n: 6 },
  { name: "Busia", code: "BSA", lat: 0.4608, lng: 34.1115, n: 5 },
  { name: "Migori", code: "MGR", lat: -1.0634, lng: 34.4731, n: 5 },
  { name: "Nyahururu", code: "NYH", lat: 0.0361, lng: 36.3639, n: 5 },
];

const FIRST = ["Titus", "Derrick", "Carol", "Joseph", "Mwende", "Brian", "Faith", "Kevin", "Mercy", "Peter", "Ann", "Dennis", "Grace", "Samuel", "Ruth", "Ian", "Lucy", "Victor", "Esther", "Collins", "Nancy", "Elijah", "Sharon", "Moses", "Beatrice", "Amos", "Caroline", "Isaac", "Janet", "Felix", "Alice", "Boniface", "Damaris", "Erick", "Gladys", "Hillary"];
const LAST = ["Masua", "Maloba", "Ndiso", "Mutiso", "Wafula", "Barasa", "Simiyu", "Wanjala", "Cheruiyot", "Kiptoo", "Wekesa", "Otieno", "Mueni", "Kirwa", "Juma", "Kamau", "Njoroge", "Achieng", "Mwangi", "Chebet", "Omondi", "Wambui", "Kilonzo", "Onyango"];

type Kind = "green" | "amber" | "red";

async function findOrgId(): Promise<{ id: string; rootId: string | null }> {
  const org = await prisma.org.findUnique({ where: { slug: "mular" }, select: { id: true } });
  if (!org) { console.error('No org with slug "mular". Run seed-mular-demo.ts first.'); process.exit(1); }
  const root = await prisma.branch.findFirst({ where: { orgId: org.id, parentId: null }, select: { id: true } });
  return { id: org.id, rootId: root?.id ?? null };
}

async function teardown(orgId: string) {
  const tagged = await prisma.borrower.findMany({ where: { orgId, deviceFingerprint: NAT_TAG }, select: { id: true } });
  const ids = tagged.map((b) => b.id);
  if (ids.length) {
    const loans = await prisma.loan.findMany({ where: { orgId, borrowerId: { in: ids } }, select: { id: true } });
    const loanIds = loans.map((l) => l.id);
    await prisma.installment.deleteMany({ where: { loanId: { in: loanIds } } });
    await prisma.disbursement.deleteMany({ where: { loanId: { in: loanIds } } });
    await prisma.c2BReceipt.deleteMany({ where: { orgId, allocatedLoanId: { in: loanIds } } });
    await prisma.loan.deleteMany({ where: { id: { in: loanIds } } });
    // Guarantors reference the application FK — clear them before the applications.
    await prisma.guarantor.deleteMany({ where: { orgId, borrowerId: { in: ids } } });
    await prisma.loanApplication.deleteMany({ where: { orgId, borrowerId: { in: ids } } });
    await prisma.borrower.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.branch.deleteMany({ where: { orgId, code: { startsWith: CODE_PREFIX } } });
  console.log(`  teardown: cleared ${ids.length} national borrowers + their branches`);
}

/** A 4-installment monthly schedule shaped to the risk we want the dot to show.
 *  Collections DPD keys off the EARLIEST unpaid installment, so arrears anchor on
 *  a controlled miss date: amber missed recently (4–26d), red long ago (35–150d)
 *  and kept missing — which is exactly what fieldRisk() reads back. */
function schedule(kind: Kind, perDue: number) {
  const term = 4;
  const now = Date.now();
  const insts: { seq: number; dueDate: Date; amountDue: number; amountPaid: number; status: string; paidAt: Date | null }[] = [];
  let balance = 0;

  if (kind === "green") {
    // A healthy young loan — every past installment paid on the day, some to come.
    const borrowDate = daysAgo(int(20, 80));
    for (let s = 0; s < term; s++) {
      const due = addMonths(borrowDate, s + 1);
      const isPast = due.getTime() < now;
      const paid = isPast ? perDue : 0;
      balance += perDue - paid;
      insts.push({ seq: s + 1, dueDate: due, amountDue: perDue, amountPaid: paid, status: isPast ? "PAID" : "UPCOMING", paidAt: isPast ? due : null });
    }
    return { borrowDate, insts, balance };
  }

  // Arrears — the first miss dates the DPD; anything past since stays unpaid.
  const dpd = kind === "red" ? int(35, 150) : int(4, 26);
  const borrowDate = daysAgo(dpd + 30); // seq1 falls due exactly `dpd` days ago
  for (let s = 0; s < term; s++) {
    const due = addMonths(borrowDate, s + 1);
    const isPast = due.getTime() < now;
    let paid = 0, st = "UPCOMING", paidAt: Date | null = null;
    if (isPast) { st = "OVERDUE"; } // defaulted from the first missed installment on
    balance += perDue - paid;
    insts.push({ seq: s + 1, dueDate: due, amountDue: perDue, amountPaid: paid, status: st, paidAt });
  }
  return { borrowDate, insts, balance };
}

async function main() {
  const down = process.argv.includes("--down");
  const { id: orgId, rootId } = await findOrgId();
  console.log(`National layer for Mular (${orgId})`);

  await teardown(orgId);
  if (down) { console.log("  --down: national layer removed."); return; }

  // Products — reuse the core book's; fall back to one if somehow empty.
  let products = await prisma.product.findMany({ where: { orgId, isActive: true }, select: { id: true, minPrincipal: true, maxPrincipal: true, interestRate: true, repaymentPeriod: true } });
  if (!products.length) {
    const p = await prisma.product.create({
      data: { orgId, name: "Business Loan", minPrincipal: 10000, maxPrincipal: 200000, interestRate: 13, interestMethod: "flat", repaymentPeriod: 4, repaymentPeriodUnit: "month", disbursementMode: "B2C_MPESA", isActive: true },
      select: { id: true, minPrincipal: true, maxPrincipal: true, interestRate: true, repaymentPeriod: true },
    });
    products = [p];
  }

  // Weighted risk mix: mostly current, a slice slipping, a few in default.
  const mix: Kind[] = [...Array(6).fill("green"), ...Array(3).fill("amber"), ...Array(2).fill("red")];

  let branchCount = 0, borrowerCount = 0, loanCount = 0, red = 0, amber = 0, olb = 0, overdue = 0;
  const natCustomers: { id: string; name: string; phone: string; branchId: string; productId: string }[] = [];

  for (const t of TOWNS) {
    const code = CODE_PREFIX + t.code;
    const existing = await prisma.branch.findFirst({ where: { orgId, code }, select: { id: true } });
    const branchId = existing?.id ?? (await prisma.branch.create({
      data: {
        orgId, name: t.name, parentId: rootId, code,
        levelName: t.hq ? "Head Office" : "Branch",
        lat: t.lat, lng: t.lng, radiusMeters: 500, active: true,
      },
      select: { id: true },
    })).id;
    branchCount++;

    for (let i = 0; i < t.n; i++) {
      const kind = pick(mix);
      const product = pick(products);
      const min = Number(product.minPrincipal), max = Number(product.maxPrincipal);
      const principal = money(Math.round(min + (max - min) * 0.2), Math.round(min + (max - min) * 0.75));
      const interest = Math.round(principal * (Number(product.interestRate) / 100));
      const loanAmount = principal + interest;
      const term = product.repaymentPeriod || 4;
      const perDue = Math.round(loanAmount / Math.max(1, Math.min(term, 4)));
      const { borrowDate, insts, balance } = schedule(kind, perDue);

      const first = pick(FIRST), last = pick(LAST), phone = nextPhone();
      const b = await prisma.borrower.create({
        data: {
          orgId, phone, firstName: first, otherName: last,
          nationalId: String(int(20000000, 39999999)),
          dob: daysAgo(int(21, 55) * 365), gender: pick(["M", "F"]), language: pick(["en", "sw"]),
          kycStatus: "VERIFIED", kycVerifiedAt: daysAgo(int(20, 300)),
          creditScore: kind === "red" ? int(430, 560) : kind === "amber" ? int(560, 680) : int(660, 830),
          riskBand: kind === "red" ? "HIGH" : kind === "amber" ? "WATCH" : pick(["PRIME", "STRONG"]),
          graduationCount: kind === "green" ? int(0, 4) : int(0, 1),
          loanLimit: money(30000, 250000, 5000),
          lat: jitter(t.lat), lng: jitter(t.lng), locationType: "business",
          locationAddress: `${t.name} town`, geoConsentAt: daysAgo(int(10, 200)),
          branchId, deviceFingerprint: NAT_TAG,
        },
        select: { id: true },
      });
      borrowerCount++;
      natCustomers.push({ id: b.id, name: `${first} ${last}`, phone, branchId, productId: product.id });

      const loan = await prisma.loan.create({
        data: {
          orgId, borrowerId: b.id, productId: product.id,
          principal, interest, loanAmount, balance,
          status: "ACTIVE", borrowDate, disbursedAt: borrowDate,
          expectedClearDate: addMonths(borrowDate, term), branchId,
        },
        select: { id: true },
      });
      loanCount++;
      olb += balance;

      await prisma.installment.createMany({
        data: insts.map((x) => ({
          orgId, loanId: loan.id, seq: x.seq, dueDate: x.dueDate,
          amountDue: x.amountDue, principalDue: Math.round(x.amountDue * 0.85), interestDue: Math.round(x.amountDue * 0.15),
          amountPaid: x.amountPaid, status: x.status as never, paidAt: x.paidAt,
        })),
      });
      const od = insts.filter((x) => x.status === "OVERDUE").reduce((s, x) => s + (x.amountDue - x.amountPaid), 0);
      overdue += od;
      if (kind === "red") red++; else if (kind === "amber") amber++;
    }
  }

  // ── Pipeline (leads) + Sureties (guarantors) — populate the parity boards ─────
  // Fresh applicants drawn from the national book, spread across the funnel so the
  // Pipeline board fills and the Sureties board has real consent evidence.
  const STAGES: { status: string; title: string }[] = [
    { status: "SUBMITTED", title: "New lead" },
    { status: "AI_PRESCREEN", title: "AI prescreen" },
    { status: "OFFICER_REVIEW", title: "Officer review" },
    { status: "REFERRED", title: "Referred" },
    { status: "APPROVED", title: "Approved" },
    { status: "DISBURSED", title: "Disbursed" },
  ];
  const RELATIONS = ["Brother", "Sister", "Business partner", "Spouse", "Neighbour", "Colleague"];
  const GTR_STATE = ["CONSENTED", "CONSENTED", "INVITED", "INVITED", "DECLINED", "EXPIRED"];
  const IPS = ["105.164.7.191", "102.215.34.20", "197.248.12.7", "41.90.64.133", "196.201.214.20"];

  const leads = natCustomers.slice(0, 54);
  let appCount = 0, gtrCount = 0;
  for (let i = 0; i < leads.length; i++) {
    const c = leads[i];
    const stage = STAGES[i % STAGES.length];
    const amount = money(15000, 180000, 1000);
    const score = int(470, 830);
    const app = await prisma.loanApplication.create({
      data: {
        orgId, borrowerId: c.id, productId: c.productId, branchId: c.branchId,
        borrowerName: c.name, phone: c.phone, amountRequested: amount,
        status: stage.status as never, stageTitle: stage.title,
        score, decision: score >= 640 ? "APPROVE" : score >= 540 ? "REFER" : "DECLINE",
        createdAt: daysAgo(int(0, 22)),
      },
      select: { id: true },
    });
    appCount++;

    // Guarantors on the mid/late-funnel apps — where a surety would actually exist.
    if (["OFFICER_REVIEW", "REFERRED", "APPROVED", "DISBURSED"].includes(stage.status) && i % 3 !== 0) {
      const state = GTR_STATE[i % GTR_STATE.length];
      const consented = state === "CONSENTED";
      await prisma.guarantor.create({
        data: {
          orgId, applicationId: app.id, borrowerId: c.id,
          fullName: `${pick(FIRST)} ${pick(LAST)}`, phone: nextPhone(), nationalId: String(int(20000000, 39999999)),
          relationship: pick(RELATIONS), status: state as never,
          amountGuaranteed: money(15000, 150000, 5000),
          invitedAt: daysAgo(int(3, 20)),
          consentedAt: consented ? daysAgo(int(0, 10)) : null,
          declinedAt: state === "DECLINED" ? daysAgo(int(0, 8)) : null,
          consentIp: consented ? pick(IPS) : null,
          expiresAt: daysAgo(state === "EXPIRED" ? int(1, 10) : -int(3, 21)),
        },
      });
      gtrCount++;
    }
  }
  console.log(`  pipeline leads: ${appCount}  ·  sureties: ${gtrCount}`);

  console.log(`  branches: ${branchCount}  ·  borrowers: ${borrowerCount}  ·  active loans: ${loanCount}`);
  console.log(`  risk mix: ${red} in default (red) · ${amber} slipping (amber) · ${borrowerCount - red - amber} current (green)`);
  console.log(`  national OLB≈${Math.round(olb).toLocaleString()}  ·  overdue≈${Math.round(overdue).toLocaleString()}`);
  console.log("\nDone. Open /console/field/nearby as an org-scope user to see the map light up nationwide.");
  console.log("Undo anytime:  npx tsx scripts/seed-mular-national.ts --down");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
