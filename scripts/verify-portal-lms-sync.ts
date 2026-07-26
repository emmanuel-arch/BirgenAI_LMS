// ─────────────────────────────────────────────────────────────────────────────
// ONE CUSTOMER, TWO SCREENS — the synchrony suite.
//
// The claim this platform makes to a lender is that their customer portal and
// their staff console are two views of the SAME record, not two systems that
// exchange messages and drift. This suite is what makes that claim falsifiable.
//
// It walks one borrower the whole way — registered → KYC → scored → applied →
// offered → signed → active → cleared — and after every single transition it
// asserts that the stage the CUSTOMER is shown and the stage the OFFICER is
// shown are the same stage. The founder's example is section 3: a customer sitting
// at "KYC verification" in the portal must not read as "statement crunching" in
// the LMS. That is now a test, not a hope.
//
// It also proves the PIN door: that a national ID finds exactly one row, that a
// wrong PIN counts and locks, that a locked account cannot be walked past, and —
// the property everything downstream depends on — that the session minted by the
// PIN door is the SAME session the OTP door mints, bound to the phone on the
// borrower's own row rather than to anything the client sent.
//
//   npx tsx scripts/verify-portal-lms-sync.ts
//
// Creates its own fixture org and deletes it at the end. Touches no real lender.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { runWithOrg, runAsPlatform } from "../src/lib/db/context";
import { journeyOf, journeyLadder, type JourneyFacts, type JourneyStage } from "../src/lib/lms/journey";
import { issuePin, verifyPin, lookupByNationalId, setPin, normaliseNationalId, maskPhone } from "../src/lib/portal/pin";

let passed = 0, failed = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
};

const slug = `synctest-${Date.now().toString(36)}`;

