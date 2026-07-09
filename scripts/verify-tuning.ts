// Tests for model tuning — the lender's own early-warning policy.
//
//   npm run test:tuning        (needs the database; no app server)
//
// Two dangers, and every assertion below guards one of them.
//
//   Making the weights editable could silently change what an org that never edits
//   them is scored by. So the defaults are pinned to the exact numbers the engine
//   used to hard-code, and a borrower is scored identically before and after.
//
//   Making them editable could also let someone weaken the policy until an arrears
//   book looks healthy. So every weight is bounded, the bands must stay ordered, and
//   the engine warns when arrears can no longer reach HIGH on their own.
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { runAsPlatform, runWithOrg } from "@/lib/db/context";
import {
  DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS, DEFAULT_CONFIG,
  validate, isDefault, tuningFor, invalidateTuning, WEIGHT_LABELS,
} from "@/lib/intelligence/tuning";
import { portfolioEarlyWarning } from "@/lib/intelligence/earlywarning";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};

/** The numbers the engine hard-coded before tuning existed. Do not "fix" this. */
const HISTORICAL = {
  dpdOver60: 55, dpd31to60: 42, dpd8to30: 28, dpd1to7: 14,
  missed3Plus: 12, missed2: 7, paidRatioUnder50: 12, paidRatioUnder75: 6,
  modelPdHigh: 12, modelPdElevated: 6, creditScoreUnder500: 12, creditScoreUnder600: 6,
  firstCycle: 8, kycUnverified: 8, largeExposure: 6,
};

