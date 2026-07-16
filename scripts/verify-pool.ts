// Tests for the CROSS-ENTITY SHARING POOL — the group's one borrower reality.
//
//   npm run test:pool        (needs the database; no app server)
//
// The claims under test, each one a way this could either leak a book or lend
// money the group shouldn't:
//
//   THE GATE — a borrower with a RUNNING loan at a sibling entity is blocked,
//     matched by national ID and, separately, by phone (the funnel's own
//     last-9-digits rule). A CLEARED loan does not block. A stranger does not
//     block. An org in NO pool sees nothing and blocks nothing.
//   THE FENCE HOLDS ELSEWHERE — pool search only surfaces SIBLINGS' customers,
//     never a non-member org's, and never balances (the shape itself is checked).
//   THE IMPORT — brings identity + KYC standing across, is idempotent (a local
//     twin is returned, never duplicated), and refuses a borrower outside the
//     caller's pool.
//   THE EXIT — deleteTenant removes the membership row but leaves the pool and
//     the surviving sibling's membership intact.
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { runAsPlatform, runWithOrg } from "@/lib/db/context";
import { poolFor, activeLoanElsewhere, searchPool, importFromPool } from "@/lib/pool/pool";
import { deleteTenant } from "@/lib/compliance/tenant";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};
const section = (s: string) => console.log(`\n${s}`);

