// ─────────────────────────────────────────────────────────────────────────────
// THE ROOM — the seven people who will be in the Micromart demo, each with
// their own account, their own role and their own half of the estate.
//
//   npx tsx scripts/setup-demo-room.ts
//   npx tsx scripts/setup-demo-room.ts --suspend      # after the demo
//
// This supersedes setup-desk-demo.ts for the demo itself. That script seeds
// three GENERIC collections accounts (Amina / Mercy / Board Observer) and is
// still the right tool for testing the floor in isolation. This one seeds the
// SEVEN REAL PEOPLE, because a room where every attendee watches somebody else's
// screen is a different meeting from one where each person signs in as
// themselves and finds their own department already there.
//
// ── THE ARGUMENT THIS SCRIPT IS BUILT TO MAKE ────────────────────────────────
// Dan Ndambuki and Ogutu Maeba are both Operations Managers. They share ONE role
// row — the same title, the same rights — and they land on two different
// consoles, because the per-person access adjustment on StaffUser.access narrows
// each of them differently: Dan keeps origination, Ogutu keeps recovery.
//
// That is the whole point of the access model, and it is much easier to show
// than to describe. If the two Ops managers are sitting next to each other, ask
// them to open the same URL. See src/lib/rbac/modules.ts for the vocabulary.
//
// ── WHAT IT WILL NOT DO ──────────────────────────────────────────────────────
// It touches only the seven accounts it owns. No existing Micromart staff row is
// modified — resetting a real person's password to run a demo is not a thing
// this script gets to do. Re-running updates rights and resets these seven
// passwords rather than creating duplicates.
//
// Every deny key is validated against allAccessKeys() before anything is
// written, so a typo fails loudly here instead of silently denying nothing and
// handing somebody a console they were meant not to see.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import bcrypt from "bcryptjs";
import { rawPrisma } from "../src/lib/prisma";
import { allAccessKeys } from "../src/lib/rbac/modules";
import { ALL_RIGHTS_SET } from "../src/lib/rbac/rights";

const ORG_SLUG = process.env.DESK_DEMO_ORG ?? "micromart";
const PASSWORD = process.env.DEMO_ROOM_PASSWORD ?? "Micromart2026!";

// ── The rights each role holds ───────────────────────────────────────────────
// Read-only by default. Nothing here moves money: no disbursements.manage, no
// float.manage for anyone but Finance, and no repayments.collect except on the
// floor that actually takes payments.

/** Everything worth seeing, nothing that changes anything. The GM's posture. */
const GM_RIGHTS = [
  "borrowers.view", "applications.view", "loans.view",
  "collections.view", "disbursements.view", "float.view",
  "repayments.view", "reconciliation.view", "intelligence.view",
  "documents.view", "field.view", "products.view", "workflows.view",
  "branches.view", "team.view", "roles.view", "settings.view",
  "billing.view", "sms.view", "compliance.view",
  "reports.view", "reports.portfolio", "reports.income", "reports.analytics",
  "riri.use", "metrics.view",
];

/** Finance & IT: the books, the float, the integrations, the bill. */
const FINANCE_IT_RIGHTS = [
  "borrowers.view", "loans.view", "applications.view",
  "repayments.view", "reconciliation.view", "reconciliation.resolve",
  "float.view", "float.manage", "disbursements.view",
  "billing.view", "billing.manage",
  "settings.view", "settings.manage",
  "compliance.view", "compliance.manage",
  "branches.view", "team.view", "products.view", "documents.view",
  "reports.view", "reports.portfolio", "reports.income", "reports.analytics",
  "riri.use", "metrics.view", "metrics.manage",
];

/** Operations: the book being worked. Shared by BOTH ops managers — see above. */
const OPERATIONS_RIGHTS = [
  "borrowers.view", "borrowers.create", "borrowers.manage",
  "kyc.verify", "applications.view", "applications.decide",
  "loans.view", "loans.apply",
  "disbursements.view", "disbursements.manage",
  "repayments.view", "collections.view", "collections.manage",
  "float.view", "reconciliation.view",
  "intelligence.view", "documents.view",
  "field.view", "field.manage",
  "products.view", "workflows.view", "branches.view", "team.view",
  "reports.view", "reports.portfolio", "reports.analytics",
];

