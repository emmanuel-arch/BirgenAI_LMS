// ─────────────────────────────────────────────────────────────────────────────
// RIRI FIRST RESPONSE — the customer's first contact, before anybody at the counter.
//
// Riri Ecosystem AI plan, §07 and Sprint 2:
//
//   "There is no reason for a customer to wait for Geoffrey to be told they press
//    *334#. Riri answers first, from the tenant corpus and the customer's own
//    record, and only what she genuinely cannot resolve reaches the counter —
//    arriving triaged, with her working shown."
//
// This file decides WHAT she says. It is a pure function: facts in, answer out. No
// database, no network, no model — which is what lets scripts/verify-first-
// response.ts pin every sentence she can say about somebody's money. The route
// gathers the facts (lib/portal/position.ts, the same read Home renders) and the
// packs, calls this, and only reaches for a language model when this returns
// `intent: "open"` — a question nothing here recognises — and even then the model
// is handed these facts and no others.
//
// ── THREE OUTCOMES, AND ONLY ONE OF THEM IS A TICKET ─────────────────────────
//   resolved  answered. Thumbs up/down, logged as a deflection.
//   offer     answered as far as she honestly can, plus "want me to raise this
//             with the team?" — the customer decides.
//   escalate  she should hand this to a person now. For "let me talk to someone"
//             the route opens the thread immediately; for a money dispute the
//             app puts the hand-off in front of them with one tap to send.
//
// ── WHAT SHE MUST NEVER DO ON THIS SURFACE (plan §07) ────────────────────────
//   · State a figure she did not read from the record in this conversation.
//     Every number below comes out of `facts`, formatted, never computed into a
//     new claim. A bridged loan's "next instalment" is not on the feed, so she
//     says so and does not derive one from the balance and the term.
//   · Promise an outcome, a timeline or an approval.
//   · Tell a customer a payment will go somewhere it will not. The lender's
//     RepaymentTrigger allocates loan first, remainder to savings.
//   · Read back a phone or ID number. `facts` does not contain either.
//   · Argue when somebody asks for a person. That is an instant, cheerful yes.
// ─────────────────────────────────────────────────────────────────────────────
import type { ThreadKind } from "@prisma/client";
import type { CustomerPosition } from "@/lib/portal/position";
import { detectLang } from "../knowledge";
import { checkTraps } from "../traps";
import { describeScreen, isScreenQuestion, type RiriLang, type RiriScreen } from "../core/context";
import { scoreScreen, DESTINATION_FLOOR } from "../core/destination";
import { APP_SCREENS, appScreenById } from "./app-map";
import { searchCorpus, hitSource, type CorpusHit, type ServedPack } from "./corpus";

export type CustomerFacts = Omit<CustomerPosition, "borrowerId" | "erased">;

export type Outcome = "resolved" | "offer" | "escalate";

export type Intent =
  | "human" | "greeting" | "thanks" | "screen" | "navigate"
  | "balance" | "due" | "limit" | "score" | "application" | "savings" | "ratiba" | "kyc" | "messages"
  | "clearance" | "dispute" | "knowledge" | "open";

export type NavigateAction = { kind: "navigate"; label: string; href: string; screenId: string };

export type Checked = { tool: string; said: string };

export type FirstResponse = {
  outcome: Outcome;
  intent: Intent;
  lang: RiriLang;
  answer: string;
  /** Pack ids and articles she stood on — the founder's "pack id on every answer". */
  sources: { id: string; label: string; starter?: boolean }[];
  /** What she read and what it said, for the triage note. Never shown as a figure she did not state. */
  checked: Checked[];
  actions: NavigateAction[];
  suggestions: string[];
  confidence: "certain" | "likely" | "unsure";
  /** The one thing a human must decide, when she hands over. */
  needsHuman: string | null;
  /** Where an escalation would be filed in the officer's queue. */
  threadKind: ThreadKind;
  /** The thread subject an escalation would carry. Never blank. */
  subject: string;
};

export type FirstResponseInput = {
  question: string;
  facts: CustomerFacts;
  packs: ServedPack[];
  /** The app screen the customer is on, resolved server-side. */
  screen: RiriScreen | null;
  lang?: RiriLang;
};

// ── Formatting ───────────────────────────────────────────────────────────────
// Deterministic on purpose — no locale tables, so the test sees exactly what a
// customer sees on any server.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MIEZI = ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ago", "Sep", "Okt", "Nov", "Des"];

