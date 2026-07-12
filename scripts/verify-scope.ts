// Tests for DATA SCOPE — the organisational structure, and who may see whose book.
//
//   npm run test:scope        (needs the database; no app server)
//
// The claims under test, each one a way this could leak a book or lose one:
//
//   THE TREE — a regional manager's visibility is literally the subtree beneath the
//     node they sit at. Descendants resolve; a CYCLE in the tree does not hang the walk.
//   OWN — an officer sees the customers they registered and NOT their colleague's, even
//     though the two hold identical rights.
//   BRANCH / BRANCH_TREE — a branch manager sees their branch; a regional manager sees
//     every branch under their region, and nothing above it.
//   IT DEFAULTS OPEN, NOT SHUT — a role with no scope, and a staff member with no
//     branch, keep the visibility they had before scopes existed. Narrowing is
//     deliberate. (A visibility boundary that fails closed empties an officer's screen
//     and reads as data loss; that is a worse failure than the one it prevents, and it
//     is NOT the tenancy boundary — RLS is, and that one does fail closed.)
//   THE DRILL-THROUGH IS FENCED TOO — canSeeBorrower refuses an id the scope may not
//     see. A list that filters while the detail page renders anything is a speed bump.
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { runAsPlatform, runWithOrg } from "@/lib/db/context";
import {
  resolveScope, descendantBranchIds, headOfficeId, invalidateBranchTree,
  borrowerScopeWhere, applicationScopeWhere, loanScopeWhere, canSeeBorrower, originStamp,
  type ResolvedScope,
} from "@/lib/rbac/scope";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};
const section = (s: string) => console.log(`\n${s}`);

/** A session as the app would see it for this staff member. */
const sessionFor = (orgId: string, staffId: string) => ({ user: { id: staffId, orgId } });