/** IT: administers the system, does not work the book. */
const IT_RIGHTS = [
  "settings.view", "settings.manage",
  "team.view", "team.manage", "roles.view", "roles.manage",
  "branding.manage", "branches.view",
  "compliance.view", "compliance.manage",
  "sms.view", "sms.manage", "billing.view",
  "borrowers.view", "loans.view", "documents.view",
  "reports.view", "metrics.view", "metrics.manage",
];

/** Front line: answer the customer, find their loan, log what was said. */
const CUSTOMER_SERVICE_RIGHTS = [
  "borrowers.view", "loans.view", "repayments.view",
  "collections.view", "collections.manage",
  "documents.view", "products.view", "reports.view",
];

/**
 * The call centre floor, in full.
 *
 * `repayments.collect` is the one write right in this set and it is deliberate:
 * a supervisor who can see that a promise came due but cannot trigger the STK
 * request has to ask somebody else to finish the call. `collections.manage`
 * additionally unlocks the Fintech bridge module (`callcenter:pipeline`), which
 * is the close of the GM's walkthrough.
 */
const CALL_CENTRE_RIGHTS = [
  "collections.view", "collections.manage",
  "borrowers.view", "loans.view",
  "repayments.view", "repayments.collect",
  "intelligence.view", "documents.view",
  "field.view", "products.view", "branches.view", "team.view",
  "sms.view", "sms.manage",
  "reports.view", "reports.portfolio", "reports.analytics",
  "riri.use", "metrics.view",
];

type Account = {
  email: string;
  first: string;
  other: string;
  /** Display job title, exactly as they would introduce themselves. */
  title: string;
  roleTitle: string;
  rights: string[];
  /** Systems and `system:module` keys this person does not see. */
  deny: string[];
  /** Where to send them on the day. Printed, not stored. */
  opens: string;
};

const ACCOUNTS: Account[] = [
  {
    email: "morris.martin@micromart.birgenai.com",
    first: "Morris", other: "Omwoa Martin",
    title: "General Manager",
    roleTitle: "General Manager",
    rights: GM_RIGHTS,
    // Nothing denied. The GM is the one person who should see all six tiles on
    // the launcher, because "six systems, one identity" is the claim being made
    // and his screen is where it is demonstrated.
    deny: [],
    opens: "/suite  →  then connectdesk…/desk/pipeline",
  },
  {
    email: "edar.omwansa@micromart.birgenai.com",
    first: "Edar", other: "Orina Omwansa",
    title: "Finance & IT Head",
    roleTitle: "Finance & IT Head",
    rights: FINANCE_IT_RIGHTS,
    // He owns the books and the integrations, not the floor. Hiding the two
    // modules where agents log calls keeps Ledgerly and Settings the first
    // things he sees rather than the fourth.
    deny: ["callcenter:work", "callcenter:promises"],
    opens: "ledgerly…/books/journal",
  },
  {
    email: "dan.ndambuki@micromart.birgenai.com",
    first: "Dan", other: "Ndambuki",
    title: "Operations Manager",
    roleTitle: "Operations Manager", // ← same role as Ogutu, on purpose
    rights: OPERATIONS_RIGHTS,
    // ORIGINATION half: applications, KYC, disbursement. The recovery modules
    // belong to Ogutu, so they are off here.
    deny: ["accounting", "hr", "callcenter:promises", "callcenter:plumbing"],
    opens: "lms…/console",
  },
  {
    email: "ogutu.maeba@micromart.birgenai.com",
    first: "Ogutu", other: "Maeba",
    title: "Operations Manager",
    roleTitle: "Operations Manager", // ← same role as Dan, on purpose
    rights: OPERATIONS_RIGHTS,
    // RECOVERY half: the floor, the promises, the recoveries. Payments and the
    // early-warning models are Dan's.
    deny: ["accounting", "hr", "lms:payments", "lms:intelligence"],
    opens: "connectdesk…/desk/queue",
  },
  {
    email: "felister.muindu@micromart.birgenai.com",
    first: "Felister", other: "Muindu",
    title: "IT",
    roleTitle: "IT Administrator",
    rights: IT_RIGHTS,
    // She provisions people and credentials. She is not on the collections
    // floor and has no reason to read the journal.
    deny: ["accounting", "callcenter:work", "callcenter:promises"],
    opens: "lms…/console/team   (then Manage, on anyone)",
  },
  {
    email: "geoffrey.njane@micromart.birgenai.com",
    first: "Geoffrey", other: "Njane",
    title: "Customer Service",
    roleTitle: "Customer Service",
    rights: CUSTOMER_SERVICE_RIGHTS,
    // The narrowest account in the room, and the most instructive: a front-line
    // agent sees the customer in front of them and nothing about the group.
    deny: [
      "accounting", "hr", "analytics",
      "callcenter:pipeline", "callcenter:plumbing",
      "lms:payments", "lms:intelligence",
    ],
    opens: "connectdesk…/desk/queue",
  },
  {
    // ── THE CENTREPIECE ──────────────────────────────────────────────────────
    // ConnectDesk is the system being sold, and this is the account it is sold
    // from. She keeps EVERY ConnectDesk module — the live floor, the work queue,
    // callbacks, the promise board, recoveries, her agents, the phone floor, the
    // Fintech bridge and the plumbing — plus Analytics, plus the read side of
    // the lending console so a case can be opened from a call without leaving.
    //
    // Her screen on the day is /desk/agents: her floor by name, ranked by cash,
    // with the PBX seats live beside each one.
    email: "phoebe.iminza@micromart.birgenai.com",
    first: "Phoebe", other: "Iminza",
    title: "Call Centre Supervisor",
    roleTitle: "Call Centre Supervisor",
    rights: CALL_CENTRE_RIGHTS,
    deny: ["accounting", "hr"],
    opens: "connectdesk…/desk/agents   ← the demo's centrepiece",
  },
];

