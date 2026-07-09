// Tests for the credit agreement — blueprint §5.1.13.
//
//   npm run test:offer          (needs the database; no app server)
//
// One rule is worth all the others: a loan must never book without a signed offer.
// Everything else here exists to make sure that rule cannot be dodged — by a stale
// offer, a repriced product, an edited row, or an officer in a hurry.
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { runAsPlatform, runWithOrg } from "@/lib/db/context";
import { buildSchedule, earlySettlementSaving } from "@/lib/lending/schedule";
import { canonicalTerms, hashTerms } from "@/lib/lending/terms";
import { createOfferForApplication, effectiveStatus, termsOf, OFFER_TTL_DAYS } from "@/lib/lending/offer";
import { bookLoanFromApplication } from "@/lib/lending/book";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};
const threw = async (fn: () => Promise<unknown>): Promise<string | null> => {
  try { await fn(); return null; } catch (e) { return e instanceof Error ? e.message : String(e); }
};

async function main() {
  const slug = `offertest-${Date.now()}`;
  const org = await runAsPlatform(() => prisma.org.create({
    data: { slug, name: "Offer Test", plan: "STARTER", mode: "NATIVE", status: "ACTIVE" },
  }));
  console.log(`fixture org ${slug} (${org.id})\n`);

  try {
    const ctx = <T>(fn: () => Promise<T>) => runWithOrg(org.id, fn);

    const product = await ctx(() => prisma.product.create({
      data: {
        orgId: org.id, name: "Biz Reducing", interestRate: 12, interestMethod: "reducing",
        repaymentPeriod: 4, repaymentPeriodUnit: "month", minPrincipal: 1000, maxPrincipal: 500000, isActive: true,
      },
    }));
    const flatProduct = await ctx(() => prisma.product.create({
      data: {
        orgId: org.id, name: "Quick Flat", interestRate: 10, interestMethod: "flat",
        repaymentPeriod: 4, repaymentPeriodUnit: "week", minPrincipal: 1000, maxPrincipal: 100000, isActive: true,
      },
    }));
    const borrower = await ctx(() => prisma.borrower.create({
      data: { orgId: org.id, phone: "254700000001", firstName: "Asha", otherName: "N" },
    }));
    const staff = await ctx(() => prisma.staffUser.create({
      data: { orgId: org.id, email: `s@${slug}.test`, passwordHash: "x", firstName: "Ops", status: "ACTIVE" },
    }));

    const newApp = (amount: number, productId: string) => ctx(() => prisma.loanApplication.create({
      data: { orgId: org.id, borrowerId: borrower.id, productId, amountRequested: amount, status: "OFFICER_REVIEW", decision: "APPROVE" },
    }));

    console.log("1. The schedule the borrower signs is the schedule the loan books");
    const s = buildSchedule({ principal: 10000, rate: 12, count: 4, unit: "month", method: "reducing", borrowDate: new Date("2026-07-09") });
    ok("reducing 10k @12% over 4 charges 750 interest", s.interest === 750, `${s.interest}`);
    ok("installments sum exactly to the total", Math.round(s.rows.reduce((a, r) => a + r.amountDue, 0) * 100) / 100 === s.loanAmount);
    ok("principal sums exactly to the principal", Math.round(s.rows.reduce((a, r) => a + r.principalDue, 0) * 100) / 100 === 10000);
    const f = buildSchedule({ principal: 10000, rate: 10, count: 4, unit: "week", method: "flat", borrowDate: new Date("2026-07-09") });
    ok("flat 10k @10% charges 1000, more than the reducing equivalent", f.interest === 1000 && f.interest > 750);
    ok("the same terms always produce the same schedule",
      buildSchedule({ principal: 10000, rate: 12, count: 4, unit: "month", method: "reducing", borrowDate: new Date("2026-07-09") }).loanAmount === s.loanAmount);

    console.log("\n2. \"Pay early, pay less\" is only claimed where it is true");
    ok("reducing: settling halfway saves the remaining interest",
      earlySettlementSaving({ principal: 10000, rate: 12, count: 4, unit: "month", method: "reducing" }, 2) > 0);
    ok("flat: settling early saves nothing, and we say zero, not a lie",
      earlySettlementSaving({ principal: 10000, rate: 10, count: 4, unit: "week", method: "flat" }, 2) === 0);

    console.log("\n3. The terms hash is a fingerprint of the agreement");
    const base = { principal: 10000, interestRate: 12, interestMethod: "reducing" as const, termCount: 4, termUnit: "month", graceDays: 0, totalInterest: 750, totalRepayable: 10750, borrowDate: new Date("2026-07-09") };
    ok("canonical form is stable and readable", canonicalTerms(base).startsWith("principal=10000.00|rate=12.0000|"));
    ok("the same terms hash the same", hashTerms(base) === hashTerms({ ...base }));
    ok("one shilling more principal changes the hash", hashTerms(base) !== hashTerms({ ...base, principal: 10001 }));
    ok("a cheaper rate changes the hash", hashTerms(base) !== hashTerms({ ...base, interestRate: 11 }));
    ok("flipping flat/reducing changes the hash", hashTerms(base) !== hashTerms({ ...base, interestMethod: "flat" }));

    console.log("\n4. NOTHING BOOKS WITHOUT A SIGNED OFFER");
    const a1 = await newApp(10000, product.id);
    let err = await threw(() => ctx(() => bookLoanFromApplication(a1.id, staff.id)));
    ok("an application with no offer cannot be booked", err === "No offer has been made to this borrower yet.", err ?? "booked!");

    const created = await ctx(() => createOfferForApplication(a1.id));
    ok("an offer is drafted from the product", !!created);
    err = await threw(() => ctx(() => bookLoanFromApplication(a1.id, staff.id)));
    ok("an UNSIGNED offer cannot be booked", err === "The borrower has not accepted the offer yet.", err ?? "booked!");

    await ctx(() => prisma.loanOffer.update({ where: { id: created!.id }, data: { status: "DECLINED", declinedAt: new Date() } }));
    err = await threw(() => ctx(() => bookLoanFromApplication(a1.id, staff.id)));
    ok("a DECLINED offer cannot be booked", err === "The borrower declined this offer.", err ?? "booked!");

    await ctx(() => prisma.loanOffer.update({ where: { id: created!.id }, data: { status: "OFFERED", declinedAt: null, expiresAt: new Date(Date.now() - 1000) } }));
    ok("a lapsed offer reads EXPIRED with no cron having run",
      effectiveStatus({ status: "OFFERED", expiresAt: new Date(Date.now() - 1000) }) === "EXPIRED");
    err = await threw(() => ctx(() => bookLoanFromApplication(a1.id, staff.id)));
    ok("an EXPIRED offer cannot be booked", err?.startsWith("The borrower's offer expired") ?? false, err ?? "booked!");

    console.log("\n5. A signed offer books, at the terms that were signed");
    await ctx(() => prisma.loanOffer.update({
      where: { id: created!.id },
      data: { status: "ACCEPTED", acceptedAt: new Date(), channel: "PORTAL", expiresAt: new Date(Date.now() + 86400000) },
    }));
    const booked = await ctx(() => bookLoanFromApplication(a1.id, staff.id));
    ok("the loan books", !!booked.loanId);
    const offer1 = await ctx(() => prisma.loanOffer.findUniqueOrThrow({ where: { id: created!.id } }));
    ok("the booked total equals the signed total", booked.loanAmount === Number(offer1.totalRepayable), `${booked.loanAmount} vs ${offer1.totalRepayable}`);
    ok("the booked interest equals the signed interest", booked.interest === Number(offer1.totalInterest));
    ok("the installment count matches", booked.installments === offer1.termCount);
    const loan = await ctx(() => prisma.loan.findUniqueOrThrow({ where: { id: booked.loanId }, include: { installments: true } }));
    ok("the schedule written matches the schedule signed",
      loan.installments.length === (offer1.schedule as { seq: number }[]).length);
    ok("booking twice is refused", (await threw(() => ctx(() => bookLoanFromApplication(a1.id, staff.id)))) === "This application already has a loan.");

    console.log("\n6. Repricing the product cannot reach into a signed agreement");
    const a2 = await newApp(20000, product.id);
    const o2 = await ctx(() => createOfferForApplication(a2.id));
    const signedTotal = o2!.totalRepayable;
    // The lender doubles the rate AFTER the borrower signs.
    await ctx(() => prisma.product.update({ where: { id: product.id }, data: { interestRate: 24 } }));
    await ctx(() => prisma.loanOffer.update({ where: { id: o2!.id }, data: { status: "ACCEPTED", acceptedAt: new Date(), channel: "PORTAL" } }));
    const booked2 = await ctx(() => bookLoanFromApplication(a2.id, staff.id));
    ok("the borrower still owes what they agreed to, not the new rate",
      booked2.loanAmount === signedTotal, `${booked2.loanAmount} vs signed ${signedTotal}`);
    await ctx(() => prisma.product.update({ where: { id: product.id }, data: { interestRate: 12 } }));

    console.log("\n7. Tampering with a stored offer blocks the booking");
    const a3 = await newApp(15000, flatProduct.id);
    const o3 = await ctx(() => createOfferForApplication(a3.id));
    await ctx(() => prisma.loanOffer.update({
      where: { id: o3!.id },
      // Someone edits the row directly to make the borrower owe more. The hash was
      // taken over the original numbers, so it no longer matches.
      data: { status: "ACCEPTED", acceptedAt: new Date(), channel: "PORTAL", totalRepayable: 99999 },
    }));
    err = await threw(() => ctx(() => bookLoanFromApplication(a3.id, staff.id)));
    ok("a row whose terms no longer hash to its signature is refused",
      err === "This offer's terms do not match its signature. Booking is blocked.", err ?? "booked!");

    console.log("\n8. Drafting is idempotent, and never re-prices mid-decision");
    const a4 = await newApp(12000, product.id);
    const first = await ctx(() => createOfferForApplication(a4.id));
    const second = await ctx(() => createOfferForApplication(a4.id));
    ok("a second draft returns the same offer", first!.id === second!.id);
    ok("and the same terms hash", first!.termsHash === second!.termsHash);
    const o4 = await ctx(() => prisma.loanOffer.findUniqueOrThrow({ where: { id: first!.id } }));
    ok(`an offer expires in ${OFFER_TTL_DAYS} days`,
      Math.round((o4.expiresAt.getTime() - o4.createdAt.getTime()) / 86_400_000) === OFFER_TTL_DAYS);
    ok("stored terms round-trip to the same hash", hashTerms(termsOf(o4)) === o4.termsHash);

    console.log("\n9. A bridged org keeps its paperwork in ServiceSuite");
    await runAsPlatform(() => prisma.org.update({ where: { id: org.id }, data: { mode: "BRIDGED" } }));
    const a5 = await newApp(9000, product.id);
    ok("no offer is drafted for a bridged application", (await ctx(() => createOfferForApplication(a5.id))) === null);
    await runAsPlatform(() => prisma.org.update({ where: { id: org.id }, data: { mode: "NATIVE" } }));
  } finally {
    await runAsPlatform(async () => {
      await prisma.installment.deleteMany({ where: { orgId: org.id } });
      await prisma.disbursement.deleteMany({ where: { orgId: org.id } });
      await prisma.loan.deleteMany({ where: { orgId: org.id } });
      await prisma.loanOffer.deleteMany({ where: { orgId: org.id } });
      await prisma.loanApplication.deleteMany({ where: { orgId: org.id } });
      await prisma.borrower.deleteMany({ where: { orgId: org.id } });
      await prisma.product.deleteMany({ where: { orgId: org.id } });
      await prisma.staffUser.deleteMany({ where: { orgId: org.id } });
      await prisma.auditLog.deleteMany({ where: { orgId: org.id } });
      await prisma.org.delete({ where: { id: org.id } });
    });
    console.log(`\n${pass} passed, ${fail} failed`);
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
