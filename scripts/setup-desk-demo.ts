// ─────────────────────────────────────────────────────────────────────────────
// A SIGN-IN FOR THE DEMO — one collections role, three accounts.
//
//   DOTENV_CONFIG_PATH=.env npx tsx scripts/setup-desk-demo.ts
//
// ConnectDesk gates on `collections.view` / `collections.manage`, which are the
// console's own rights rather than a parallel vocabulary. Micromart's existing
// staff rows do not all carry them, so this ensures:
//
//   · a "Collections Desk" role holding exactly the rights the floor needs
//   · a supervisor account (sees everything, including the write queue)
//   · an agent account (works the queue, cannot arm the mirror)
//   · a viewer account (reads the floor, changes nothing)
//
// Idempotent: re-running updates the rights and resets the passwords rather than
// creating duplicates. It touches ONLY the accounts it owns — no existing staff
// row is modified, because resetting a real person's password to run a demo is
// not a thing this script gets to do.
//
// The passwords are printed once. They are demo credentials on a demo org and
// are not secrets, but they do open a real lender's book, so they should be
// rotated or the accounts suspended after the demo:
//
//   npx tsx scripts/setup-desk-demo.ts --suspend
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import bcrypt from "bcryptjs";
import { rawPrisma } from "../src/lib/prisma";

const ORG_SLUG = process.env.DESK_DEMO_ORG ?? "micromart";

/** Everything the floor needs, and nothing that moves money out. */
const SUPERVISOR_RIGHTS = [
  "collections.view", "collections.manage",
  "borrowers.view", "loans.view", "repayments.view",
  "reports.view", "reports.analytics", "reports.portfolio",
  "team.view", "branches.view", "products.view",
];
const AGENT_RIGHTS = [
  "collections.view", "collections.manage",
  "borrowers.view", "loans.view", "repayments.view",
];
const VIEWER_RIGHTS = ["collections.view", "borrowers.view", "loans.view", "reports.view"];

const ACCOUNTS = [
  { key: "supervisor", email: "desk.supervisor@micromart.birgenai.com", first: "Amina", other: "Cheruiyot", title: "Collections Supervisor", password: "DeskDemo2026!", rights: SUPERVISOR_RIGHTS, roleTitle: "Collections Supervisor" },
  { key: "agent", email: "desk.agent@micromart.birgenai.com", first: "Mercy", other: "Kaitano", title: "Collections Agent", password: "DeskDemo2026!", rights: AGENT_RIGHTS, roleTitle: "Collections Agent" },
  { key: "viewer", email: "desk.viewer@micromart.birgenai.com", first: "Board", other: "Observer", title: "Read-only", password: "DeskDemo2026!", rights: VIEWER_RIGHTS, roleTitle: "Collections Observer" },
];

async function main() {
  const suspend = process.argv.includes("--suspend");

  const org = await rawPrisma.org.findUnique({ where: { slug: ORG_SLUG }, select: { id: true, name: true } });
  if (!org) throw new Error(`No org with slug "${ORG_SLUG}".`);
  console.log(`${suspend ? "Suspending" : "Provisioning"} ConnectDesk demo accounts on ${org.name}\n`);

  if (suspend) {
    const r = await rawPrisma.staffUser.updateMany({
      where: { orgId: org.id, email: { in: ACCOUNTS.map((a) => a.email) } },
      data: { status: "DISABLED" },
    });
    console.log(`  ${r.count} account(s) suspended. Re-run without --suspend to restore them.`);
    await rawPrisma.$disconnect();
    return;
  }

  for (const acc of ACCOUNTS) {
    // The role first — a staff row needs one, and the rights live on it.
    let role = await rawPrisma.role.findFirst({ where: { orgId: org.id, title: acc.roleTitle }, select: { id: true } });
    if (role) {
      await rawPrisma.role.update({ where: { id: role.id }, data: { rights: acc.rights } });
    } else {
      role = await rawPrisma.role.create({
        data: { orgId: org.id, title: acc.roleTitle, rights: acc.rights, dataScope: "ORG" },
        select: { id: true },
      });
    }

    const passwordHash = await bcrypt.hash(acc.password, 10);
    const existing = await rawPrisma.staffUser.findFirst({
      where: { orgId: org.id, email: acc.email }, select: { id: true },
    });

    if (existing) {
      await rawPrisma.staffUser.update({
        where: { id: existing.id },
        data: { passwordHash, roleId: role.id, status: "ACTIVE", firstName: acc.first, otherName: acc.other, title: acc.title },
      });
      console.log(`  \x1b[32m✓\x1b[0m updated  ${acc.email.padEnd(42)} ${acc.roleTitle}`);
    } else {
      await rawPrisma.staffUser.create({
        data: {
          orgId: org.id, email: acc.email, passwordHash, roleId: role.id, status: "ACTIVE",
          firstName: acc.first, otherName: acc.other, title: acc.title,
        },
      });
      console.log(`  \x1b[32m✓\x1b[0m created  ${acc.email.padEnd(42)} ${acc.roleTitle}`);
    }
  }

  console.log(`\n  Password for all three: \x1b[1m${ACCOUNTS[0].password}\x1b[0m`);
  console.log(`  Sign in at /desk/login (or /login) and pick "${org.name}".`);
  console.log(`\n  \x1b[2mSuspend them after the demo:  npx tsx scripts/setup-desk-demo.ts --suspend\x1b[0m`);
  await rawPrisma.$disconnect();
}

main().catch(async (e) => {
  console.error(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
  await rawPrisma.$disconnect();
  process.exit(1);
});