// ── Validation, before anything is written ───────────────────────────────────

function preflight(): void {
  const validKeys = allAccessKeys();
  const problems: string[] = [];

  const emails = new Set<string>();
  for (const a of ACCOUNTS) {
    if (emails.has(a.email)) problems.push(`duplicate email: ${a.email}`);
    emails.add(a.email);

    for (const r of a.rights) {
      if (!ALL_RIGHTS_SET.has(r)) problems.push(`${a.email}: unknown right "${r}"`);
    }
    for (const k of a.deny) {
      // A key that is not in the catalogue denies NOTHING — it is silently
      // ignored at read time, which is the failure mode this catches.
      if (!validKeys.has(k)) problems.push(`${a.email}: unknown access key "${k}"`);
    }
  }

  // Two people must share the Operations Manager role for the demo beat to
  // work. If somebody splits them later, this says so rather than quietly
  // removing the most interesting thing in the script.
  const ops = ACCOUNTS.filter((a) => a.roleTitle === "Operations Manager");
  if (ops.length !== 2) problems.push(`expected 2 Operations Managers sharing a role, found ${ops.length}`);
  else if (JSON.stringify(ops[0].deny) === JSON.stringify(ops[1].deny)) {
    problems.push("both Operations Managers have the same deny list — the per-person demo shows nothing");
  }

  if (problems.length) {
    console.error("\n  Refusing to write. Fix these first:\n");
    for (const p of problems) console.error(`    ✗ ${p}`);
    console.error("");
    process.exit(1);
  }
}

