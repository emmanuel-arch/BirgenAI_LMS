// The system map's drift tests.
//
//   npm run test:map        (pure — no database, no model, no browser)
//
// The map is what lets ServiceSuite AI say "the credit policy editor is at
// Settings → Credit policy and here is the door". Everything it claims must be
// true, and there are exactly three ways for it to stop being true:
//
//   1. A SCREEN MOVES OR DIES and the map still names it. The assistant sends a
//      lender to a 404 and the lender concludes the software is broken.
//   2. A SCREEN SHIPS AND NOBODY DESCRIBES IT. Silent, and the worst of the three:
//      the surface exists, the menu shows it, and the assistant says "I don't know".
//      This is exactly how the map came to be missing half the console.
//   3. RETRIEVAL REGRESSES. The entries are all correct and the question no longer
//      reaches them.
//
// Each gets a test below. The third is pinned with the questions a founder and a
// loan officer actually type, including the one that started this: "take me to
// create credit policies".
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  SYSTEM_SCREENS, SYSTEM_CONCEPTS, findScreens, findConcepts, resolveDestination,
  screenById, screensFor,
} from "@/lib/riri/system-map";
import { answerFromMap, isNavigationIntent } from "@/lib/riri/guide";
import { NAV_REGISTRY } from "@/lib/nav/registry";
import { ALL_RIGHTS } from "@/lib/rbac/rights";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};

const APP = join(process.cwd(), "src", "app");

/** Does this href have a page behind it? Query strings and dynamic ids stripped. */
function routeExists(href: string): boolean {
  const path = href.split("?")[0].replace(/\/$/, "");
  if (!path.startsWith("/")) return false;
  return existsSync(join(APP, ...path.slice(1).split("/"), "page.tsx"));
}

const ADMIN = { rights: new Set<string>(["*"]), features: new Set<string>(["riri", "portfolio-scan", "statement-cruncher", "route-planner", "model-tuning", "document-parser"]) };
const OFFICER = {
  rights: new Set<string>(["borrowers.view", "borrowers.create", "loans.view", "loans.apply", "applications.view", "collections.view", "repayments.view"]),
  features: new Set<string>(["statement-cruncher"]),
};

// ── 1. Every screen the map names is real ────────────────────────────────────
console.log("1. Every href in the map resolves to a page that exists");
{
  const broken = SYSTEM_SCREENS.filter((s) => !routeExists(s.href));
  ok("no dead destinations", broken.length === 0, broken.map((b) => `${b.id} → ${b.href}`).join(", "));

  const conceptDoors = SYSTEM_CONCEPTS.flatMap((c) => (c.screens ?? []).map((id) => ({ c: c.id, id })));
  const danglingDoors = conceptDoors.filter((d) => !screenById(d.id));
  ok("every concept points at a screen that exists", danglingDoors.length === 0, danglingDoors.map((d) => `${d.c} → ${d.id}`).join(", "));

  const dangling = SYSTEM_SCREENS.flatMap((s) => (s.related ?? []).map((r) => ({ from: s.id, r })))
    .filter((x) => !screenById(x.r) && !SYSTEM_CONCEPTS.some((c) => c.id === x.r));
  ok("every related[] id resolves", dangling.length === 0, dangling.map((d) => `${d.from} → ${d.r}`).join(", "));
}

