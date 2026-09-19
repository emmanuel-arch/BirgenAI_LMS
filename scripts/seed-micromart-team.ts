// ─────────────────────────────────────────────────────────────────────────────
// MICROMART'S REAL TEAM — wipe the seeded cast, install the eight people who
// will actually be in the room on demo day (22 Sep 2026, 09:00–11:00 EAT).
//
//   npx tsx scripts/seed-micromart-team.ts             # report what it would do
//   npx tsx scripts/seed-micromart-team.ts --commit    # do it
//
// ── WHY A WIPE AND NOT A MERGE ───────────────────────────────────────────────
// The Micromart org carried 22 staff rows, and 15 of them were invented for
// demos: alice.nyambura@micromart.birgenai.com and thirteen more on a domain
// that does not exist, plus three ConnectDesk actors. A console being shown to
// the people whose names are NOT in it reads as somebody else's software. So the
// cast is replaced rather than added to, and the fictional domain leaves with
// it.
//
// Two collateral effects, both deliberate and both reported before they happen:
//
//   · FieldVisit rows point at an agent by foreign key, and the seeded visits
//     belong to seeded officers. They go with them — a visit allocated to
//     nobody is not a record worth keeping.
//   · The ConnectDesk demo cast (desk.agent / desk.supervisor / desk.viewer)
//     goes too. Phoebe Iminza is the real Collections Supervisor and inherits
//     that floor; setup-desk-demo.ts can be re-run against her if the seeded
//     queues are wanted back.
//
// ── PASSWORDS ARE SET HERE, ON PURPOSE ───────────────────────────────────────
// The normal path is an invite email carrying a set-password link. That path is
// dead: every staff email this deployment has ever sent failed at the relay with
// "553 Relaying disallowed. Invalid Domain", so an invite would be an invite
// nobody receives. Until the relay is fixed these eight are given a known
// opening password — <Initial><Surname>@2026! — which each of them can change
// from the identity menu once they are in.
//
// ── THE SECOND FACTOR STILL STANDS ───────────────────────────────────────────
// Every one of them carries a real mobile number, because SMS is the one
// channel that works today: the sign-in code the founder received on 18 Sep
// 2026 went out as an SMS to 254758517032 while the email of the same code
// failed. So the OTP step is not weakened for the demo — it is simply delivered
// down the channel that arrives. See lib/otp.ts.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { runAsPlatform } from "../src/lib/db/context";
import { ALL_SYSTEM_IDS } from "../src/lib/suite/entitlements";

const COMMIT = process.argv.includes("--commit");
const SLUG = "micromart";

// Written out rather than derived, so what lands in the database is reviewable
// on the page that puts it there. `Ebirgen@2026!` — first initial, surname with
// one capital, the year, a bang.
const PASSWORDS: Record<string, string> = {
  "birgen@techcrast.co.ke": "Ebirgen@2026!",
  "geoffrey@micromartafrica.com": "Gnjane@2026!",
  "morris@micromartafrica.com": "Mmartin@2026!",
  "edgar@micromartafrica.com": "Eomwansa@2026!",
  "fmuindu05@gmail.com": "Fmuindu@2026!",
  "rodgersmaeba@gmail.com": "Rmaeba@2026!",
  "phoebesimwa@gmail.com": "Piminza@2026!",
  "ndambuki@micromartafrica.com": "Dndambuki@2026!",
};

// ── THE ROLES ────────────────────────────────────────────────────────────────
// Six of the eight titles did not exist on this org. They are created here with
// rights that mean something rather than with a wildcard each: a console where
// every seat is an administrator demonstrates nothing about access control, and
// the first question a risk officer asks about a lending system is who can move
// money.
//
// `*` is reserved for the two administrative seats. Everybody else carries an
// explicit list.
type RoleSpec = { title: string; rights: string[]; dataScope: "ORG" | "BRANCH_TREE" | "BRANCH" | "OWN" };

