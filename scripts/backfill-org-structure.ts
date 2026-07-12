// Gives every existing lender a head office, and every existing row a home.
//
//   npm run db:backfill:structure        (idempotent — safe to re-run)
//
// Data scope (src/lib/rbac/scope.ts) decides who may see a borrower by asking which
// BRANCH they belong to and WHICH OFFICER registered them. Every row written before
// those columns existed answers "null" to both — and a null branch belongs to no one:
// it is invisible to a branch-scoped manager and to a regional one, so an officer's
// entire back-catalogue would vanish from their manager's screen the moment the lender
// narrowed a role. Nobody would call that a security feature; they would call it "the
// system lost my customers".
//
// So this backfill is not cosmetic. It:
//   1. ensures each org has exactly one ROOT branch (parentId null) — the head office;
//   2. stamps every branch-less staff member, borrower, application and loan to it;
//   3. infers the OWNING OFFICER where the row already knew one (a loan carries
//      `createdBy`; an application can inherit its borrower's officer), and leaves it
//      null otherwise rather than guessing — an unowned borrower sitting at head office
//      is honest, an invented owner is not.
//
// Connects with the SEED/TOOLING client rather than the app one: it deliberately walks
// every tenant, and prisma/seed-client.ts passes `app.platform=on` as a startup
// parameter, which is the only form a connection pooler honours reliably.
import "dotenv/config";
import { platformPrisma } from "../prisma/seed-client";

const prisma = platformPrisma();

async function main() {
  const orgs = await prisma.org.findMany({
    select: { id: true, slug: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`${orgs.length} orgs\n`);

  for (const org of orgs) {
    // 1. The head office. An org with branches but no root (every one of them parented
    // to something that no longer exists) is a broken tree — promote the oldest rather
    // than bolt a second root on beside it.
    let root = await prisma.branch.findFirst({
      where: { orgId: org.id, parentId: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    });

    if (!root) {
      const oldest = await prisma.branch.findFirst({
        where: { orgId: org.id },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true },
      });
      if (oldest) {
        await prisma.branch.update({ where: { id: oldest.id }, data: { parentId: null, levelName: "Head Office" } });
        root = oldest;
        console.log(`  ${org.slug}: promoted "${oldest.name}" to head office`);
      } else {
        root = await prisma.branch.create({
          data: { orgId: org.id, name: "Head Office", levelName: "Head Office", parentId: null },
          select: { id: true, name: true },
        });
        console.log(`  ${org.slug}: created head office`);
      }
    }

    // 2. Staff with no branch belong to the head office — otherwise a BRANCH-scoped role
    // would silently degrade them to OWN (see resolveScope).
    const staffFixed = await prisma.staffUser.updateMany({
      where: { orgId: org.id, branchId: null },
      data: { branchId: root.id },
    });

    // 3. The book. Borrowers first, since applications and loans can inherit from them.
    const borrowersFixed = await prisma.borrower.updateMany({
      where: { orgId: org.id, branchId: null },
      data: { branchId: root.id },
    });

    const apps = await prisma.loanApplication.findMany({
      where: { orgId: org.id, OR: [{ branchId: null }, { officerId: null }] },
      select: { id: true, borrowerId: true, branchId: true, officerId: true },
    });
    let appsFixed = 0;
    for (const app of apps) {
      const b = await prisma.borrower.findUnique({
        where: { id: app.borrowerId },
        select: { branchId: true, createdById: true },
      });
      await prisma.loanApplication.update({
        where: { id: app.id },
        data: {
          branchId: app.branchId ?? b?.branchId ?? root.id,
          officerId: app.officerId ?? b?.createdById ?? null,
        },
      });
      appsFixed++;
    }

    // A loan already knows who booked it (`createdBy`); it only needs a branch, and the
    // truest one is the branch that officer belongs to.
    const loans = await prisma.loan.findMany({
      where: { orgId: org.id, branchId: null },
      select: { id: true, createdBy: true },
    });
    let loansFixed = 0;
    for (const loan of loans) {
      const officer = loan.createdBy
        ? await prisma.staffUser.findFirst({ where: { id: loan.createdBy, orgId: org.id }, select: { branchId: true } })
        : null;
      await prisma.loan.update({ where: { id: loan.id }, data: { branchId: officer?.branchId ?? root.id } });
      loansFixed++;
    }

    console.log(
      `  ${org.slug.padEnd(14)} head office "${root.name}" · staff ${staffFixed.count} · borrowers ${borrowersFixed.count} · applications ${appsFixed} · loans ${loansFixed}`,
    );
  }

  console.log("\nEvery row now has a branch. Roles still default to ORG scope — narrow them in Team & Roles.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