async function main() {
  const stamp = Date.now();
  const mkOrg = (slug: string, name: string) =>
    runAsPlatform(() => prisma.org.create({ data: { slug: `${slug}-${stamp}`, name, plan: "PREMIUM", mode: "NATIVE", status: "ACTIVE" } }));

  // Three orgs: two in the pool (micro + axe), one outsider.
  const [micro, axe, outsider] = await Promise.all([
    mkOrg("pooltest-micro", "Micro Test"), mkOrg("pooltest-axe", "Axe Test"), mkOrg("pooltest-out", "Outsider Test"),
  ]);

  const pool = await runAsPlatform(() => prisma.sharingPool.create({
    data: {
      name: `Pool Test Group ${stamp}`,
      legalBasis: "Test basis: onboarding consent + DPA 2019 s.30(1)(b)(f).",
      members: { create: [{ orgId: micro.id }, { orgId: axe.id }] },
    },
  }));

  try {
    // Fixtures on MICRO's book: one borrower with a running loan, one cleared.
    const { runner, cleared } = await runWithOrg(micro.id, async () => {
      const product = await prisma.product.create({
        data: { orgId: micro.id, name: "Pool Test", minPrincipal: 1000, maxPrincipal: 100000, interestRate: 10, repaymentPeriod: 4 },
      });
      const runner = await prisma.borrower.create({
        data: { orgId: micro.id, phone: "254711002200", nationalId: `4040${stamp % 10000}`, firstName: "Achieng", otherName: "Runner", kycStatus: "VERIFIED", kycVerifiedAt: new Date() },
      });
      const cleared = await prisma.borrower.create({
        data: { orgId: micro.id, phone: "254711002201", nationalId: `4041${stamp % 10000}`, firstName: "Baraka", otherName: "Cleared" },
      });
      const mkLoan = (borrowerId: string, status: "ACTIVE" | "CLEARED") =>
        prisma.loan.create({ data: { orgId: micro.id, borrowerId, productId: product.id, principal: 10000, interest: 1000, loanAmount: 11000, balance: status === "ACTIVE" ? 11000 : 0, status, borrowDate: new Date() } });
      await mkLoan(runner.id, "ACTIVE");
      await mkLoan(cleared.id, "CLEARED");
      return { runner, cleared };
    });

    section("1. Membership resolves — and only for members");
    const axePool = await poolFor(axe.id);
    ok("axe sees its pool", axePool?.name === pool.name);
    ok("axe's sibling is micro, not itself", axePool?.siblings.length === 1 && axePool.siblings[0].orgId === micro.id);
    ok("the legal basis rides along", (axePool?.legalBasis ?? "").includes("DPA 2019"));
    ok("the outsider has no pool", (await poolFor(outsider.id)) === null);

    section("2. The gate: a running loan at a sibling blocks");
    const byId = await activeLoanElsewhere(axe.id, { nationalId: runner.nationalId });
    ok("blocked by national ID", byId.blocked && byId.lender === "Micro Test", JSON.stringify(byId));
    const byPhone = await activeLoanElsewhere(axe.id, { phone: "0711002200" }); // local format — last-9 match
    ok("blocked by phone, any format", byPhone.blocked && byPhone.lender === "Micro Test");
    ok("the refusal carries the legal basis", byId.blocked && byId.legalBasis.includes("DPA 2019"));
    ok("a CLEARED loan does not block", !(await activeLoanElsewhere(axe.id, { nationalId: cleared.nationalId })).blocked);
    ok("a stranger does not block", !(await activeLoanElsewhere(axe.id, { phone: "254799999999" })).blocked);
    ok("no identity, no verdict", !(await activeLoanElsewhere(axe.id, {})).blocked);
    ok("an org outside the pool is never blocked", !(await activeLoanElsewhere(outsider.id, { nationalId: runner.nationalId })).blocked);
    ok("micro is not blocked by its OWN borrower", !(await activeLoanElsewhere(micro.id, { nationalId: runner.nationalId })).blocked);

    section("3. Pool search: siblings only, minimal shape");
    const found = await searchPool(axe.id, "Achieng");
    ok("axe finds micro's customer", found?.customers.some((c) => c.name.includes("Achieng")) ?? false);
    const hit = found!.customers.find((c) => c.name.includes("Achieng"))!;
    ok("the hit names its source entity", hit.sourceOrg.name === "Micro Test");
    ok("the hit carries the running-loan flag", hit.activeLoansThere === 1);
    ok("KYC standing rides along", hit.kycVerified === true);
    ok("no balance in the shape", !("balance" in hit) && !("olb" in hit));
    ok("not yet on axe's book", hit.alreadyLocal === false);
    ok("the outsider's search finds nothing", (await searchPool(outsider.id, "Achieng")) === null);
    ok("micro does not find its own row via the pool", !((await searchPool(micro.id, "Achieng"))?.customers.some((c) => c.name.includes("Achieng")) ?? false));

    section("4. The import: identity travels, once");
    const imp = await runWithOrg(axe.id, () => importFromPool(axe.id, hit.sourceBorrowerId));
    ok("import succeeds", imp.ok && imp.imported, JSON.stringify(imp));
    const copy = imp.ok ? await runWithOrg(axe.id, () => prisma.borrower.findFirst({ where: { id: imp.borrowerId } })) : null;
    ok("identity came across", copy?.firstName === "Achieng" && copy?.nationalId === runner.nationalId);
    ok("KYC standing mirrored, artifacts did NOT", copy?.kycStatus === "VERIFIED" && copy?.selfieKey == null && copy?.idFrontKey == null);
    const again = await runWithOrg(axe.id, () => importFromPool(axe.id, hit.sourceBorrowerId));
    ok("importing twice returns the same local row", again.ok && !again.imported && again.borrowerId === (imp.ok ? imp.borrowerId : ""));
    ok("…and the search now flags them local", (await searchPool(axe.id, "Achieng"))!.customers.find((c) => c.sourceBorrowerId === hit.sourceBorrowerId)!.alreadyLocal === true);
    const foreign = await runWithOrg(outsider.id, () => importFromPool(outsider.id, hit.sourceBorrowerId));
    ok("an outsider cannot import from the pool", !foreign.ok);

    section("5. Leaving: deleteTenant removes the membership, not the pool");
    await runAsPlatform(() => deleteTenant(micro.id));
    const after = await runAsPlatform(() => prisma.sharingPool.findUnique({ where: { id: pool.id }, include: { members: true } }));
    ok("micro's membership is gone", !after?.members.some((m) => m.orgId === micro.id));
    ok("the pool and axe's membership survive", after != null && after.members.some((m) => m.orgId === axe.id));
    ok("axe now has no siblings, so nothing blocks", !(await activeLoanElsewhere(axe.id, { nationalId: runner.nationalId })).blocked);
  } finally {
    // Teardown: the two surviving orgs (micro is already gone) and the pool.
    await runAsPlatform(() => deleteTenant(axe.id)).catch(() => {});
    await runAsPlatform(() => deleteTenant(outsider.id)).catch(() => {});
    await runAsPlatform(() => prisma.sharingPool.deleteMany({ where: { id: pool.id } })).catch(() => {});
    console.log("\nfixtures cleaned up");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
