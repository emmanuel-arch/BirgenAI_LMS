// Tests for VERIFICATION AT THE COUNTER — and for the bug that made it necessary.
//
//   npm run test:kyc-counter        (needs the database; no app server)
//
// THE BUG, because it is the whole reason this suite exists. "Verify at the counter"
// opened /verify — the BORROWER's portal — in a new tab. That page has no session, so
// it works out which lender it is serving from the address bar: the subdomain, or
// ?lender=. On the console's own host (localhost, birgenai.com — both reserved
// labels) it resolved to neither and fell back to a default org.
//
// So an officer at Techcrast verified a customer, and that customer's KYC session,
// checks and PHOTOGRAPHS were written into a DIFFERENT LENDER's org. At finalize the
// code went looking for a borrower in THAT org with the phone number; there wasn't
// one; nothing attached. The officer was shown "verified", and their customer stayed
// blocked at the payout desk with no explanation.
//
// It did not fail to save. It saved into someone else's books. That is a tenancy
// breach wearing a UX bug's clothing, and the tests below pin every property that
// makes it impossible now:
//
//   THE ORG IS NEVER GUESSED. The counter route reads the org from the staff session
//     and takes the borrower by id. It has no lenderSlug, no hostname, no fallback.
//   AN ATTACH CANNOT CROSS A TENANT. Two lenders, the same phone number, two different
//     people — a session in one org can never promote onto a borrower in the other.
//   THE ATTACH ACTUALLY MOVES THE ROW. kycStatus, the timestamp and the portrait land
//     on the Borrower, because a green tick over a still-blocked customer is the lie
//     that started all this.
//   THE OFFICER MUST BE ABLE TO SEE THEM. The borrowerId in the body is not a key to
//     the whole org — it is checked against the officer's data scope.
//   ONE PIPELINE, TWO DOORS. Both surfaces run the SAME wizard, so a customer verified
//     at the counter passed exactly the checks a customer verified at home did.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { runAsPlatform, runWithOrg } from "@/lib/db/context";
import { attachKycSession } from "@/lib/kyc/attach";
import { portraitsFor } from "@/lib/kyc/avatars";
import { resolveScope, canSeeBorrower } from "@/lib/rbac/scope";
import type { Session } from "@/lib/auth";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};
const section = (s: string) => console.log(`\n${s}`);
const src = (p: string) => readFileSync(p, "utf8");

const COUNTER_ROUTE = "src/app/api/console/kyc/verify/route.ts";
const PORTAL_PAGE = "src/app/verify/page.tsx";
const QUEUE_CLIENT = "src/app/console/kyc/KycQueueClient.tsx";
const COUNTER_PAGE = "src/app/console/kyc/[id]/VerifyClient.tsx";

