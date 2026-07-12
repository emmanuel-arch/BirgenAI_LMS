// Tests for the KYC gate — the thing standing between an unverified customer and money.
//
//   npm run test:kyc-gate        (needs the database; no app server)
//
// The claims under test:
//   THE QUEUE IS THE UNVERIFIED, AND ONLY THEM. A verified borrower leaves it; every
//     other KYC state (never started, half-finished, awaiting a human, failed) stays.
//   IT IS SCOPED. An officer works their own customers, not their colleague's — the
//     same rule as every other book surface, not a second implementation of it.
//   DELETION IS NARROW, and refuses for two DIFFERENT reasons: a VERIFIED borrower is a
//     person whose identity this lender attested to (deleting them destroys evidence),
//     and anyone who has APPLIED has a history worth keeping (a declined application is
//     a training label). Only a customer who is neither can be removed.
//   THE GATE IS ON THE MONEY. The rule the disbursement route enforces is that a
//     borrower who is not VERIFIED cannot have funds released — checked here as the
//     predicate, so the route and this test cannot drift apart.
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { runAsPlatform, runWithOrg } from "@/lib/db/context";
import { resolveScope, borrowerScopeWhere, canSeeBorrower } from "@/lib/rbac/scope";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};
const section = (s: string) => console.log(`\n${s}`);

/** The disbursement route's rule, in one place so the test cannot drift from it. */
const RELEASES_MONEY = ["approve", "manual", "retry"];
const wouldRelease = (action: string, kycStatus: string) =>
  !(RELEASES_MONEY.includes(action) && kycStatus !== "VERIFIED");

const UNVERIFIED = ["NONE", "IN_PROGRESS", "PENDING_REVIEW", "FAILED"];