const ROLES: RoleSpec[] = [
  { title: "System Admin", rights: ["*"], dataScope: "ORG" },
  { title: "Org Admin", rights: ["*"], dataScope: "ORG" },
  {
    // Runs the company. Sees everything, decides applications, and is kept out
    // of exactly two places: the credential vault and the role editor. A GM who
    // can silently rewrite who may disburse is not a control, it is a hole.
    title: "General Manager",
    rights: [
      "borrowers.view", "borrowers.manage", "kyc.verify",
      "applications.view", "applications.decide", "loans.view",
      "collections.view", "collections.manage",
      "disbursements.view", "disbursements.manage", "float.view",
      "repayments.view", "reconciliation.view",
      "intelligence.view", "documents.view",
      "reports.view", "reports.portfolio", "reports.income", "reports.analytics", "reports.builder",
      "field.view", "field.manage",
      "products.view", "workflows.view", "branches.view", "branches.manage",
      "team.view", "roles.view", "billing.view",
      "sms.view", "compliance.view", "riri.use", "metrics.view",
      "settings.view",
    ],
    dataScope: "ORG",
  },
  {
    // Owns the shelf: what is sold, at what price, on which workflow. Reads the
    // book to know whether a product is working; does not decide a file and does
    // not touch money.
    title: "Product Manager",
    rights: [
      "borrowers.view", "applications.view", "loans.view",
      "products.view", "products.manage", "workflows.view", "workflows.manage",
      "intelligence.view", "intelligence.tune", "documents.view",
      "reports.view", "reports.portfolio", "reports.income", "reports.analytics", "reports.builder",
      "branches.view", "sms.view", "sms.manage",
      "riri.use", "metrics.view", "metrics.manage", "settings.view",
    ],
    dataScope: "ORG",
  },
  {
    // The two stages the demo turns on. Decides at Risk, and holds the money
    // rails at Finance — disbursement, float, reconciliation, and the Ratiba
    // mandate that collects the instalments.
    title: "Risk & Finance Manager",
    rights: [
      "borrowers.view", "kyc.verify",
      "applications.view", "applications.decide", "loans.view",
      "disbursements.view", "disbursements.manage", "float.view", "float.manage",
      "repayments.view", "repayments.collect", "reconciliation.view", "reconciliation.resolve",
      "intelligence.view", "intelligence.tune", "documents.view", "documents.parse",
      "reports.view", "reports.portfolio", "reports.income", "reports.analytics",
      "collections.view", "products.view", "workflows.view", "branches.view",
      "compliance.view", "billing.view", "riri.use", "metrics.view", "settings.view",
    ],
    dataScope: "ORG",
  },
  {
    // The floor: who is where, which visits are out, which queues are moving.
    title: "Operations Manager",
    rights: [
      "borrowers.view", "borrowers.create", "borrowers.manage", "kyc.verify",
      "applications.view", "loans.view", "loans.apply",
      "collections.view", "collections.manage",
      "repayments.view", "repayments.collect",
      "field.view", "field.manage",
      "documents.view", "documents.parse",
      "reports.view", "reports.portfolio", "reports.analytics",
      "branches.view", "team.view", "products.view", "workflows.view",
      "sms.view", "sms.manage", "riri.use", "metrics.view",
    ],
    dataScope: "ORG",
  },
  {
    // Owns the credit decision itself, and the policy behind it.
    title: "Head of Credit",
    rights: [
      "borrowers.view", "borrowers.manage", "kyc.verify", "kyc.vouch",
      "applications.view", "applications.decide", "loans.view", "loans.apply",
      "collections.view",
      "intelligence.view", "intelligence.tune", "documents.view", "documents.parse",
      "reports.view", "reports.portfolio", "reports.income", "reports.analytics", "reports.builder",
      "products.view", "products.manage", "workflows.view", "branches.view",
      "riri.use", "metrics.view", "metrics.manage", "settings.view",
    ],
    dataScope: "ORG",
  },
  {
    title: "Collections Supervisor",
    rights: [
      "collections.view", "collections.manage",
      "borrowers.view", "loans.view", "repayments.view",
      "reports.view", "reports.analytics", "reports.portfolio",
      "team.view", "branches.view", "products.view", "riri.use",
    ],
    dataScope: "ORG",
  },
];

// ── THE EIGHT ────────────────────────────────────────────────────────────────
// `deny` is the per-person adjustment on top of the role (lib/rbac/modules.ts).
// Phoebe is the only one narrowed: she works the collections floor and nothing
// else, so every system except ConnectDesk is denied and the lending console is
// not a door she can find by typing a URL. Everybody else holds the whole suite
// on one BirgenAI ID, which is the property the demo is there to show.
type Person = {
  first: string;
  other: string;
  email: string;
  phone: string;
  role: string;
  /** ServiceSuite parity tiers — who may initiate, authorise and validate. */
  tiers: [boolean, boolean, boolean];
  deny?: string[];
};

const ONLY_CONNECTDESK = ALL_SYSTEM_IDS.filter((id) => id !== "callcenter");

const TEAM: Person[] = [
  { first: "Emmanuel", other: "Birgen",  email: "birgen@techcrast.co.ke",        phone: "254758517032", role: "System Admin",           tiers: [true, true, true] },
  { first: "Geoffrey", other: "Njane",   email: "geoffrey@micromartafrica.com",  phone: "254706583636", role: "Product Manager",        tiers: [true, false, false] },
  { first: "Morris",   other: "Martin",  email: "morris@micromartafrica.com",    phone: "254721797735", role: "General Manager",        tiers: [false, true, true] },
  { first: "Edgar",    other: "Omwansa", email: "edgar@micromartafrica.com",     phone: "254795595914", role: "Risk & Finance Manager", tiers: [true, true, false] },
  { first: "Felister", other: "Muindu",  email: "fmuindu05@gmail.com",           phone: "254746147224", role: "Org Admin",              tiers: [true, true, true] },
  { first: "Rodgers",  other: "Maeba",   email: "rodgersmaeba@gmail.com",        phone: "254743924569", role: "Operations Manager",     tiers: [true, false, false] },
  { first: "Phoebe",   other: "Iminza",  email: "phoebesimwa@gmail.com",         phone: "254727729273", role: "Collections Supervisor", tiers: [false, false, false], deny: ONLY_CONNECTDESK },
  { first: "Daniel",   other: "Ndambuki",email: "ndambuki@micromartafrica.com",  phone: "254710625633", role: "Head of Credit",         tiers: [true, true, false] },
];

