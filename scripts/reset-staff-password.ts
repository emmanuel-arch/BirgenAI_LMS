// Diagnose a sign-in problem, and reset a staff password when that is the cause.
//
//   DOTENV_CONFIG_PATH=.env.local npx tsx scripts/reset-staff-password.ts --q=birgen
//   DOTENV_CONFIG_PATH=.env.local npx tsx scripts/reset-staff-password.ts --email=me@x.com --password='…' --apply
//
// DIAGNOSES BY DEFAULT, because "cannot log in" is usually not the password. The
// login route (api/auth/login) gates on, in order:
//   1. a StaffUser with that email AND status = ACTIVE   <- INVITED silently fails
//   2. a non-null passwordHash                            <- invited-but-never-set
//   3. bcrypt.compare
//   4. Org.status !== SUSPENDED
//   5. today's sign-in code, unless Org.isDemo
// Every one of those returns the same "Invalid email or password", by design — so
// the only way to know which gate closed is to look, which is what this does.
//
// On the second factor: outside production the code is echoed back in the login
// response as `fallbackCode` when neither email nor SMS could deliver it, so an
// unconfigured SMTP does not lock you out locally. It DOES in production.
//
// Never prints a password, and never prints a hash.
import "dotenv/config";
import bcrypt from "bcryptjs";
import { platformPrisma } from "../prisma/seed-client";
import { enterPlatform } from "../src/lib/db/context";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const flag = (k: string) => process.argv.includes(`--${k}`);

const APPLY = flag("apply");
const EMAIL = arg("email")?.trim().toLowerCase();
const Q = arg("q")?.trim();
const ORG = arg("org")?.trim();
const PASSWORD = arg("password");

async function main() {
  if (!EMAIL && !Q && !ORG) throw new Error("Pass --email=<address>, --q=<name or partial email>, or --org=<slug>.");

  const p = platformPrisma();
  enterPlatform();

  const staff = await p.staffUser.findMany({
    where: {
      ...(ORG ? { org: { slug: ORG } } : {}),
      ...(EMAIL
        ? { email: EMAIL }
        : Q
          ? {
              OR: [
                { email: { contains: Q, mode: "insensitive" } },
                { firstName: { contains: Q, mode: "insensitive" } },
                { otherName: { contains: Q, mode: "insensitive" } },
              ],
            }
          : {}),
    },
    select: {
      id: true, email: true, firstName: true, otherName: true, status: true,
      passwordHash: true, lastLoginAt: true, createdAt: true,
      isInitiator: true, isAuthorizer: true, isValidator: true,
      role: { select: { title: true } },
      org: { select: { slug: true, name: true, status: true, isDemo: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`\nSTAFF ACCOUNTS matching ${EMAIL ? `email "${EMAIL}"` : `"${Q}"`} — ${staff.length} found`);
  if (staff.length === 0) {
    console.log("  (none)\n  A sign-in cannot succeed without a StaffUser row. Create one, or check the address for a typo.");
  }
  for (const s of staff) {
    const blockers: string[] = [];
    if (s.status !== "ACTIVE") blockers.push(`status is ${s.status} — the login query requires ACTIVE`);
    if (!s.passwordHash) blockers.push("no password has ever been set");
    if (s.org.status === "SUSPENDED") blockers.push("organization is SUSPENDED");
    console.log(`\n  ${s.email}`);
    console.log(`    name        ${s.firstName}${s.otherName ? " " + s.otherName : ""}`);
    console.log(`    org         ${s.org.name} (${s.org.slug}) · ${s.org.status}${s.org.isDemo ? " · DEMO (skips the sign-in code)" : ""}`);
    console.log(`    role        ${s.role?.title ?? "(none)"}   tiers: ${[s.isInitiator && "initiator", s.isAuthorizer && "authorizer", s.isValidator && "validator"].filter(Boolean).join(", ") || "none"}`);
    console.log(`    status      ${s.status}`);
    console.log(`    password    ${s.passwordHash ? "set" : "NOT SET"}`);
    console.log(`    last login  ${s.lastLoginAt ? s.lastLoginAt.toISOString() : "never"}`);
    console.log(`    ${blockers.length ? "BLOCKED: " + blockers.join("; ") : "no blockers — a correct password should sign in"}`);
  }

  const admins = await p.platformAdmin.findMany({ select: { email: true, name: true, createdAt: true } });
  console.log(`\nPLATFORM ADMINS — ${admins.length} (these sign in at /platform/login, a different door)`);
  for (const a of admins) console.log(`  ${a.email}  ${a.name ?? ""}`);

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing changed.`);
    console.log(`  To reset: --email=<exact address> --password='…' --apply\n`);
    await p.$disconnect();
    return;
  }

  // ── apply ────────────────────────────────────────────────────────────────
  if (!EMAIL) throw new Error("--apply requires --email=<exact address> so it cannot hit the wrong account.");
  if (!PASSWORD) throw new Error("--apply requires --password=…");
  if (PASSWORD.length < 10) throw new Error("The app requires at least 10 characters (api/auth/password).");
  const target = staff.find((s) => s.email === EMAIL);
  if (!target) throw new Error(`No staff account with email exactly "${EMAIL}".`);

  const data: { passwordHash: string; status?: "ACTIVE" } = {
    // Cost 12, matching every other place the app hashes (api/auth/login compares
    // against this, so a different cost would still verify but drift from house).
    passwordHash: await bcrypt.hash(PASSWORD, 12),
  };
  // A reset on an account the login query cannot even see would look like it
  // failed. Activating is the point of the reset, so do it in the same write.
  if (target.status !== "ACTIVE") data.status = "ACTIVE";

  await p.staffUser.update({ where: { id: target.id }, data });
  await p.auditLog.create({
    data: {
      orgId: (await p.staffUser.findUnique({ where: { id: target.id }, select: { orgId: true } }))!.orgId,
      actorId: target.id,
      actorType: "staff",
      action: "auth.password-reset",
      entity: "StaffUser",
      entityId: target.id,
      meta: { channel: "script", by: "founder-authorized reset", activated: target.status !== "ACTIVE" },
    },
  }).catch(() => {});

  console.log(`\nAPPLIED — password reset for ${target.email}`);
  if (data.status) console.log(`  status ${target.status} -> ACTIVE (it could not have signed in otherwise)`);
  console.log(`  org ${target.org.name} (${target.org.slug})`);
  if (!target.org.isDemo) {
    console.log(`\n  NOTE: this org is not a demo org, so sign-in also asks for today's code.`);
    console.log(`  With SMTP unset, the login response carries it as "fallbackCode" outside production —`);
    console.log(`  submit the password, read that code from the response, then submit it.`);
  }
  console.log("");

  await p.$disconnect();
}

main().then(() => process.exit(0)).catch((e) => { console.error(`\n${e instanceof Error ? e.message : e}\n`); process.exit(1); });