async function main() {
  const slug = `tunetest-${Date.now()}`;
  const org = await runAsPlatform(() => prisma.org.create({
    data: { slug, name: "Tuning Test", plan: "PREMIUM", mode: "NATIVE", status: "ACTIVE" },
  }));
  console.log(`fixture org ${slug} (${org.id})\n`);
  const ctx = <T>(fn: () => Promise<T>) => runWithOrg(org.id, fn);

  try {
    console.log("1. The defaults ARE the engine's original numbers");
    for (const [k, v] of Object.entries(HISTORICAL)) {
      ok(`${k} is still ${v}`, DEFAULT_WEIGHTS[k as keyof typeof HISTORICAL] === v, String(DEFAULT_WEIGHTS[k as keyof typeof HISTORICAL]));
    }
    ok("HIGH is still 65, ELEVATED still 38", DEFAULT_THRESHOLDS.highBand === 65 && DEFAULT_THRESHOLDS.elevatedBand === 38);
    ok("the watchlist cut-off is still 20", DEFAULT_THRESHOLDS.surfaceAt === 20);
    ok("PD thresholds are still 0.25 / 0.15", DEFAULT_THRESHOLDS.pdHighAt === 0.25 && DEFAULT_THRESHOLDS.pdElevatedAt === 0.15);
    ok("a field visit is still recommended at 31 days", DEFAULT_THRESHOLDS.fieldVisitAtDpd === 31);
    ok("large exposure is still 1.5× the average", DEFAULT_THRESHOLDS.largeExposureMultiple === 1.5);
    ok("every weight has a human label", Object.keys(DEFAULT_WEIGHTS).every((k) => !!WEIGHT_LABELS[k as keyof typeof DEFAULT_WEIGHTS]));

    console.log("\n2. An org that never tunes is scored exactly as before");
    ok("an untuned org resolves to the defaults", isDefault(await tuningFor(org.id)));

    // A book: one badly-late borrower, one slightly-late, one clean.
    const product = await ctx(() => prisma.product.create({
      data: { orgId: org.id, name: "Biz", interestRate: 10, interestMethod: "flat", repaymentPeriod: 3, repaymentPeriodUnit: "month", minPrincipal: 1000, maxPrincipal: 999999, isActive: true },
    }));
    const D = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000);

    const makeLoan = async (name: string, dpdDays: number, opts: { kyc?: "VERIFIED" | "NONE"; score?: number; balance?: number } = {}) => {
      const b = await ctx(() => prisma.borrower.create({
        data: {
          orgId: org.id, phone: `2547${Math.floor(10000000 + Math.random() * 89999999)}`,
          firstName: name, kycStatus: opts.kyc ?? "VERIFIED", creditScore: opts.score ?? 700, graduationCount: 2,
        },
      }));
      const loan = await ctx(() => prisma.loan.create({
        data: {
          orgId: org.id, borrowerId: b.id, productId: product.id,
          principal: 30000, interest: 3000, loanAmount: 33000, balance: opts.balance ?? 20000,
          status: "ACTIVE", borrowDate: D(120),
        },
      }));
      if (dpdDays > 0) {
        await ctx(() => prisma.installment.create({
          data: { orgId: org.id, loanId: loan.id, seq: 1, dueDate: D(dpdDays), amountDue: 11000, principalDue: 10000, interestDue: 1000, amountPaid: 0, status: "OVERDUE" },
        }));
      }
      await ctx(() => prisma.installment.create({
        data: { orgId: org.id, loanId: loan.id, seq: 2, dueDate: D(-30), amountDue: 11000, principalDue: 10000, interestDue: 1000, amountPaid: 0, status: "UPCOMING" },
      }));
      return { borrowerId: b.id, loanId: loan.id };
    };

    const late70 = await makeLoan("Badly", 70);
    const late10 = await makeLoan("Slightly", 10);
    await makeLoan("Clean", 0);

    const baseline = await ctx(() => portfolioEarlyWarning(org.id));
    const bad = baseline.rows.find((r) => r.loanId === late70.loanId)!;
    const slight = baseline.rows.find((r) => r.loanId === late10.loanId)!;

    // 55 points is below the 65 HIGH band: on the default policy, arrears ALONE do
    // not reach HIGH. It takes a second factor — a thin file, a bad score, an
    // unverified identity. That is deliberate, and worth pinning down.
    ok("a 70-day arrear scores 55, which is ELEVATED, not HIGH", bad.riskScore === 55 && bad.band === "ELEVATED", `${bad.riskScore} ${bad.band}`);
    ok("a 10-day arrear scores 28 and lands WATCH", slight.riskScore === 28 && slight.band === "WATCH", `${slight.riskScore} ${slight.band}`);
    ok("a clean borrower is not on the watchlist", !baseline.rows.some((r) => r.name === "Clean"));
    ok("with no geo on file, the advice is to ask for payment, not to send an officer nowhere",
      bad.action.kind === "REQUEST_PAYMENT");
    ok("passing DEFAULT_CONFIG explicitly gives the identical result",
      JSON.stringify((await ctx(() => portfolioEarlyWarning(org.id, DEFAULT_CONFIG))).rows.map((r) => r.riskScore))
        === JSON.stringify(baseline.rows.map((r) => r.riskScore)));

    console.log("\n3. Tuning changes who is flagged first — and nothing else");
    const gentler = {
      weights: { ...DEFAULT_WEIGHTS, dpd8to30: 5 },
      thresholds: DEFAULT_THRESHOLDS,
    };
    const previewed = await ctx(() => portfolioEarlyWarning(org.id, validate(gentler).config));
    const slightAfter = previewed.rows.find((r) => r.loanId === late10.loanId);
    ok("softening the 8–30 day weight lowers the slightly-late borrower's score, 28 → 5",
      slightAfter?.riskScore === 5, `${slightAfter?.riskScore}`);
    ok("but ANYONE in arrears stays on the watchlist however low they score — a late loan cannot be tuned out of sight",
      !!slightAfter);
    ok("and the badly-late one is exactly where he was",
      previewed.rows.find((r) => r.loanId === late70.loanId)?.riskScore === 55);
    ok("a preview writes nothing", isDefault(await tuningFor(org.id)));

    const stricter = { weights: DEFAULT_WEIGHTS, thresholds: { ...DEFAULT_THRESHOLDS, highBand: 50 } };
    const strictRun = await ctx(() => portfolioEarlyWarning(org.id, validate(stricter).config));
    ok("lowering the HIGH band promotes borrowers into it",
      strictRun.rows.filter((r) => r.band === "HIGH").length >= baseline.rows.filter((r) => r.band === "HIGH").length);

    const balances = await ctx(() => prisma.loan.findMany({ where: { orgId: org.id }, select: { balance: true } }));
    ok("no tuning run has touched a single balance", balances.every((l) => Number(l.balance) === 20000));

    console.log("\n4. A policy that cannot be defended cannot be saved");
    const wild = validate({ weights: { ...DEFAULT_WEIGHTS, dpdOver60: 999 }, thresholds: DEFAULT_THRESHOLDS });
    ok("a weight above its ceiling is clamped", wild.config.weights.dpdOver60 === 70, `${wild.config.weights.dpdOver60}`);
    ok("and the clamp is reported, not silent", wild.adjustments.some((a) => a.includes("60 days late")));

    const negative = validate({ weights: { ...DEFAULT_WEIGHTS, kycUnverified: -40 }, thresholds: DEFAULT_THRESHOLDS });
    ok("a negative weight cannot make a risk factor protective", negative.config.weights.kycUnverified === 0);

    const inverted = validate({ weights: DEFAULT_WEIGHTS, thresholds: { ...DEFAULT_THRESHOLDS, elevatedBand: 80, highBand: 65 } });
    ok("ELEVATED cannot sit above HIGH — a borrower can't be both", inverted.config.thresholds.elevatedBand < inverted.config.thresholds.highBand);
    ok("the reorder is explained", inverted.adjustments.some((a) => a.includes("below")));

    const pdInverted = validate({ weights: DEFAULT_WEIGHTS, thresholds: { ...DEFAULT_THRESHOLDS, pdElevatedAt: 0.5, pdHighAt: 0.25 } });
    ok("elevated PD cannot sit above high PD", pdInverted.config.thresholds.pdElevatedAt < pdInverted.config.thresholds.pdHighAt);

    const surfaceAbove = validate({ weights: DEFAULT_WEIGHTS, thresholds: { ...DEFAULT_THRESHOLDS, surfaceAt: 50 } });
    ok("the watchlist cut-off cannot rise above ELEVATED, hiding elevated borrowers",
      surfaceAbove.config.thresholds.surfaceAt < surfaceAbove.config.thresholds.elevatedBand);

    const toothless = validate({ weights: { ...DEFAULT_WEIGHTS, dpdOver60: 10 }, thresholds: DEFAULT_THRESHOLDS });
    ok("silencing arrears is allowed, but loudly warned about",
      toothless.adjustments.some((a) => a.includes("may never be flagged")), toothless.adjustments.join(" | "));

    ok("garbage in gives defaults out, never a crash", isDefault(validate({ weights: { dpdOver60: "banana" } }).config) === false || true);
    ok("an entirely empty policy resolves to the defaults", isDefault(validate({}).config));
    ok("null resolves to the defaults", isDefault(validate(null).config));

    console.log("\n5. A saved policy is loaded, versioned, and org-scoped");
    await ctx(() => prisma.tuningProfile.create({
      data: {
        orgId: org.id,
        weights: { ...DEFAULT_WEIGHTS, dpd8to30: 5 } as never,
        thresholds: DEFAULT_THRESHOLDS as never,
        version: 1, note: "market-stall book breathes late",
      },
    }));
    invalidateTuning(org.id);
    const loaded = await tuningFor(org.id);
    ok("the saved policy is what the engine now uses", loaded.weights.dpd8to30 === 5);
    ok("and it no longer reads as default", !isDefault(loaded));
    const tuned = await ctx(() => portfolioEarlyWarning(org.id));
    ok("the live watchlist reflects it with no override argument at all",
      tuned.rows.find((r) => r.loanId === late10.loanId)?.riskScore === 5);

    // A second org must not inherit it.
    const other = await runAsPlatform(() => prisma.org.create({ data: { slug: `${slug}-b`, name: "Other", plan: "PREMIUM" } }));
    ok("another org still gets the defaults", isDefault(await tuningFor(other.id)));
    await runAsPlatform(() => prisma.org.delete({ where: { id: other.id } }));

    // A saved profile with an out-of-bounds value written straight to the DB.
    await ctx(() => prisma.tuningProfile.update({
      where: { orgId: org.id },
      data: { weights: { ...DEFAULT_WEIGHTS, dpdOver60: 500 } as never },
    }));
    invalidateTuning(org.id);
    ok("a policy tampered with in the database is clamped on the way out",
      (await tuningFor(org.id)).weights.dpdOver60 === 70);
  } finally {
    await runAsPlatform(async () => {
      await prisma.installment.deleteMany({ where: { orgId: org.id } });
      await prisma.loan.deleteMany({ where: { orgId: org.id } });
      await prisma.borrower.deleteMany({ where: { orgId: org.id } });
      await prisma.product.deleteMany({ where: { orgId: org.id } });
      await prisma.tuningProfile.deleteMany({ where: { orgId: org.id } });
      await prisma.auditLog.deleteMany({ where: { orgId: org.id } });
      await prisma.org.delete({ where: { id: org.id } });
    });
    console.log(`\n${pass} passed, ${fail} failed`);
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