async function main() {
  const stamp = Date.now();
  const org = await runAsPlatform(() => prisma.org.create({
    data: { slug: `scopetest-${stamp}`, name: "Scope Test", plan: "PREMIUM", mode: "NATIVE", status: "ACTIVE" },
  }));
  const ctx = <T>(fn: () => Promise<T>) => runWithOrg(org.id, fn);

  try {
    // ── The structure ─────────────────────────────────────────────────────────
    section("1. The tree");

    const { hq, region, cbd, westlands, otherRegion, officerRole, managerRole, regionalRole, adminRole, brian, grace, carol, regina, amina, product } =
      await ctx(async () => {
        const hq = await prisma.branch.create({ data: { orgId: org.id, name: "Head Office", levelName: "Head Office" } });
        const region = await prisma.branch.create({ data: { orgId: org.id, name: "Nairobi Region", levelName: "Region", parentId: hq.id } });
        const cbd = await prisma.branch.create({ data: { orgId: org.id, name: "CBD", levelName: "Branch", parentId: region.id } });
        const westlands = await prisma.branch.create({ data: { orgId: org.id, name: "Westlands", levelName: "Branch", parentId: region.id } });
        // A second region, so "sees everything under MY region" is a real claim rather
        // than "sees everything, and there happened to be nothing else".
        const otherRegion = await prisma.branch.create({ data: { orgId: org.id, name: "Coast Region", levelName: "Region", parentId: hq.id } });
        const mombasa = await prisma.branch.create({ data: { orgId: org.id, name: "Mombasa", levelName: "Branch", parentId: otherRegion.id } });

        const rights = ["borrowers.view", "applications.view", "loans.view"];
        const officerRole = await prisma.role.create({ data: { orgId: org.id, title: "Officer", rights, menu: rights, dataScope: "OWN" } });
        const managerRole = await prisma.role.create({ data: { orgId: org.id, title: "Branch Manager", rights, menu: rights, dataScope: "BRANCH" } });
        const regionalRole = await prisma.role.create({ data: { orgId: org.id, title: "Regional", rights, menu: rights, dataScope: "BRANCH_TREE" } });
        const adminRole = await prisma.role.create({ data: { orgId: org.id, title: "Admin", rights: ["*"], menu: ["*"], dataScope: "ORG" } });

        const mk = (email: string, first: string, roleId: string, branchId: string) =>
          prisma.staffUser.create({ data: { orgId: org.id, email, firstName: first, roleId, branchId, status: "ACTIVE" } });

        const brian = await mk(`brian@${stamp}.test`, "Brian", officerRole.id, cbd.id);
        const grace = await mk(`grace@${stamp}.test`, "Grace", officerRole.id, westlands.id);
        const carol = await mk(`carol@${stamp}.test`, "Carol", managerRole.id, cbd.id);
        const regina = await mk(`regina@${stamp}.test`, "Regina", regionalRole.id, region.id);
        const amina = await mk(`amina@${stamp}.test`, "Amina", adminRole.id, hq.id);

        const product = await prisma.product.create({
          data: { orgId: org.id, name: "Test", minPrincipal: 1000, maxPrincipal: 99999, interestRate: 10, repaymentPeriod: 4 },
        });
        return { hq, region, cbd, westlands, otherRegion, mombasa, officerRole, managerRole, regionalRole, adminRole, brian, grace, carol, regina, amina, product };
      });

    const root = await headOfficeId(org.id);
    ok("the head office is the root of the tree", root === hq.id);

    const under = await descendantBranchIds(org.id, region.id);
    ok("a region resolves to itself + its branches", under.length === 3 && under.includes(cbd.id) && under.includes(westlands.id), `${under.length} nodes`);
    ok("…and NOT to a sibling region's branches", !under.includes(otherRegion.id));

    const all = await descendantBranchIds(org.id, hq.id);
    ok("the head office resolves to every node", all.length === 6, `${all.length} nodes`);

    // ── The book: Brian owns 2 in CBD, Grace owns 1 in Westlands ──────────────
    section("2. Whose customers");

    const { bBorrower1, gBorrower } = await ctx(async () => {
      const mkBorrower = async (name: string, phone: string, ownerId: string, branchId: string) => {
        const b = await prisma.borrower.create({
          data: { orgId: org.id, phone, firstName: name, createdById: ownerId, branchId },
        });
        await prisma.loanApplication.create({
          data: { orgId: org.id, borrowerId: b.id, productId: product.id, amountRequested: 10000, status: "OFFICER_REVIEW", officerId: ownerId, branchId },
        });
        await prisma.loan.create({
          data: {
            orgId: org.id, borrowerId: b.id, productId: product.id, principal: 10000, interest: 1000,
            loanAmount: 11000, balance: 10000, status: "ACTIVE", createdBy: ownerId, branchId,
          },
        });
        return b;
      };
      const bBorrower1 = await mkBorrower("BrianCustomerOne", `2547${stamp}`.slice(0, 12), brian.id, cbd.id);
      await mkBorrower("BrianCustomerTwo", `2548${stamp}`.slice(0, 12), brian.id, cbd.id);
      const gBorrower = await mkBorrower("GraceCustomer", `2549${stamp}`.slice(0, 12), grace.id, westlands.id);
      return { bBorrower1, gBorrower };
    });

    const countFor = async (staffId: string) => {
      const scope = await resolveScope(sessionFor(org.id, staffId));
      return ctx(async () => ({
        scope,
        borrowers: await prisma.borrower.count({ where: { orgId: org.id, ...borrowerScopeWhere(scope) } }),
        apps: await prisma.loanApplication.count({ where: { orgId: org.id, ...applicationScopeWhere(scope) } }),
        loans: await prisma.loan.count({ where: { orgId: org.id, ...loanScopeWhere(scope) } }),
      }));
    };

    const brianSees = await countFor(brian.id);
    ok("OWN: Brian sees only the 2 customers he registered", brianSees.scope.kind === "OWN" && brianSees.borrowers === 2, `${brianSees.borrowers} borrowers`);
    ok("…and only his own applications and loans", brianSees.apps === 2 && brianSees.loans === 2);

    const graceSees = await countFor(grace.id);
    ok("OWN: Grace — same rights, same role — sees only her 1", graceSees.borrowers === 1, `${graceSees.borrowers} borrower`);

    const carolSees = await countFor(carol.id);
    ok("BRANCH: Carol sees CBD's 2, not Westlands'", carolSees.scope.kind === "BRANCH" && carolSees.borrowers === 2, `${carolSees.borrowers} borrowers`);

    const reginaSees = await countFor(regina.id);
    ok("BRANCH_TREE: Regina sees BOTH branches under her region", reginaSees.scope.kind === "BRANCH_TREE" && reginaSees.borrowers === 3, `${reginaSees.borrowers} borrowers`);

    const aminaSees = await countFor(amina.id);
    ok("ORG: the admin sees the whole book", aminaSees.scope.unrestricted && aminaSees.borrowers === 3, `${aminaSees.borrowers} borrowers`);

    // ── The drill-through ─────────────────────────────────────────────────────
    section("3. The detail page is fenced too, not just the list");

    const brianScope = await resolveScope(sessionFor(org.id, brian.id));
    ok("Brian may open his own customer", await ctx(() => canSeeBorrower(brianScope, bBorrower1.id)));
    ok("Brian may NOT open Grace's customer by typing the id", !(await ctx(() => canSeeBorrower(brianScope, gBorrower.id))));

    const reginaScope = await resolveScope(sessionFor(org.id, regina.id));
    ok("Regina may open a customer in either of her branches", await ctx(() => canSeeBorrower(reginaScope, gBorrower.id)));

    // ── Failing OPEN, deliberately ────────────────────────────────────────────
    section("4. It defaults to the visibility that existed before it");

    const noRole = await ctx(() => prisma.staffUser.create({
      data: { orgId: org.id, email: `norole@${stamp}.test`, firstName: "NoRole", branchId: cbd.id, status: "ACTIVE" },
    }));
    const noRoleScope = await resolveScope(sessionFor(org.id, noRole.id));
    ok("a staff member with NO role keeps ORG visibility (never a silent lockout)", noRoleScope.unrestricted);

    // A branch-shaped scope with no branch cannot be filtered by branch. Widening to ORG
    // would leak; emptying the screen would look like data loss. OWN is always true of them.
    const homeless = await ctx(() => prisma.staffUser.create({
      data: { orgId: org.id, email: `homeless@${stamp}.test`, firstName: "Homeless", roleId: managerRole.id, status: "ACTIVE" },
    }));
    const homelessScope = await resolveScope(sessionFor(org.id, homeless.id));
    ok("a BRANCH-scoped staff member with no branch falls back to OWN, not to ORG", homelessScope.kind === "OWN" && !homelessScope.unrestricted);

    const impersonated = await resolveScope({
      user: { id: brian.id, orgId: org.id, impersonator: { platformAdminId: "x", name: "Founder" } },
    });
    ok("an impersonating platform admin sees everything (that is why they are there)", impersonated.unrestricted);

    // ── The cycle guard ───────────────────────────────────────────────────────
    section("5. A cycle in the tree must not hang the walk");

    // Force a loop straight into the database, bypassing the API's guard — this is the
    // state a bad migration or a hand-edited row could leave behind, and the walker has
    // to survive it rather than spin forever.
    await ctx(() => prisma.branch.update({ where: { id: region.id }, data: { parentId: cbd.id } }));
    invalidateBranchTree(org.id);
    const looped = await Promise.race([
      descendantBranchIds(org.id, region.id),
      new Promise<string[]>((_, rej) => setTimeout(() => rej(new Error("hung")), 3000)),
    ]).catch(() => null);
    ok("descendantBranchIds terminates on a cyclic tree", looped !== null, looped ? `${looped.length} nodes, no hang` : "HUNG");
    await ctx(() => prisma.branch.update({ where: { id: region.id }, data: { parentId: hq.id } }));
    invalidateBranchTree(org.id);

    // ── The stamp ─────────────────────────────────────────────────────────────
    section("6. The origin stamp");

    const walkIn = await ctx(() => originStamp(org.id, { id: brian.id, branchId: cbd.id }));
    ok("a walk-in is owned by the officer who registered them", walkIn.staffId === brian.id && walkIn.branchId === cbd.id);

    const portal = await ctx(() => originStamp(org.id, null));
    ok("a portal borrower has no officer and lands at the head office, never nowhere", portal.staffId === null && portal.branchId === hq.id);
  } finally {
    await runAsPlatform(async () => {
      const w = { orgId: org.id };
      await prisma.loan.deleteMany({ where: w });
      await prisma.loanApplication.deleteMany({ where: w });
      await prisma.borrower.deleteMany({ where: w });
      await prisma.product.deleteMany({ where: w });
      await prisma.staffUser.deleteMany({ where: w });
      await prisma.role.deleteMany({ where: w });
      await prisma.auditLog.deleteMany({ where: w });
      await prisma.orgSubscription.deleteMany({ where: w });
      // Children before parents, or the FK on parentId blocks the delete.
      for (let i = 0; i < 5; i++) {
        const leaves = await prisma.branch.findMany({ where: { orgId: org.id }, select: { id: true, parentId: true } });
        const parents = new Set(leaves.map((b) => b.parentId).filter(Boolean));
        const deletable = leaves.filter((b) => !parents.has(b.id)).map((b) => b.id);
        if (!deletable.length) break;
        await prisma.branch.deleteMany({ where: { id: { in: deletable } } });
      }
      await prisma.org.delete({ where: { id: org.id } });
    });
    console.log("\nfixtures cleaned up");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