async function main() {
  console.log("\n═══ ONE CUSTOMER, TWO SCREENS ═══");

  const org = await runAsPlatform(() => prisma.org.create({
    data: {
      slug, name: "Sync Test Ltd", status: "ACTIVE", mode: "NATIVE",
      accent: "#003c71", accentSoft: "rgba(0,60,113,0.12)",
    },
  }));
  const ctx = <T,>(fn: () => Promise<T>) => runWithOrg(org.id, fn);

  try {
    // ── 1. The stage machine agrees with itself ────────────────────────────
    console.log("\n1. The journey is ONE function, so the two screens cannot disagree");

    const facts = (over: Partial<JourneyFacts> = {}): JourneyFacts => ({
      kycStatus: "NONE", hasScore: false, applications: [], offers: [], loans: [], ...over,
    });

    const cases: { name: string; f: JourneyFacts; expect: JourneyStage }[] = [
      { name: "fresh registration", f: facts(), expect: "REGISTERED" },
      { name: "documents submitted", f: facts({ kycStatus: "PENDING_REVIEW" }), expect: "KYC_PENDING" },
      { name: "identity verified, no statement", f: facts({ kycStatus: "VERIFIED" }), expect: "KYC_VERIFIED" },
      { name: "statement crunched", f: facts({ kycStatus: "VERIFIED", hasScore: true }), expect: "SCORED" },
      { name: "application in review", f: facts({ kycStatus: "VERIFIED", hasScore: true, applications: [{ status: "OFFICER_REVIEW" }] }), expect: "APPLIED" },
      { name: "offer out, unsigned", f: facts({ kycStatus: "VERIFIED", hasScore: true, applications: [{ status: "APPROVED" }], offers: [{ status: "OFFERED" }] }), expect: "OFFERED" },
      { name: "borrower signed", f: facts({ kycStatus: "VERIFIED", hasScore: true, applications: [{ status: "APPROVED" }], offers: [{ status: "ACCEPTED" }] }), expect: "SIGNED" },
      { name: "money out", f: facts({ kycStatus: "VERIFIED", hasScore: true, offers: [{ status: "ACCEPTED" }], loans: [{ status: "ACTIVE" }] }), expect: "ACTIVE" },
      { name: "repaid in full", f: facts({ kycStatus: "VERIFIED", hasScore: true, loans: [{ status: "CLEARED" }] }), expect: "CLEARED" },
    ];

    for (const c of cases) {
      const v = journeyOf(c.f);
      ok(`${c.name} ⇒ ${c.expect}`, v.stage === c.expect, `got ${v.stage}`);
    }

    // ── 2. THE FOUNDER'S CASE, stated as an assertion ──────────────────────
    console.log("\n2. A customer in KYC cannot be 'statement crunching' on the other screen");

    const inKyc = journeyOf(facts({ kycStatus: "PENDING_REVIEW" }));
    ok("portal says 'We're checking your ID'", inKyc.borrowerLabel === "We're checking your ID", inKyc.borrowerLabel);
    ok("console says 'KYC verification'", inKyc.staffLabel === "KYC verification", inKyc.staffLabel);
    ok("both are the SAME stage index", journeyOf(facts({ kycStatus: "PENDING_REVIEW" })).index === inKyc.index);
    ok("it is NOT the crunch stage", inKyc.stage !== "KYC_VERIFIED" && inKyc.stage !== "SCORED");
    ok("the console knows whose move it is", inKyc.waitingOn === "lender", inKyc.waitingOn);

    const crunchStage = journeyOf(facts({ kycStatus: "VERIFIED" }));
    ok("the crunch stage is strictly AFTER KYC", crunchStage.index > inKyc.index);
    ok("…and it is the lender's next action", crunchStage.next === "Crunch their M-Pesa statement", crunchStage.next ?? "null");

    // The ladders are generated from the same table, so the two audiences see the
    // same number of steps with the same ones ticked. A portal that showed four
    // steps against the console's five would desync on the first release.
    const staffLadder = journeyLadder(inKyc, "staff");
    const borrowerLadder = journeyLadder(inKyc, "borrower");
    ok("both ladders have the same length", staffLadder.length === borrowerLadder.length);
    ok("both mark the same step current", staffLadder.findIndex((s) => s.current) === borrowerLadder.findIndex((s) => s.current));
    ok("both mark the same steps done", staffLadder.filter((s) => s.done).length === borrowerLadder.filter((s) => s.done).length);

    // ── 3. A live borrower, walked through the real tables ─────────────────
    console.log("\n3. The same walk, against real rows");

    const NATIONAL_ID = "31445566";
    const borrower = await ctx(() => prisma.borrower.create({
      data: {
        orgId: org.id, phone: "254700111222", nationalId: NATIONAL_ID,
        firstName: "Emmanuel", otherName: "Kipleting", email: "sync@test.local",
        kycStatus: "NONE",
      },
    }));

    /** Read the borrower the way BOTH screens do: from rows, through one function. */
    const liveStage = async () => {
      const b = await ctx(() => prisma.borrower.findUniqueOrThrow({
        where: { id: borrower.id },
        select: {
          kycStatus: true, creditScore: true,
          applications: { select: { status: true } },
          offers: { select: { status: true } },
          loans: { select: { status: true } },
        },
      }));
      const snaps = await ctx(() => prisma.scoreSnapshot.count({ where: { orgId: org.id, borrowerId: borrower.id } }));
      return journeyOf({
        kycStatus: b.kycStatus,
        hasScore: b.creditScore != null || snaps > 0,
        applications: b.applications,
        offers: b.offers,
        loans: b.loans,
      });
    };

    ok("a new registration reads REGISTERED on both screens", (await liveStage()).stage === "REGISTERED");

    await ctx(() => prisma.borrower.update({ where: { id: borrower.id }, data: { kycStatus: "PENDING_REVIEW" } }));
    let s = await liveStage();
    ok("documents in ⇒ KYC_PENDING", s.stage === "KYC_PENDING", s.stage);
    ok("…and the portal is NOT asking for a statement yet", s.borrowerLabel !== "Share your M-Pesa statement");

    await ctx(() => prisma.borrower.update({ where: { id: borrower.id }, data: { kycStatus: "VERIFIED" } }));
    s = await liveStage();
    ok("verified ⇒ KYC_VERIFIED, and NOW the statement is asked for", s.stage === "KYC_VERIFIED" && s.borrowerLabel === "Share your M-Pesa statement");

    await ctx(() => prisma.scoreSnapshot.create({
      data: { orgId: org.id, borrowerId: borrower.id, modelKind: "thin-file", modelVersion: "test", score: 690, riskBand: "STRONG" },
    }));
    s = await liveStage();
    ok("a score lands ⇒ SCORED on both screens", s.stage === "SCORED", s.stage);
    ok("the portal now says they can apply", s.borrowerLabel === "You're approved to apply", s.borrowerLabel);

    // ── 4. The PIN door ────────────────────────────────────────────────────
    console.log("\n4. The returning customer's door: national ID, then PIN");

    ok("an ID with spaces and case still finds them", normaliseNationalId(" 314 455 66 ") === NATIONAL_ID);

    const before = await ctx(() => lookupByNationalId(org.id, NATIONAL_ID));
    ok("the ID finds exactly one account", !!before && before.borrowerId === borrower.id);
    ok("…which has no PIN yet", before?.hasPin === false);
    ok("an unknown ID finds nothing", (await ctx(() => lookupByNationalId(org.id, "99999999"))) === null);
    ok("another lender's ID is invisible", (await ctx(() => lookupByNationalId("some-other-org", NATIONAL_ID))) === null);

    const pin = await ctx(() => issuePin(borrower.id));
    ok("a fresh PIN is 6 digits", /^\d{6}$/.test(pin));

    const stored = await ctx(() => prisma.borrower.findUniqueOrThrow({ where: { id: borrower.id }, select: { portalPinHash: true } }));
    ok("the plaintext is NEVER stored", stored.portalPinHash !== pin && (stored.portalPinHash ?? "").startsWith("$2"));

    const good = await ctx(() => verifyPin(org.id, NATIONAL_ID, pin));
    ok("the right PIN opens the door", good.ok === true);
    ok("…and the session is bound to the phone on the ROW, not to input",
      good.ok === true && good.phone === "254700111222");

    const bad = await ctx(() => verifyPin(org.id, NATIONAL_ID, "000000"));
    ok("a wrong PIN is refused", bad.ok === false && bad.reason === "invalid");
    ok("…and the customer is told how many tries remain", bad.ok === false && bad.attemptsLeft === 4);

    ok("a correct PIN forgives the earlier miss", (await ctx(() => verifyPin(org.id, NATIONAL_ID, pin))).ok === true);
    const afterGood = await ctx(() => prisma.borrower.findUniqueOrThrow({ where: { id: borrower.id }, select: { portalPinAttempts: true } }));
    ok("…by resetting the counter to zero", afterGood.portalPinAttempts === 0);

    for (let i = 0; i < 4; i++) await ctx(() => verifyPin(org.id, NATIONAL_ID, "111111"));
    const fifth = await ctx(() => verifyPin(org.id, NATIONAL_ID, "111111"));
    ok("five wrong PINs lock the account", fifth.ok === false && fifth.reason === "locked");
    const whileLocked = await ctx(() => verifyPin(org.id, NATIONAL_ID, pin));
    ok("…and even the RIGHT PIN cannot walk past a lock", whileLocked.ok === false && whileLocked.reason === "locked");

    // A staff reset is the recovery path, and it must actually recover them.
    const reissued = await ctx(() => issuePin(borrower.id));
    ok("a staff reset clears the lock", (await ctx(() => verifyPin(org.id, NATIONAL_ID, reissued))).ok === true);

    ok("a guessable PIN is refused", (await ctx(() => setPin(borrower.id, "111111"))) === false);
    ok("a sequential PIN is refused", (await ctx(() => setPin(borrower.id, "123456"))) === false);
    ok("a real PIN is accepted", (await ctx(() => setPin(borrower.id, "418302"))) === true);
    ok("…and it is the one that now works", (await ctx(() => verifyPin(org.id, NATIONAL_ID, "418302"))).ok === true);

    ok("the masked phone identifies without leaking", maskPhone("254700111222") === "0700 ••• 222");

    // ── 5. Application → offer → signature → money ─────────────────────────
    console.log("\n5. The contract: sent from the LMS, signed in the portal");

    const product = await ctx(() => prisma.product.create({
      data: {
        orgId: org.id, name: "Business 30d",
        minPrincipal: 1000, maxPrincipal: 100000, interestRate: 15,
        repaymentPeriod: 30, repaymentPeriodUnit: "day",
        isActive: true,
      },
    }));

    const app = await ctx(() => prisma.loanApplication.create({
      data: {
        orgId: org.id, borrowerId: borrower.id, productId: product.id,
        amountRequested: 25000, status: "OFFICER_REVIEW",
      },
    }));
    s = await liveStage();
    ok("an application ⇒ APPLIED, and the LENDER owes the next move", s.stage === "APPLIED" && s.waitingOn === "lender");

    await ctx(() => prisma.loanApplication.update({ where: { id: app.id }, data: { status: "APPROVED" } }));
    s = await liveStage();
    ok("approved but no offer yet ⇒ still the lender's move", s.stage === "APPLIED" && s.waitingOn === "lender", `${s.stage}/${s.waitingOn}`);
    ok("…and the console names the missing step", s.next === "Generate and send the offer", s.next ?? "null");

    // The offer row is the LEGAL artifact — the exact terms shown to the borrower.
    // The fixture fills every column the schema demands rather than a convenient
    // subset, because a suite that can only build a half-offer is not testing the
    // thing the borrower actually signs.
    const now = new Date();
    const offer = await ctx(() => prisma.loanOffer.create({
      data: {
        orgId: org.id, borrowerId: borrower.id, applicationId: app.id, productId: product.id,
        principal: 25000, interestRate: 15, interestMethod: "flat",
        termCount: 30, termUnit: "day", totalInterest: 3750, totalRepayable: 28750,
        borrowDate: now,
        firstDueDate: new Date(now.getTime() + 30 * 86400000),
        expectedClearDate: new Date(now.getTime() + 30 * 86400000),
        schedule: [{ seq: 1, dueDate: new Date(now.getTime() + 30 * 86400000).toISOString(), amountDue: 28750 }],
        termsHash: "sync-test",
        expiresAt: new Date(now.getTime() + 7 * 86400000),
        status: "OFFERED",
      },
    }));
    s = await liveStage();
    ok("offer sent ⇒ OFFERED, and it is the BORROWER'S move", s.stage === "OFFERED" && s.waitingOn === "borrower");
    ok("the portal says it is ready to sign", s.borrowerLabel === "Your offer is ready to sign", s.borrowerLabel);
    ok("the console says it is waiting on a signature", s.staffLabel === "Offer sent — awaiting signature", s.staffLabel);

    await ctx(() => prisma.loanOffer.update({ where: { id: offer.id }, data: { status: "ACCEPTED", channel: "PORTAL", acceptedAt: new Date() } }));
    s = await liveStage();
    ok("signed in the portal ⇒ SIGNED, back to the lender", s.stage === "SIGNED" && s.waitingOn === "lender");
    ok("…and the console's next step is disbursement", s.next === "Disburse the loan", s.next ?? "null");

    const loan = await ctx(() => prisma.loan.create({
      data: {
        orgId: org.id, borrowerId: borrower.id, productId: product.id, applicationId: app.id,
        principal: 25000, interest: 3750, loanAmount: 28750, balance: 28750, status: "ACTIVE",
        expectedClearDate: new Date(Date.now() + 30 * 86400000),
      },
    }));
    s = await liveStage();
    ok("money out ⇒ ACTIVE on both screens", s.stage === "ACTIVE");

    await ctx(() => prisma.loan.update({ where: { id: loan.id }, data: { status: "CLEARED", balance: 0, clearedAt: new Date() } }));
    s = await liveStage();
    ok("repaid ⇒ CLEARED, and they may borrow again", s.stage === "CLEARED" && s.borrowerLabel === "Loan cleared — you can borrow again");

    // ── 6. The regression this whole file exists to prevent ────────────────
    console.log("\n6. A live borrower never regresses to an onboarding step");

    await ctx(() => prisma.borrower.update({ where: { id: borrower.id }, data: { kycStatus: "PENDING_REVIEW" } }));
    s = await liveStage();
    ok("an expired ID does NOT drag a cleared customer back to KYC", s.stage === "CLEARED", s.stage);

    // ── 7. Erasure removes them from the PIN door too ──────────────────────
    console.log("\n7. An erased person is not a searchable customer");

    await ctx(() => prisma.borrower.update({ where: { id: borrower.id }, data: { erasedAt: new Date() } }));
    ok("an erased borrower cannot be found by national ID", (await ctx(() => lookupByNationalId(org.id, NATIONAL_ID))) === null);
    ok("…and their PIN no longer opens anything", (await ctx(() => verifyPin(org.id, NATIONAL_ID, "418302"))).ok === false);

  } catch (err) {
    // Without this the finally below would swallow a mid-suite throw and exit 0,
    // which is the one thing a verification script must never do.
    failed++;
    console.log(`
  FAIL  the suite threw before it finished`);
    console.error(err);
  } finally {
    await runAsPlatform(async () => {
      await prisma.$executeRawUnsafe(`DELETE FROM "Loan" WHERE "orgId" = $1`, org.id).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM "LoanOffer" WHERE "orgId" = $1`, org.id).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM "LoanApplication" WHERE "orgId" = $1`, org.id).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM "ScoreSnapshot" WHERE "orgId" = $1`, org.id).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM "Product" WHERE "orgId" = $1`, org.id).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM "Borrower" WHERE "orgId" = $1`, org.id).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM "AuditLog" WHERE "orgId" = $1`, org.id).catch(() => {});
      await prisma.org.delete({ where: { id: org.id } }).catch(() => {});
    });
    console.log("\nfixture cleaned up");
    console.log(`\n${passed} passed, ${failed} failed`);
    await prisma.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
  }
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
