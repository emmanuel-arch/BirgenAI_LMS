// Tests for KISWAHILI I18N (item 20, blueprint §5.1) — the portal dictionary,
// the borrower SMS catalogue, and Riri support's second voice.
//
//   npm run test:i18n        (pure — no database queries, no app server)
//
// The claims under test, each one a way a bilingual product quietly rots:
//
//   THE TWO DICTIONARIES CANNOT DIVERGE. The type system already makes a missing
//     Kiswahili key a compile error; what it cannot see is a Kiswahili sentence
//     that dropped `{amount}` — a reminder SMS that names no amount is worse than
//     an English one. The placeholder sets are asserted key-for-key.
//   STAFF MESSAGES NEVER LOCALISE. The Kiswahili SMS catalogue's key set IS the
//     policy of what may switch language — otp and login_code must not be in it.
//   THE QUESTION DECIDES THE LANGUAGE. detectLang must flip on real Kiswahili
//     support questions and never on English ones.
//   RETRIEVAL WORKS IN KISWAHILI. "ninawezaje kuongeza mfanyakazi" must find the
//     team article as surely as "add staff" does — same corpus, second voice.
//   THE HONESTY MACHINERY IS SHARED. The confidence floor, the who-to-ask and the
//     name-the-price answers all exist in Kiswahili; a refusal in Kiswahili is
//     still a refusal, never a guess.
import "dotenv/config";
import { EN, SW, fmt, DICT, isLang } from "@/lib/i18n/portal";
import { defaultSmsTemplates, swahiliSmsTemplates } from "@/lib/sms/send";
import { ARTICLES, search, detectLang } from "@/lib/riri/knowledge";
import { answerSupport } from "@/lib/riri/support";
import { ALL_RIGHTS_SET } from "@/lib/rbac/rights";
import { AVAILABLE_FEATURES } from "@/lib/billing/plans";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};
const section = (s: string) => console.log(`\n${s}`);

