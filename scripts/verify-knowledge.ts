// The pack validator's and the grounding traps' tests.
//
//   npm run test:knowledge     (pure — no database, no model, no network)
//
// Two properties, and both of them are about what Riri is ALLOWED to say when the
// facts are somebody else's:
//
//   1. A tenant pack cannot describe our software. That is the line that makes
//      "train it on your own JSON" safe to hand to a competitor's staff, and it has
//      to be enforced by the validator rather than by the person uploading.
//   2. The six known-wrong readings of this book produce a caveat or a refusal, not
//      a number. These are the questions a lender asks in week one.
import {
  validatePack, appRouteProblem, sourceRef, embeddableText,
  type Pack, type PackEntry,
} from "@/lib/riri/pack";
import { checkTraps, mustRefuse, trapGrounding, trapIds, TRAPS } from "@/lib/riri/traps";
import * as fs from "node:fs";
import * as path from "node:path";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};

/** A minimal valid tenant pack, which each test then breaks in one specific way. */
const base = (over: Partial<Pack> = {}, entry: Partial<PackEntry> = {}): unknown => ({
  pack: "micromart.products",
  owner: "KE/LENDER/P051234567X",
  version: 3,
  authority: "tenant",
  audience: ["customer", "staff"],
  lang: "en",
  entries: [{
    category: "products",
    question: "What loan products do you offer?",
    variants: ["products gani", "what can I borrow"],
    answer: "We offer Business Boost, a School Fees Loan and a Personal Loan.",
    ...entry,
  }],
  ...over,
});

const errorsAt = (input: unknown, at: string): boolean => {
  const r = validatePack(input);
  return !r.ok && r.issues.some((i) => i.level === "error" && i.at === at);
};