async function main() {
  console.log(`\n\x1b[1mMicromart team\x1b[0m — ${COMMIT ? "\x1b[33mCOMMIT\x1b[0m" : "\x1b[2mdry run (nothing written)\x1b[0m"}\n`);

  await runAsPlatform(async () => {
    const org = await prisma.org.findFirst({ where: { slug: SLUG }, select: { id: true, name: true } });
    if (!org) throw new Error(`No org with slug "${SLUG}".`);

    const head = await prisma.branch.findFirst({ where: { orgId: org.id, name: "Head Office" }, select: { id: true } });

    // ── What goes ─────────────────────────────────────────────────────────
    const existing = await prisma.staffUser.findMany({
      where: { orgId: org.id },
      select: { id: true, email: true, firstName: true, otherName: true },
      orderBy: { email: "asc" },
    });
    const visits = await prisma.fieldVisit.count({ where: { agentId: { in: existing.map((s) => s.id) } } });

    console.log(`  \x1b[1m${org.name}\x1b[0m`);
    console.log(`  removing   ${existing.length} staff rows${visits ? `, and ${visits} field visits allocated to them` : ""}`);
    for (const s of existing) console.log(`    \x1b[2m− ${s.email}\x1b[0m`);

    console.log(`\n  installing ${TEAM.length}:`);
    for (const p of TEAM) {
      const pw = PASSWORDS[p.email];
      console.log(
        `    + ${(p.first + " " + p.other).padEnd(18)} ${p.email.padEnd(30)} ${p.role.padEnd(23)} ${p.phone}  ${pw}` +
          (p.deny ? `  \x1b[2m(ConnectDesk only)\x1b[0m` : ""),
      );
    }

    if (!COMMIT) {
      console.log(`\n  \x1b[2mNothing written. Re-run with --commit.\x1b[0m\n`);
      return;
    }

    // ── Roles first: a staff row points at one ────────────────────────────
    const roleIds = new Map<string, string>();
    for (const r of ROLES) {
      const row = await prisma.role.upsert({
        where: { orgId_title: { orgId: org.id, title: r.title } },
        create: {
          orgId: org.id,
          title: r.title,
          rights: r.rights as unknown as Prisma.InputJsonValue,
          menu: (r.rights[0] === "*" ? ["*"] : []) as unknown as Prisma.InputJsonValue,
          dataScope: r.dataScope,
        },
        update: {
          rights: r.rights as unknown as Prisma.InputJsonValue,
          dataScope: r.dataScope,
        },
        select: { id: true, title: true },
      });
      roleIds.set(row.title, row.id);
    }
    console.log(`\n  roles      ${ROLES.length} present`);

    // ── Then the wipe ─────────────────────────────────────────────────────
    // Visits before agents: the foreign key is NOT nullable-on-delete, so the
    // staff delete fails outright while a visit still points at one of them.
    const killedVisits = await prisma.fieldVisit.deleteMany({ where: { agentId: { in: existing.map((s) => s.id) } } });
    // Sign-in codes are keyed by staff id. Left behind they are orphan rows that
    // the next person to be issued that id would inherit.
    await prisma.otpChallenge.deleteMany({ where: { orgId: org.id, staffId: { in: existing.map((s) => s.id) } } });
    const killed = await prisma.staffUser.deleteMany({ where: { orgId: org.id } });
    console.log(`  removed    ${killed.count} staff, ${killedVisits.count} visits`);

    // ── And the eight ─────────────────────────────────────────────────────
    for (const p of TEAM) {
      const passwordHash = await bcrypt.hash(PASSWORDS[p.email], 10);
      await prisma.staffUser.create({
        data: {
          orgId: org.id,
          email: p.email.toLowerCase(),
          phone: p.phone,
          firstName: p.first,
          otherName: p.other,
          title: p.role,
          passwordHash,
          roleId: roleIds.get(p.role) ?? null,
          branchId: head?.id ?? null,
          isInitiator: p.tiers[0],
          isAuthorizer: p.tiers[1],
          isValidator: p.tiers[2],
          status: "ACTIVE",
          access: (p.deny ? { deny: p.deny } : {}) as unknown as Prisma.InputJsonValue,
        },
      });
    }
    console.log(`  installed  ${TEAM.length} staff, all ACTIVE, all on Head Office\n`);
  });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n\x1b[31m" + (e instanceof Error ? e.message : String(e)) + "\x1b[0m\n");
    process.exit(1);
  });
