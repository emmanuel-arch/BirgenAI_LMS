// The router's tests — the file that replaces a human finger.
//
//   npm run test:router     (pure — no database, no model, no browser)
//
// Collapsing three tiles into one assistant took the routing decision away from the
// user. That is only an improvement if the decision is at least as safe as the one
// they were making, and "at least as safe" is not an opinion — it is this file.
//
// THE ONE THAT MATTERS: a request for a hard number must never reach the engine that
// reasons. Section 1 is that property, stated forty different ways. Everything else
// is comfort; section 1 is the product's integrity.
import { routeQuestion, ENGINE_LABEL, type Engine } from "@/lib/riri/router";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};

const ADMIN = {
  rights: new Set<string>(["*"]),
  features: new Set<string>(["riri", "portfolio-scan", "statement-cruncher", "route-planner", "model-tuning", "document-parser"]),
};

const expect = (q: string, want: Engine, ctx: Parameters<typeof routeQuestion>[1] = { access: ADMIN }) => {
  const r = routeQuestion(q, ctx);
  ok(`"${q}" → ${want}`, r.engine === want, r.engine === want ? r.confidence : `got ${r.engine} (${r.why})`);
  return r;
};

// ── 1. A NUMBER NEVER REACHES THE REASONING ENGINE ───────────────────────────
console.log("1. Anything asking for a figure goes to the engine that queries");
{
  const numbers = [
    "what's my outstanding loan book",
    "how much did we collect last month",
    "how many active loans do we have",
    "what's my PAR 30 by product",
    "top 5 borrowers by balance",
    "disbursements over time",
    "which branch has the worst arrears",
    "what's our collection rate this quarter",
    "interest earned by product this year",
    "how much is in arrears over 90 days",
    "total disbursed year to date",
    "new borrowers per month this year",
    "what is the default rate",
    "show me PAR buckets",
    "which officer disbursed the most last month",
    "average loan size",
    "how many applications are waiting",
    "portfolio at risk",
    "value at risk this week",
    "approval rate compared to last month",
  ];
  for (const q of numbers) expect(q, "analytics");
}

// ── 2. Platform questions go to the platform ─────────────────────────────────
console.log("\n2. How, where and why-blocked go to the engine that knows the system");
{
  const platform = [
    "how do i apply for a loan for a customer",
    "how do i register a new borrower",
    "why can't i disburse this loan",
    "who can see whose customers",
    "how do i upgrade our package",
    "take me to create credit policies",
    "where do i find the income statement",
    "how do i connect our own m-pesa",
    "how do i add a branch and put staff in it",
    "what does the reconciliation screen do",
    "how do i give someone approval rights",
    "configure the approval workflow",
    "why is the approve button greyed out",
    "ninawezaje kutengeneza bidhaa ya mkopo",
    "what can you do",
    "can you approve a loan",
    "credit policy",
    "maker checker",
  ];
  for (const q of platform) expect(q, "support");
}

// ── 3. Judgement, people and drafting go to the assistant ────────────────────
console.log("\n3. A read, a person or a script goes to the engine that reasons");
{
  const judgement = [
    "who should i chase first today",
    "can i give this customer a top-up",
    "should i restructure or push for full payment",
    "how do i say no to them without losing them",
    "draft the call for a customer 12 days late",
    "is this customer worth graduating",
    "what am i missing about this application",
    "write an SMS reminding them, in Kiswahili",
    "why is their limit so low",
    "are they likely to pay this month",
    "is my book drifting",
    "they're asking for more than their limit — what do i say",
  ];
  for (const q of judgement) expect(q, "assistant");
}

// ── 4. The pinned-customer guard ─────────────────────────────────────────────
console.log("\n4. A figure ABOUT ONE PERSON is a record lookup, not an aggregate");
{
  const pinned = { hasSubject: true, access: ADMIN };
  expect("how much do they owe", "assistant", pinned);
  expect("how many loans have they taken", "assistant", pinned);
  expect("what's their balance", "assistant", pinned);
  // …but an aggregate asked while pinned is still an aggregate.
  expect("what's the total outstanding across the whole book", "analytics", pinned);
  expect("what's my PAR 30 by product", "analytics", pinned);

  const r = routeQuestion("how much do they owe", pinned);
  ok("…and it offers the book reading as one tap", r.alternative?.engine === "analytics", r.alternative?.label);
}

// ── 5. It says which engine ran, and why ─────────────────────────────────────
console.log("\n5. Every routing is explainable in one line");
{
  const qs = [
    "what's my outstanding loan book",
    "how do i disburse",
    "should i top them up",
    "asdkjh qwe zzz",
  ];
  for (const q of qs) {
    const r = routeQuestion(q, { access: ADMIN });
    ok(`"${q}" carries a reason`, r.why.length > 12 && /[.!]$/.test(r.why), `${ENGINE_LABEL[r.engine]}: ${r.why}`);
  }
}

// ── 6. When it cannot tell, it does not pretend ──────────────────────────────
console.log("\n6. Ambiguity is offered, not guessed");
{
  const vague = routeQuestion("tell me about the book", { access: ADMIN });
  ok("an ambiguous question is marked unsure", vague.confidence === "unsure", `${vague.engine}/${vague.confidence}`);
  ok("…and carries the other reading", !!vague.alternative, vague.alternative?.label);

  const certain = routeQuestion("what's my PAR 30 by product", { access: ADMIN });
  ok("a clear number question is certain", certain.confidence === "certain");
  ok("…and offers no alternative to muddy it", !certain.alternative);
}

// ── 7. Determinism ───────────────────────────────────────────────────────────
console.log("\n7. Same words, same engine — always");
{
  const q = "how much did we collect last month";
  const runs = new Set(Array.from({ length: 50 }, () => routeQuestion(q, { access: ADMIN }).engine));
  ok("fifty runs, one answer", runs.size === 1, [...runs].join("/"));

  const noAccess = routeQuestion(q);
  ok("it routes without a session too (pure)", noAccess.engine === "analytics");
  ok("an empty question does not crash", routeQuestion("").engine === "support");
  ok("whitespace does not crash", routeQuestion("   \n  ").engine === "support");
}

console.log(`\n${fail === 0 ? "ALL GREEN" : "FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
