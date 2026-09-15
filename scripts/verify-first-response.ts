// Riri First Response — the customer's first contact, pinned.
//
//   npm run test:first-response     (pure — no database, no model, no network)
//
// What this suite exists to make impossible to break quietly:
//
//   1. A customer asking about money is answered from THEIR record, every time, with
//      the figure exactly as the record holds it — and never with a figure it does
//      not hold (the bridged "next instalment" is the canonical trap).
//   2. "I want to talk to a person" is an instant escalation, in both languages.
//   3. A question about *334# is answered without a thread (plan, Sprint 2 "done when").
//   4. A money dispute is handed over, not argued with.
//   5. Navigation comes only from the app map, and the app map only names routes the
//      app actually declares (drift test against micro-eazy-app/src/App.tsx).
//   6. The model path cannot smuggle a figure past the record (figuresGrounded).
//   7. The core contracts import nothing from the application.
import * as fs from "node:fs";
import * as path from "node:path";
import { firstResponse, figuresGrounded, customerSystemPrompt, ksh, day, type CustomerFacts } from "@/lib/riri/portal/first-response";
import { customerPacks, searchCorpus, CUSTOMER_ARTICLES } from "@/lib/riri/portal/corpus";
import { APP_SCREENS, appScreenById } from "@/lib/riri/portal/app-map";
import { triageNote, caseRef } from "@/lib/riri/portal/triage";
import { resolveScreen, isScreenQuestion, normaliseRoute } from "@/lib/riri/core/context";
import { signHandoff, verifyHandoff, resolveAcross } from "@/lib/riri/core/destination";
import { gate, toolSpec } from "@/lib/riri/core/tools";
import { validatePack, type Pack } from "@/lib/riri/pack";
import { mergeRiriConfig, validateRiriConfig } from "@/lib/config/riri";
import micromartStarter from "@/lib/riri/packs/micromart.customer.pack.json";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};
const section = (t: string) => console.log(`\n${t}`);

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** A bridged Micromart customer with an open loan and no instalment schedule on the feed. */
const bridged: CustomerFacts = {
  found: true, lender: "Micromart Africa", firstName: "Emmanuel", kycStatus: "VERIFIED",
  bookSource: "lender", bookIssue: null,
  limit: 20000, outstanding: 12400, available: 7600, loanCount: 1,
  activeLoan: { ref: "884211", product: "Micro Chap Chap", balance: 12400, loanAmount: 10000, nextDue: null, expectedClearDate: "2026-10-12" },
  schedule: [], score: 642, scoreMax: 900, band: "Low risk", scoreTone: "good",
  scoreDrivers: [{ factor: "Loans repaid on time", direction: "increases" }, { factor: "Short credit history", direction: "reduces" }],
  avgDailySales: null, savings: { balance: 1350, lastAmount: 250, lastAt: "2026-09-02" },
  ratiba: { available: false, active: false, amount: null, frequency: null },
  unreadMessages: 1,
  messages: [{ id: "t1", subject: "About my application", preview: "We need…", at: new Date(), fromStaff: true, unread: true }],
  application: null,
};

/** A native customer with a real schedule. */
const native: CustomerFacts = {
  ...bridged, bookSource: "native",
  activeLoan: { ref: "AB12CD34", product: "Business Boost", balance: 9000, loanAmount: 12000, nextDue: { date: "2026-09-21", amount: 3150 }, expectedClearDate: "2026-10-05" },
  schedule: [
    { seq: 1, due: "2026-09-07", amount: 3150, status: "PAID" },
    { seq: 2, due: "2026-09-21", amount: 3150, status: "DUE" },
    { seq: 3, due: "2026-10-05", amount: 3150, status: "UPCOMING" },
  ],
  outstanding: 9000,
  ratiba: { available: true, active: true, amount: 3150, frequency: "WEEKLY" },
};

const unreachable: CustomerFacts = { ...bridged, bookSource: "unavailable", bookIssue: "unreachable", outstanding: 0, activeLoan: null };
const packs = customerPacks("micromart");
const repay = appScreenById("app-repay")!;
const ask = (q: string, facts: CustomerFacts = bridged, screen = null as typeof repay | null) =>
  firstResponse({ question: q, facts, packs, screen });

// ─────────────────────────────────────────────────────────────────────────────
section("1. Money comes from the record, exactly");