// ── 2. Every menu item is described ──────────────────────────────────────────
console.log("\n2. Nothing on the sidebar is a stranger to the assistant");
{
  const navHrefs = NAV_REGISTRY.flatMap((m) => m.items).filter((i) => i.href).map((i) => i.href!);
  const mapHrefs = new Set(SYSTEM_SCREENS.map((s) => s.href));
  const missing = navHrefs.filter((h) => !mapHrefs.has(h));
  ok("every nav href appears in the map", missing.length === 0, missing.join(", "));

  const ids = SYSTEM_SCREENS.map((s) => s.id);
  ok("no duplicate screen ids", new Set(ids).size === ids.length);

  const rights = new Set<string>(ALL_RIGHTS);
  const badRights = SYSTEM_SCREENS
    .flatMap((s) => [s.right, ...(s.anyRight ?? [])])
    .filter((r) => r !== undefined)
    .filter((r) => !rights.has(r as string));
  ok("every right named is a real right", badRights.length === 0, badRights.join(", "));

  const thin = SYSTEM_SCREENS.filter((s) => s.asks.length < 3 || s.does.length < 1 || s.purpose.length < 20);
  ok("no thin entries (≥3 phrasings, ≥1 verb, a real purpose)", thin.length === 0, thin.map((t) => t.id).join(", "));
}

// ── 3. Retrieval: the questions people actually type ─────────────────────────
console.log("\n3. Retrieval lands on the right screen");
{
  const cases: [string, string][] = [
    // The one that started this.
    ["take me to create credit policies", "credit-policy"],
    ["where do i write our credit policy", "credit-policy"],
    ["change the score ceilings", "credit-policy"],
    ["graduation ladder", "credit-policy"],
    // Screens the corpus never covered.
    ["income statement", "income-statement"],
    ["how much did we make", "income-statement"],
    ["unallocated payment", "reconciliation"],
    ["show me the pipeline", "pipeline"],
    ["who guaranteed this loan", "sureties"],
    ["audit trail", "oversight"],
    ["crunch a statement", "crunch"],
    ["closed loop", "closed-loop"],
    ["open the analytics studio", "analytics-studio"],
    ["customers near me", "field-nearby"],
    ["message templates", "sms-templates"],
    ["borrower settings", "borrower-settings"],
    ["minimum age", "borrower-settings"],
    // Old ground still holds.
    ["add a branch", "branches"],
    ["invite a staff member", "team"],
    ["create a loan product", "products"],
    ["single sign on", "suite"],
  ];
  for (const [q, want] of cases) {
    const hit = findScreens(q, ADMIN, 1)[0];
    ok(`"${q}" → ${want}`, hit?.screen.id === want, hit ? `got ${hit.screen.id} (${hit.score.toFixed(0)})` : "no hit");
  }

  // The vault is a drawer ON the settings launcher, so `settings` and `vault-settings`
  // share a route on purpose — they carry different consequences, not different doors.
  // Assert where the person ENDS UP, which is the only thing that can be wrong.
  ok(`"connect our mpesa" lands on the settings launcher`,
    findScreens("connect our mpesa", ADMIN, 1)[0]?.screen.href === "/console/settings",
    findScreens("connect our mpesa", ADMIN, 1)[0]?.screen.href);
}

// ── 4. Concepts beat screens when the question is about the model ────────────
console.log("\n4. A question about how it WORKS is not answered with a link");
{
  const cases: [string, string][] = [
    ["who can see whose customers", "who-sees-what"],
    ["why do i need a second person to approve", "maker-checker"],
    ["how does money move", "money-in-out"],
    ["where does the limit come from", "score-to-limit"],
    ["joining fee vs processing fee", "fees"],
    ["can an admin make themselves super admin", "security-model"],
    ["can you approve a loan", "assistant-limits"],
    ["where are my old conversations", "assistant-apps"],
    ["turn on autopilot", "assistant-apps"],
  ];
  for (const [q, want] of cases) {
    const hit = findConcepts(q, 1)[0];
    ok(`"${q}" → ${want}`, hit?.concept.id === want, hit ? `got ${hit.concept.id}` : "no hit");
  }

  const a = answerFromMap("who can see whose customers", ADMIN);
  ok("the answer is shaped as a concept, not a destination", a?.shape === "concept", a?.shape);
  ok("…and still ends in a door", (a?.actions.length ?? 0) > 0);
}