// ─────────────────────────────────────────────────────────────────────────────
console.log("1. A valid tenant pack is accepted");
{
  const r = validatePack(base());
  ok("the minimal pack validates", r.ok, r.ok ? "" : JSON.stringify(r.issues));
  if (r.ok) {
    ok("…and carries its identity onto answers",
      sourceRef(r.pack).pack === "micromart.products" && sourceRef(r.pack).version === 3);
    ok("…and embeds question + variants + answer together",
      embeddableText(r.pack.entries[0]).includes("products gani") &&
      embeddableText(r.pack.entries[0]).includes("Business Boost"));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n2. THE RULE — a tenant pack cannot describe our software");
{
  // The shapes a user reads as an instruction and acts on.
  const navAnswers = [
    "Go to Settings and add your details there.",
    "Click Save when you are done.",
    "Tap the Apply button on your dashboard.",
    "Open the Borrowers screen to find them.",
    "Head to Products, then set the rate.",
    "Use Settings → Vault to connect M-Pesa.",
    "In the console, click Disburse to release the money.",
  ];
  for (const answer of navAnswers)
    ok(`refused: "${answer.slice(0, 42)}…"`, errorsAt(base({}, { answer }), "entries[0].answer"));

  // …while ordinary tenant facts, including ones that mention actions in the world,
  // must still get through. A validator that refuses real answers is not used.
  const fineAnswers = [
    "Our processing fee is 3% of the approved amount, deducted at disbursement.",
    "Call us on 0700 000 000 between 8am and 5pm.",
    "Bring your national ID and your last three months of statements.",
    "Repayment is due every 30 days from disbursement.",
    "You can pay to till 5620596.",
    "Visit https://micromart.co.ke/products to compare them.",
  ];
  for (const answer of fineAnswers) {
    const r = validatePack(base({}, { answer }));
    ok(`allowed: "${answer.slice(0, 42)}…"`, r.ok, r.ok ? "" : JSON.stringify(r.issues.filter(i => i.level === "error")));
  }

  // Somebody ELSE's rail is not our software. This exemption is what lets the most
  // valuable customer answer we have exist at all — the one about *334#.
  console.log("   …and steps for an external rail are still allowed");
  const railAnswers = [
    "Dial *334# and choose Ratiba to set up a standing order.",
    "Open the M-PESA app and tap Ratiba to see your subscriptions.",
    "Press 1 on the Safaricom menu to confirm.",
  ];
  for (const answer of railAnswers) {
    const r = validatePack(base({}, { answer }));
    ok(`allowed: "${answer.slice(0, 42)}…"`, r.ok, r.ok ? "" : JSON.stringify(r.issues.filter(i => i.level === "error")));
  }

  // …but naming an external rail must not become a bypass. This is the hole the
  // first version of the exemption had: add "M-Pesa" to any walkthrough of OUR
  // screens and it sailed through, which is exactly what an integration doc does.
  console.log("   …and mentioning a rail does not launder a walkthrough of ours");
  const bypassAttempts = [
    "Use Settings → Vault to connect M-Pesa.",
    "Go to Settings in the console to add your M-Pesa paybill.",
    "Click Save on the Vault screen once your Safaricom keys are in.",
  ];
  for (const answer of bypassAttempts)
    ok(`refused: "${answer.slice(0, 42)}…"`, errorsAt(base({}, { answer }), "entries[0].answer"));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n3. …and cannot link into the app");
{
  ok("relative route refused", errorsAt(base({}, { url: "/console/borrowers/new" }), "entries[0].url"));
  ok("dot-relative refused", errorsAt(base({}, { url: "./apply" }), "entries[0].url"));
  ok("bare host refused", errorsAt(base({}, { url: "micromart.co.ke" }), "entries[0].url"));
  ok("javascript: refused", errorsAt(base({}, { url: "javascript:alert(1)" }), "entries[0].url"));
  ok("https allowed", validatePack(base({}, { url: "https://micromart.co.ke/products" })).ok);
  ok("appRouteProblem explains itself", (appRouteProblem("/console") ?? "").includes("system map"));
  ok("appRouteProblem passes a real URL", appRouteProblem("https://x.co/y") === null);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n4. Identity — a pack must say whose facts these are");
{
  ok("bare EntityId refused as owner", errorsAt(base({ owner: "3002" }), "owner"));
  ok("EntityId-shaped owner refused", errorsAt(base({ owner: "KE/LENDER/3003" }), "owner"));
  ok("KRA PIN accepted", validatePack(base({ owner: "KE/LENDER/P051234567X" })).ok);
  ok("version must be a whole number ≥ 1", errorsAt(base({ version: 0 }), "version"));
  ok("pack id must be a slug", errorsAt(base({ pack: "Micromart Products" }), "pack"));
  ok("only platform may claim platform authority",
    errorsAt(base({ authority: "platform" }), "authority"));
  ok("a document pack must name its source",
    errorsAt(base({ authority: "document", source: undefined }), "source"));
  ok("internal content can never be customer-facing",
    errorsAt(base({ audience: ["internal", "customer"] }), "audience"));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n5. Hygiene that keeps a corpus reviewable");
{
  const dup = base();
  (dup as { entries: PackEntry[] }).entries.push({
    category: "products",
    question: "what loan products do you offer?",
    answer: "Something else entirely.",
  });
  ok("duplicate questions refused", errorsAt(dup, "entries[1].question"));

  ok("a bad date is refused", errorsAt(base({}, { review_by: "next March" }), "entries[0].review_by"));
  ok("review before effective is refused",
    errorsAt(base({}, { effective_from: "2026-09-01", review_by: "2026-08-01" }), "entries[0].review_by"));

  const money = validatePack(base({}, { answer: "The fee is KES 1,500 per application." }));
  ok("a figure with no review date warns",
    money.ok && money.warnings.some((w) => w.at === "entries[0].review_by"));

  ok("all errors are reported at once, not one per round-trip", (() => {
    const r = validatePack({ pack: "BAD ID", owner: "3002", version: 0, authority: "tenant", lang: "fr", audience: [], entries: [] });
    return !r.ok && r.issues.filter((i) => i.level === "error").length >= 5;
  })());

  ok("garbage does not crash it", !validatePack("not a pack").ok);
  ok("null does not crash it", !validatePack(null).ok);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n6. The six traps fire on the questions a lender actually asks");
{
  const expectTrap = (q: string, id: string) => {
    const hits = checkTraps(q);
    ok(`"${q}" → ${id}`, hits.some((h) => h.trap.id === id),
      hits.length ? trapIds(hits).join(",") : "no trap fired");
  };

  expectTrap("how long do our loans take to settle", "settlement-date");
  expectTrap("what's the average time to clear a loan", "settlement-date");
  expectTrap("show me loans cleared last month", "settlement-date");
  expectTrap("how much have we earned in penalties this year", "penalties");
  expectTrap("are we charging late fees", "penalties");
  expectTrap("is this customer KYC verified", "kyc-simulated");
  expectTrap("what did the ID check say", "kyc-simulated");
  expectTrap("where does my payment go", "repayment-allocation");
  expectTrap("can I pay towards savings instead", "repayment-allocation");
  expectTrap("did the SMS go out", "sms-outbox");
  expectTrap("how many messages were delivered yesterday", "sms-outbox");
  expectTrap("compare entity 3003 across servers", "entity-identity");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n7. A refusal is a refusal, and a caveat is not");
{
  const settle = checkTraps("what is our average settlement time");
  const refusal = mustRefuse(settle);
  ok("settlement questions refuse outright", refusal !== null);
  ok("…and the refusal explains why, not just that", (refusal?.trap.say ?? "").includes("DateCleared"));

  const pen = checkTraps("how much did we collect in penalties");
  ok("penalties caveat, not refusal", pen.length > 0 && mustRefuse(pen) === null);

  ok("grounding is phrased as facts about the data",
    trapGrounding(pen).includes("KNOWN DEFECTS") && trapGrounding(pen).includes("6 of 37"));

  ok("an ordinary question trips nothing", checkTraps("what is my outstanding loan book").length === 0);
  ok("…so does a greeting", checkTraps("niaje").length === 0);
  ok("empty input is safe", checkTraps("").length === 0 && trapGrounding([]) === "");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n8. The traps themselves are well-formed");
{
  ok("every trap has a distinct id", new Set(TRAPS.map((t) => t.id)).size === TRAPS.length);
  ok("all six are present", TRAPS.length === 6, `${TRAPS.length}`);
  ok("every trap states its truth and its words",
    TRAPS.every((t) => t.truth.length > 80 && t.say.length > 80));
  ok("checking is deterministic", (() => {
    const q = "how long do loans take to settle";
    return new Set(Array.from({ length: 50 }, () => trapIds(checkTraps(q)).join(","))).size === 1;
  })());
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n9. The shipped packs validate — the pipeline, end to end");
{
  const dir = path.join(process.cwd(), "src", "lib", "riri", "packs");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
  ok("there is at least one shipped pack", files.length > 0, `${files.length} file(s)`);

  for (const f of files) {
    let parsed: unknown;
    try { parsed = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); }
    catch (e) { ok(`${f} is valid JSON`, false, String(e)); continue; }

    const r = validatePack(parsed);
    ok(`${f} validates`, r.ok,
      r.ok ? `${(parsed as Pack).entries.length} entries, v${(parsed as Pack).version}`
           : r.issues.filter((i) => i.level === "error").map((i) => `${i.at}: ${i.message}`).join(" | "));

    // Warnings are not failures, but an unreviewed figure should be visible.
    if (r.ok && r.warnings.length)
      console.log(`        ${r.warnings.length} warning(s): ${r.warnings.map((w) => w.at).join(", ")}`);
  }

  // The answer this whole exercise exists for.
  const ratiba = files.includes("ratiba.pack.json")
    ? (JSON.parse(fs.readFileSync(path.join(dir, "ratiba.pack.json"), "utf8")) as Pack)
    : null;
  ok("the Ratiba pack is shipped", ratiba !== null);
  if (ratiba) {
    const ussd = ratiba.entries.find((e) => e.variants?.some((v) => v.includes("*334#")) || e.answer.includes("*334#"));
    ok("…and it answers the *334# question without a human", !!ussd);
    ok("…in the customer's audience", ratiba.audience.includes("customer"));
    ok("…and it names the agreement it came from", !!ratiba.source?.title);
  }
}

console.log(`\n${fail === 0 ? "ALL GREEN" : "FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
