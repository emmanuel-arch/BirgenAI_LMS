// ─────────────────────────────────────────────────────────────────────────────
// WHERE EVERY DOOR LETS EVERY PERSON OUT.
//
//   npx tsx scripts/verify-doors.ts [--org micromart]
//
// Sign-in no longer ends on a launcher — it ends INSIDE a system, chosen by the
// host that was knocked on and by what the person actually holds (lib/suite/
// landing.ts). That is a rule with two inputs and seven possible answers, and
// the failure mode is not an exception: it is a supervisor landing in a console
// she cannot use, or a manager being told he has no systems. Neither throws.
// Both are only visible as a table.
//
// So this prints the table. Read down a column to check one host; read across a
// row to check one person. Nothing here writes, sends, or signs anything in.
//
// It also checks the two things that would make the table a lie:
//
//   · NO LANDING IS A LOOP. Every destination must be a system this person may
//     actually enter, because each of those layouts re-checks and redirects —
//     and a redirect that lands where it came from is an infinite loop served to
//     somebody who has just typed the right password. (The one exception is
//     /no-access, which gates nothing; that is why it exists.)
//   · EVERY PERSON CAN RECEIVE A SIGN-IN CODE. Staff email at this deployment
//     fails at the relay, so an account with no mobile number is an account
//     whose second factor cannot be delivered. That is a warning, not an error:
//     sign-in falls open to password-only rather than locking anybody out, but
//     it is never the intended state and it should never be a surprise.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { runAsPlatform } from "../src/lib/db/context";
import { parseAccess } from "../src/lib/rbac/modules";
import { visibleSystemIds } from "../src/lib/suite/access";
import { staffLanding, homeFor, NO_SYSTEMS } from "../src/lib/suite/landing";
import { SATELLITE_HOSTS, SUITE_DOMAIN, systemIdForLabel } from "../src/lib/suite/labels";

const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d;
};

/** The staff hosts, in the order a person meets them. The consumer app is not one. */
const HOSTS = SATELLITE_HOSTS.filter((h) => h.door !== null);

async function main() {
  const slug = arg("org", "micromart");
  let bad = 0;
  let warn = 0;

  await runAsPlatform(async () => {
    const org = await prisma.org.findFirst({
      where: { slug },
      select: { id: true, name: true, systems: true },
    });
    if (!org) throw new Error(`No org with slug "${slug}".`);

    const staff = await prisma.staffUser.findMany({
      where: { orgId: org.id },
      select: { email: true, firstName: true, otherName: true, phone: true, access: true, status: true, role: { select: { title: true } } },
      orderBy: { createdAt: "asc" },
    });

    console.log(`\n\x1b[1m${org.name}\x1b[0m — where each host lets each person out\n`);
    const head = HOSTS.map((h) => h.label.padEnd(11)).join(" ");
    console.log(`  ${"".padEnd(22)}${"".padEnd(24)}${head}`);
    console.log(`  ${"─".repeat(22 + 24 + head.length)}`);

    for (const s of staff) {
      const denied = new Set(parseAccess(s.access).deny ?? []);
      const visible = visibleSystemIds(org.systems, denied);
      const name = `${s.firstName} ${s.otherName ?? ""}`.trim();

      const cells = HOSTS.map((h) => {
        const to = staffLanding(visible, systemIdForLabel(h.label));
        // A landing must be a system this person may enter, or the one page that
        // gates nothing. Anything else is a redirect loop.
        const ok = to === NO_SYSTEMS || visible.some((id) => homeFor(id) === to);
        if (!ok) bad++;
        const colour = to === NO_SYSTEMS ? "\x1b[33m" : ok ? "\x1b[32m" : "\x1b[31m";
        return `${colour}${to.padEnd(11)}\x1b[0m`;
      }).join(" ");

      console.log(`  ${name.padEnd(22)}${(s.role?.title ?? "—").padEnd(24)}${cells}`);

      if (!s.phone) {
        warn++;
        console.log(`  ${"".padEnd(22)}\x1b[33m⚠ no mobile number — today's sign-in code cannot be delivered (staff email fails at the relay)\x1b[0m`);
      }
      if (s.status !== "ACTIVE") {
        warn++;
        console.log(`  ${"".padEnd(22)}\x1b[33m⚠ status is ${s.status} — sign-in refuses before any of this is reached\x1b[0m`);
      }
    }

    console.log(`\n  \x1b[2mhosts: ${HOSTS.map((h) => `${h.label}.${SUITE_DOMAIN}`).join("  ")}\x1b[0m`);
    console.log(
      bad === 0
        ? `\n  \x1b[32mPASS\x1b[0m  every landing is a system that person holds${warn ? `, with ${warn} warning${warn > 1 ? "s" : ""}` : ""}\n`
        : `\n  \x1b[31mFAIL\x1b[0m  ${bad} landing${bad > 1 ? "s" : ""} would bounce straight back — that is a redirect loop\n`,
    );
  });

  process.exit(bad === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n\x1b[31m" + (e instanceof Error ? e.message : String(e)) + "\x1b[0m\n");
  process.exit(1);
});