// ── 5. Autopilot refuses to move on a guess ──────────────────────────────────
console.log("\n5. Autopilot resolves one screen or none");
{
  ok("a clear ask resolves", resolveDestination("take me to the credit policy", ADMIN)?.screen.id === "credit-policy");
  // The founder's exact words, plural and all. This is the case that made the
  // retrieval stem in the first place: it used to score 10 and Autopilot refused.
  ok("…including the plural the founder actually typed",
    resolveDestination("take me to create credit policies", ADMIN)?.screen.id === "credit-policy",
    String(findScreens("take me to create credit policies", ADMIN, 1)[0]?.score));
  ok("…and 'go to reconciliation' moves", resolveDestination("go to reconciliation", ADMIN)?.screen.id === "reconciliation");
  ok("…and 'open borrower settings' moves", resolveDestination("open borrower settings", ADMIN)?.screen.id === "borrower-settings");
  ok("nonsense resolves to nothing", resolveDestination("asdkjhasd qwe zzz", ADMIN) === null);
  ok("an empty question resolves to nothing", resolveDestination("", ADMIN) === null);
  // THE MARGIN RULE. A word that lives on one screen resolves; a word that lives on
  // several refuses, because landing somebody somewhere they didn't ask for costs
  // them the work of finding out where they are before they can ask again.
  for (const vague of ["credit", "payment", "score", "customer"]) {
    const r = resolveDestination(vague, ADMIN);
    ok(`"${vague}" fits several screens — nothing moves`, r === null, r?.screen.id);
  }
  for (const [clear, want] of [["fees", "charges"], ["risk", "early-warning"]] as const) {
    ok(`"${clear}" has one home — it moves`, resolveDestination(clear, ADMIN)?.screen.id === want);
  }

  ok("navigation intent is detected", isNavigationIntent("take me to products"));
  ok("a how-to is not navigation intent", !isNavigationIntent("how do i price a loan product"));
}

// ── 6. Access: the map never explains a screen you cannot open ───────────────
console.log("\n6. The map answers to rights and to the package");
{
  const officerAsksSettings = answerFromMap("open the credit policy", OFFICER);
  ok("an officer is told whose job it is, not how to do it",
    !!officerAsksSettings && /isn't on your access/i.test(officerAsksSettings.answer), officerAsksSettings?.answer.slice(0, 60));
  ok("…and is offered no door into it", officerAsksSettings?.actions.length === 0);

  const noPlan = answerFromMap("open model tuning", { rights: new Set(["*"]), features: new Set() });
  ok("a feature off the package is named with its price, not a wall",
    !!noPlan && /isn't on your package/i.test(noPlan.answer), noPlan?.answer.slice(0, 60));
  ok("…and the door offered is billing", noPlan?.actions[0]?.href === "/console/billing");

  const mine = screensFor(OFFICER).map((s) => s.id);
  ok("an officer's reachable set excludes settings", !mine.includes("credit-policy"));
  ok("…and includes their own work", mine.includes("borrowers-list") && mine.includes("collections-queue"));
  ok("…and excludes screens that need a row to open", !mine.includes("borrower-360"));
}

// ── 7. Shape of a capability answer ──────────────────────────────────────────
console.log("\n7. A capability answer carries the consequences, not just the purpose");
{
  const a = answerFromMap("what is the credit policy screen for", ADMIN);
  ok("it answers", !!a, a?.shape);
  ok("it names the verbs", !!a && /What you do there/.test(a.answer));
  ok("it names the implications", !!a && /Worth knowing/.test(a.answer));
  ok("it ends in the right door", a?.actions[0]?.href === "/console/settings/credit");

  const nav = answerFromMap("take me to the credit policy", ADMIN);
  ok("a navigation answer is short — no verb list", !!nav && !/What you do there/.test(nav.answer));
  ok("…and still goes to the right place", nav?.actions[0]?.href === "/console/settings/credit");
}

console.log(`\n${fail === 0 ? "ALL GREEN" : "FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
