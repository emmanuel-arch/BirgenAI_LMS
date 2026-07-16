// Tests for RISK BANDS + BEHAVIOURAL SCORING + GRADUATION.
//
//   npm run test:risk    (live DB: builds a scratch org with real repayment
//                         histories, graduates people, then deletes itself)
//
// The graduation engine gives customers MORE MONEY on the strength of a number it
// computed itself. Every claim below is a way it could give the wrong person more
// money, or refuse the right one — and neither looks like a crash.
//
//   THE ARITHMETIC IS THE STORED PROCEDURE'S. sp_CreditScoringAndGraduation is in
//     production at Micromart and its numbers are trusted. Repayment history and days
//     in arrears, half and half; 100/75/50/0 on completeness; 100/30/10/0 on lateness.
//     If this drifts, a lender migrating to us sees their customers reband overnight.
//   ONE DAY LATE COSTS 70 POINTS, and that is meant to hurt. In a 30-day microloan
//     "a few days late" is most of the way to not paying, and a curve that shrugs at
//     it will lend again to someone already sliding.
//   TWO CLEARED LOANS AT THE SAME PRINCIPAL — the rule everyone misses. Graduation is
//     not "have they borrowed twice", it is "have they cleared the SAME amount twice",
//     which is what proves the ceiling is holding them back rather than fitting them.
//   THE INCREASE IS CAPPED AT KES 5,000. Otherwise 30% of a 100k loan is 30k of new
//     exposure bought with two repayments, and the ladder becomes a cliff.
//   A HIGH-RISK CUSTOMER NEVER GRADUATES. 0%, by construction, not by rounding.
//   THE CRON CANNOT DOUBLE-GRADUATE. It runs every night; the same customer must not
//     climb the ladder twice for the same two loans.
import "dotenv/config";
import { platformPrisma } from "../prisma/seed-client";
import { enterPlatform } from "@/lib/db/context";
import { bandForScore, bandForBehavioural, defaultProbability, normaliseBandName, RISK_BANDS } from "@/lib/risk/bands";
import { repaymentPoints, arrearsPoints, behaviouralScore, assessGraduation, runGraduations, MAX_INCREASE_KES } from "@/lib/risk/graduation";
import { deleteTenant } from "@/lib/compliance/tenant";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => {
  if (c) { pass++; console.log(`  PASS  ${n}${x ? ` — ${x}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${n}${x ? ` — ${x}` : ""}`); }
};
const section = (s: string) => console.log(`\n${s}`);
const DAY = 86_400_000;

async function main() {
  // ── The ladder ─────────────────────────────────────────────────────────────
  section("Four bands, one vocabulary");

  ok("there are exactly four", RISK_BANDS.length === 4);
  ok("they are ordered best to worst", RISK_BANDS.map((b) => b.key).join(">") === "PRIME>STRONG>WATCH>HIGH");
  ok("an 800 is PRIME", bandForScore(800)?.key === "PRIME");
  ok("750 is the Prime floor, exactly", bandForScore(750)?.key === "PRIME" && bandForScore(749)?.key === "STRONG");
  ok("a 747 is STRONG — good, but three points off Prime, and the ladder says so",
    bandForScore(747)?.key === "STRONG");
  ok("a 600 is WATCH", bandForScore(600)?.key === "WATCH");
  ok("a 480 is HIGH", bandForScore(480)?.key === "HIGH");
  ok("an unscored customer has no band, rather than a default one", bandForScore(null) === null);

  ok("★ a HIGH-risk customer graduates at exactly 0%", RISK_BANDS.find((b) => b.key === "HIGH")!.graduationPercent === 0);
  ok("the top band is worth more than the second (the old 3-band ladder paid them the same)",
    RISK_BANDS[0].graduationPercent > RISK_BANDS[1].graduationPercent, "30% vs 20%");

  section("ServiceSuite's vocabulary still resolves");
  ok("'Minor risk' maps to PRIME", normaliseBandName("Minor risk") === "PRIME");
  ok("'Moderate' maps to WATCH", normaliseBandName("Moderate") === "WATCH");
  ok("'Major risk' maps to HIGH", normaliseBandName("Major risk") === "HIGH");

  section("The probability of default is honest about where it came from");
  const modelPd = defaultProbability(bandForScore(747), 0.021);
  ok("★ a model's own PD always wins", modelPd?.pd === 0.021 && modelPd.source === "model");
  const bandPd = defaultProbability(bandForScore(747), null);
  ok("★ …and a customer no model has scored gets their BAND's midpoint, labelled as such",
    bandPd?.source === "band" && bandPd.pd === 0.06, `STRONG midpoint = ${bandPd?.pd}`);
  const primePd = defaultProbability(bandForScore(800), null);
  ok("…and the bands really do separate: Prime carries a third of Strong's risk",
    (primePd?.pd ?? 1) < (bandPd?.pd ?? 0), `${primePd?.pd} vs ${bandPd?.pd}`);
  ok("no band and no model = no number invented", defaultProbability(null, null) === null);

  // ── The stored procedure's arithmetic ──────────────────────────────────────
  section("The arithmetic is sp_CreditScoringAndGraduation's, exactly");

  ok("paid in full = 100", repaymentPoints(5000, 5000) === 100);
  ok("paid three quarters = 75", repaymentPoints(5000, 3750) === 75);
  ok("paid half = 50", repaymentPoints(5000, 2500) === 50);
  ok("paid a third = 0 (not 33 — the curve is a cliff, on purpose)", repaymentPoints(5000, 1650) === 0);

  const due = new Date("2026-06-10");
  ok("paid on the day = 100", arrearsPoints(due, new Date("2026-06-10")) === 100);
  ok("paid early = 100", arrearsPoints(due, new Date("2026-06-08")) === 100);
  ok("★ ONE DAY LATE = 30. Seventy points, for one day. It is meant to hurt.",
    arrearsPoints(due, new Date("2026-06-11")) === 30);
  ok("four days late = 10", arrearsPoints(due, new Date("2026-06-14")) === 10);
  ok("a week late = 0", arrearsPoints(due, new Date("2026-06-18")) === 0);
  ok("★ never paid at all = scored against TODAY, so it gets worse every day",
    arrearsPoints(new Date(Date.now() - 30 * DAY), null) === 0);

  // ── Live DB ────────────────────────────────────────────────────────────────
  const p = platformPrisma();
  enterPlatform();
  const stamp = Date.now();

  const org = await p.org.create({ data: { slug: `risktest-${stamp}`, name: "Risk Test Ltd", status: "ACTIVE" } });
  const branch = await p.branch.create({ data: { orgId: org.id, name: "HQ" } });
  const product = await p.product.create({
    data: { orgId: org.id, name: "Boost", minPrincipal: 1000, maxPrincipal: 100000, interestRate: 10, repaymentPeriod: 30 },
  });

  /** Build a borrower with N cleared loans, each repaid with a given lateness/completeness. */
  const build = async (
    name: string,
    phone: string,
    loans: { principal: number; daysLate: number; paidRatio: number }[],
    limit?: number,
  ) => {
    const b = await p.borrower.create({
      data: { orgId: org.id, phone, firstName: name, kycStatus: "VERIFIED", branchId: branch.id, loanLimit: limit ?? null },
    });
    let i = 0;
    for (const spec of loans) {
      i++;
      const cleared = new Date(Date.now() - (loans.length - i + 1) * 40 * DAY);
      const dueDate = new Date(cleared.getTime() - 5 * DAY);
      const app = await p.loanApplication.create({
        data: { orgId: org.id, borrowerId: b.id, productId: product.id, amountRequested: spec.principal },
      });
      const loan = await p.loan.create({
        data: {
          orgId: org.id, borrowerId: b.id, applicationId: app.id, productId: product.id,
          principal: spec.principal, interest: spec.principal * 0.1, loanAmount: spec.principal * 1.1,
          balance: 0, status: "CLEARED", clearedAt: cleared, branchId: branch.id,
        },
      });
      const amountDue = spec.principal * 1.1;
      await p.installment.create({
        data: {
          orgId: org.id, loanId: loan.id, seq: 1, dueDate,
          amountDue, principalDue: spec.principal, interestDue: spec.principal * 0.1,
          amountPaid: amountDue * spec.paidRatio,
          status: "PAID",
          paidAt: new Date(dueDate.getTime() + spec.daysLate * DAY),
        },
      });
    }
    return b;
  };

  // The flawless customer: two 10,000 loans, paid in full, on the day.
  const prime = await build("Prime", "254790000001", [
    { principal: 10000, daysLate: 0, paidRatio: 1 },
    { principal: 10000, daysLate: 0, paidRatio: 1 },
  ], 10000);

  // Always pays in full — but always a week late.
  const late = await build("Late", "254790000002", [
    { principal: 10000, daysLate: 8, paidRatio: 1 },
    { principal: 10000, daysLate: 9, paidRatio: 1 },
  ], 10000);

  // Two cleared loans, but of DIFFERENT amounts — still finding their level.
  const climbing = await build("Climbing", "254790000003", [
    { principal: 5000, daysLate: 0, paidRatio: 1 },
    { principal: 12000, daysLate: 0, paidRatio: 1 },
  ], 12000);

  // Only one cleared loan.
  const novice = await build("Novice", "254790000004", [{ principal: 10000, daysLate: 0, paidRatio: 1 }], 10000);

  // A big borrower — to prove the KES 5,000 ceiling bites.
  const big = await build("Big", "254790000005", [
    { principal: 100000, daysLate: 0, paidRatio: 1 },
    { principal: 100000, daysLate: 0, paidRatio: 1 },
  ], 100000);

  // ── Behavioural scoring ────────────────────────────────────────────────────
  section("Scoring a real repayment record");

  const sPrime = await behaviouralScore(org.id, prime.id);
  ok("★ paid in full and on the day = 100/100", sPrime.score === 100, `${sPrime.score} (rh ${sPrime.repaymentHistory}, arrears ${sPrime.daysInArrears})`);
  ok("…which is PRIME", sPrime.band?.key === "PRIME");

  const sLate = await behaviouralScore(org.id, late.id);
  ok("★★ ALWAYS PAYS IN FULL, ALWAYS A WEEK LATE = 50/100 — half marks, and it is not PRIME",
    sLate.score === 50, `${sLate.score} (rh ${sLate.repaymentHistory}, arrears ${sLate.daysInArrears})`);
  ok("…they land in HIGH, which is exactly the customer a full-payment-only model would keep lending to",
    sLate.band?.key === "HIGH", sLate.band?.label);

  // ── Graduation ─────────────────────────────────────────────────────────────
  section("Who climbs the ladder");

  const gPrime = await assessGraduation(org.id, prime.id);
  ok("★ two cleared 10,000s, spotless = ELIGIBLE", gPrime.eligible);
  ok("…at 30% (Prime)", gPrime.graduationPercent === 30);
  ok("★ new limit = 10,000 + 30% = 13,000", gPrime.newLimit === 13000, String(gPrime.newLimit));
  ok("…and it explains itself in words", /Cleared KES 10,000 twice/.test(gPrime.reason), gPrime.reason);

  const gLate = await assessGraduation(org.id, late.id);
  ok("★★ THE ALWAYS-LATE PAYER IS REFUSED, though they repaid every shilling", !gLate.eligible);
  ok("…and is told why", /too low to earn an increase/.test(gLate.reason), gLate.reason);

  const gClimb = await assessGraduation(org.id, climbing.id);
  ok("★★ TWO CLEARED LOANS OF DIFFERENT AMOUNTS DO NOT GRADUATE — the ceiling was never proved",
    !gClimb.eligible);
  ok("…and the reason names both amounts", /5,000 and KES 12,000|12,000 and KES 5,000/.test(gClimb.reason), gClimb.reason);

  const gNovice = await assessGraduation(org.id, novice.id);
  ok("one cleared loan is not a track record", !gNovice.eligible && /1 more cleared loan/.test(gNovice.reason));

  const gBig = await assessGraduation(org.id, big.id);
  ok("★★ THE KES 5,000 CEILING BITES: 30% of 100,000 would be 30,000 of new exposure",
    gBig.newLimit === 100000 + MAX_INCREASE_KES, String(gBig.newLimit));
  ok("…and the assessment says the cap decided it, not the percentage", gBig.cappedByCeiling);

  // ── The cron ───────────────────────────────────────────────────────────────
  section("The nightly run");

  const run1 = await runGraduations(org.id, "test");
  ok("everyone with a closed loan is SCORED", run1.scored === 5, `${run1.scored} scored`);
  ok("★ only those who earned it are GRADUATED", run1.graduated === 2, `${run1.graduated} graduated (Prime + Big)`);

  const primeAfter = await p.borrower.findUnique({ where: { id: prime.id } });
  ok("the limit actually moved", Number(primeAfter?.loanLimit) === 13000);
  ok("the previous limit is remembered", Number(primeAfter?.previousLoanLimit) === 10000);
  ok("the graduation is counted", primeAfter?.graduationCount === 1);
  ok("★ the behavioural score is written to the customer", primeAfter?.behaviouralScore === 100);
  ok("★ …and so is their band, in the shared vocabulary", primeAfter?.riskBand === "PRIME");

  const lateAfter = await p.borrower.findUnique({ where: { id: late.id } });
  ok("★ the always-late payer is SCORED but NOT graduated (a lender must see the bad ones too)",
    lateAfter?.behaviouralScore === 50 && Number(lateAfter?.loanLimit) === 10000 && lateAfter?.graduationCount === 0);

  const event = await p.graduationEvent.findFirst({ where: { orgId: org.id, borrowerId: prime.id } });
  ok("★ the whole reasoning is written down — a customer can be TOLD why",
    !!event && Number(event.previousLimit) === 10000 && Number(event.newLimit) === 13000
      && event.riskBand === "PRIME" && event.repaymentHistoryScore === 100 && event.daysInArrearsScore === 100
      && Number(event.provenPrincipal) === 10000);

  // ── Idempotency ────────────────────────────────────────────────────────────
  const run2 = await runGraduations(org.id, "test");
  ok("★★ A SECOND NIGHT DOES NOT GRADUATE THEM AGAIN", run2.graduated === 0, `${run2.graduated}`);
  const primeAfter2 = await p.borrower.findUnique({ where: { id: prime.id } });
  ok("…and the limit did not climb twice for the same two loans",
    Number(primeAfter2?.loanLimit) === 13000 && primeAfter2?.graduationCount === 1);

  // ── Cleanup ────────────────────────────────────────────────────────────────
  await p.complianceRequest.create({
    data: { orgId: org.id, kind: "ORG_EXPORT", status: "COMPLETED", reason: "Test teardown." },
  });
  await deleteTenant(org.id);
  await p.auditLog.deleteMany({ where: { orgId: org.id } });
  ok("the scratch org is gone", (await p.org.findUnique({ where: { id: org.id } })) === null);

  await p.$disconnect();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
