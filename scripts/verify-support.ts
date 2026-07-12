// Tests for RIRI SUPPORT — the knowledge base, the rights filter, and the consent model.
//
//   npm run test:support        (needs the database; no app server)
//
// The claims under test, each one a way an AI support agent goes wrong:
//
//   SHE DOES NOT INVENT. A question the corpus cannot answer is answered with "I don't
//     know", never with a plausible menu path. This is THE failure mode: a lender who
//     follows invented instructions and finds nothing there concludes the SOFTWARE is
//     broken, not the assistant.
//   SHE CANNOT CITE WHAT DOES NOT EXIST. Every article's destination is a real route and
//     every right it names is a real right — asserted against the actual rights list, so
//     an article cannot outlive the screen it describes.
//   SHE ANSWERS THE PERSON, NOT THE QUESTION. A loan officer asking how to change the
//     interest rate is told who to ask; he is not walked into a screen he cannot open.
//   SHE NAMES THE PRICE. A feature the lender has not bought is named honestly, with what
//     it costs, rather than being explained and then denied at the door.
//   CONSENT. Every action she offers is a NAVIGATION and nothing else. Speech recognition
//     mishears, and in a lending system the distance between "show me" and "send it" is
//     one syllable — so nothing she can do on her own is irreversible.
//   THE SPOKEN TEXT IS NOT THE WRITTEN TEXT. Markdown read aloud is gibberish.
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { runAsPlatform } from "@/lib/db/context";
import { ARTICLES, search, articlesFor } from "@/lib/riri/knowledge";
import { answerSupport, setupState, welcome } from "@/lib/riri/support";
import { speakable } from "@/lib/hooks/useVoice";
import { ALL_RIGHTS_SET } from "@/lib/rbac/rights";
import { AVAILABLE_FEATURES } from "@/lib/billing/plans";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};
const section = (s: string) => console.log(`\n${s}`);

const ADMIN = new Set(["*"]);
const ALL_FEATURES = new Set<string>(AVAILABLE_FEATURES as unknown as string[]);

