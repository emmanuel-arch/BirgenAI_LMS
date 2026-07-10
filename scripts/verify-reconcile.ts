// Tests for reconciliation — the referee between the money and the book.
//
//   npm run test:reconcile        (needs the database; no app server)
//
// Two properties carry everything:
//   • every disagreement class is DETECTED, with the right amount and a message
//     a Finance officer can act on;
//   • the sweep is IDEMPOTENT and honest about lifecycle — re-detection bumps
//     lastSeenAt, a vanished condition self-heals, a human "resolved" that
//     reappears is reopened, and IGNORED is never overturned by a machine.
import "dotenv/config";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runAsPlatform, runWithOrg } from "@/lib/db/context";
import { reconcileOrg, raiseException, resolveException } from "@/lib/finance/reconcile";
import { allocateRepayment } from "@/lib/lending/allocate";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};

const D = (n: number) => new Prisma.Decimal(n);

async function main() {
  const slug = `recontest-${Date.now()}`;
  const [org, orgB] = await runAsPlatform(() =>
    Promise.all([
      prisma.org.create({ data: { slug, name: "Recon Test", plan: "STARTER", mode: "NATIVE", status: "ACTIVE" } }),
      prisma.org.create({ data: { slug: `${slug}-b`, name: "Recon Test B", plan: "STARTER", mode: "NATIVE", status: "ACTIVE" } }),
    ]),
  );
  const ctx = <T>(fn: () => Promise<T>) => runWithOrg(org.id, fn);
  console.log(`fixture org ${slug} (${org.id})\n`);

  const exOf = (kind: string, reference?: string) =>
    ctx(() => prisma.reconciliationException.findMany({ where: { orgId: org.id, kind, ...(reference ? { reference } : {}) } }));

  try {
    const borrower = await ctx(() => prisma.borrower.create({ data: { orgId: org.id, phone: "254712000111", firstName: "Recon" } }));
    const product = await ctx(() => prisma.product.create({
      data: { orgId: org.id, name: "Recon Loan", minPrincipal: D(1000), maxPrincipal: D(100000), interestRate: D(10), repaymentPeriod: 4 },
    }));
    const mkLoan = (principal: number, status: "ACTIVE" | "PENDING_DISBURSEMENT") =>
      ctx(() => prisma.loan.create({
        data: {
          orgId: org.id, borrowerId: borrower.id, productId: product.id,
          principal: D(principal), interest: D(principal * 0.1),
          loanAmount: D(principal * 1.1), balance: D(principal * 1.1), status,
        },
      }));

    // A healthy loan: ACTIVE with a confirmed payout of exactly its principal.
    const loan1 = await mkLoan(10000, "ACTIVE");
    await ctx(() => prisma.disbursement.create({
      data: { orgId: org.id, loanId: loan1.id, amount: D(10000), phone: borrower.phone, state: "CONFIRMED", receiptRef: "B2C-OK-1" },
    }));

    console.log("1. A healthy book raises nothing");
    let stats = await reconcileOrg(org.id);
    ok("zero facts, zero opened", stats.facts === 0 && stats.opened === 0, JSON.stringify(stats));

    console.log("\n2. Paybill money with no home is found, and found once");
    const receipt = await ctx(() => prisma.c2BReceipt.create({
      data: { orgId: org.id, transId: "TX-UNALLOC-1", amount: D(750), phone: "254712000111", billRef: "??" },
    }));
    stats = await reconcileOrg(org.id);
    ok("one exception opened", stats.opened === 1, JSON.stringify(stats));
    let [ex] = await exOf("C2B_UNALLOCATED", receipt.id);
    ok("HIGH, with the amount", ex?.severity === "HIGH" && Number(ex.amountKes) === 750);
    ok("and a message a human can act on", ex?.message.includes("Allocate it from Repayments"));

    const seenAt = ex.lastSeenAt;
    await new Promise((r) => setTimeout(r, 20));
    stats = await reconcileOrg(org.id);
    ok("sweeping again opens nothing new", stats.opened === 0 && stats.stillOpen === 1);
    [ex] = await exOf("C2B_UNALLOCATED", receipt.id);
    ok("it bumped lastSeenAt instead", ex.lastSeenAt > seenAt);
    ok("and there is still exactly one row",
      (await ctx(() => prisma.reconciliationException.count({ where: { orgId: org.id, kind: "C2B_UNALLOCATED" } }))) === 1);

    console.log("\n3. Fixing the condition closes the exception as self-healed");
    await ctx(() => prisma.c2BReceipt.update({ where: { id: receipt.id }, data: { allocatedLoanId: loan1.id, allocatedAt: new Date() } }));
    stats = await reconcileOrg(org.id);
    ok("one self-healed", stats.selfHealed === 1, JSON.stringify(stats));
    [ex] = await exOf("C2B_UNALLOCATED", receipt.id);
    ok("resolved, and it says so", ex.status === "RESOLVED" && (ex.resolution ?? "").includes("self-healed"));

    console.log("\n4. A human 'resolved' that keeps reproducing is REOPENED; IGNORED never is");
    const receipt2 = await ctx(() => prisma.c2BReceipt.create({
      data: { orgId: org.id, transId: "TX-UNALLOC-2", amount: D(300) },
    }));
    await reconcileOrg(org.id);
    let [ex2] = await exOf("C2B_UNALLOCATED", receipt2.id);
    await resolveException(org.id, ex2.id, "tester", "RESOLVED", "we think we fixed it");
    stats = await reconcileOrg(org.id);
    ok("the sweep reopened it", stats.reopened === 1);
    [ex2] = await exOf("C2B_UNALLOCATED", receipt2.id);
    ok("open again, note cleared", ex2.status === "OPEN" && ex2.resolution === null);

    await resolveException(org.id, ex2.id, "tester", "IGNORED", "test paybill, not real money");
    stats = await reconcileOrg(org.id);
    ok("ignored stays ignored through a sweep", stats.reopened === 0 && stats.opened === 0);
    [ex2] = await exOf("C2B_UNALLOCATED", receipt2.id);
    ok("with the human's note intact", ex2.status === "IGNORED" && ex2.resolution === "test paybill, not real money");

    console.log("\n5. A confirmed STK payment that never posted is the loudest alarm");
    const intent = await ctx(() => prisma.paymentIntent.create({
      data: { orgId: org.id, loanId: loan1.id, phone: borrower.phone, amount: D(2000), state: "SUCCESS", mpesaReceipt: "RCPT-LOST-1", checkoutRequestId: `ws_${slug}_1` },
    }));
    const orphan = await ctx(() => prisma.paymentIntent.create({
      data: { orgId: org.id, phone: "254712000999", amount: D(1500), state: "SUCCESS", mpesaReceipt: "RCPT-ORPHAN", checkoutRequestId: `ws_${slug}_2` },
    }));
    await reconcileOrg(org.id);
    let [sx] = await exOf("STK_SUCCESS_UNAPPLIED", intent.id);
    ok("flagged HIGH with the amount", sx?.severity === "HIGH" && Number(sx.amountKes) === 2000);
    ok("names the receipt", sx?.message.includes("RCPT-LOST-1"));
    const [ox] = await exOf("STK_SUCCESS_UNAPPLIED", orphan.id);
    ok("a SUCCESS with no loan attached is flagged too", !!ox && ox.message.includes("NO loan attached"));

    // Posting the money (what the console's "Apply to loan" does) heals it.
    await ctx(() => allocateRepayment(loan1.id, 2000, "STK:RCPT-LOST-1"));
    await reconcileOrg(org.id);
    [sx] = await exOf("STK_SUCCESS_UNAPPLIED", intent.id);
    ok("posting the money self-heals the exception", sx.status === "RESOLVED");

    console.log("\n6. Disbursement disagreements");
    const loanStuck = await mkLoan(4000, "ACTIVE");
    await ctx(() => prisma.disbursement.create({
      data: {
        orgId: org.id, loanId: loanStuck.id, amount: D(4000), phone: borrower.phone,
        state: "SENT", updatedAt: new Date(Date.now() - 2 * 86_400_000),
      },
    }));
    const loanNoMoney = await mkLoan(6000, "ACTIVE"); // live loan, FAILED payout
    await ctx(() => prisma.disbursement.create({
      data: { orgId: org.id, loanId: loanNoMoney.id, amount: D(6000), phone: borrower.phone, state: "FAILED", failReason: "B2C rejected" },
    }));
    const loanNotLive = await mkLoan(8000, "PENDING_DISBURSEMENT"); // money left, book asleep
    await ctx(() => prisma.disbursement.create({
      data: { orgId: org.id, loanId: loanNotLive.id, amount: D(8000), phone: borrower.phone, state: "CONFIRMED", receiptRef: "B2C-OK-2" },
    }));
    const loanShort = await mkLoan(6000, "PENDING_DISBURSEMENT"); // payout ≠ principal
    const disbShort = await ctx(() => prisma.disbursement.create({
      data: { orgId: org.id, loanId: loanShort.id, amount: D(5000), phone: borrower.phone, state: "PENDING_CHECKER" },
    }));
    await ctx(() => prisma.disbursement.update({ where: { id: disbShort.id }, data: { state: "CONFIRMED" } }));

    await reconcileOrg(org.id);
    ok("a payout silent for two days is stuck", (await exOf("DISB_STUCK")).length === 1);
    const mismatches = await exOf("DISB_LOAN_STATE_MISMATCH");
    ok("a live loan with a failed payout is flagged",
      mismatches.some((m) => m.reference === loanNoMoney.id && m.message.includes("no confirmed payout")));
    ok("money out with the loan never activated is flagged",
      mismatches.some((m) => m.reference === loanNotLive.id && m.message.includes("never activated")));
    const amounts = await exOf("DISB_AMOUNT_MISMATCH");
    // Both loanShort (5000 vs 6000) and... loanShort's CONFIRMED+PENDING loan also
    // trips the state mismatch — expected: two different questions about one loan.
    ok("a payout that differs from principal is flagged, with the difference",
      amounts.some((a) => a.reference === disbShort.id && Number(a.amountKes) === -1000));

    console.log("\n7. One receipt, two payments");
    await ctx(async () => {
      await prisma.paymentIntent.create({ data: { orgId: org.id, phone: "254712000222", amount: D(900), state: "SUCCESS", mpesaReceipt: "RCPT-DOUBLE", checkoutRequestId: `ws_${slug}_3` } });
      await prisma.paymentIntent.create({ data: { orgId: org.id, phone: "254712000222", amount: D(900), state: "SUCCESS", mpesaReceipt: "RCPT-DOUBLE", checkoutRequestId: `ws_${slug}_4` } });
      // Mark them posted so the duplicate check is what speaks, not the STK check.
      await allocateRepayment(loan1.id, 900, "STK:RCPT-DOUBLE");
    });
    await reconcileOrg(org.id);
    const dups = await exOf("DUP_RECEIPT", "RCPT-DOUBLE");
    ok("the duplicate receipt is flagged once, HIGH", dups.length === 1 && dups[0].severity === "HIGH");
    ok("with how many times it settled", ((dups[0].meta as { occurrences?: number })?.occurrences) === 2);

    console.log("\n8. The float ledger must agree with itself");
    await ctx(async () => {
      await prisma.floatLedger.create({ data: { orgId: org.id, kind: "TOPUP", amount: D(10000), balanceAfter: D(10000) } });
      await prisma.floatLedger.create({ data: { orgId: org.id, kind: "DISBURSE", amount: D(-4000), balanceAfter: D(5000) } }); // wrong: should be 6000
    });
    await reconcileOrg(org.id);
    const [fd] = await exOf("FLOAT_DRIFT", "float");
    ok("drift detected with the gap", !!fd && Number(fd.amountKes) === -1000, fd?.message);

    console.log("\n9. The webhook path: raise now, not tonight");
    await raiseException(org.id, {
      kind: "C2B_UNALLOCATED", reference: "evt-test-1", severity: "HIGH",
      amountKes: 111, message: "raised from a webhook", meta: {},
    });
    await raiseException(org.id, {
      kind: "C2B_UNALLOCATED", reference: "evt-test-1", severity: "HIGH",
      amountKes: 111, message: "raised twice", meta: {},
    });
    const evt = await exOf("C2B_UNALLOCATED", "evt-test-1");
    ok("raising twice is one row", evt.length === 1);
    ok("the first message stands (upsert bumps lastSeenAt, not the story)", evt[0].message === "raised from a webhook");

    console.log("\n10. Tenant isolation");
    const crossCount = await runWithOrg(orgB.id, () =>
      prisma.reconciliationException.count({ where: { orgId: org.id } }));
    ok("org B sees none of org A's exceptions", crossCount === 0);
  } finally {
    await runAsPlatform(async () => {
      for (const o of [org, orgB]) {
        await prisma.reconciliationException.deleteMany({ where: { orgId: o.id } });
        await prisma.floatLedger.deleteMany({ where: { orgId: o.id } });
        await prisma.disbursement.deleteMany({ where: { orgId: o.id } });
        await prisma.c2BReceipt.deleteMany({ where: { orgId: o.id } });
        await prisma.paymentIntent.deleteMany({ where: { orgId: o.id } });
        await prisma.smsMessage.deleteMany({ where: { orgId: o.id } });
        await prisma.usageEvent.deleteMany({ where: { orgId: o.id } });
        await prisma.auditLog.deleteMany({ where: { orgId: o.id } });
        await prisma.installment.deleteMany({ where: { orgId: o.id } });
        await prisma.loan.deleteMany({ where: { orgId: o.id } });
        await prisma.product.deleteMany({ where: { orgId: o.id } });
        await prisma.borrower.deleteMany({ where: { orgId: o.id } });
        await prisma.orgSubscription.deleteMany({ where: { orgId: o.id } });
        await prisma.org.delete({ where: { id: o.id } });
      }
    });
    console.log(`\n${pass} passed, ${fail} failed`);
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
