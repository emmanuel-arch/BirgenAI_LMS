// Tests for collections — the arrears work queue, promises to pay, tickets.
//
//   npm run test:collections        (needs the database; no app server)
//
// The claims under test, each one a way this module could lie:
//   • The queue is DERIVED — an overdue loan appears with the right days-past-due
//     and amount, a healthy loan never does, and fresh arrears sort first.
//   • A promise resolves by the MONEY: allocated paybill receipts + successful
//     STK payments, deduplicated by M-Pesa receipt, measured only from the
//     moment the promise was taken. KEPT / PARTIAL / BROKEN are arithmetic.
//   • One pending promise per loan — a new one supersedes the old with a trail.
//   • Resolution is idempotent and never touches future-dated promises.
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { runAsPlatform, runWithOrg } from "@/lib/db/context";
import { collectionsQueue, bucketOf } from "@/lib/collections/queue";
import { paidSince, takePromise, resolveDuePromises } from "@/lib/collections/ptp";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};

const D = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000);

async function main() {
  const slug = `colltest-${Date.now()}`;
  const org = await runAsPlatform(() => prisma.org.create({
    data: { slug, name: "Collections Test", plan: "STARTER", mode: "NATIVE", status: "ACTIVE" },
  }));
  console.log(`fixture org ${slug} (${org.id})\n`);
  const ctx = <T>(fn: () => Promise<T>) => runWithOrg(org.id, fn);

  try {
    // ── Fixtures: one overdue loan, one fresh-overdue loan, one healthy loan ──
    const { staff, overdueLoan, freshLoan, healthyLoan, borrower } = await ctx(async () => {
      const staff = await prisma.staffUser.create({
        data: { orgId: org.id, email: `officer@${slug}.test`, firstName: "Okoth", status: "ACTIVE" },
      });
      const product = await prisma.product.create({
        data: {
          orgId: org.id, name: "Test Loan", minPrincipal: 1000, maxPrincipal: 100000,
          interestRate: 10, repaymentPeriod: 4,
        },
      });
      const borrower = await prisma.borrower.create({
        data: { orgId: org.id, phone: "254700000111", firstName: "Wanjiru", otherName: "Test" },
      });
      const mkLoan = async (overdueDaysAgo: number | null) => {
        const loan = await prisma.loan.create({
          data: {
            orgId: org.id, borrowerId: borrower.id, productId: product.id,
            principal: 10000, interest: 1000, loanAmount: 11000, balance: 11000,
            status: "ACTIVE", borrowDate: D(60),
          },
        });
        await prisma.installment.createMany({
          data: [1, 2, 3, 4].map((seq) => ({
            orgId: org.id, loanId: loan.id, seq,
            dueDate: seq === 1 && overdueDaysAgo != null ? D(overdueDaysAgo) : D(-seq * 7),
            amountDue: 2750, principalDue: 2500, interestDue: 250,
            amountPaid: 0,
            penalty: seq === 1 && overdueDaysAgo != null ? 137.5 : 0,
            status: seq === 1 && overdueDaysAgo != null ? "OVERDUE" : "UPCOMING",
          })),
        });
        return loan;
      };
      const overdueLoan = await mkLoan(45); // 45 days past due
      const freshLoan = await mkLoan(3); // 3 days past due — should sort FIRST
      const healthyLoan = await mkLoan(null); // nothing overdue
      return { staff, overdueLoan, freshLoan, healthyLoan, borrower };
    });

    console.log("1. The queue is the book, freshest arrears first");
    const q1 = await ctx(() => collectionsQueue(org.id));
    ok("both overdue loans appear, the healthy one doesn't",
      q1.rows.length === 2 && !q1.rows.some((r) => r.loanId === healthyLoan.id));
    ok("3-day arrears sorts before 45-day arrears", q1.rows[0]?.loanId === freshLoan.id);
    const stale = q1.rows.find((r) => r.loanId === overdueLoan.id)!;
    ok("days-past-due is right", stale.dpd === 45, `dpd ${stale.dpd}`);
    ok("bucket is right", stale.bucket === "31-60" && q1.rows[0].bucket === "1-7");
    ok("amount overdue = due + penalty − paid", stale.amountOverdue === 2750 + 137.5, String(stale.amountOverdue));
    ok("summary counts the book", q1.summary.loansOverdue === 2 && q1.summary.ticketsOpen === 0);
    ok("bucketOf boundaries", bucketOf(7) === "1-7" && bucketOf(8) === "8-30" && bucketOf(30) === "8-30" && bucketOf(31) === "31-60" && bucketOf(61) === "60+");

    console.log("\n2. paidSince measures real money, once");
    await ctx(async () => {
      // A receipt allocated BEFORE the window must not count.
      await prisma.c2BReceipt.create({
        data: { orgId: org.id, transId: "T-EARLY", amount: 999, allocatedLoanId: overdueLoan.id, allocatedAt: D(20), createdAt: D(20) },
      });
      // In-window: an allocated paybill receipt and a successful STK…
      await prisma.c2BReceipt.create({
        data: { orgId: org.id, transId: "T-C2B1", amount: 1000, allocatedLoanId: overdueLoan.id, allocatedAt: D(5), createdAt: D(5) },
      });
      await prisma.paymentIntent.create({
        data: { orgId: org.id, loanId: overdueLoan.id, phone: "254700000111", amount: 500, state: "SUCCESS", mpesaReceipt: "STK-1" },
      });
      // …and the SAME M-Pesa receipt recorded through both channels (DUP_RECEIPT hazard).
      await prisma.c2BReceipt.create({
        data: { orgId: org.id, transId: "DUP-1", amount: 700, allocatedLoanId: overdueLoan.id, allocatedAt: D(2), createdAt: D(2) },
      });
      await prisma.paymentIntent.create({
        data: { orgId: org.id, loanId: overdueLoan.id, phone: "254700000111", amount: 700, state: "SUCCESS", mpesaReceipt: "DUP-1" },
      });
      // A failed STK must never count as money.
      await prisma.paymentIntent.create({
        data: { orgId: org.id, loanId: overdueLoan.id, phone: "254700000111", amount: 5000, state: "FAILED", mpesaReceipt: null },
      });
    });
    const paid = await ctx(() => paidSince(org.id, overdueLoan.id, D(10)));
    ok("counts C2B + STK, dedupes the shared receipt, ignores early + failed", paid === 1000 + 500 + 700, `paid ${paid}`);

    console.log("\n3. Promises: one pending per loan, resolved by arithmetic");
    const p1 = await ctx(() => takePromise({ orgId: org.id, loanId: freshLoan.id, borrowerId: borrower.id, amount: 3000, dueDate: D(-5), createdBy: staff.id }));
    const p2 = await ctx(() => takePromise({ orgId: org.id, loanId: freshLoan.id, borrowerId: borrower.id, amount: 4000, dueDate: D(-5), createdBy: staff.id }));
    const p1row = await ctx(() => prisma.promiseToPay.findUniqueOrThrow({ where: { id: p1.id } }));
    ok("a newer promise supersedes the old (CANCELLED, with the trail saying so)",
      p1row.status === "CANCELLED" && (p1row.note ?? "").includes("Superseded"));
    const pending = await ctx(() => prisma.promiseToPay.count({ where: { orgId: org.id, loanId: freshLoan.id, status: "PENDING" } }));
    ok("exactly one promise is pending", pending === 1);

    // KEPT: promise on overdueLoan for 2000, due yesterday, with 2200 landed after it.
    const kept = await ctx(() => takePromise({ orgId: org.id, loanId: overdueLoan.id, borrowerId: borrower.id, amount: 2000, dueDate: D(1), createdBy: staff.id }));
    await ctx(async () => {
      await prisma.promiseToPay.update({ where: { id: kept.id }, data: { createdAt: D(8) } }); // taken 8 days ago
    });
    // BROKEN: p2 is due D(-5)? No — D(-5) is 5 days in the FUTURE; make a broken one on freshLoan later.
    const broken = await ctx(() => takePromise({ orgId: org.id, loanId: freshLoan.id, borrowerId: borrower.id, amount: 9000, dueDate: D(2), createdBy: staff.id }));
    await ctx(() => prisma.promiseToPay.update({ where: { id: broken.id }, data: { createdAt: D(1) } }));

    const resolutions = await ctx(() => resolveDuePromises(org.id));
    const keptRow = await ctx(() => prisma.promiseToPay.findUniqueOrThrow({ where: { id: kept.id } }));
    const brokenRow = await ctx(() => prisma.promiseToPay.findUniqueOrThrow({ where: { id: broken.id } }));
    ok("a paid promise resolves KEPT with the amount recorded",
      keptRow.status === "KEPT" && Number(keptRow.paidAmount) === 2200, `${keptRow.status} ${keptRow.paidAmount}`);
    ok("an unpaid promise resolves BROKEN", brokenRow.status === "BROKEN" && Number(brokenRow.paidAmount) === 0);
    const p2row = await ctx(() => prisma.promiseToPay.findUniqueOrThrow({ where: { id: p2.id } }));
    ok("p2 was superseded by the broken-test promise, not resolved", p2row.status === "CANCELLED");
    ok("resolution reports what it did", resolutions.length === 2);

    // PARTIAL: some money, not all.
    const partial = await ctx(() => takePromise({ orgId: org.id, loanId: overdueLoan.id, borrowerId: borrower.id, amount: 50000, dueDate: D(1), createdBy: staff.id }));
    await ctx(() => prisma.promiseToPay.update({ where: { id: partial.id }, data: { createdAt: D(8) } }));
    await ctx(() => resolveDuePromises(org.id));
    const partialRow = await ctx(() => prisma.promiseToPay.findUniqueOrThrow({ where: { id: partial.id } }));
    ok("part-paid resolves PARTIAL", partialRow.status === "PARTIAL" && Number(partialRow.paidAmount) === 2200);

    ok("re-running resolution changes nothing (idempotent)", (await ctx(() => resolveDuePromises(org.id))).length === 0);
    const future = await ctx(() => takePromise({ orgId: org.id, loanId: freshLoan.id, borrowerId: borrower.id, amount: 1000, dueDate: D(-10), createdBy: staff.id }));
    await ctx(() => resolveDuePromises(org.id));
    const futureRow = await ctx(() => prisma.promiseToPay.findUniqueOrThrow({ where: { id: future.id } }));
    ok("a future-dated promise stays PENDING", futureRow.status === "PENDING");

    console.log("\n4. The queue wears the human layer");
    await ctx(() => prisma.collectionCall.create({
      data: { orgId: org.id, loanId: freshLoan.id, borrowerId: borrower.id, outcome: "PROMISE_TO_PAY", ptpId: future.id, createdBy: staff.id },
    }));
    await ctx(() => prisma.collectionTicket.create({
      data: { orgId: org.id, borrowerId: borrower.id, loanId: freshLoan.id, kind: "HARDSHIP", title: "Test hardship", createdBy: staff.id },
    }));
    const q2 = await ctx(() => collectionsQueue(org.id));
    const freshRow = q2.rows.find((r) => r.loanId === freshLoan.id)!;
    ok("the open promise shows on the row", freshRow.ptp?.id === future.id && freshRow.ptp?.amount === 1000);
    ok("the last call shows, with the caller's name", freshRow.lastCall?.outcome === "PROMISE_TO_PAY" && freshRow.lastCall?.by === "Okoth");
    ok("open tickets counted on the row and in the summary", freshRow.openTickets === 1 && q2.summary.ticketsOpen === 1);
    ok("summary sees the pending promise", q2.summary.ptpsPending === 1);

    console.log("\n5. Tenant fences hold");
    const other = await runAsPlatform(() => prisma.org.create({ data: { slug: `${slug}-b`, name: "Other", mode: "NATIVE", status: "ACTIVE" } }));
    try {
      const otherQueue = await runWithOrg(other.id, () => collectionsQueue(other.id));
      ok("another org's queue is empty", otherQueue.rows.length === 0 && otherQueue.summary.ptpsPending === 0);
      const cross = await runWithOrg(other.id, () => prisma.promiseToPay.findMany({ where: { orgId: org.id } }));
      ok("RLS hides promises across the fence even when asked directly", cross.length === 0);
    } finally {
      await runAsPlatform(() => prisma.org.delete({ where: { id: other.id } }));
    }
  } finally {
    // Cleanup, children first.
    await runAsPlatform(async () => {
      const w = { orgId: org.id };
      await prisma.collectionCall.deleteMany({ where: w });
      await prisma.collectionTicket.deleteMany({ where: w });
      await prisma.promiseToPay.deleteMany({ where: w });
      await prisma.c2BReceipt.deleteMany({ where: w });
      await prisma.paymentIntent.deleteMany({ where: w });
      await prisma.installment.deleteMany({ where: w });
      await prisma.loan.deleteMany({ where: w });
      await prisma.borrower.deleteMany({ where: w });
      await prisma.product.deleteMany({ where: w });
      await prisma.staffUser.deleteMany({ where: w });
      await prisma.orgSubscription.deleteMany({ where: w });
      await prisma.auditLog.deleteMany({ where: w });
      await prisma.org.delete({ where: { id: org.id } });
    });
    console.log("\nfixture cleaned up");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
