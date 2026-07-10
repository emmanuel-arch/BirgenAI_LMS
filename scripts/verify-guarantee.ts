// Tests for guarantors and collateral — blueprint §4 role 4, §10.
//
//   npm run test:guarantee      (needs the database; no app server)
//
// `Product.guarantorRequired` and `Product.securityRequired` were decorative booleans
// for two phases: a product demanding a guarantor booked happily without one. These
// tests exist so they can never go back to being decorative.
//
// The rule worth all the others: a guarantor consents to ONE agreement. Re-price the
// loan and their consent is stale, because standing behind KES 10,000 is not standing
// behind KES 50,000.
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { runAsPlatform, runWithOrg } from "@/lib/db/context";
import { createOfferForApplication } from "@/lib/lending/offer";
import { bookLoanFromApplication } from "@/lib/lending/book";
import { checkSecurity } from "@/lib/lending/security";
import {
  inviteGuarantor, consentGuarantor, declineGuarantor, requestGuarantorCode,
  effectiveGuarantorStatus, standsBehind, expireStaleGuarantors,
  resolveGuarantorOrg, guarantorPurpose,
} from "@/lib/lending/guarantor";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};
const threw = async (fn: () => Promise<unknown>): Promise<string | null> => {
  try { await fn(); return null; } catch (e) { return e instanceof Error ? e.message : String(e); }
};