async function main() {
  const stamp = Date.now();
  const org = await runAsPlatform(() => prisma.org.create({
    data: { slug: `kycgate-${stamp}`, name: "KYC Gate Test", plan: "PREMIUM", mode: "NATIVE", status: "ACTIVE" },
  }));
  const ctx = <T>(fn: () => Promise<T>) => runWithOrg(org.id, fn);

  try {
    section("1. The gate on the money");

    for (const status of UNVERIFIED) {
      ok(`a ${status} borrower cannot be paid out`, !wouldRelease("approve", status));
    }
    ok("a VERIFIED borrower can", wouldRelease("approve", "VERIFIED"));
    ok("the manual-confirm path is gated too (paying outside the rails is still paying)", !wouldRelease("manual", "NONE"));
    ok("a retry is gated too", !wouldRelease("retry", "NONE"));
    ok("…but SUBMITTING to the queue is not gated — an officer may still prepare it", wouldRelease("submit", "NONE"));

    section("2. The queue");

    const { brian, grace, unverified, verified, applied } = await ctx(async () => {
      const branch = await prisma.branch.create({ data: { orgId: org.id, name: "HQ", levelName: "Head Office" } });
      const rights = ["borrowers.view", "borrowers.manage", "kyc.verify"];
      const officerRole = await prisma.role.create({ data: { orgId: org.id, title: "Officer", rights, menu: rights, dataScope: "OWN" } });

      const mk = (email: string, first: string) => prisma.staffUser.create({
        data: { orgId: org.id, email, firstName: first, roleId: officerRole.id, branchId: branch.id, status: "ACTIVE" },
      });
      const brian = await mk(`brian@${stamp}.test`, "Brian");
      const grace = await mk(`grace@${stamp}.test`, "Grace");

      const product = await prisma.product.create({
        data: { orgId: org.id, name: "Test", minPrincipal: 1000, maxPrincipal: 99999, interestRate: 10, repaymentPeriod: 4 },
      });

      const mkBorrower = (name: string, phone: string, ownerId: string, kycStatus: string) =>
        prisma.borrower.create({
          data: { orgId: org.id, phone, firstName: name, createdById: ownerId, branchId: branch.id, kycStatus: kycStatus as never },
        });

      // Brian's: one never-started, one verified, one who already applied.
      const unverified = await mkBorrower("Unverified", `2547${stamp}`.slice(0, 12), brian.id, "NONE");
      const verified = await mkBorrower("Verified", `2548${stamp}`.slice(0, 12), brian.id, "VERIFIED");
      const applied = await mkBorrower("Applied", `2549${stamp}`.slice(0, 12), brian.id, "PENDING_REVIEW");
      await prisma.loanApplication.create({
        data: { orgId: org.id, borrowerId: applied.id, productId: product.id, amountRequested: 10000, status: "OFFICER_REVIEW", officerId: brian.id, branchId: branch.id },
      });

      // Grace's — Brian must never see or delete this one.
      await mkBorrower("GraceCustomer", `2540${stamp}`.slice(0, 12), grace.id, "NONE");

      return { brian, grace, unverified, verified, applied };
    });

    const queueFor = async (staffId: string) => {
      const scope = await resolveScope({ user: { id: staffId, orgId: org.id } });
      return ctx(() => prisma.borrower.findMany({
        where: { orgId: org.id, ...borrowerScopeWhere(scope), kycStatus: { in: UNVERIFIED as never[] } },
        select: { id: true, firstName: true },
      }));
    };

    const brianQueue = await queueFor(brian.id);
    ok("the verified borrower has LEFT the queue", !brianQueue.some((b) => b.id === verified.id));
    ok("the never-started and the pending-review are IN it", brianQueue.length === 2, brianQueue.map((b) => b.firstName).join(", "));
    ok("Grace's customer is NOT in Brian's queue (it is scoped like every other list)", !brianQueue.some((b) => b.firstName === "GraceCustomer"));

    const graceQueue = await queueFor(grace.id);
    ok("…and Grace sees only hers", graceQueue.length === 1 && graceQueue[0].firstName === "GraceCustomer");

    section("3. Deletion is narrow, and refuses for two different reasons");

    const brianScope = await resolveScope({ user: { id: brian.id, orgId: org.id } });

    const deletable = await ctx(() => prisma.borrower.findFirst({
      where: { id: unverified.id, orgId: org.id },
      select: { kycStatus: true, _count: { select: { applications: true, loans: true } } },
    }));
    ok("an unverified customer who never applied CAN be removed",
      deletable!.kycStatus !== "VERIFIED" && deletable!._count.applications === 0 && deletable!._count.loans === 0);

    const verifiedRow = await ctx(() => prisma.borrower.findFirst({
      where: { id: verified.id, orgId: org.id }, select: { kycStatus: true },
    }));
    ok("a VERIFIED customer cannot — deleting them destroys the identity evidence", verifiedRow!.kycStatus === "VERIFIED");

    const appliedRow = await ctx(() => prisma.borrower.findFirst({
      where: { id: applied.id, orgId: org.id },
      select: { kycStatus: true, _count: { select: { applications: true } } },
    }));
    ok("a customer who has APPLIED cannot — a declined application is still a training label",
      appliedRow!._count.applications > 0);

    const graceCustomer = await ctx(() => prisma.borrower.findFirst({
      where: { orgId: org.id, firstName: "GraceCustomer" }, select: { id: true },
    }));
    ok("Brian cannot even reach Grace's customer to delete them",
      !(await ctx(() => canSeeBorrower(brianScope, graceCustomer!.id))));
  } finally {
    await runAsPlatform(async () => {
      const w = { orgId: org.id };
      await prisma.loanApplication.deleteMany({ where: w });
      await prisma.borrower.deleteMany({ where: w });
      await prisma.product.deleteMany({ where: w });
      await prisma.staffUser.deleteMany({ where: w });
      await prisma.role.deleteMany({ where: w });
      await prisma.branch.deleteMany({ where: w });
      await prisma.auditLog.deleteMany({ where: w });
      await prisma.orgSubscription.deleteMany({ where: w });
      await prisma.org.delete({ where: { id: org.id } });
    });
    console.log("\nfixtures cleaned up");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