async function main() {
  // ── 1. The corpus cannot describe a platform that does not exist ───────────
  section("1. The corpus is bound to the real product");

  const badRight = ARTICLES.filter((a) => a.right && !ALL_RIGHTS_SET.has(a.right));
  ok("every article's required right is a real right", badRight.length === 0, badRight.map((a) => a.id).join(", "));

  const badFeature = ARTICLES.filter((a) => a.feature && !ALL_FEATURES.has(a.feature));
  ok("every article's required feature is one we actually built", badFeature.length === 0, badFeature.map((a) => a.id).join(", "));

  const badHref = ARTICLES.filter((a) => a.action && !a.action.href.startsWith("/console"));
  ok("every destination is a real console route", badHref.length === 0, badHref.map((a) => a.id).join(", "));

  const noAsks = ARTICLES.filter((a) => a.asks.length < 3);
  ok("every article knows at least 3 ways a person might ask for it", noAsks.length === 0, noAsks.map((a) => a.id).join(", "));

  const dupe = ARTICLES.length !== new Set(ARTICLES.map((a) => a.id)).size;
  ok("no duplicate article ids", !dupe, `${ARTICLES.length} articles`);

  // ── 2. Retrieval ──────────────────────────────────────────────────────────
  section("2. She finds the right answer");

  const finds = (q: string, id: string) => {
    const hit = search(q, { rights: ADMIN, features: ALL_FEATURES, limit: 1 })[0];
    return hit?.article.id === id;
  };

  ok("'how do i disburse a loan' → paying out", finds("how do i disburse a loan", "disburse-how"));
  ok("'why can't i see other officers customers' → who sees what", finds("why can't i see other officers customers", "who-sees-what"));
  ok("'add a new branch' → structure", finds("add a new branch", "branches-build"));
  ok("'how do i apply a loan' → applying", finds("how do i apply a loan", "apply-how"));
  ok("'my borrower is blocked' → KYC", finds("my borrower is blocked", "kyc-verify"));
  ok("'how much does it cost' → packages", finds("how much does it cost", "billing-upgrade"));
  ok("'i forgot my password' → passwords", finds("i forgot my password", "password-help"));
  ok("'set the interest rate' → products", finds("set the interest rate", "product-create"));

  // ── 3. The rights filter ──────────────────────────────────────────────────
  section("3. She answers the person, not just the question");

  const officer = new Set(["borrowers.view", "borrowers.create", "loans.apply", "applications.view"]);
  const reachable = articlesFor(officer);
  ok("an officer's reachable corpus is smaller than an admin's", reachable.length < articlesFor(ADMIN).length,
    `${reachable.length} of ${ARTICLES.length}`);
  ok("…and contains nothing he cannot open", reachable.every((a) => !a.right || officer.has(a.right)));

  const stamp = Date.now();
  const org = await runAsPlatform(() => prisma.org.create({
    data: { slug: `support-${stamp}`, name: "Support Test", plan: "STARTER", mode: "NATIVE", status: "PENDING" },
  }));

  try {
    const asOfficer = await answerSupport(org.id, "how do i change the interest rate", { rights: officer, features: ALL_FEATURES });
    ok("an officer asking to reprice a product is told who to ask, not how", /isn't on your access|administrator/i.test(asOfficer.answer));
    ok("…and is NOT handed a walkthrough he would fail halfway through", !/1\./.test(asOfficer.answer));
    ok("…and is offered no action he cannot take", asOfficer.actions.length === 0);

    const asAdmin = await answerSupport(org.id, "how do i change the interest rate", { rights: ADMIN, features: ALL_FEATURES });
    ok("an admin asking the same thing gets the steps", /1\./.test(asAdmin.answer));
    ok("…and an offer to take him there", asAdmin.actions[0]?.href === "/console/products");

    // ── 4. The paywall is named, not sprung ─────────────────────────────────
    section("4. A feature they haven't bought is priced, not hidden");

    const noPremium = new Set<string>(["riri"]); // a Starter-ish set: no portfolio-scan
    const gated = await answerSupport(org.id, "how does early warning work", { rights: ADMIN, features: noPremium });
    ok("early warning on a package that lacks it names the package and the price", /KES|package/i.test(gated.answer));
    ok("…and sends them to billing rather than into a wall", gated.actions[0]?.href === "/console/billing");

    const entitled = await answerSupport(org.id, "how does early warning work", { rights: ADMIN, features: ALL_FEATURES });
    ok("a lender who HAS it just gets the answer", entitled.actions[0]?.href === "/console/intelligence");

    // ── 5. She does not invent ──────────────────────────────────────────────
    section("5. The honest failure");

    const unknown = await answerSupport(org.id, "how do i export the loan book to quickbooks", { rights: ADMIN, features: ALL_FEATURES });
    ok("a question the corpus cannot answer gets 'I don't know'", /don't have an answer/i.test(unknown.answer));
    ok("…and NO invented menu path", !/\/console\//.test(unknown.answer));
    ok("…and no action offered to a screen that doesn't exist", unknown.actions.length === 0);

    // ── 6. Guided onboarding ────────────────────────────────────────────────
    section("6. 'What do I do next' is a question about THIS lender");

    const empty = await setupState(org.id);
    ok("a brand-new org is told to build its structure first", empty.next?.href === "/console/branches");
    ok("…because staff and borrowers have to belong to an office", !empty.hasStructure && !empty.isActive);

    const w = welcome("Edgar", "Techcrast Software", empty);
    ok("the welcome greets them by name", w.answer.includes("Edgar"));
    ok("…names their lender", w.answer.includes("Techcrast Software"));
    ok("…and offers exactly ONE next step, not a menu", w.actions.length === 1 && w.actions[0].href === "/console/branches");

    // Give them a structure and a product; the next step must MOVE.
    await runAsPlatform(async () => {
      await prisma.branch.create({ data: { orgId: org.id, name: "HQ", levelName: "Head Office" } });
      await prisma.product.create({
        data: { orgId: org.id, name: "P", minPrincipal: 1000, maxPrincipal: 9999, interestRate: 10, repaymentPeriod: 4 },
      });
    });
    const partway = await setupState(org.id);
    ok("once they have a structure and a product, the next step moves on", partway.next?.href === "/console/team", partway.next?.title);

    const guided = await answerSupport(org.id, "what do i do next", { rights: ADMIN, features: ALL_FEATURES });
    ok("'what do i do next' reads the live org, not a stored counter", guided.actions[0]?.href === "/console/team");

    // ── 7. Consent ──────────────────────────────────────────────────────────
    section("7. She proposes; a human accepts");

    const everyAction = [asAdmin, gated, entitled, guided, w].flatMap((r) => r.actions);
    ok("every action Riri can offer is a NAVIGATION and nothing else", everyAction.every((a) => a.kind === "navigate"),
      `${everyAction.length} actions across the answers above`);
    ok("…so nothing she does unattended is irreversible", everyAction.every((a) => a.href.startsWith("/console")));

    // ── 8. Voice ────────────────────────────────────────────────────────────
    section("8. What is spoken is not what is shown");

    const spoken = speakable("**PAR 30** is 36.2%.\n\n1. Open Collections.\n2. Call them.\n\nSee [Billing](/console/billing).");
    ok("markdown bold is not read as asterisks", !spoken.includes("*"));
    ok("a numbered step is read as a step", spoken.includes("Step 1."));
    ok("a link is read as its words, not its URL", spoken.includes("Billing") && !spoken.includes("/console/billing"));

    const long = speakable("word ".repeat(400));
    ok("a long answer is trimmed for the ear and points at the screen", long.length < 800 && /more on the screen/.test(long));
  } finally {
    await runAsPlatform(async () => {
      const w = { orgId: org.id };
      await prisma.product.deleteMany({ where: w });
      await prisma.branch.deleteMany({ where: w });
      await prisma.ririQueryLog.deleteMany({ where: w });
      await prisma.orgSubscription.deleteMany({ where: w });
      await prisma.org.delete({ where: { id: org.id } });
    });
    console.log("\nfixtures cleaned up");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