export const ksh = (n: number) => `KSh ${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

export function day(iso: string | null | undefined, lang: RiriLang = "en"): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return null;
  return `${Number(m[3])} ${(lang === "sw" ? MIEZI : MONTHS)[Number(m[2]) - 1]} ${m[1]}`;
}

const first = (facts: CustomerFacts) => facts.firstName?.trim().split(/\s+/)[0] ?? null;

/**
 * The console's detector knows a staff member's Kiswahili — mkopaji, tawi, idhinisha.
 * A customer asks in different words: nadaiwa, nilipe, akiba, pesa yangu. Same
 * threshold rule (one strong word), a customer's vocabulary on top.
 */
const SW_CUSTOMER = /\b(?:nadaiwa|ninadaiwa|nilipe|nitalipa|nitalipaje|kulipa|lipa|akiba|kiwango|ombi|lini|nataka|naweza|nikopeshe|kukopa|pesa|mimi|habari|asante|sawa|niaje|mambo|nimelipa|imeingia|haijaingia|haijaonekana|kiasi|ngapi|nini|wapi|je)\b/i;

export function customerLang(q: string): RiriLang {
  if (detectLang(q) === "sw") return "sw";
  const customerWord = SW_CUSTOMER.test(q);
  const englishFrame = /\b(?:the|what|how|when|my|is|do|i|can|where)\b/i.test(q);
  return customerWord && !englishFrame ? "sw" : "en";
}

// ── Intents ──────────────────────────────────────────────────────────────────
// Bilingual, keyword-matched and ordered. Deliberately not a model: the question
// "what do I owe?" must reach the record every single time, and a classifier that
// is right 97% of the time is one that answers a balance question from a fee
// article three customers in a hundred.
const R = {
  human: /\b(?:talk|speak|chat)\s+(?:to|with)\s+(?:a |an |the |some |your )?(?:human|person|someone|somebody|agent|officer|staff|real person|customer care|manager|team)\b|\b(?:human agent|real person|customer care|customer service|call me|call me back|nipigie|mtu halisi|nataka (?:kuongea|kuzungumza) na (?:mtu|afisa|mhudumu|meneja)|niunganishe na mtu|nipe mtu)\b|^\s*(?:agent|human|a person|operator)\s*[?.!]*\s*$/i,
  greeting: /^\s*(?:hi|hello|hey|habari(?: yako)?|mambo|niaje|sasa|hujambo|vipi|good (?:morning|afternoon|evening))(?:\s+riri)?[\s!,.]*$/i,
  thanks: /^\s*(?:thanks|thank you|asante(?: sana)?|poa|sawa|ok(?:ay)?|great|nice|cool)(?:\s+riri)?[\s!.]*$/i,
  clearance: /\b(?:when did i (?:clear|finish|pay off|complete)|date (?:i|my (?:last |previous )?loan) (?:was )?cleared|cleared date|clearance date|nilimaliza (?:mkopo )?lini)\b/i,
  dispute: /\b(?:double (?:charged|deducted|payment)|charged twice|deducted twice|wrong (?:charge|amount|deduction|balance)|not reflect(?:ing|ed)?|didn'?t reflect|paid but|took the money but|money (?:gone|deducted|missing|disappeared)|balance (?:has not|hasn'?t|did not|didn'?t|is not|isn'?t) (?:changed?|reduced?|gone down|moved|updated)|haijaonekana|haijaingia|haijapungua|fraud|stolen|unauthori[sz]ed|scam|complain(?:t)?|refund|reversal)\b/i,
  application: /\b(?:my application|application status|status of my (?:loan|application)|where is my (?:loan|application|money)|(?:is|was|has) my loan (?:been )?approved|when will i (?:get|receive) (?:the |my )?(?:money|loan|cash)|disburs(?:e|ed|ement)|ombi langu|mkopo wangu umefika wapi|nitapata pesa lini)\b/i,
  due: /\b(?:next (?:payment|instal?ment|repayment)|due date|when (?:is|do|should|will|must) (?:my|i|the|this) .{0,24}(?:due|pay)|(?:loan|instal?ment|payment|repayment) (?:is )?due\b|when (?:do|should|must) i pay|how much (?:is|do i pay) (?:this|next) (?:week|month)|instal?ment amount|lini (?:nilipe|nitalipa|nilipie)|tarehe ya kulipa|awamu (?:ijayo|inayofuata))\b/i,
  balance: /\b(?:my balance|balance|outstanding|how much (?:do|did) i (?:still )?owe|what do i owe|how much (?:is )?(?:left|remaining)|remaining (?:balance|amount)|amount owed|deni langu|deni|salio|nadaiwa|ninadaiwa|nimebaki na)\b/i,
  limit: /\b(?:my limit|loan limit|credit limit|how much can i (?:borrow|get|take)|what can i borrow|qualify for|available to borrow|(?:a )?(?:bigger|larger|higher) (?:loan|limit|amount)|more money|increase my loan|kiwango changu|kiwango cha mkopo|naweza kukopa (?:ngapi|kiasi gani))\b/i,
  score: /\b(?:my (?:credit )?score|what(?:'s| is) my score|score yangu|alama yangu)\b/i,
  savings: /\b(?:my savings|savings balance|how much (?:have i saved|is in my savings)|akiba yangu)\b/i,
  ratiba: /\b(?:is my (?:ratiba|standing order|auto.?repay)|do i have (?:a |an )?(?:ratiba|standing order|auto.?repay)|my (?:ratiba|standing order|auto.?repay)|ratiba yangu)\b/i,
  kyc: /\b(?:my (?:id|kyc|identity) (?:check|verification|status)|is my (?:id|identity|kyc)(?: check)? (?:verified|approved|done|complete)|verification status|kitambulisho changu)\b/i,
  messages: /\b(?:did (?:they|anyone|the team|someone) (?:reply|respond|answer|write)|any (?:reply|replies|new messages?)|unread|new messages?|wamejibu)\b/i,
  navigate: /\b(?:take me|go to|open|navigate|show me|where (?:is|do i find|can i find)|nipeleke|fungua|nionyeshe)\b/i,
  howWhy: /\b(?:how (?:do|can|to)|why|what (?:moves|raises|lowers)|increase|improve|raise|bigger|higher|kwa nini|jinsi|ongeza)\b/i,
};

const has = (re: RegExp, q: string) => re.test(q);

// ── Voices ───────────────────────────────────────────────────────────────────
// Every framing sentence in both languages, in one table, so neither voice can
// gain a sentence the other lacks. Figures are passed in already formatted.
const V = {
  en: {
    unreachable: (lender: string) =>
      `I couldn't reach your account at ${lender} just now, so I won't guess a figure — that's a connection problem on our side, and nothing about your loan has changed. Try me again in a minute, or I can pass this to the team.`,
    ambiguous: (lender: string) =>
      `Your number matches more than one record at ${lender}, so I can't safely say which account is yours. That needs a person to sort out — I can pass it to the team now.`,
    mismatch: (lender: string) =>
      `The account on your number at ${lender} carries different ID details from the ones you verified with, so I'm not going to read it to you. A person needs to check this — I can pass it to the team now.`,
    greeting: (name: string | null, lender: string) =>
      `Hi${name ? ` ${name}` : ""} 👋 I'm Riri. Ask me anything about your account with ${lender} — your balance, your next payment, your limit, your application, or M-PESA Ratiba. If it's something I can't sort out, I'll get you to a person.`,
    thanks: "Any time 🙂 I'm right here if anything else comes up.",
    human: (lender: string) =>
      `Of course — I'll get you to a person at ${lender}. I've passed your conversation to the team with what I can already see on your account, so you won't have to explain it twice. Their reply will appear in Messages.`,
    humanNeeds: "They asked to speak to a person. Nothing about their account has been promised.",
    clearance: (lender: string, owe: string, loans: number) =>
      `I can't give you the exact date a past loan was cleared from here — ${lender}'s record of that date isn't one I can rely on yet, and I'd rather not guess a date. What I can see: you have ${loans} open loan${loans === 1 ? "" : "s"} and owe ${owe} right now. The team can confirm the clearance date from your statement if you need it.`,
    clearanceNeeds: "Confirm the date their previous loan was cleared, from the statement — the lender's clearance date field is empty.",
    disputeTail: (owe: string | null) =>
      `${owe ? `Right now your balance shows ${owe}. ` : ""}This is worth a person following to the end rather than you checking back. I can raise it with the team now — they'll see what you told me and what I checked.`,
    disputeNeeds: "Check whether the payment the customer describes reached their loan, and tell them what happens next. Riri made no promise about timing or outcome.",
    owe: (lender: string, amount: string) => `Your outstanding balance with ${lender} is **${amount}**.`,
    loanLine: (product: string | null, borrowed: string, left: string) =>
      `Your open loan${product ? ` is **${product}**:` : ":"} ${borrowed} borrowed, **${left}** left to pay.`,
    clearBy: (d: string) => `It's due to be cleared by **${d}**.`,
    several: (n: number) => `That's across ${n} open loans.`,
    owesNothing: (lender: string) => `You don't owe ${lender} anything right now — there's no open loan with a balance on your account.`,
    noLoanYet: (lender: string) => `You don't have a loan with ${lender} yet, so there's nothing to repay.`,
    nextDue: (amount: string, d: string) => `Your next instalment is **${amount}**, due **${d}**.`,
    upcoming: "Coming up after that:",
    noSchedule: (lender: string, product: string | null, left: string, clear: string | null) =>
      `I can see your ${product ?? "loan"} has **${left}** left${clear ? ` and is due to be cleared by **${clear}**` : ""}. But the part of ${lender}'s records I can read doesn't carry the date and amount of each instalment — and I won't work one out, because that's the number you'd actually pay. Your loan agreement and SMS reminders have your schedule, or I can ask the team to confirm your next instalment.`,
    noScheduleNeeds: "Confirm the date and amount of the customer's next instalment — the instalment schedule is not on the feed Riri can read.",
    nothingDue: "You have no open loan, so there's nothing due.",
    limit: (lender: string, limit: string, available: string, owe: string | null) =>
      `Your limit with ${lender} is **${limit}**, and **${available}** of it is available right now${owe ? ` — the rest is covered by the ${owe} you owe` : ""}.`,
    noLimit: "You don't have a limit yet. It's set from your six-month M-PESA statement once you've been through the statement cruncher.",
    score: (score: number, band: string | null) => `Your score is **${score}** out of 900${band ? ` — ${band}` : ""}.`,
    drivers: "What's moving it:",
    up: "helps", down: "holds it back",
    noScore: "You don't have a score yet. It's built from your M-PESA statement and your credit bureau record, then from how you repay.",
    application: (amount: string, product: string | null, stage: string | null, status: string) =>
      `Your application for **${amount}**${product ? ` (${product})` : ""} is ${stage ? `with **${stage}**` : `**${status}**`}.`,
    appWait: "I can't tell you when a decision will come — only that desk can — but you'll see every move under Application the moment it happens.",
    appNeeds: "They want to know when a decision on their application will come. Riri did not give a timeline.",
    noApplication: (lender: string) => `You don't have an application in progress with ${lender}.`,
    canApply: (available: string) => `You have **${available}** available if you'd like to apply.`,
    savings: (lender: string, amount: string) => `Your savings with ${lender} are **${amount}**.`,
    savingsLast: (amount: string, d: string) => `The last amount added was ${amount}, on ${d}.`,
    savingsHow: "Anything you pay beyond what your loan needs goes into your savings automatically.",
    savingsUnknown: (lender: string) => `I couldn't read your savings at ${lender} just now, so I won't guess. Try again in a minute.`,
    ratibaOff: (lender: string) =>
      `${lender} doesn't set up M-PESA Ratiba standing orders through this app yet, so there isn't one on your account from here. If you've created one yourself, it lives on *334# under Ratiba — that's where you check, change or stop it.`,
    ratibaOn: (amount: string | null, freq: string | null) =>
      `Yes — you have a standing order${amount ? ` for **${amount}**` : ""}${freq ? `, ${freq.toLowerCase()}` : ""}. You can check, change or stop it on *334# under Ratiba.`,
    ratibaNone: "No standing order is set up on your account. You can switch on auto-repay from Repay.",
    kyc: {
      VERIFIED: "Your identity check is complete.",
      PENDING_REVIEW: (lender: string) => `A person at ${lender} is reviewing your ID check — that's the normal last step for every new customer, and you'll see the result here as soon as it's decided.`,
      IN_PROGRESS: "You've started your ID check but haven't finished it yet.",
      FAILED: "Your ID check needs another look. Your ID check screen explains what was unclear and what would help.",
      NONE: "You haven't done the ID check yet — it's the first step before you can borrow.",
    } as Record<string, string | ((lender: string) => string)>,
    unread: (n: number) => `You have **${n}** unread message${n === 1 ? "" : "s"} from the team.`,
    latest: (subject: string) => `The latest is “${subject}”.`,
    noUnread: "No new replies from the team.",
    noThreads: "You don't have any conversations with the team yet.",
    screenUnknown: "I can't tell which screen you're on, so I don't want to guess. Tell me what you're trying to do and I'll point you to the right place.",
    navigate: (title: string, purpose: string) => `Here's **${title}** — ${purpose}`,
    open: (lender: string) =>
      `I don't want to guess at that one. I can help with your balance, your next payment, your limit and score, your application, M-PESA Ratiba, and how repaying works. Or I can pass your question to the team at ${lender} — they'll see exactly what you asked and what I checked.`,
    openNeeds: "Riri could not answer this from the customer's record or the knowledge packs. It needs your judgement.",
    allocation:
      "Just so we're both clear: every payment goes to your loan first, and anything left over goes to your savings. Nobody can send a payment somewhere else.",
    starterNote: "",
    s: {
      balance: ["When is my next payment?", "How do I repay?", "How much can I borrow?"],
      due: ["What do I owe?", "How do I repay?", "What happens if I pay late?"],
      limit: ["How do I increase my limit?", "What is my score?", "Apply now"],
      score: ["What moves my limit?", "What lowers my score?"],
      application: ["What happens after I apply?", "What do I owe?"],
      general: ["What do I owe?", "When is my next payment?", "What is Ratiba?"],
      open: ["What do I owe?", "How do I repay?", "Talk to a person"],
    },
    act: { repay: "Open Repay", track: "See my application", apply: "Apply now", ladder: "See my limit ladder", score: "See my score", messages: "Open Messages", kyc: "Open ID check" },
    sub: {
      human: "Customer asked for a person", dispute: "Payment query", due: "Next instalment", clearance: "Loan clearance date",
      application: "About my application", open: "A question for the team", unreachable: "Account could not be read", ambiguous: "Account records need checking",
    },
  },
  sw: {
    unreachable: (lender: string) =>
      `Sikuweza kufikia akaunti yako ${lender} sasa hivi, kwa hivyo sitakisia kiasi — ni tatizo la mtandao upande wetu, na hakuna kilichobadilika kwenye mkopo wako. Jaribu tena baada ya dakika moja, au naweza kulipeleka kwa timu.`,
    ambiguous: (lender: string) =>
      `Nambari yako inalingana na rekodi zaidi ya moja ${lender}, kwa hivyo siwezi kusema kwa uhakika akaunti ipi ni yako. Hilo linahitaji mtu — naweza kulipeleka kwa timu sasa.`,
    mismatch: (lender: string) =>
      `Akaunti iliyo kwenye nambari yako ${lender} ina maelezo ya kitambulisho tofauti na uliyothibitisha nayo, kwa hivyo sitaisoma kwako. Mtu anahitaji kuangalia — naweza kulipeleka kwa timu sasa.`,
    greeting: (name: string | null, lender: string) =>
      `Niaje${name ? ` ${name}` : ""} 👋 Mimi ni Riri. Niulize chochote kuhusu akaunti yako ${lender} — salio lako, malipo yako yajayo, kiwango chako, ombi lako, au M-PESA Ratiba. Nisipoweza kulitatua, nitakuunganisha na mtu.`,
    thanks: "Karibu sana 🙂 Niko hapa ukihitaji kitu kingine.",
    human: (lender: string) =>
      `Sawa kabisa — nitakuunganisha na mtu ${lender}. Nimepeleka mazungumzo yako kwa timu pamoja na ninachoona kwenye akaunti yako, ili usilazimike kueleza mara mbili. Jibu lao litaonekana kwenye Messages.`,
    humanNeeds: "They asked to speak to a person. Nothing about their account has been promised.",
    clearance: (lender: string, owe: string, loans: number) =>
      `Siwezi kukupa tarehe kamili mkopo wa zamani ulipomalizika kutoka hapa — rekodi ya ${lender} ya tarehe hiyo bado si ya kutegemewa, na sipendi kukisia. Ninachoona: una mkopo ${loans} unaoendelea na unadaiwa ${owe} sasa. Timu inaweza kuthibitisha tarehe hiyo kutoka kwa taarifa yako.`,
    clearanceNeeds: "Confirm the date their previous loan was cleared, from the statement — the lender's clearance date field is empty.",
    disputeTail: (owe: string | null) =>
      `${owe ? `Kwa sasa salio lako linaonyesha ${owe}. ` : ""}Hili linastahili mtu kulifuatilia hadi mwisho. Naweza kulipeleka kwa timu sasa — wataona ulichoniambia na nilichoangalia.`,
    disputeNeeds: "Check whether the payment the customer describes reached their loan, and tell them what happens next. Riri made no promise about timing or outcome.",
    owe: (lender: string, amount: string) => `Salio lako unalodaiwa na ${lender} ni **${amount}**.`,
    loanLine: (product: string | null, borrowed: string, left: string) =>
      `Mkopo wako unaoendelea${product ? ` ni **${product}**:` : ":"} ulikopa ${borrowed}, umebaki na **${left}** kulipa.`,
    clearBy: (d: string) => `Unatarajiwa kumalizika kufikia **${d}**.`,
    several: (n: number) => `Hiyo ni kwa mikopo ${n} inayoendelea.`,
    owesNothing: (lender: string) => `Hudaiwi chochote na ${lender} sasa hivi — hakuna mkopo unaoendelea wenye salio kwenye akaunti yako.`,
    noLoanYet: (lender: string) => `Bado huna mkopo na ${lender}, kwa hivyo hakuna cha kulipa.`,
    nextDue: (amount: string, d: string) => `Awamu yako ijayo ni **${amount}**, tarehe **${d}**.`,
    upcoming: "Zinazofuata:",
    noSchedule: (lender: string, product: string | null, left: string, clear: string | null) =>
      `Naona ${product ?? "mkopo wako"} una **${left}** iliyobaki${clear ? ` na unatarajiwa kumalizika kufikia **${clear}**` : ""}. Lakini sehemu ya rekodi za ${lender} ninayoweza kusoma haina tarehe na kiasi cha kila awamu — na sitakihesabu, kwa sababu hicho ndicho kiasi utakacholipa. Mkataba wako wa mkopo na SMS za ukumbusho zina ratiba yako, au naweza kuiomba timu ithibitishe awamu yako ijayo.`,
    noScheduleNeeds: "Confirm the date and amount of the customer's next instalment — the instalment schedule is not on the feed Riri can read.",
    nothingDue: "Huna mkopo unaoendelea, kwa hivyo hakuna kinachodaiwa.",
    limit: (lender: string, limit: string, available: string, owe: string | null) =>
      `Kiwango chako na ${lender} ni **${limit}**, na **${available}** kinapatikana sasa hivi${owe ? ` — kilichobaki kinashikiliwa na ${owe} unazodaiwa` : ""}.`,
    noLimit: "Bado huna kiwango. Kinawekwa kutoka kwa taarifa yako ya M-PESA ya miezi sita baada ya kupitia statement cruncher.",
    score: (score: number, band: string | null) => `Alama yako ni **${score}** kati ya 900${band ? ` — ${band}` : ""}.`,
    drivers: "Kinachoisukuma:",
    up: "inasaidia", down: "inairudisha nyuma",
    noScore: "Bado huna alama. Inajengwa kutoka kwa taarifa yako ya M-PESA na rekodi ya CRB, kisha jinsi unavyolipa.",
    application: (amount: string, product: string | null, stage: string | null, status: string) =>
      `Ombi lako la **${amount}**${product ? ` (${product})` : ""} liko ${stage ? `kwa **${stage}**` : `**${status}**`}.`,
    appWait: "Siwezi kukuambia uamuzi utakuja lini — ni dawati hilo pekee linaloweza — lakini utaona kila hatua kwenye Application mara inapotokea.",
    appNeeds: "They want to know when a decision on their application will come. Riri did not give a timeline.",
    noApplication: (lender: string) => `Huna ombi linaloendelea na ${lender}.`,
    canApply: (available: string) => `Una **${available}** zinazopatikana ukitaka kuomba.`,
    savings: (lender: string, amount: string) => `Akiba yako na ${lender} ni **${amount}**.`,
    savingsLast: (amount: string, d: string) => `Kiasi cha mwisho kilichoongezwa ni ${amount}, tarehe ${d}.`,
    savingsHow: "Chochote unacholipa zaidi ya kinachohitajika na mkopo wako huenda kwa akiba yako moja kwa moja.",
    savingsUnknown: (lender: string) => `Sikuweza kusoma akiba yako ${lender} sasa hivi, kwa hivyo sitakisia. Jaribu tena baada ya dakika moja.`,
    ratibaOff: (lender: string) =>
      `${lender} bado haiweki M-PESA Ratiba kupitia programu hii, kwa hivyo hakuna iliyowekwa kwenye akaunti yako kutoka hapa. Ikiwa ulijiwekea mwenyewe, iko kwenye *334# chini ya Ratiba — hapo ndipo unaiangalia, kuibadilisha au kuisimamisha.`,
    ratibaOn: (amount: string | null, freq: string | null) =>
      `Ndiyo — una standing order${amount ? ` ya **${amount}**` : ""}${freq ? `, ${freq.toLowerCase()}` : ""}. Unaweza kuiangalia, kuibadilisha au kuisimamisha kwenye *334# chini ya Ratiba.`,
    ratibaNone: "Hakuna standing order kwenye akaunti yako. Unaweza kuwasha auto-repay kutoka Repay.",
    kyc: {
      VERIFIED: "Ukaguzi wako wa kitambulisho umekamilika.",
      PENDING_REVIEW: (lender: string) => `Mtu ${lender} anakagua kitambulisho chako — hiyo ni hatua ya kawaida ya mwisho kwa kila mteja mpya, na utaona matokeo hapa mara yatakapoamuliwa.`,
      IN_PROGRESS: "Umeanza ukaguzi wa kitambulisho lakini bado hujaumaliza.",
      FAILED: "Ukaguzi wako wa kitambulisho unahitaji kuangaliwa tena. Skrini ya Your ID check inaeleza kilichokosa uwazi.",
      NONE: "Bado hujafanya ukaguzi wa kitambulisho — ni hatua ya kwanza kabla ya kukopa.",
    } as Record<string, string | ((lender: string) => string)>,
    unread: (n: number) => `Una ujumbe **${n}** ambao hujasoma kutoka kwa timu.`,
    latest: (subject: string) => `Wa karibuni ni “${subject}”.`,
    noUnread: "Hakuna majibu mapya kutoka kwa timu.",
    noThreads: "Bado huna mazungumzo na timu.",
    screenUnknown: "Siwezi kujua uko kwenye skrini gani, kwa hivyo sitakisia. Niambie unajaribu kufanya nini nami nitakuonyesha mahali sahihi.",
    navigate: (title: string, purpose: string) => `Hii hapa **${title}** — ${purpose}`,
    open: (lender: string) =>
      `Sitaki kukisia hilo. Naweza kusaidia na salio lako, malipo yako yajayo, kiwango na alama yako, ombi lako, M-PESA Ratiba, na jinsi ya kulipa. Au naweza kupeleka swali lako kwa timu ${lender} — wataona ulichouliza na nilichoangalia.`,
    openNeeds: "Riri could not answer this from the customer's record or the knowledge packs. It needs your judgement.",
    allocation:
      "Ili tuelewane: kila malipo huenda kwa mkopo wako kwanza, na kinachobaki huenda kwa akiba yako. Hakuna anayeweza kupeleka malipo mahali pengine.",
    starterNote: "",
    s: {
      balance: ["Nilipe lini?", "Nitalipaje?", "Naweza kukopa kiasi gani?"],
      due: ["Nadaiwa kiasi gani?", "Nitalipaje?", "Nikichelewa kulipa?"],
      limit: ["Nitaongezaje kiwango changu?", "Alama yangu ni ngapi?"],
      score: ["Kinachobadilisha kiwango changu?", "Nini hushusha alama yangu?"],
      application: ["Baada ya kuomba nini hufuata?", "Nadaiwa kiasi gani?"],
      general: ["Nadaiwa kiasi gani?", "Nilipe lini?", "Ratiba ni nini?"],
      open: ["Nadaiwa kiasi gani?", "Nitalipaje?", "Nataka kuongea na mtu"],
    },
    act: { repay: "Fungua Repay", track: "Ona ombi langu", apply: "Omba sasa", ladder: "Ona limit ladder", score: "Ona alama yangu", messages: "Fungua Messages", kyc: "Fungua ukaguzi wa ID" },
    sub: {
      human: "Customer asked for a person", dispute: "Payment query", due: "Next instalment", clearance: "Loan clearance date",
      application: "About my application", open: "A question for the team", unreachable: "Account could not be read", ambiguous: "Account records need checking",
    },
  },
} as const;

