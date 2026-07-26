// ─────────────────────────────────────────────────────────────────────────────
// Force a FRESH sign-in code to a staff inbox.
//
// The daily code is deliberately sticky: issueDailyLoginOtp() will not reissue
// while this morning's challenge is still live, because re-hashing would silently
// invalidate the email the officer is already looking at. That is right for
// production and wrong for checking a template change — so this script clears
// today's challenge first, then issues, which sends a real email through the real
// layout with the real brand.
//
//   npx tsx scripts/resend-login-code.ts <email> [org-slug]
//
// Prints nothing secret: the code goes to the inbox, not the terminal.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { runWithOrg, runAsPlatform } from "../src/lib/db/context";
import { issueDailyLoginOtp, LOGIN_PURPOSE } from "../src/lib/otp";

async function main() {
  const email = (process.argv[2] || "").trim().toLowerCase();
  const slug = (process.argv[3] || "").trim().toLowerCase() || null;
  if (!email) {
    console.error("Usage: npx tsx scripts/resend-login-code.ts <email> [org-slug]");
    process.exit(1);
  }

  // The lookup crosses orgs (one email can hold seats at several lenders), so it
  // runs as the platform; everything after it is scoped to the seat's own org.
  const staff = await runAsPlatform(() => prisma.staffUser.findMany({
    where: { email, ...(slug ? { org: { slug } } : {}) },
    select: { id: true, orgId: true, firstName: true, email: true, org: { select: { name: true, slug: true } } },
  }));

  if (staff.length === 0) {
    console.error(`No staff seat found for ${email}${slug ? ` at ${slug}` : ""}.`);
    process.exit(1);
  }
  if (staff.length > 1 && !slug) {
    console.error(`${email} holds seats at ${staff.length} lenders — pass a slug:`);
    for (const s of staff) console.error(`  npx tsx scripts/resend-login-code.ts ${email} ${s.org.slug}`);
    process.exit(1);
  }

  const seat = staff[0];
  await runWithOrg(seat.orgId, async () => {
    // Clear today's live challenge so the next call actually issues + emails.
    const cleared = await prisma.otpChallenge.deleteMany({
      where: { orgId: seat.orgId, staffId: seat.id, purpose: LOGIN_PURPOSE, usedAt: null },
    });
    console.log(`Cleared ${cleared.count} live challenge(s) for ${seat.email} @ ${seat.org.name}.`);

    const issue = await issueDailyLoginOtp(seat.orgId, seat.id);
    console.log(
      issue.delivered
        ? `✅ A fresh code is on its way to ${seat.email} — branded as ${seat.org.name}.`
        : `⚠️  Issued, but neither email nor SMS delivered.${issue.fallbackCode ? ` Fallback code: ${issue.fallbackCode}` : ""}`,
    );
  });
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