async function main() {
  const suspend = process.argv.includes("--suspend");
  preflight();

  // `--check` validates the seven accounts and prints the plan WITHOUT opening a
  // database connection. It is the safe thing to run first: this script writes
  // to a real lender's org, and being able to see exactly what it would do
  // before it does it costs nothing.
  if (process.argv.includes("--check")) {
    console.log(`\n  Preflight passed. ${ACCOUNTS.length} accounts, ${new Set(ACCOUNTS.map((a) => a.roleTitle)).size} roles.`);
    console.log(`  Target org slug: ${ORG_SLUG}   (nothing was written)\n`);
    for (const a of ACCOUNTS) {
      console.log(`    ${a.first} ${a.other}`.padEnd(26) + `${a.title}`);
      console.log(`      \x1b[2m${a.email}\x1b[0m`);
      console.log(`      \x1b[2mrole: ${a.roleTitle} · ${a.rights.length} rights` +
        `${a.deny.length ? ` · hides ${a.deny.join(", ")}` : " · hides nothing"}\x1b[0m`);
    }
    console.log("");
    return;
  }

  const org = await rawPrisma.org.findUnique({
    where: { slug: ORG_SLUG },
    select: { id: true, name: true },
  });
  if (!org) throw new Error(`No org with slug "${ORG_SLUG}".`);

  console.log(`\n${suspend ? "Suspending" : "Provisioning"} the demo room on ${org.name}\n`);

  if (suspend) {
    const r = await rawPrisma.staffUser.updateMany({
      where: { orgId: org.id, email: { in: ACCOUNTS.map((a) => a.email) } },
      data: { status: "DISABLED" },
    });
    console.log(`  ${r.count} account(s) suspended. Re-run without --suspend to restore them.\n`);
    await rawPrisma.$disconnect();
    return;
  }

  // Roles first — two accounts share one, so this is deduplicated by title
  // rather than created per account.
  const roleIds = new Map<string, string>();
  for (const acc of ACCOUNTS) {
    if (roleIds.has(acc.roleTitle)) continue;

    const existing = await rawPrisma.role.findFirst({
      where: { orgId: org.id, title: acc.roleTitle },
      select: { id: true },
    });
    if (existing) {
      await rawPrisma.role.update({ where: { id: existing.id }, data: { rights: acc.rights } });
      roleIds.set(acc.roleTitle, existing.id);
    } else {
      const created = await rawPrisma.role.create({
        data: { orgId: org.id, title: acc.roleTitle, rights: acc.rights, dataScope: "ORG" },
        select: { id: true },
      });
      roleIds.set(acc.roleTitle, created.id);
    }
  }
  console.log(`  ${roleIds.size} roles for ${ACCOUNTS.length} people — Dan and Ogutu share one.\n`);

  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  for (const acc of ACCOUNTS) {
    const roleId = roleIds.get(acc.roleTitle)!;
    const access = acc.deny.length ? { deny: acc.deny } : {};

    const existing = await rawPrisma.staffUser.findFirst({
      where: { orgId: org.id, email: acc.email },
      select: { id: true },
    });

    const data = {
      passwordHash,
      roleId,
      status: "ACTIVE" as const,
      firstName: acc.first,
      otherName: acc.other,
      title: acc.title,
      access,
      // Deterministic, so the same person keeps the same avatar across re-runs.
      avatarSeed: acc.email,
    };

    if (existing) {
      await rawPrisma.staffUser.update({ where: { id: existing.id }, data });
      console.log(`  \x1b[32m✓\x1b[0m updated  ${acc.first} ${acc.other}`);
    } else {
      await rawPrisma.staffUser.create({ data: { orgId: org.id, email: acc.email, ...data } });
      console.log(`  \x1b[32m✓\x1b[0m created  ${acc.first} ${acc.other}`);
    }
    console.log(`    \x1b[2m${acc.email}\x1b[0m`);
    console.log(`    \x1b[2m${acc.title} · ${acc.opens}\x1b[0m`);
    if (acc.deny.length) console.log(`    \x1b[2mhidden: ${acc.deny.join(", ")}\x1b[0m`);
    console.log("");
  }

  console.log(`  Password for all seven: \x1b[1m${PASSWORD}\x1b[0m`);
  console.log(`  Everyone signs in at the SAME door — /login — and picks "${org.name}".`);
  console.log(`  The server decides where they land.\n`);
  console.log(`  \x1b[2mTwo people to seat together: Dan Ndambuki and Ogutu Maeba. Same role,\x1b[0m`);
  console.log(`  \x1b[2msame URL, two different consoles.\x1b[0m\n`);
  console.log(`  \x1b[2mAfter the demo:  npx tsx scripts/setup-demo-room.ts --suspend\x1b[0m\n`);

  await rawPrisma.$disconnect();
}

main().catch(async (e) => {
  console.error(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
  await rawPrisma.$disconnect();
  process.exit(1);
});