{
  const r = ask("How much do I owe?");
  ok("balance is the record's figure", r.intent === "balance" && r.answer.includes("KSh 12,400"), r.answer.slice(0, 90));
  ok("…with the loan it is on", r.answer.includes("Micro Chap Chap"));
  ok("…and the checked line names the read", r.checked.some((c) => c.said.includes("outstanding KSh 12,400")));
  ok("…offers Repay from the map", r.actions[0]?.screenId === "app-repay" && r.actions[0]?.href === "/repay");
  ok("…resolved, not a ticket", r.outcome === "resolved");
}
{
  const r = ask("nadaiwa kiasi gani?");
  ok("Kiswahili balance question answers in Kiswahili", r.lang === "sw" && r.answer.includes("KSh 12,400") && /Salio|salio/.test(r.answer), r.answer.slice(0, 80));
}
{
  const r = ask("When is my next payment?");
  ok("bridged next instalment is NOT invented", r.intent === "due" && !/KSh 3,|next instalment is/i.test(r.answer), r.answer.slice(0, 100));
  ok("…says why, and offers a person", r.outcome === "offer" && /won't work one out/.test(r.answer));
  ok("…and hands the officer the one question", /instalment/.test(r.needsHuman ?? ""));
}
{
  const r = ask("When is my next payment?", native);
  ok("native next instalment is stated from the schedule", r.answer.includes("KSh 3,150") && r.answer.includes("21 Sep 2026"), r.answer.slice(0, 90));
  ok("…with what comes after", r.answer.includes("5 Oct 2026"));
}
{
  const r = ask("What do I owe?", unreachable);
  ok("an unreachable book never renders as zero", !/KSh 0/.test(r.answer) && /won't guess/.test(r.answer));
  ok("…and offers a person", r.outcome === "offer");
}
{
  const r = ask("how much can I borrow?");
  ok("limit and availability from the record", r.intent === "limit" && r.answer.includes("KSh 20,000") && r.answer.includes("KSh 7,600"), r.answer.slice(0, 90));
}
{
  const r = ask("how do I increase my limit?");
  ok("a how-question gets the figure AND the explanation", r.answer.includes("KSh 20,000") && /reviewed every time you repay/.test(r.answer));
  ok("…and names where the explanation came from", r.sources.some((s) => s.id === "article:limit-moves"));
}
ok("score is stated with its drivers", (() => { const r = ask("what is my score"); return r.answer.includes("642") && r.answer.includes("Loans repaid on time"); })());
ok("savings are stated", ask("what are my savings?").answer.includes("KSh 1,350"));
ok("no application is a true answer, with the way to apply", (() => { const r = ask("where is my application?"); return r.intent === "application" && /don't have an application/.test(r.answer) && r.actions[0]?.screenId === "app-apply"; })());
{
  const withApp: CustomerFacts = { ...bridged, application: { id: "11111111-2222", status: "OFFICER_REVIEW", stageTitle: "Risk", amount: 8000, product: "Micro Chap Chap" } };
  const r = ask("is my loan approved?", withApp);
  ok("an application in flight names the desk", r.answer.includes("**Risk**") && r.answer.includes("KSh 8,000"));
  ok("…promises no timeline", /can't tell you when a decision will come/.test(r.answer) && !/within|hours|by tomorrow/i.test(r.answer));
  ok("…and would file under APPLICATION", r.threadKind === "APPLICATION");
}
ok("Ratiba on a bridged lender is not claimed as set", /doesn't set up M-PESA Ratiba/.test(ask("is my ratiba on?").answer));
ok("Ratiba on a native lender reads the standing order", ask("do I have a standing order?", native).answer.includes("KSh 3,150"));
ok("kyc status is plain", ask("is my id verified?").answer === "Your identity check is complete.");
ok("unread messages are counted", /\*\*1\*\* unread/.test(ask("did they reply?").answer));

// ─────────────────────────────────────────────────────────────────────────────
section("2. A person, instantly");

for (const q of ["I want to talk to a person", "can I speak to someone", "customer care", "agent", "nataka kuongea na mtu"]) {
  const r = ask(q);
  ok(`"${q}" escalates`, r.intent === "human" && r.outcome === "escalate");
}
ok("…cheerfully, without arguing", /Of course|Sawa kabisa/.test(ask("talk to a human").answer));
ok("a greeting is not an escalation", ask("hi riri").intent === "greeting");

// ─────────────────────────────────────────────────────────────────────────────
section("3. *334# without a thread");

{
  const r = ask("Do I need to dial *334# to use Ratiba?");
  ok("the Ratiba question is answered from the platform pack", r.intent === "knowledge" && /\*334#/.test(r.answer), r.sources[0]?.id);
  ok("…resolved — no thread", r.outcome === "resolved");
  ok("…stamped with the pack and version", r.sources[0]?.label.includes("platform.ratiba v1"));
}
ok("what is Ratiba", /standing-order service/.test(ask("what is ratiba").answer));
{
  const r = ask("what fees do you charge?");
  ok("fees come from the lender's pack", r.sources[0]?.id.startsWith("micromart.customer@"), r.sources[0]?.id);
  ok("…stamped as an unreviewed starter", r.sources[0]?.starter === true && /Starter pack/.test(r.sources[0]?.label ?? ""));
}
ok("how do I repay → the article, with Repay", (() => { const r = ask("how do I pay my loan"); return r.sources[0]?.id === "article:how-repay" && r.actions[0]?.screenId === "app-repay"; })());
ok("how to get an M-PESA statement → *334# steps", /\*334#/.test(ask("how do I get my mpesa statement?").answer));

// ─────────────────────────────────────────────────────────────────────────────
section("4. Disputes are handed over");

{
  const r = ask("I paid but my balance has not changed");
  ok("a payment that did not reflect is a dispute", r.intent === "dispute" && r.outcome === "escalate");
  ok("…files under REPAYMENT", r.threadKind === "REPAYMENT");
  ok("…states the balance it can see", r.answer.includes("KSh 12,400"));
  ok("…promises no timeline", !/within \d|24 hours|by tomorrow/i.test(r.answer));
}
ok("double charged → dispute", ask("I was double charged").intent === "dispute");
ok("a past clearance date is refused, not invented", (() => { const r = ask("when did I clear my last loan?"); return r.intent === "clearance" && !/\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/.test(r.answer.split("What I can see")[0]); })());

// ─────────────────────────────────────────────────────────────────────────────
section("5. The screen, and the map");

ok("what am I looking at, on Repay", (() => { const r = ask("what is this page?", bridged, repay); return r.intent === "screen" && r.answer.includes("**Repay**") && /loan first/.test(r.answer); })());
ok("…honest when the screen is unknown", /can't tell which screen/.test(ask("what is this?", bridged, null).answer));
ok("take me to my score → the Score screen", (() => { const r = ask("take me to my score"); return r.intent === "navigate" || r.intent === "score"; })());
ok("take me to repay → /repay", ask("take me to repay").actions[0]?.href === "/repay");
ok("isScreenQuestion does not swallow a real question", !isScreenQuestion("what is ratiba") && isScreenQuestion("what am I looking at?") && isScreenQuestion("hii ni nini"));
ok("routes resolve to the most specific screen", resolveScreen(APP_SCREENS, "/messages/abc-123")?.id === "app-thread" && resolveScreen(APP_SCREENS, "/messages")?.id === "app-messages");
ok("a full URL is reduced to its path", normaliseRoute("https://microeazy.servicesuitecloud.com/repay?x=1") === "/repay");
ok("an unknown route is no screen, not a guess", resolveScreen(APP_SCREENS, "/nowhere") === null);
ok("the lender home resolves to Home only by the map's own rule", resolveScreen(APP_SCREENS, "/") ?.id === "app-home");

// Drift: every href in the app map is a route the app declares.
{
  const appFile = path.resolve(__dirname, "../../micro-eazy-app/src/App.tsx");
  if (!fs.existsSync(appFile)) {
    console.log("  SKIP  app map drift — micro-eazy-app is not checked out beside connected-suite");
  } else {
    const src = fs.readFileSync(appFile, "utf8");
    const routes = [...src.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]).filter((p) => p !== "*");
    const declared = (href: string) => routes.some((r) => {
      const a = r.split("/").filter(Boolean), b = href.split("/").filter(Boolean);
      return a.length === b.length && a.every((seg, i) => seg === b[i] || (seg.startsWith(":") && b[i].startsWith(":")));
    });
    const missing = APP_SCREENS.filter((s) => !declared(s.href)).map((s) => s.href);
    ok("every app-map href is a route in App.tsx", missing.length === 0, missing.join(", ") || `${APP_SCREENS.length} screens`);
  }
}
ok("every article's screen exists in the map", CUSTOMER_ARTICLES.every((a) => !a.screen || !!appScreenById(a.screen)));
ok("the app map has the plan's ~14 screens", APP_SCREENS.length >= 12 && APP_SCREENS.length <= 16, String(APP_SCREENS.length));

// ─────────────────────────────────────────────────────────────────────────────
section("6. The model cannot smuggle a figure");

{
  const system = customerSystemPrompt(bridged, ["platform.ratiba"]);
  ok("a figure from the facts passes", figuresGrounded("You owe KSh 12,400 on Micro Chap Chap.", system));
  ok("an invented figure is refused", !figuresGrounded("Your next instalment is KSh 3,100.", system));
  ok("an invented rate is refused", !figuresGrounded("The rate is 12% a week.", system));
  ok("prose with no figures passes", figuresGrounded("I can pass that to the team for you.", system));
  ok("the prompt carries no phone or ID", !/2547\d{8}|\b\d{8}\b/.test(system));
}

// ─────────────────────────────────────────────────────────────────────────────
section("7. The triage note");

{
  const r = ask("I paid but my balance has not changed");
  const note = triageNote({ questions: ["Hi", "I paid but my balance has not changed"], response: r, screen: repay, note: "I paid on Friday at 3pm", lender: "Micromart Africa" });
  ok("carries the customer's words verbatim", note.includes("“I paid but my balance has not changed”"));
  ok("says what she checked", note.includes("outstanding KSh 12,400"));
  ok("names the screen they were on", note.includes("Repay screen"));
  ok("carries what they added", note.includes("I paid on Friday at 3pm"));
  ok("ends on the one thing a person must decide", /What needs a person:\nCheck whether the payment/.test(note));
  ok("case refs are short and stable", caseRef("0f3c2a1b-9d8e-4f00-a000-000000000000") === "ME-0F3C2A");
}

// ─────────────────────────────────────────────────────────────────────────────
section("8. Packs, tenancy and the training console's rules");

{
  const starter = validatePack({ ...(micromartStarter as object) });
  ok("the Micromart starter pack passes the tenant validator", starter.ok, starter.ok ? `${(micromartStarter as unknown as Pack).entries.length} entries` : JSON.stringify(starter.issues.slice(0, 2)));
  const staffOnly: Pack = { ...(micromartStarter as unknown as Pack), pack: "micromart.internal", audience: ["staff"] };
  ok("a staff-only pack never reaches the customer corpus", !customerPacks("micromart", [staffOnly]).some((p) => p.pack.pack === "micromart.internal"));
  const published: Pack = { ...(micromartStarter as unknown as Pack), owner: "KE/LENDER/P051234567X", version: 2 };
  const served = customerPacks("micromart", [published]).find((p) => p.pack.pack === "micromart.customer")!;
  ok("a published pack replaces the starter", served.ref.version === 2 && served.ref.starter === false);
  ok("an unknown lender gets no starter", !customerPacks("nobody").some((p) => p.ref.starter));

  const cfg = mergeRiriConfig({ member: { kraPin: "p051234567x" }, packs: [published] });
  ok("KRA PIN is normalised", cfg.member.kraPin === "P051234567X");
  ok("a pack owned by the lender's PIN publishes", validateRiriConfig(cfg).length === 0);
  ok("a pack owned by someone else does not", validateRiriConfig(mergeRiriConfig({ member: { kraPin: "P051234567X" }, packs: [{ ...published, owner: "KE/LENDER/A000000000Z" }] })).some((i) => i.path.endsWith(".owner")));
  ok("no PIN, no tenant pack", validateRiriConfig(mergeRiriConfig({ packs: [published] })).some((i) => /KRA PIN/.test(i.message)));
  ok("platform authority cannot be uploaded", validateRiriConfig(mergeRiriConfig({ member: { kraPin: "P051234567X" }, packs: [{ ...published, authority: "platform", owner: "platform" }] })).length > 0);
  ok("retrieval has a floor", searchCorpus("the quick brown fox", "en", packs).length === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
section("9. The contracts");

void (async () => {
  const secret = "test-secret-for-handoff";
  const token = await signHandoff({ from: "lms", fromTitle: "the console", to: "app", href: "https://portal.example/repay", question: "where do customers repay?" }, secret, 1_000_000);
  const good = await verifyHandoff(token, secret, 1_000_000 + 60_000);
  ok("a signed hand-off verifies", good.ok && good.handoff.href.endsWith("/repay"));
  ok("a tampered hand-off does not", !(await verifyHandoff(token.replace(/.$/, (c) => (c === "A" ? "B" : "A")), secret, 1_000_000)).ok);
  ok("an old hand-off has expired", !(await verifyHandoff(token, secret, 1_000_000 + 11 * 60_000)).ok);
  ok("the wrong secret fails", !(await verifyHandoff(token, "other", 1_000_000)).ok);

  const ctx = { system: "app" as const, surface: "customer-dock" as const, audience: "customer" as const, tenant: "org-1", tenantName: "Micromart", actor: { kind: "customer" as const, id: null, name: null }, screen: null, route: null, subject: null, lang: "en" as const, consentRef: null };
  ok("customer.record passes the gate for the customer", gate(toolSpec("customer.record")!, ctx) === null);
  ok("book.query refuses a customer", gate(toolSpec("book.query")!, ctx)?.reason === "audience");
  ok("interchange.score refuses without a consent_ref", gate(toolSpec("interchange.score")!, ctx)?.reason === "consent");
  ok("no tenant, no tool", gate(toolSpec("customer.record")!, { ...ctx, tenant: "" })?.reason === "tenant");

  const res = resolveAcross("take me to repay", [
    { system: "app", base: "https://portal.example", version: 1, title: "the app", screens: APP_SCREENS },
  ], "lms");
  ok("cross-system resolution yields an absolute link", res.kind === "one" && res.destination.href === "https://portal.example/repay" && res.destination.crossesSystem);

  // Core purity: nothing reachable from core/index.ts imports the application.
  const root = path.resolve(__dirname, "../src/lib/riri");
  const seen = new Set<string>();
  const offenders: string[] = [];
  const walk = (file: string) => {
    if (seen.has(file)) return; seen.add(file);
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+"([^"]+)"/gm)) {
      const spec = m[1];
      if (spec.startsWith("@/") || spec.startsWith("next") || spec.startsWith("@prisma") || spec === "react") offenders.push(`${path.relative(root, file)} → ${spec}`);
      else if (spec.startsWith(".")) {
        const base = path.resolve(path.dirname(file), spec);
        const hit = [base, `${base}.ts`, `${base}/index.ts`].find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
        if (hit && hit.endsWith(".ts")) walk(hit);
      }
    }
  };
  walk(path.join(root, "core/index.ts"));
  ok("the core imports nothing from the application", offenders.length === 0, offenders.join("; ") || `${seen.size} files walked`);

  ok("money formats the way the app does", ksh(1234567.4) === "KSh 1,234,567" && day("2026-09-21") === "21 Sep 2026");

  // ── The partner contract (plan §02): KRA-PIN keyed, relay-signed. ─────────
  process.env.RIRI_PARTNER_KEYS = JSON.stringify({ "KE/LENDER/P051234567X": { secret: "a-partner-secret-of-sufficient-length", org: "micromart" } });
  const { partnerFor } = await import("@/lib/riri/partner");
  const { sign, verify } = await import("@/lib/enterprise/relay");
  const p = partnerFor("KE/LENDER/P051234567X");
  ok("a registered member code resolves to its org", p?.orgSlug === "micromart");
  ok("an EntityId-shaped code does not", partnerFor("KE/LENDER/3005") === null);
  ok("an unknown code does not", partnerFor("KE/LENDER/A000000000Z") === null);
  const bodyText = JSON.stringify({ question: "What fees do you charge?" });
  const ts = String(Date.now());
  ok("a signed body verifies", verify(p!.secret, ts, bodyText, sign(p!.secret, ts, bodyText)));
  ok("one changed byte does not", !verify(p!.secret, ts, bodyText.replace("fees", "feez"), sign(p!.secret, ts, bodyText)));
  ok("an old timestamp does not", !verify(p!.secret, String(Date.now() - 10 * 60_000), bodyText, sign(p!.secret, String(Date.now() - 10 * 60_000), bodyText)));
  const staffPacks = (await import("@/lib/riri/portal/corpus")).servedPacks("micromart", [], "staff");
  ok("a partner's staff surface gets no customer-app articles", searchCorpus("how do I get my mpesa statement", "en", staffPacks, 3, false).every((h) => h.kind === "pack"));

  console.log(`\n${fail === 0 ? "ALL GREEN" : "FAILURES"} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