const STATUS_WORDS: Record<string, string> = {
  SUBMITTED: "submitted and waiting for its first review",
  AI_PRESCREEN: "being pre-screened",
  OFFICER_REVIEW: "with an officer for review",
  APPROVED: "approved",
  REFERRED: "referred for a closer look",
  DECLINED: "declined",
};

function nav(screenId: string, label: string): NavigateAction {
  const s = appScreenById(screenId);
  return { kind: "navigate", label, href: s?.href ?? "/", screenId };
}

// ── The answer ───────────────────────────────────────────────────────────────

export function firstResponse(input: FirstResponseInput): FirstResponse {
  const q = input.question.trim();
  const lang: RiriLang = input.lang ?? customerLang(q);
  const v = V[lang];
  const f = input.facts;
  const lender = f.lender;

  const base = (over: Partial<FirstResponse> & Pick<FirstResponse, "intent" | "answer">): FirstResponse => ({
    outcome: "resolved",
    lang,
    sources: [],
    checked: [],
    actions: [],
    suggestions: [],
    confidence: "certain",
    needsHuman: null,
    threadKind: "GENERAL",
    subject: v.sub.open,
    ...over,
  });

  const record = (said: string): Checked => ({ tool: "customer.record", said });
  const bookLine = (): Checked =>
    f.bookSource === "unavailable"
      ? record(`${lender}'s book could not be read (${f.bookIssue ?? "unreachable"})`)
      : f.bookSource === "onboarding"
        ? record(`Not on ${lender}'s book yet — onboarding customer`)
        : record(`Read live from ${f.bookSource === "native" ? "our book" : `${lender}'s book`}: outstanding ${ksh(f.outstanding)}, limit ${ksh(f.limit)}, ${f.loanCount} open loan${f.loanCount === 1 ? "" : "s"}${f.activeLoan ? `, loan ${f.activeLoan.ref} (${f.activeLoan.product ?? "loan"}) balance ${ksh(f.activeLoan.balance)}` : ""}`);

  /** When the book could not be read, every money question gets the same honest answer. */
  const bookBlocked = (intent: Intent): FirstResponse | null => {
    if (f.bookSource !== "unavailable") return null;
    const issue = f.bookIssue ?? "unreachable";
    const answer = issue === "ambiguous" ? v.ambiguous(lender) : issue === "mismatch" ? v.mismatch(lender) : v.unreachable(lender);
    return base({
      intent, answer, outcome: issue === "unreachable" ? "offer" : "escalate", confidence: "certain",
      checked: [bookLine()],
      needsHuman: issue === "unreachable"
        ? `The customer asked about their account but ${lender}'s book could not be read at the time. Confirm their position.`
        : `The customer's phone ${issue === "ambiguous" ? "matches more than one record" : "matches a record with a different national ID"} on ${lender}'s book. Resolve which account is theirs.`,
      threadKind: "LOAN",
      subject: issue === "unreachable" ? v.sub.unreachable : v.sub.ambiguous,
    });
  };

  // 1 · A PERSON. Instantly, cheerfully, first — before anything else is tried.
  if (has(R.human, q)) {
    return base({
      intent: "human", answer: v.human(lender), outcome: "escalate",
      checked: [bookLine()], needsHuman: v.humanNeeds, subject: v.sub.human,
      threadKind: f.application ? "APPLICATION" : f.activeLoan ? "LOAN" : "GENERAL",
    });
  }

  if (has(R.greeting, q)) {
    return base({ intent: "greeting", answer: v.greeting(first(f), lender), suggestions: [...v.s.general] });
  }
  if (has(R.thanks, q)) return base({ intent: "thanks", answer: v.thanks });

  // 2 · THE SCREEN THEY ARE ON.
  if (isScreenQuestion(q)) {
    if (!input.screen) return base({ intent: "screen", answer: v.screenUnknown, confidence: "unsure" });
    return base({
      intent: "screen",
      answer: describeScreen(input.screen, lang),
      sources: [{ id: `screen:${input.screen.id}`, label: "Micro Eazy app map" }],
      checked: [{ tool: "platform.screen", said: `On ${input.screen.title} (${input.screen.id})` }],
    });
  }

  // 3 · A PAST CLEARANCE DATE — the settlement trap, in the customer's voice.
  if (has(R.clearance, q)) {
    const blocked = bookBlocked("clearance");
    if (blocked) return blocked;
    return base({
      intent: "clearance", outcome: "offer", confidence: "certain",
      answer: v.clearance(lender, ksh(f.outstanding), f.loanCount),
      checked: [bookLine(), { tool: "trap.settlement-date", said: "Clearance dates are not reliable on this book — refused a date" }],
      needsHuman: v.clearanceNeeds, threadKind: "LOAN", subject: v.sub.clearance,
    });
  }

  const hits = searchCorpus(q, lang, input.packs, 3);

  // 4 · MONEY THAT WENT SOMEWHERE UNEXPECTED. Answer what can be answered, then hand over.
  if (has(R.dispute, q)) {
    const top = hits[0];
    const knowledge = top ? `${hitBody(top, lang)}\n\n` : "";
    const owe = f.bookSource === "native" || f.bookSource === "lender" ? ksh(f.outstanding) : null;
    return base({
      intent: "dispute", outcome: "escalate", confidence: "likely",
      answer: `${knowledge}${v.disputeTail(owe)}`,
      sources: top ? [hitSource(top)] : [],
      checked: [bookLine(), ...(top ? [{ tool: "corpus", said: `Matched ${hitSource(top).id}` }] : [{ tool: "corpus", said: "No knowledge entry matched" }])],
      actions: [nav("app-repay", v.act.repay)],
      needsHuman: v.disputeNeeds, threadKind: "REPAYMENT", subject: v.sub.dispute,
    });
  }

  /** A how/why question on a record intent gets the figure AND the explanation. */
  const explain = (): { text: string; source: { id: string; label: string; starter?: boolean } | null } => {
    if (!has(R.howWhy, q) || !hits[0]) return { text: "", source: null };
    return { text: `\n\n${hitBody(hits[0], lang)}`, source: hitSource(hits[0]) };
  };

  // 5 · THE RECORD. In the order a customer's worry actually runs.
  if (has(R.application, q)) {
    const a = f.application;
    if (!a) {
      const answer = [v.noApplication(lender), f.available > 0 ? v.canApply(ksh(f.available)) : ""].filter(Boolean).join(" ");
      return base({
        intent: "application", answer,
        checked: [{ tool: "customer.application", said: "No application in progress" }, bookLine()],
        actions: f.available > 0 ? [nav("app-apply", v.act.apply)] : [],
        suggestions: [...v.s.application],
      });
    }
    const status = lang === "en" ? STATUS_WORDS[a.status] ?? a.status.toLowerCase().replace(/_/g, " ") : a.status.toLowerCase().replace(/_/g, " ");
    const decided = a.status === "APPROVED" || a.status === "DECLINED";
    return base({
      intent: "application", outcome: decided ? "resolved" : "offer",
      answer: `${v.application(ksh(a.amount), a.product, decided ? null : a.stageTitle, status)}${decided ? "" : `\n\n${v.appWait}`}`,
      checked: [{ tool: "customer.application", said: `Application ${a.id.slice(0, 8)} for ${ksh(a.amount)} — status ${a.status}${a.stageTitle ? `, stage ${a.stageTitle}` : ""}` }],
      actions: [nav("app-track", v.act.track)],
      suggestions: [...v.s.application],
      needsHuman: decided ? null : v.appNeeds, threadKind: "APPLICATION", subject: v.sub.application,
    });
  }

  if (has(R.due, q)) {
    const blocked = bookBlocked("due");
    if (blocked) return blocked;
    const loan = f.activeLoan;
    if (!loan) {
      return base({ intent: "due", answer: f.bookSource === "onboarding" ? v.noLoanYet(lender) : v.nothingDue, checked: [bookLine()], suggestions: [...v.s.due] });
    }
    if (loan.nextDue) {
      const d = day(loan.nextDue.date, lang) ?? loan.nextDue.date;
      const later = f.schedule
        .filter((s) => s.due > loan.nextDue!.date && ["UPCOMING", "DUE", "PARTIAL", "OVERDUE"].includes(s.status))
        .slice(0, 3)
        .map((s) => `- ${day(s.due, lang) ?? s.due} — ${ksh(s.amount)}`);
      return base({
        intent: "due",
        answer: [v.nextDue(ksh(loan.nextDue.amount), d), later.length ? `\n${v.upcoming}\n${later.join("\n")}` : ""].join(""),
        checked: [bookLine(), { tool: "customer.schedule", said: `Next instalment ${ksh(loan.nextDue.amount)} on ${loan.nextDue.date}` }],
        actions: [nav("app-repay", v.act.repay)],
        suggestions: [...v.s.due],
      });
    }
    return base({
      intent: "due", outcome: "offer", confidence: "certain",
      answer: v.noSchedule(lender, loan.product, ksh(loan.balance), day(loan.expectedClearDate, lang)),
      checked: [bookLine(), { tool: "customer.schedule", said: "Instalment schedule not available on the lender feed — no date or amount stated" }],
      actions: [nav("app-repay", v.act.repay)],
      suggestions: [...v.s.due],
      needsHuman: v.noScheduleNeeds, threadKind: "LOAN", subject: v.sub.due,
    });
  }

  if (has(R.balance, q)) {
    const blocked = bookBlocked("balance");
    if (blocked) return blocked;
    const x = explain();
    const loan = f.activeLoan;
    let answer: string;
    if (f.bookSource === "onboarding") answer = v.noLoanYet(lender);
    else if (!loan && f.outstanding <= 0) answer = v.owesNothing(lender);
    else {
      const parts = [v.owe(lender, ksh(f.outstanding))];
      if (loan) {
        parts.push(v.loanLine(loan.product, ksh(loan.loanAmount), ksh(loan.balance)));
        const clear = day(loan.expectedClearDate, lang);
        if (clear) parts.push(v.clearBy(clear));
      }
      if (f.loanCount > 1) parts.push(v.several(f.loanCount));
      answer = parts.join(" ");
    }
    return base({
      intent: "balance", answer: `${answer}${x.text}`,
      sources: x.source ? [x.source] : [],
      checked: [bookLine()],
      actions: f.outstanding > 0 ? [nav("app-repay", v.act.repay)] : f.available > 0 ? [nav("app-apply", v.act.apply)] : [],
      suggestions: [...v.s.balance],
    });
  }

  if (has(R.limit, q)) {
    const x = explain();
    if (f.limit <= 0) {
      return base({ intent: "limit", answer: `${v.noLimit}${x.text}`, sources: x.source ? [x.source] : [], checked: [bookLine()], actions: [nav("app-crunch", "Open the statement cruncher")] });
    }
    const blocked = f.bookSource === "unavailable" ? bookBlocked("limit") : null;
    if (blocked) return blocked;
    return base({
      intent: "limit",
      answer: `${v.limit(lender, ksh(f.limit), ksh(f.available), f.outstanding > 0 ? ksh(f.outstanding) : null)}${x.text}`,
      sources: x.source ? [x.source] : [],
      checked: [bookLine()],
      actions: f.available > 0 ? [nav("app-apply", v.act.apply), nav("app-ladder", v.act.ladder)] : [nav("app-ladder", v.act.ladder)],
      suggestions: [...v.s.limit],
    });
  }

  if (has(R.score, q)) {
    const x = explain();
    if (f.score == null) {
      return base({ intent: "score", answer: `${v.noScore}${x.text}`, sources: x.source ? [x.source] : [], checked: [record("No score on file")] });
    }
    const drivers = f.scoreDrivers.slice(0, 3).map((d) => `- ${d.factor} — ${d.direction === "increases" ? v.up : v.down}`);
    return base({
      intent: "score",
      answer: `${v.score(f.score, f.band)}${drivers.length ? `\n\n${v.drivers}\n${drivers.join("\n")}` : ""}${x.text}`,
      sources: x.source ? [x.source] : [],
      checked: [record(`Score ${f.score}/900${f.band ? ` (${f.band})` : ""}`)],
      actions: [nav("app-score", v.act.score)],
      suggestions: [...v.s.score],
    });
  }

  if (has(R.savings, q)) {
    if (!f.savings) {
      return base({ intent: "savings", answer: v.savingsUnknown(lender), outcome: "offer", confidence: "certain", checked: [record("Savings could not be read")], needsHuman: `Confirm the customer's savings balance — it could not be read from ${lender}'s book.`, threadKind: "LOAN" });
    }
    const last = f.savings.lastAmount != null && day(f.savings.lastAt, lang) ? v.savingsLast(ksh(f.savings.lastAmount), day(f.savings.lastAt, lang)!) : "";
    return base({
      intent: "savings",
      answer: [v.savings(lender, ksh(f.savings.balance)), last, v.savingsHow].filter(Boolean).join(" "),
      checked: [record(`Savings ${ksh(f.savings.balance)}`)],
      suggestions: [...v.s.balance],
    });
  }

  if (has(R.ratiba, q)) {
    const r = f.ratiba;
    const answer = !r.available ? v.ratibaOff(lender) : r.active ? v.ratibaOn(r.amount != null ? ksh(r.amount) : null, r.frequency) : v.ratibaNone;
    return base({
      intent: "ratiba", answer,
      checked: [{ tool: "ratiba.status", said: !r.available ? "Ratiba not offered through the app by this lender" : r.active ? `Standing order active${r.amount != null ? `, ${ksh(r.amount)}` : ""}` : "No standing order" }],
      actions: r.available ? [nav("app-repay", v.act.repay)] : [],
      suggestions: ["What is Ratiba?", "How do I stop my Ratiba standing order?"],
    });
  }

  if (has(R.kyc, q)) {
    const said = v.kyc[f.kycStatus] ?? v.kyc.NONE;
    return base({
      intent: "kyc",
      answer: typeof said === "function" ? said(lender) : said,
      checked: [record(`KYC status ${f.kycStatus}`)],
      actions: f.kycStatus === "VERIFIED" ? [] : [nav(f.kycStatus === "FAILED" ? "app-identity" : "app-kyc", v.act.kyc)],
    });
  }

  if (has(R.messages, q)) {
    const latest = f.messages[0];
    const answer = f.unreadMessages > 0
      ? [v.unread(f.unreadMessages), latest ? v.latest(latest.subject) : ""].filter(Boolean).join(" ")
      : latest ? `${v.noUnread} ${v.latest(latest.subject)}` : v.noThreads;
    return base({
      intent: "messages", answer,
      checked: [record(`${f.unreadMessages} unread message${f.unreadMessages === 1 ? "" : "s"}`)],
      actions: [nav("app-messages", v.act.messages)],
    });
  }

  // 6 · "TAKE ME TO…" — the app map, and only the app map.
  if (has(R.navigate, q)) {
    const ranked = APP_SCREENS
      .filter((s) => !s.contextual)
      .map((s) => ({ s, score: scoreScreen(q, s) }))
      .filter((x) => x.score >= DESTINATION_FLOOR)
      .sort((a, z) => z.score - a.score);
    if (ranked[0]) {
      const s = ranked[0].s;
      return base({
        intent: "navigate",
        answer: v.navigate(s.title, s.purpose),
        sources: [{ id: `screen:${s.id}`, label: "Micro Eazy app map" }],
        checked: [{ tool: "platform.screen", said: `Resolved to ${s.title}` }],
        actions: [{ kind: "navigate", label: lang === "sw" ? `Fungua ${s.title}` : `Open ${s.title}`, href: s.href, screenId: s.id }],
      });
    }
  }

  // 7 · KNOWLEDGE — ours in code, theirs in packs.
  if (hits[0]) {
    const top = hits[0];
    const src = hitSource(top);
    const article = top.kind === "article" ? top.article : null;
    const offers = article?.offersPerson ?? /raise it as a case|raising as a case|worth raising/i.test(top.kind === "pack" ? top.entry.answer : "");
    const trapLine = checkTraps(q).some((h) => h.trap.id === "repayment-allocation") && !/loan first/i.test(hitBody(top, lang)) ? `\n\n${v.allocation}` : "";
    const actions: NavigateAction[] = article?.screen ? [nav(article.screen, lang === "sw" ? `Fungua ${appScreenById(article.screen)?.title ?? ""}` : `Open ${appScreenById(article.screen)?.title ?? ""}`)] : [];
    return base({
      intent: "knowledge",
      outcome: offers ? "offer" : "resolved",
      confidence: top.score >= 30 ? "certain" : "likely",
      answer: `${hitBody(top, lang)}${trapLine}`,
      sources: [src],
      checked: [{ tool: "corpus", said: `Matched ${src.id}${src.starter ? " (starter pack, not yet reviewed by the lender)" : ""}` }],
      actions,
      suggestions: hits.slice(1).map((h) => (h.kind === "article" ? h.title : h.entry.question)).slice(0, 2),
      needsHuman: offers ? `The customer asked: follow-up needed on "${top.kind === "article" ? top.title : top.entry.question}".` : null,
      threadKind: /repay|pay|ratiba|late/i.test(top.kind === "article" ? top.article.category : top.entry.category) ? "REPAYMENT" : "GENERAL",
    });
  }

  // 8 · NOTHING RECOGNISED IT. The route may try a grounded model; this is the floor.
  return base({
    intent: "open", outcome: "offer", confidence: "unsure",
    answer: v.open(lender),
    checked: [bookLine(), { tool: "corpus", said: "No knowledge entry matched" }],
    suggestions: [...v.s.open],
    needsHuman: v.openNeeds,
  });
}

/** An entry's words, as the customer reads them. External URLs are offered, never app routes. */
function hitBody(hit: CorpusHit, lang: RiriLang): string {
  if (hit.kind === "article") return `**${hit.title}**\n\n${hit.body}`;
  const more = hit.entry.url ? `\n\n${lang === "sw" ? "Zaidi" : "More"}: ${hit.entry.url}` : "";
  return `${hit.entry.answer}${more}`;
}

// ── The grounded model path, for questions nothing above recognised ──────────

/**
 * Every shilling figure and percentage in a model's answer must already be in the
 * text it was grounded on. Anything else is a number the model made, and on this
 * surface a made-up number is somebody's next payment.
 */
export function figuresGrounded(answer: string, grounding: string): boolean {
  const flat = (s: string) => s.replace(/,/g, "");
  const ground = flat(grounding);
  const money = [...flat(answer).matchAll(/(?:ksh|kes|shillings?)\s*\.?\s*(\d+(?:\.\d+)?)/gi)].map((m) => m[1]);
  const pct = [...flat(answer).matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => `${m[1]}%`);
  return money.every((n) => ground.includes(n)) && pct.every((p) => ground.includes(p));
}

/**
 * The system instruction for a customer-facing model answer.
 *
 * Only reached for `intent: "open"`. The facts block is built from the same
 * record, so a model can phrase but cannot introduce: a figure not in FACTS is
 * a figure it was told it does not know.
 */
export function customerSystemPrompt(facts: CustomerFacts, packsSeen: string[]): string {
  const lines = [
    `bookSource: ${facts.bookSource}`,
    facts.bookSource === "native" || facts.bookSource === "lender" ? `outstanding: ${ksh(facts.outstanding)}` : "outstanding: unknown",
    `limit: ${facts.limit > 0 ? ksh(facts.limit) : "none yet"}, available: ${ksh(facts.available)}`,
    facts.activeLoan ? `open loan: ${facts.activeLoan.product ?? "loan"}, borrowed ${ksh(facts.activeLoan.loanAmount)}, balance ${ksh(facts.activeLoan.balance)}${facts.activeLoan.nextDue ? `, next instalment ${ksh(facts.activeLoan.nextDue.amount)} on ${facts.activeLoan.nextDue.date}` : ", instalment schedule not available"}` : "open loan: none",
    facts.application ? `application: ${ksh(facts.application.amount)}, status ${facts.application.status}${facts.application.stageTitle ? `, stage ${facts.application.stageTitle}` : ""}` : "application: none in progress",
    facts.score != null ? `score: ${facts.score}/900` : "score: none",
    facts.savings ? `savings: ${ksh(facts.savings.balance)}` : "savings: unknown",
    `kyc: ${facts.kycStatus}`,
  ];
  return `You are Riri, the assistant inside the Micro Eazy app, talking to a customer of ${facts.lender}${facts.firstName ? ` called ${facts.firstName}` : ""}. You are warm, plain-spoken and brief — three or four short sentences. Match their language: English, Kiswahili or Sheng.

THE RULES YOU NEVER BREAK
- Figures, dates and names come ONLY from FACTS below, exactly as written. If a number is not in FACTS, say you can't see it — never estimate, never calculate a new figure.
- Never promise an approval, a decision time, a refund or any outcome. You can describe what happens; you cannot commit ${facts.lender}.
- Payments go to the loan first and any remainder to savings. Nobody can route a payment elsewhere. Never suggest otherwise.
- Never tell them to press a button or go to a named screen — the app gives them buttons separately.
- If you are not sure, say so and offer to pass the question to the team. If they ask for a person, agree immediately.
- Never repeat a phone number or ID number.

FACTS (their own account, read just now):
${lines.map((l) => `- ${l}`).join("\n")}

${packsSeen.length ? `Knowledge available on this app came from: ${packsSeen.join(", ")}. If the question is about ${facts.lender}'s products, fees or terms and you do not have the fact, say the loan overview shows every fee before they agree.` : ""}`;
}