async function main() {
  const slug = `gtest-${Date.now()}`;
  const org = await runAsPlatform(() => prisma.org.create({
    data: { slug, name: "Guarantee Test", plan: "STARTER", mode: "NATIVE", status: "ACTIVE" },
  }));
  console.log(`fixture org ${slug} (${org.id})\n`);
  const ctx = <T>(fn: () => Promise<T>) => runWithOrg(org.id, fn);

  try {
    // Two products: one wants a guarantor, one wants security at 80% of principal.
    const guaranteed = await ctx(() => prisma.product.create({
      data: {
        orgId: org.id, name: "Guaranteed", interestRate: 10, interestMethod: "flat",
        repaymentPeriod: 4, repaymentPeriodUnit: "week", minPrincipal: 1000, maxPrincipal: 999999,
        isActive: true, guarantorRequired: true,
      },
    }));
    const secured = await ctx(() => prisma.product.create({
      data: {
        orgId: org.id, name: "Secured", interestRate: 10, interestMethod: "flat",
        repaymentPeriod: 4, repaymentPeriodUnit: "week", minPrincipal: 1000, maxPrincipal: 999999,
        isActive: true, securityRequired: true, securityCoverPct: 80,
      },
    }));
    const plain = await ctx(() => prisma.product.create({
      data: {
        orgId: org.id, name: "Plain", interestRate: 10, interestMethod: "flat",
        repaymentPeriod: 4, repaymentPeriodUnit: "week", minPrincipal: 1000, maxPrincipal: 999999, isActive: true,
      },
    }));

    const borrower = await ctx(() => prisma.borrower.create({
      data: { orgId: org.id, phone: "254700111222", firstName: "Wanjiru" },
    }));
    const staff = await ctx(() => prisma.staffUser.create({
      data: { orgId: org.id, email: `s@${slug}.test`, passwordHash: "x", firstName: "Ops", status: "ACTIVE" },
    }));

    const newApp = (amount: number, productId: string) => ctx(() => prisma.loanApplication.create({
      data: { orgId: org.id, borrowerId: borrower.id, productId, amountRequested: amount, status: "OFFICER_REVIEW", decision: "APPROVE" },
    }));
    const signOffer = async (appId: string) => {
      const o = await ctx(() => createOfferForApplication(appId));
      await ctx(() => prisma.loanOffer.update({
        where: { id: o!.id },
        data: { status: "ACCEPTED", acceptedAt: new Date(), channel: "PORTAL" },
      }));
      return o!;
    };
    /** Read the live code straight out of the challenge table — we are the SMS here. */
    const codeFor = async (gid: string, phone: string) => {
      const c = await ctx(() => prisma.otpChallenge.findFirst({
        where: { orgId: org.id, phone, purpose: guarantorPurpose(gid), usedAt: null },
        orderBy: { createdAt: "desc" },
      }));
      return c!;
    };

    console.log("1. A product that needs a guarantor cannot book without one");
    const a1 = await newApp(10000, guaranteed.id);
    const offer1 = await signOffer(a1.id);
    let err = await threw(() => ctx(() => bookLoanFromApplication(a1.id, staff.id)));
    ok("no guarantor asked → refused", err === "This product needs a guarantor, and none has been asked.", err ?? "booked!");

    const g1 = await ctx(() => inviteGuarantor({ applicationId: a1.id, fullName: "Otieno Mwangi", phone: "254700333444", relationship: "brother" }));
    ok("an invitation is created", !!g1.id);
    err = await threw(() => ctx(() => bookLoanFromApplication(a1.id, staff.id)));
    ok("asked but silent → still refused", err === "This product needs a guarantor, and the one asked has not consented yet.", err ?? "booked!");

    console.log("\n2. A borrower cannot guarantee their own loan");
    err = await threw(() => ctx(() => inviteGuarantor({ applicationId: a1.id, fullName: "Wanjiru", phone: borrower.phone })));
    ok("refused, by phone number", err === "A borrower cannot guarantee their own loan.", err ?? "allowed!");
    err = await threw(() => ctx(() => inviteGuarantor({ applicationId: a1.id, fullName: "Otieno again", phone: "254700333444" })));
    ok("and nobody is asked twice", err === "That person has already been asked.", err ?? "allowed!");

    console.log("\n3. Consent is a code sent to the GUARANTOR's phone");
    await ctx(() => requestGuarantorCode(g1.id));
    const challenge = await codeFor(g1.id, "254700333444");
    ok("the challenge is scoped to this one invitation", challenge.purpose === guarantorPurpose(g1.id));
    ok("and issued to the guarantor's number, not the borrower's", challenge.phone === "254700333444");

    // The wrong code does not consent.
    const bad = await ctx(() => consentGuarantor(g1.id, "000000", {}));
    ok("a wrong code is refused", !bad.ok);

    // The right one does. bcrypt hides it, so re-issue and read the dev code path.
    const issued = await ctx(() => requestGuarantorCode(g1.id));
    ok("a dev code is handed back when no SMS provider exists", !!issued.devCode);
    const good = await ctx(() => consentGuarantor(g1.id, issued.devCode!, { ip: "1.2.3.4", userAgent: "test" }));
    ok("the right code consents", good.ok);

    const consented = await ctx(() => prisma.guarantor.findUniqueOrThrow({ where: { id: g1.id } }));
    ok("the consent is bound to the agreement they saw", consented.offerTermsHash === offer1.termsHash);
    ok("and records what it stands behind", Number(consented.amountGuaranteed) === offer1.totalRepayable);
    ok("with the evidence of the signature", !!consented.otpChallengeId && consented.consentIp === "1.2.3.4");
    ok("standsBehind agrees", standsBehind(consented, offer1.termsHash));

    const booked = await ctx(() => bookLoanFromApplication(a1.id, staff.id));
    ok("and NOW the loan books", !!booked.loanId);

    console.log("\n4. A guarantor consents to ONE agreement — re-price it and consent goes stale");
    const a2 = await newApp(10000, guaranteed.id);
    const offer2 = await signOffer(a2.id);
    const g2 = await ctx(() => inviteGuarantor({ applicationId: a2.id, fullName: "Achieng", phone: "254700555666" }));
    const iss2 = await ctx(() => requestGuarantorCode(g2.id));
    await ctx(() => consentGuarantor(g2.id, iss2.devCode!, {}));
    ok("they stand behind the 10,000 agreement", standsBehind(await ctx(() => prisma.guarantor.findUniqueOrThrow({ where: { id: g2.id } })), offer2.termsHash));

    // The lender re-issues at 50,000. Same guarantor row, different agreement.
    await ctx(() => prisma.loanOffer.delete({ where: { id: offer2.id } }));
    await ctx(() => prisma.loanApplication.update({ where: { id: a2.id }, data: { amountRequested: 50000 } }));
    const offer2b = await signOffer(a2.id);
    ok("the new agreement has a different fingerprint", offer2b.termsHash !== offer2.termsHash);
    const g2row = await ctx(() => prisma.guarantor.findUniqueOrThrow({ where: { id: g2.id } }));
    ok("their old consent does NOT stand behind it", !standsBehind(g2row, offer2b.termsHash));
    err = await threw(() => ctx(() => bookLoanFromApplication(a2.id, staff.id)));
    ok("standing behind KES 10,000 is not standing behind KES 50,000 — booking refused",
      err === "The guarantor agreed to different terms. The offer changed since — ask them again.", err ?? "booked!");

    console.log("\n5. Declined and expired invitations are not consent");
    const a3 = await newApp(10000, guaranteed.id);
    await signOffer(a3.id);
    const g3 = await ctx(() => inviteGuarantor({ applicationId: a3.id, fullName: "Kamau", phone: "254700777888" }));
    await ctx(() => declineGuarantor(g3.id));
    err = await threw(() => ctx(() => bookLoanFromApplication(a3.id, staff.id)));
    ok("a declined guarantor does not let the loan book, and the officer is told to ask someone else",
      err === "This product needs a guarantor. The person asked declined — ask someone else.", err ?? "booked!");
    err = await threw(() => ctx(() => requestGuarantorCode(g3.id)));
    ok("and a declined invitation cannot be re-opened with a code", err === "This invitation is closed.", err ?? "issued!");

    const a4 = await newApp(10000, guaranteed.id);
    await signOffer(a4.id);
    const g4 = await ctx(() => inviteGuarantor({ applicationId: a4.id, fullName: "Njeri", phone: "254700999000" }));
    await ctx(() => prisma.guarantor.update({ where: { id: g4.id }, data: { expiresAt: new Date(Date.now() - 1000) } }));
    const g4row = await ctx(() => prisma.guarantor.findUniqueOrThrow({ where: { id: g4.id } }));
    ok("a lapsed invitation reads EXPIRED with no cron having run", effectiveGuarantorStatus(g4row) === "EXPIRED");
    err = await threw(() => ctx(() => bookLoanFromApplication(a4.id, staff.id)));
    ok("and an unanswered invitation does not let the loan book",
      err === "The guarantor never answered and the invitation has expired. Ask again.", err ?? "booked!");
    ok("the sweep tidies it", (await runAsPlatform(() => expireStaleGuarantors())) >= 1);

    console.log("\n6. Only VERIFIED collateral counts");
    const a5 = await newApp(10000, secured.id);
    await signOffer(a5.id);
    err = await threw(() => ctx(() => bookLoanFromApplication(a5.id, staff.id)));
    ok("nothing pledged → refused", err === "This product requires security, and nothing has been pledged.", err ?? "booked!");

    const lorry = await ctx(() => prisma.collateral.create({
      data: { orgId: org.id, applicationId: a5.id, borrowerId: borrower.id, kind: "VEHICLE", description: "Isuzu lorry", estimatedValueKes: 20000 },
    }));
    err = await threw(() => ctx(() => bookLoanFromApplication(a5.id, staff.id)));
    ok("pledged but nobody looked at it → refused",
      err?.includes("none of it is verified") ?? false, err ?? "booked!");

    // Verify something worth less than the 80% cover the product demands.
    await ctx(() => prisma.collateral.update({ where: { id: lorry.id }, data: { estimatedValueKes: 5000, status: "VERIFIED", verifiedBy: staff.id, verifiedAt: new Date() } }));
    const short = await ctx(() => checkSecurity(a5.id, 10000, secured));
    ok("80% of a 10,000 principal is 8,000 of cover", short.requiredValue === 8000);
    ok("5,000 verified is not enough", !short.ok && short.verifiedValue === 5000);
    err = await threw(() => ctx(() => bookLoanFromApplication(a5.id, staff.id)));
    ok("and booking says exactly how short", err?.includes("short of the KES 8,000") ?? false, err ?? "booked!");

    await ctx(() => prisma.collateral.update({ where: { id: lorry.id }, data: { estimatedValueKes: 8000 } }));
    const enough = await ctx(() => checkSecurity(a5.id, 10000, secured));
    ok("8,000 verified covers it", enough.ok);
    const booked5 = await ctx(() => bookLoanFromApplication(a5.id, staff.id));
    ok("the loan books", !!booked5.loanId);
    const attached = await ctx(() => prisma.collateral.findUniqueOrThrow({ where: { id: lorry.id } }));
    ok("and the security now points at the loan it secures", attached.loanId === booked5.loanId);

    // Rejected collateral is not security.
    const a6 = await newApp(10000, secured.id);
    await signOffer(a6.id);
    await ctx(() => prisma.collateral.create({
      data: { orgId: org.id, applicationId: a6.id, borrowerId: borrower.id, kind: "LAND", description: "Plot", estimatedValueKes: 500000, status: "REJECTED", rejectedReason: "title deed is not theirs" },
    }));
    err = await threw(() => ctx(() => bookLoanFromApplication(a6.id, staff.id)));
    ok("half a million of REJECTED security counts for nothing, and says why",
      err === "The security offered was rejected — title deed is not theirs. Nothing else has been pledged.", err ?? "booked!");

    console.log("\n7. A product that asks for neither is unaffected");
    const a7 = await newApp(10000, plain.id);
    await signOffer(a7.id);
    const booked7 = await ctx(() => bookLoanFromApplication(a7.id, staff.id));
    ok("it books, as it always did", !!booked7.loanId);
    const sec7 = await ctx(() => checkSecurity(a7.id, 10000, plain));
    ok("and its security check is a no-op", sec7.ok && !sec7.required);

    console.log("\n8. The invitation resolves its own tenant, and only its own");
    ok("a real id resolves to its org", (await resolveGuarantorOrg(g1.id)) === org.id);
    ok("a well-formed but unknown uuid resolves to nothing",
      (await resolveGuarantorOrg("00000000-0000-0000-0000-000000000000")) === null);
    ok("garbage never reaches the database", (await resolveGuarantorOrg("../../etc/passwd")) === null);
  } finally {
    await runAsPlatform(async () => {
      await prisma.installment.deleteMany({ where: { orgId: org.id } });
      await prisma.disbursement.deleteMany({ where: { orgId: org.id } });
      await prisma.collateral.deleteMany({ where: { orgId: org.id } });
      await prisma.loan.deleteMany({ where: { orgId: org.id } });
      await prisma.guarantor.deleteMany({ where: { orgId: org.id } });
      await prisma.loanOffer.deleteMany({ where: { orgId: org.id } });
      await prisma.loanApplication.deleteMany({ where: { orgId: org.id } });
      await prisma.otpChallenge.deleteMany({ where: { orgId: org.id } });
      await prisma.smsMessage.deleteMany({ where: { orgId: org.id } });
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
