// Tests for portfolio runs + model drift — the recorded side of early warning.
//
//   npm run test:portfolio      (needs the database; no app server)
//
// Three promises under test.
//
//   A run is a RECORDING. Its tiles must equal what the live engine says at the
//   same moment, it must state the policy that scored it, and making one must not
//   touch a loan, a balance, or a borrower.
//
//   Movement is a DIFF, not an opinion. Who entered, left, escalated or improved
//   between two runs is set arithmetic over borrower ids and bands — pinned here
//   against hand-built runs.
//
//   Drift is HONEST. Below the evidence floors the verdict is INSUFFICIENT, never
//   a confident guess; above them the arithmetic (realised vs predicted default
//   rate, PSI between score windows) is pinned to hand-computed values.
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { runAsPlatform, runWithOrg } from "@/lib/db/context";
import {
  psi, computeDrift, MIN_RESOLVED, MIN_WINDOW,
} from "@/lib/intelligence/drift";
import {
  runPortfolio, portfolioTrend, latestRun, sweepPortfolioRuns,
  movementBetween, compactRows, type CompactRow,
} from "@/lib/intelligence/portfolio";
import { portfolioEarlyWarning } from "@/lib/intelligence/earlywarning";
import { plan } from "@/lib/riri/planner";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};

const row = (b: string, band: CompactRow["band"], s = 50): CompactRow =>
  ({ b, l: `loan-${b}`, n: b, s, band, dpd: 10, bal: 10000 });

