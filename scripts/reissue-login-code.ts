// Force today's sign-in code to be REISSUED, so an environment with no mail
// credentials can still get in.
//
//   DOTENV_CONFIG_PATH=.env.local npx tsx scripts/reissue-login-code.ts --email=you@org.com
//   DOTENV_CONFIG_PATH=.env.local npx tsx scripts/reissue-login-code.ts --email=... --org=micromart
//
// THE LOCKOUT THIS FIXES. issueDailyLoginOtp does not reissue a code while a valid
// one exists — the email from this morning still works, and re-hashing would
// silently invalidate it mid-day. To say so it returns `delivered: true`, which is
// true of a code that reached an inbox and a lie about a code that went nowhere.
// Locally there is no SMTP, so the FIRST sign-in attempt of the day creates a
// challenge nobody can ever read, and every attempt afterwards is told the code was
// delivered. The login card's fallbackCode escape hatch never fires, because that
// only appears on the attempt that ISSUES a code.
//
// So this deletes the unread challenge. The next sign-in attempt then issues a fresh
// one, fails to deliver it, and the card shows the code — the escape hatch working as
// designed. Nothing here weakens the check: it removes a code, never reveals one, and
// the new code still has to be typed.
//
// Refuses to run with NODE_ENV=production. A code that reached a real inbox is a real
// second factor, and deleting it there would be an attack, not a convenience.
import "dotenv/config";
import { platformPrisma } from "../prisma/seed-client";
import { enterPlatform } from "../src/lib/db/context";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to delete a live second factor in production.");
  }

  const email = (arg("email") ?? "").trim().toLowerCase();
  const orgSlug = arg("org");
  if (!email) throw new Error("Pass --email=<staff email>.");

  const p = platformPrisma();
  enterPlatform();

  const staff = await p.staffUser.findMany({
    where: { email, ...(orgSlug ? { org: { slug: orgSlug } } : {}) },
    select: { id: true, status: true, email: true, org: { select: { slug: true, name: true } } },
  });

  if (staff.length === 0) throw new Error(`No staff seat for ${email}${orgSlug ? ` at ${orgSlug}` : ""}.`);
  // The same email can hold a seat at several lenders — say which one, rather than
  // clearing a code for a book the caller did not mean.
  if (staff.length > 1 && !orgSlug) {
    console.log(`\n${email} holds ${staff.length} seats. Pass --org= to choose:`);
    for (const s of staff) console.log(`  --org=${s.org.slug}   (${s.org.name}, ${s.status})`);
    process.exit(1);
  }

  const me = staff[0];
  const outstanding = await p.otpChallenge.findMany({
    where: { staffId: me.id, usedAt: null },
    select: { id: true, purpose: true, attempts: true, expiresAt: true, createdAt: true },
  });

  console.log(`\n${me.email} · ${me.org.name} (${me.org.slug}) · seat is ${me.status}`);
  if (outstanding.length === 0) {
    console.log("  no outstanding challenge — the next sign-in will issue a fresh code and show it.\n");
    return;
  }
  for (const c of outstanding) {
    console.log(
      `  ${c.purpose.padEnd(14)} issued ${c.createdAt.toISOString().slice(11, 16)}` +
      ` · expires ${c.expiresAt.toISOString().slice(11, 16)} · ${c.attempts} failed attempt(s)`,
    );
  }

  const gone = await p.otpChallenge.deleteMany({ where: { staffId: me.id, usedAt: null } });
  console.log(`\n  deleted ${gone.count} unread challenge(s).`);
  console.log("  Sign in again — the card will show the new code because delivery fails here.\n");
}

main().then(() => process.exit(0)).catch((e) => { console.error(`\n${e instanceof Error ? e.message : e}\n`); process.exit(1); });