const placeholders = (s: string): string =>
  [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

/** Walk EN and SW together: same keys, non-empty leaves, identical placeholder sets. */
function walk(en: unknown, sw: unknown, path: string, problems: string[]) {
  if (typeof en === "string") {
    if (typeof sw !== "string") { problems.push(`${path}: sw is not a string`); return; }
    if (!en.trim() || !sw.trim()) problems.push(`${path}: empty string`);
    if (placeholders(en) !== placeholders(sw)) problems.push(`${path}: placeholders differ (${placeholders(en)} vs ${placeholders(sw)})`);
    return;
  }
  if (Array.isArray(en)) {
    if (!Array.isArray(sw) || sw.length !== en.length) { problems.push(`${path}: array length differs`); return; }
    en.forEach((v, i) => walk(v, (sw as unknown[])[i], `${path}[${i}]`, problems));
    return;
  }
  if (en && typeof en === "object") {
    const eKeys = Object.keys(en as object).sort();
    const sKeys = Object.keys((sw ?? {}) as object).sort();
    if (eKeys.join("|") !== sKeys.join("|")) { problems.push(`${path}: key sets differ`); return; }
    for (const k of eKeys) walk((en as Record<string, unknown>)[k], (sw as Record<string, unknown>)[k], `${path}.${k}`, problems);
  }
}

const ADMIN = new Set(["*"]);
const ALL_FEATURES = new Set<string>(AVAILABLE_FEATURES as unknown as string[]);
const NONE = new Set<string>();

async function main() {
  // ── 1. The portal dictionary — one shape, two complete voices ───────────────
  section("1. Portal dictionary parity (EN ↔ SW)");
  const problems: string[] = [];
  walk(EN, SW, "dict", problems);
  ok("every key exists in both languages with matching placeholders", problems.length === 0, problems.slice(0, 3).join(" · "));
  ok("DICT resolves both languages", DICT.en === EN && DICT.sw === SW);
  ok("isLang accepts exactly en|sw", isLang("en") && isLang("sw") && !isLang("fr") && !isLang(null));
  ok("fmt fills placeholders", fmt("KES {amount} due {date}", { amount: 500, date: "Jan 5" }) === "KES 500 due Jan 5");
  ok("fmt renders a missing var as empty, never 'undefined'", fmt("Hi {name}!", {}) === "Hi !");
  ok("the two voices actually differ (SW is not a copy)", EN.landing.titleOpen !== SW.landing.titleOpen && EN.otp.title !== SW.otp.title);

  // ── 2. Borrower SMS — the Kiswahili catalogue IS the localisation policy ────
  section("2. SMS templates");
  const en = new Map(defaultSmsTemplates().map((t) => [t.key, t.body]));
  const sw = swahiliSmsTemplates();
  ok("every Kiswahili template shadows a real built-in", sw.every((t) => en.has(t.key)), sw.filter((t) => !en.has(t.key)).map((t) => t.key).join(","));
  const phMismatch = sw.filter((t) => placeholders(t.body) !== placeholders(en.get(t.key)!));
  ok("each Kiswahili template keeps its twin's placeholders exactly", phMismatch.length === 0, phMismatch.map((t) => t.key).join(","));
  const swKeys = new Set(sw.map((t) => t.key));
  ok("staff codes never localise (otp, login_code absent from the sw catalogue)", !swKeys.has("otp") && !swKeys.has("login_code"));
  const borrowerKeys = ["verify", "offer_sign", "reminder", "due_today", "arrears", "disbursed", "payment", "cleared", "kyc_link", "guarantor_invite", "guarantor_sign"];
  ok("every borrower-facing template has its Kiswahili twin", borrowerKeys.every((k) => swKeys.has(k)), borrowerKeys.filter((k) => !swKeys.has(k)).join(","));

  // ── 3. The question decides the language ────────────────────────────────────
  section("3. Language detection");
  const swQs = [
    "ninawezaje kuongeza mfanyakazi?",
    "nifanye nini sasa",
    "kwa nini siwezi kutoa pesa",
    "nimesahau nenosiri langu",
    "jinsi ya kusajili mteja mpya",
  ];
  for (const q of swQs) ok(`sw: "${q}"`, detectLang(q) === "sw");
  const enQs = [
    "how do i disburse a loan",
    "what is par 30",
    "why can't i see all borrowers",
    "add staff",
    "what do the packages include?",
  ];
  for (const q of enQs) ok(`en: "${q}"`, detectLang(q) === "en");

  // ── 4. The corpus is complete in both voices ────────────────────────────────
  section("4. Corpus completeness");
  const missing = ARTICLES.filter((a) => !a.sw.title.trim() || !a.sw.body.trim() || a.sw.asks.length < 3);
  ok("every article has a Kiswahili title, body and ≥3 phrasings", missing.length === 0, missing.map((a) => a.id).join(","));
  const stepDrift = ARTICLES.filter((a) => (a.steps?.length ?? 0) !== (a.sw.steps?.length ?? 0));
  ok("steps mirror one-for-one (same actions, same order)", stepDrift.length === 0, stepDrift.map((a) => a.id).join(","));
  const noLabel = ARTICLES.filter((a) => a.action && !a.sw.actionLabel?.trim());
  ok("every action button has a Kiswahili label", noLabel.length === 0, noLabel.map((a) => a.id).join(","));
  const upperAsks = ARTICLES.filter((a) => [...a.asks, ...a.sw.asks].some((s) => s !== s.toLowerCase()));
  ok("all phrasings are lowercase (retrieval lowercases the question)", upperAsks.length === 0, upperAsks.map((a) => a.id).join(","));
  const badRight = ARTICLES.filter((a) => a.right && !ALL_RIGHTS_SET.has(a.right));
  ok("the sw voice added no article with an unreal right", badRight.length === 0);

  // ── 5. Retrieval in Kiswahili ────────────────────────────────────────────────
  section("5. Kiswahili retrieval");
  const opts = { rights: ADMIN, features: ALL_FEATURES };
  const hit = (q: string) => search(q, opts)[0]?.article.id;
  ok("'ninawezaje kuongeza mfanyakazi' → team-invite", hit("ninawezaje kuongeza mfanyakazi") === "team-invite");
  ok("'kwa nini siwezi kutoa pesa' → disburse-how", hit("kwa nini siwezi kutoa pesa") === "disburse-how");
  ok("'nimesahau nenosiri' → password-help", hit("nimesahau nenosiri") === "password-help");
  ok("'pakia nembo yangu' → branding-how", hit("pakia nembo yangu") === "branding-how");
  ok("'ongeza tawi jipya' → branches-build", hit("ongeza tawi jipya") === "branches-build");
  ok("English retrieval is untouched: 'how do i disburse' → disburse-how", hit("how do i disburse") === "disburse-how");
  ok("the confidence floor holds in Kiswahili (cooking ugali gets no article)", search("ninawezaje kupika ugali", opts).length === 0);

  // ── 6. answerSupport speaks the asker's language (article paths are DB-free) ─
  section("6. Support answers in Kiswahili");
  const a1 = await answerSupport("org-x", "ninawezaje kuongeza mfanyakazi?", { rights: ADMIN, features: ALL_FEATURES });
  ok("the answer is the article's Kiswahili voice", a1.answer.includes("Kuongeza wafanyakazi") && a1.answer.includes("Fungua Access → Team"));
  ok("the action button is labelled in Kiswahili", a1.actions[0]?.label === "Fungua Team" && a1.actions[0]?.href === "/console/team");
  ok("the follow-up suggestions are Kiswahili phrasings", a1.suggestions.length > 0 && a1.suggestions.every((s) => detectLang(s) === "sw" || !/how|what|why/.test(s)));

  const a2 = await answerSupport("org-x", "ongeza tawi jipya", { rights: NONE, features: ALL_FEATURES });
  ok("who-to-ask (no permission) is said in Kiswahili", a2.answer.includes("ruhusa") && a2.articleId === "branches-build");

  const a3 = await answerSupport("org-x", "tahadhari ya mapema", { rights: ADMIN, features: NONE });
  ok("name-the-price (not on package) is said in Kiswahili", a3.answer.includes("kifurushi") && a3.answer.includes("KES"), a3.articleId ?? "");

  const a4 = await answerSupport("org-x", "ninawezaje kupika ugali", { rights: ADMIN, features: ALL_FEATURES });
  ok("the honest refusal is said in Kiswahili", a4.answer.startsWith("Sina jibu"));

  const a5 = await answerSupport("org-x", "how do i add staff", { rights: ADMIN, features: ALL_FEATURES });
  ok("an English question still gets the English voice", a5.answer.includes("Adding staff and giving them a role"));

  const a6 = await answerSupport("org-x", "how do i add staff", { rights: ADMIN, features: ALL_FEATURES, lang: "sw" });
  ok("an explicit lang (the voice toggle) overrides detection", a6.answer.includes("Kuongeza wafanyakazi"));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