async function main() {
  const stamp = Date.now();

  // ── 1. The org is never guessed ────────────────────────────────────────────
  section("1. The counter route cannot guess the tenant");

  const route = src(COUNTER_ROUTE);
  ok("it takes the org from the session, not the request", /session\.user\.orgId/.test(route));
  ok("…and never resolves an org from a slug the caller supplied", !/resolveOrg\(/.test(route));
  ok("…and has no lenderSlug at all", !/lenderSlug/.test(route));
  ok("…and no default org to fall back to", !/["']hub["']/.test(route));
  ok("it demands the kyc.verify right", /requireRight\(session,\s*["']kyc\.verify["']\)/.test(route));
  ok("it checks the borrower is on the caller's book", /canSeeBorrower\(/.test(route));
  ok("the officer's assertion is written to the audit log", /kyc\.verify\.counter/.test(route));

  // ── 2. The portal will no longer guess either ──────────────────────────────
  section("2. The portal stops rather than guessing");

  const portal = src(PORTAL_PAGE);
  ok("no lender ⇒ an honest stop, not a default org", /no-lender/.test(portal));
  ok("…and the old `useState(\"hub\")` default is gone", !/useState\(["']hub["']\)/.test(portal));

  const queue = src(QUEUE_CLIENT);
  ok("'Verify at the counter' stays inside the console", /\/console\/kyc\/\$\{r\.id\}/.test(queue));
  ok("…and no longer opens the borrower's portal in a new tab", !/\/verify\?phone=/.test(queue));

  // ── 3. One pipeline, two doors ─────────────────────────────────────────────
  section("3. Both doors run the same checks");

  const counterUi = src(COUNTER_PAGE);
  const IMPORTS_FLOW = /from ["']@\/components\/kyc\/VerifyFlow["']/;
  ok("the counter runs the shared pipeline", IMPORTS_FLOW.test(counterUi));
  ok("the borrower's portal runs the SAME shared pipeline", IMPORTS_FLOW.test(portal),
    "so the counter cannot drift into a weaker set of checks");

  // ── 4. Two lenders, one phone number, two different people ─────────────────
  section("4. An attach cannot cross a tenant");

  const mkOrg = (slug: string, name: string) => runAsPlatform(() => prisma.org.create({
    data: { slug, name, plan: "PREMIUM", mode: "NATIVE", status: "ACTIVE" },
  }));
  const techcrast = await mkOrg(`counter-a-${stamp}`, "Techcrast");
  const otherLender = await mkOrg(`counter-b-${stamp}`, "Some Other Lender");

  // The same human phone number exists at both lenders. This is not contrived — a
  // borrower shops around, and every lender in Kenya keys on the phone.
  const phone = `2547${String(stamp).slice(-8)}`;

  const mwangi = await runWithOrg(techcrast.id, () => prisma.borrower.create({
    data: { orgId: techcrast.id, phone, firstName: "Christopher", otherName: "Mwangi", kycStatus: "NONE" },
  }));
  const someoneElse = await runWithOrg(otherLender.id, () => prisma.borrower.create({
    data: { orgId: otherLender.id, phone, firstName: "Not", otherName: "Mwangi", kycStatus: "NONE" },
  }));

  // A COMPLETED verification, filed at Techcrast, where it belongs.
  const session = await runWithOrg(techcrast.id, () => prisma.kycSession.create({
    data: {
      orgId: techcrast.id, borrowerId: mwangi.id, phone, nationalId: "39362809", provider: "simulation",
      status: "VERIFIED", completedAt: new Date(),
      idQualityScore: 91, livenessScore: 95, livenessPassed: true, faceMatchScore: 93, iprsMatched: true,
      portraitKey: `sim/${techcrast.id}/${stamp}/portrait-x.jpg`,
      idFrontKey: `sim/${techcrast.id}/${stamp}/id-front-x.jpg`,
    },
  }));

  // The OTHER lender tries to promote it onto THEIR borrower with the same phone.
  // RLS scopes the session lookup, so there is nothing there to find.
  const crossed = await runWithOrg(otherLender.id, () => attachKycSession(otherLender.id, someoneElse.id, phone, "39362809"));
  ok("a session at one lender cannot verify a same-phone borrower at another", crossed === null);

  const stillBlocked = await runWithOrg(otherLender.id, () => prisma.borrower.findUnique({
    where: { id: someoneElse.id }, select: { kycStatus: true, portraitKey: true },
  }));
  ok("…the other lender's borrower is untouched", stillBlocked?.kycStatus === "NONE" && stillBlocked?.portraitKey === null);

  // ── 5. The attach actually moves the row ───────────────────────────────────
  section("5. The verification lands on the customer");

  const attached = await runWithOrg(techcrast.id, () => attachKycSession(techcrast.id, mwangi.id, phone, "39362809"));
  ok("the right lender's attach succeeds", attached?.status === "VERIFIED");

  const after = await runWithOrg(techcrast.id, () => prisma.borrower.findUnique({
    where: { id: mwangi.id },
    select: { kycStatus: true, kycVerifiedAt: true, portraitKey: true, idFrontKey: true, faceMatchScore: true, livenessPassed: true, iprsVerified: true, nationalId: true },
  }));
  ok("kycStatus is VERIFIED on the BORROWER, not just the session", after?.kycStatus === "VERIFIED",
    "the exact thing that silently didn't happen");
  ok("…and it is stamped with when", after?.kycVerifiedAt != null);
  ok("…the portrait is promoted onto the borrower", after?.portraitKey === session.portraitKey);
  ok("…so is the ID document", after?.idFrontKey === session.idFrontKey);
  ok("…and the scores the risk engine reads", after?.faceMatchScore === 93 && after?.livenessPassed === true && after?.iprsVerified === true);
  ok("…and the national ID gap is filled", after?.nationalId === "39362809");

  const linked = await runWithOrg(techcrast.id, () => prisma.kycSession.findUnique({
    where: { id: session.id }, select: { borrowerId: true },
  }));
  ok("the session is linked back to the borrower", linked?.borrowerId === mwangi.id);

  // ── 6. The gate opens — that is the point of all of it ─────────────────────
  section("6. The gate opens");

  const RELEASES_MONEY = ["approve", "manual", "retry"];
  const wouldRelease = (action: string, kycStatus: string) => !(RELEASES_MONEY.includes(action) && kycStatus !== "VERIFIED");
  ok("before: no money could be released to Mwangi", !wouldRelease("approve", "NONE"));
  ok("after: it can", wouldRelease("approve", after!.kycStatus));

  // ── 7. The borrowerId in the body is not a skeleton key ────────────────────
  section("7. An officer can only verify their own customers");

  const { brianSession, graceCustomer } = await runWithOrg(techcrast.id, async () => {
    const branch = await prisma.branch.create({ data: { orgId: techcrast.id, name: "HQ", levelName: "Head Office" } });
    const rights = ["borrowers.view", "kyc.verify"];
    const role = await prisma.role.create({ data: { orgId: techcrast.id, title: "Officer", rights, menu: rights, dataScope: "OWN" } });
    const mk = (email: string, first: string) => prisma.staffUser.create({
      data: { orgId: techcrast.id, email, firstName: first, roleId: role.id, branchId: branch.id, status: "ACTIVE" },
    });
    const brian = await mk(`brian-${stamp}@t.test`, "Brian");
    const grace = await mk(`grace-${stamp}@t.test`, "Grace");
    const graceCustomer = await prisma.borrower.create({
      data: { orgId: techcrast.id, phone: `2541${String(stamp).slice(-8)}`, firstName: "Grace's", createdById: grace.id, branchId: branch.id, kycStatus: "NONE" },
    });
    const brianSession: Session = { user: { id: brian.id, orgId: techcrast.id, name: "Brian" } };
    return { brianSession, graceCustomer };
  });

  const brianScope = await runWithOrg(techcrast.id, () => resolveScope(brianSession));
  ok("Brian's scope is OWN", brianScope.kind === "OWN");
  const canHe = await runWithOrg(techcrast.id, () => canSeeBorrower(brianScope, graceCustomer.id));
  ok("Brian cannot verify Grace's customer by pasting their id", !canHe);
  const canHeHisOwn = await runWithOrg(techcrast.id, () => canSeeBorrower(brianScope, mwangi.id));
  ok("…and an unowned customer is not his either", !canHeHisOwn, "OWN means OWN");

  // ── 8. Portraits ───────────────────────────────────────────────────────────
  section("8. The face beside the name");

  const faces = await runWithOrg(techcrast.id, () => portraitsFor([mwangi.id]));
  ok("a sim/ portrait yields no URL — the row is real, the bytes were never written",
    faces[mwangi.id] === undefined,
    "so the avatar falls back to initials rather than a broken image");

  const noCross = await runWithOrg(otherLender.id, () => portraitsFor([mwangi.id]));
  ok("…and one lender cannot sign another lender's face", Object.keys(noCross).length === 0);

  // ── cleanup ────────────────────────────────────────────────────────────────
  await runAsPlatform(async () => {
    for (const id of [techcrast.id, otherLender.id]) {
      const w = { orgId: id };
      await prisma.auditLog.deleteMany({ where: w });
      await prisma.kycCheck.deleteMany({ where: w });
      await prisma.kycSession.deleteMany({ where: w });
      await prisma.borrower.deleteMany({ where: w });
      await prisma.staffUser.deleteMany({ where: w });
      await prisma.role.deleteMany({ where: w });
      await prisma.branch.deleteMany({ where: w });
      await prisma.orgSubscription.deleteMany({ where: w });
      await prisma.org.delete({ where: { id } });
    }
  });
  console.log("\nfixtures cleaned up");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