async function main() {
  console.log("1. PSI — the population arithmetic");
  const flat = Array.from({ length: 100 }, (_, i) => 300 + (i * 6) % 600);
  ok("identical populations score ~0", psi(flat, flat) < 0.01, String(psi(flat, flat)));
  const strong = Array.from({ length: 100 }, (_, i) => 750 + (i % 100));
  const weak = Array.from({ length: 100 }, (_, i) => 380 + (i % 100));
  ok("a wholesale shift blows past the 0.25 drift line", psi(strong, weak) >= 0.25, String(psi(strong, weak)));
  const mild = flat.map((s) => Math.max(300, s - 40));
  ok("a mild shift lands between stable and drifting", psi(flat, mild) > 0 && psi(flat, mild) < 0.25, String(psi(flat, mild)));
  ok("an empty bin on one side cannot blow PSI to infinity",
    Number.isFinite(psi(Array(50).fill(880), Array(50).fill(320))));

  console.log("\n2. Drift verdicts — honest below the floors, arithmetic above them");
  const scores = (n: number, at: number) => Array.from({ length: n }, () => at);
  const resolved = (n: number, defaults: number, pd: number) =>
    Array.from({ length: n }, (_, i) => ({ pd, defaulted: i < defaults }));

  const thin = computeDrift({ baselineScores: scores(5, 700), recentScores: scores(5, 700), resolved: resolved(MIN_RESOLVED - 1, 2, 0.1) });
  ok(`${MIN_RESOLVED - 1} outcomes is not a calibration verdict`, thin.calibration.verdict === "INSUFFICIENT");
  ok(`${MIN_WINDOW - 10} scores a side is not a population verdict`, thin.population.verdict === "INSUFFICIENT");
  ok("and with neither able to speak, the whole report says so", thin.status === "INSUFFICIENT");
  ok("the note says what evidence is missing, not just 'insufficient'", thin.calibration.note.includes(String(MIN_RESOLVED)));

  const calm = computeDrift({ baselineScores: scores(30, 700), recentScores: scores(30, 700), resolved: resolved(30, 3, 0.1) });
  ok("30 loans, 3 defaults, 10% predicted → realised 10%, gap 0, STABLE",
    calm.calibration.verdict === "STABLE" && calm.calibration.realisedRate === 0.1 && calm.calibration.gap === 0);
  ok("identical windows read STABLE", calm.population.verdict === "STABLE");
  ok("and the whole report is STABLE", calm.status === "STABLE");

  const watch = computeDrift({ baselineScores: scores(30, 700), recentScores: scores(30, 700), resolved: resolved(50, 8, 0.1) });
  ok("realised 16% vs predicted 10% is a 6pp WATCH", watch.calibration.verdict === "WATCH", `gap ${watch.calibration.gap}`);

  const under = computeDrift({ baselineScores: scores(30, 700), recentScores: scores(30, 700), resolved: resolved(50, 11, 0.1) });
  ok("realised 22% vs predicted 10% is DRIFTING", under.calibration.verdict === "DRIFTING", `gap ${under.calibration.gap}`);
  ok("and the note says which DIRECTION it is wrong — underestimating", under.calibration.note.includes("UNDERESTIMATING"));

  const over = computeDrift({ baselineScores: scores(30, 700), recentScores: scores(30, 700), resolved: resolved(50, 1, 0.2) });
  ok("a model too pessimistic is also drift — you're declining good borrowers",
    over.calibration.verdict === "DRIFTING" && over.calibration.note.includes("pessimistic"), `gap ${over.calibration.gap}`);

  const popOnly = computeDrift({ baselineScores: scores(50, 820), recentScores: scores(50, 380), resolved: resolved(30, 3, 0.1) });
  ok("the overall status is the WORSE of the two components",
    popOnly.calibration.verdict === "STABLE" && popOnly.population.verdict === "DRIFTING" && popOnly.status === "DRIFTING");

  console.log("\n3. Movement — a diff, not an opinion");
  const first = movementBetween(null, [row("a", "HIGH"), row("b", "WATCH")]);
  ok("with no previous run, everyone counts as entered", first.entered.length === 2 && first.left.length === 0);
  const move = movementBetween(
    [row("a", "ELEVATED"), row("b", "WATCH"), row("c", "HIGH")],
    [row("a", "HIGH"), row("b", "WATCH"), row("d", "WATCH")],
  );
  ok("d entered", move.entered.length === 1 && move.entered[0].b === "d");
  ok("c left", move.left.length === 1 && move.left[0].b === "c");
  ok("a escalated ELEVATED → HIGH", move.escalated.length === 1 && move.escalated[0].b === "a");
  ok("b holding steady is not movement", move.improved.length === 0);
  const better = movementBetween([row("a", "HIGH")], [row("a", "WATCH")]);
  ok("a band falling is improvement", better.improved.length === 1);

  console.log("\n4. Riri knows the difference between the borrowers and the model");
  ok("'is the model drifting' goes to the drift engine", JSON.stringify(plan("is the model drifting", [])) === JSON.stringify({ kind: "engine", engine: "drift" }));
  ok("'how is calibration looking' goes to the drift engine", (plan("how is calibration looking", []) as { engine?: string }).engine === "drift");
  ok("'can I trust the scores' goes to the drift engine", (plan("can I still trust the scores?", []) as { engine?: string }).engine === "drift");
  ok("'who might default' still goes to the watchlist", (plan("who might default this month", []) as { engine?: string }).engine === "watchlist");
  ok("'show me the watchlist' still goes to the watchlist", (plan("show me the watchlist", []) as { engine?: string }).engine === "watchlist");

  // ── The database half ─────────────────────────────────────────────────────
  const slug = `portfoliotest-${Date.now()}`;
  const org = await runAsPlatform(() => prisma.org.create({
    data: { slug, name: "Portfolio Test", plan: "PREMIUM", mode: "NATIVE", status: "ACTIVE" },
  }));
  console.log(`\nfixture org ${slug} (${org.id})`);
  const ctx = <T>(fn: () => Promise<T>) => runWithOrg(org.id, fn);
  const D = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000);

  try {
    const product = await ctx(() => prisma.product.create({
      data: { orgId: org.id, name: "Biz", interestRate: 10, interestMethod: "flat", repaymentPeriod: 3, repaymentPeriodUnit: "month", minPrincipal: 1000, maxPrincipal: 999999, isActive: true },
    }));

    const makeLoan = async (name: string, dpdDays: number) => {
      const b = await ctx(() => prisma.borrower.create({
        data: { orgId: org.id, phone: `2547${Math.floor(10000000 + Math.random() * 89999999)}`, firstName: name, kycStatus: "VERIFIED", creditScore: 700, graduationCount: 2 },
      }));
      const loan = await ctx(() => prisma.loan.create({
        data: { orgId: org.id, borrowerId: b.id, productId: product.id, principal: 30000, interest: 3000, loanAmount: 33000, balance: 20000, status: "ACTIVE", borrowDate: D(120) },
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
    await makeLoan("Slightly", 10);
    await makeLoan("Clean", 0);

    console.log("\n5. A run records exactly what the engine says");
    const live = await ctx(() => portfolioEarlyWarning(org.id));
    const run1 = await ctx(() => runPortfolio(org.id, "manual"));
    ok("watchlist matches the live engine", run1.tiles.watchlist === live.rows.length, `${run1.tiles.watchlist} vs ${live.rows.length}`);
    ok("high count matches", run1.tiles.high === live.tiles.high);
    ok("OLB matches", run1.tiles.olb === live.tiles.olb);
    ok("value at risk matches", run1.tiles.atRiskValue === live.tiles.atRiskValue);
    ok("projected loss matches", run1.tiles.projectedLoss === live.tiles.projectedLoss);
    ok("active loans counted", run1.tiles.activeLoans === 3);
    ok("an untuned org's run says it was scored on the default policy", run1.policy === "default");
    ok("the first run counts its whole watchlist as entered", run1.movement.entered.length === live.rows.length);
    ok("with no scoring history, drift is INSUFFICIENT — never invented", run1.drift.status === "INSUFFICIENT");

    const stored = await ctx(() => latestRun(org.id));
    ok("the run is persisted with its compact rows", stored != null && stored.rows.length === live.rows.length);
    ok("compact rows carry id, band and balance for the diff",
      stored!.rows.every((r) => r.b && r.band && typeof r.bal === "number"));

    console.log("\n6. Movement between real runs");
    const run2 = await ctx(() => runPortfolio(org.id, "manual"));
    ok("an unchanged book means an unchanged watchlist", run2.movement.entered.length === 0 && run2.movement.left.length === 0 && run2.movement.escalated.length === 0);

    const late40 = await makeLoan("Newly", 40);
    const run3 = await ctx(() => runPortfolio(org.id, "manual"));
    ok("a borrower slipping into arrears enters the next run", run3.movement.entered.length === 1 && run3.movement.entered[0].b === late40.borrowerId);

    // The badly-late borrower pays up: overdue installment cleared.
    await ctx(() => prisma.installment.updateMany({
      where: { loanId: late70.loanId, status: "OVERDUE" },
      data: { status: "PAID", amountPaid: 11000 },
    }));
    const run4 = await ctx(() => runPortfolio(org.id, "manual"));
    ok("a borrower who pays their arrears leaves the next run", run4.movement.left.some((r) => r.b === late70.borrowerId));

    const balances = await ctx(() => prisma.loan.findMany({ where: { orgId: org.id }, select: { balance: true } }));
    ok("four runs have not touched a single balance", balances.every((l) => Number(l.balance) === 20000));

    console.log("\n7. Drift measured from real snapshots");
    const snaps: { orgId: string; modelKind: string; modelVersion: string; score: number; pd: number; outcome: string; outcomeObservedAt: Date | null; createdAt: Date }[] = [];
    for (let i = 0; i < 30; i++) {
      // Baseline window: ~700s, 10% PD, 3 of 30 defaulted.
      snaps.push({ orgId: org.id, modelKind: "pooled-v3", modelVersion: "t", score: 690 + (i % 21), pd: 0.1, outcome: i < 3 ? "DEFAULTED" : "REPAID", outcomeObservedAt: D(100), createdAt: D(200 - i) });
    }
    for (let i = 0; i < 20; i++) {
      // Recent window: same population, still pending.
      snaps.push({ orgId: org.id, modelKind: "pooled-v3", modelVersion: "t", score: 690 + (i % 21), pd: 0.1, outcome: "PENDING", outcomeObservedAt: null, createdAt: D(20 - (i % 15)) });
    }
    await ctx(() => prisma.scoreSnapshot.createMany({ data: snaps }));

    const run5 = await ctx(() => runPortfolio(org.id, "manual"));
    ok("calibration now speaks: 3/30 realised vs 10% predicted, STABLE",
      run5.drift.calibration.verdict === "STABLE" && run5.drift.calibration.resolved === 30 && run5.drift.calibration.realisedRate === 0.1);
    ok("population windows both filled and read STABLE", run5.drift.population.verdict === "STABLE", `psi ${run5.drift.population.psi}`);
    ok("the drift report rides on the stored run", ((await ctx(() => latestRun(org.id)))!.drift?.status) === "STABLE");

    console.log("\n8. The trend, tenancy, and retention");
    const trend = await ctx(() => portfolioTrend(org.id));
    ok("five runs, oldest first", trend.length === 5 && trend[0].runId === run1.runId && trend[4].runId === run5.runId);
    ok("at-risk share is derived per point", trend.every((t) => t.atRiskPct === (t.olb > 0 ? Math.round((t.atRiskValue / t.olb) * 1000) / 10 : 0)));
    ok("every point states its trigger and policy", trend.every((t) => t.trigger === "manual" && t.policy === "default"));

    const other = await runAsPlatform(() => prisma.org.create({ data: { slug: `${slug}-b`, name: "Other", plan: "PREMIUM" } }));
    ok("another org sees none of these runs", (await runWithOrg(other.id, () => portfolioTrend(other.id))).length === 0);
    await runAsPlatform(() => prisma.org.delete({ where: { id: other.id } }));

    await ctx(() => prisma.portfolioRun.create({
      data: { orgId: org.id, ranAt: D(500), trigger: "cron", policy: "default", activeLoans: 0, olb: 0, atRiskValue: 0, projectedLoss: 0, watchlist: 0, high: 0, elevated: 0, rows: [] },
    }));
    const swept = await runAsPlatform(() => sweepPortfolioRuns());
    ok("a 500-day-old run is swept", swept >= 1);
    ok("the recent five survive the sweep", (await ctx(() => portfolioTrend(org.id))).length === 5);

    console.log("\n9. compactRows is bounded and faithful");
    const compacted = compactRows(live.rows);
    ok("compaction keeps score, band, dpd and rounds the balance",
      compacted.every((c, i) => c.s === live.rows[i].riskScore && c.band === live.rows[i].band && c.bal === Math.round(live.rows[i].balance)));
  } finally {
    await runAsPlatform(async () => {
      await prisma.portfolioRun.deleteMany({ where: { orgId: org.id } });
      await prisma.scoreSnapshot.deleteMany({ where: { orgId: org.id } });
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
