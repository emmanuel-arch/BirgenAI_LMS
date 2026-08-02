// ─────────────────────────────────────────────────────────────────────────────
// THE ROUTER — one assistant, three engines, and nobody has to know that.
//
// WHAT THIS REPLACES, AND WHY THE OLD SHAPE EXISTED
// -------------------------------------------------
// The dock used to make the lender pick: Support, Assistant, or Analytics. Three
// tiles on a home screen, one thread each. That was not a whim — it was a fix for a
// real and expensive failure. When the tiers sat behind a segmented switcher, the
// model could change under a half-typed question: compose "what's my PAR 30 by
// product", tap Assistant while thinking, hit send, and a request for a hard number
// off the book reaches the engine that REASONS instead of the one that QUERIES. It
// answers plausibly. A made-up number with the lender's name on it is the worst
// output this system can produce.
//
// "One app at a time" fixed that by making the human commit before they typed. It
// worked. It also made the human do the routing — and asked them to know, before
// they had asked anything, which of three engines owns their question. That is our
// architecture leaking through the glass. A lender should not have to know we have
// three engines any more than they need to know we have three database indexes.
//
// SO THE FIX MOVES, IT DOES NOT DISAPPEAR.
// The safety property was never "the human chooses". It was: A REQUEST FOR A HARD
// NUMBER MUST NOT REACH A MODEL THAT WILL REASON ONE UP. That property is stronger
// here than it was under the switcher, because:
//
//   · The decision is made from the FINISHED question, at send. A switcher decided
//     from whatever was tapped last, possibly mid-sentence.
//   · It is deterministic and pure — same words, same engine, every time. There is
//     a test file that pins it, which is not a thing you can write about a finger.
//   · The number path is checked FIRST and greedily. When a question could be read
//     as asking for a figure, it goes to the engine that produces figures with the
//     SQL attached, and never to the one that produces prose.
//   · The answer is STAMPED with which engine ran and what its evidence was — the
//     query, the record, or its own reasoning. The user still knows; they are told
//     afterwards instead of being examined beforehand.
//   · When it genuinely cannot tell, it does not guess: it asks, in one tap.
//
// Pure by construction: no database, no model call, no session. It reads the metric
// catalogue's own synonyms and the system map's own phrasings, which means the
// router learns every time somebody adds a metric or a screen, and cannot drift from
// what those two files actually contain.
// ─────────────────────────────────────────────────────────────────────────────
import { METRICS } from "./catalog";
import { findScreens, findConcepts, type Access } from "./system-map";
import { isNavigationIntent } from "./guide";

export type Engine = "support" | "assistant" | "analytics";

export type Routing = {
  engine: Engine;
  /** How sure. `unsure` is the only value that may carry an `alternative`. */
  confidence: "certain" | "likely" | "unsure";
  /** One line, shown under the answer. Never jargon — the lender reads this. */
  why: string;
  /** The other reading, when there genuinely are two. Offered as one tap. */
  alternative?: { engine: Engine; label: string };
};

export type RouteContext = {
  /** A customer is pinned — the whole conversation is about them. */
  hasSubject?: boolean;
  /** The caller's rights and package, so the map scores what they can reach. */
  access?: Access;
};

// ── The vocabularies ─────────────────────────────────────────────────────────

/**
 * A question shaped like a measurement. Not "does it mention money" — a lot of
 * how-to questions mention money — but "is it asking for a QUANTITY".
 */
const QUANTITY =
  /\b(how much|how many|what(?:'s| is| are)? (?:my|our|the) total|total|sum|count|average|median|percentage|percent|ratio|rate of|top \d+|top ten|bottom \d+|worst|best|highest|lowest|rank|breakdown|split by|by (?:product|branch|officer|month|region|status|county)|over time|trend|month on month|year to date|ytd|compared to last|since (?:january|last)|this (?:month|week|quarter|year)|last (?:month|week|quarter|year))\b/i;

/** Words that name a figure a lender tracks. Seeded from the catalogue itself. */
const METRIC_WORDS: ReadonlySet<string> = new Set(
  METRICS.flatMap((m) => [m.label, ...m.synonyms])
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3),
);

/** Multi-word figures that must not be broken into common nouns. */
const METRIC_PHRASES = [
  "par 30", "par30", "portfolio at risk", "value at risk", "loan book", "outstanding book",
  "collection rate", "write off", "write-off", "default rate", "approval rate",
  "disbursed", "collected", "arrears", "in arrears", "past due", "npl",
  "interest earned", "fee income", "average loan size", "repeat rate", "retention",
];

/**
 * Short tokens the length filter would throw away, and one of them is the single
 * most-asked figure in microlending. "show me PAR buckets" carried no signal at all
 * until this existed, because `par` is three letters. Matched as whole tokens, never
 * as substrings — otherwise "compare" is a portfolio metric.
 */
const SHORT_METRIC_TOKENS: ReadonlySet<string> = new Set(["par", "npl", "ytd", "mtd", "tat", "dpd"]);

/** Asking to be shown how, or where, or why something is refused. */
const HOWTO =
  /\b(how do (?:i|we|you)|how can (?:i|we)|how to|steps to|walk me through|guide me|where (?:is|do|can) (?:i|we)|why can(?:'|no)?t (?:i|we)|why is (?:it|this) (?:blocked|greyed|disabled|stuck)|what (?:does|is) (?:the|this) .{0,24}(?:screen|page|button|setting|field) (?:do|for)|set ?up|configure|enable|turn on|turn off|permission|access|who can|am i allowed|ninawezaje|nifanyaje|nifanye nini|kwa nini siwezi)\b/i;

/** Asking for a judgement, a plan, or words to say. */
const JUDGEMENT =
  /\b(should (?:i|we)|would you|do you think|is it (?:worth|wise|safe)|advise|recommend|draft|write (?:me|a|an|the)|what do i (?:say|tell)|how do i (?:tell|say|explain) (?:them|him|her)|talk to|convince|negotiate|chase|follow up|prioriti[sz]e|who should i|what am i missing|help me decide|argue|pros and cons|restructure or)\b/i;

/** The conversation is about a PERSON, not the book. */
const PERSON =
  /\b(this (?:customer|borrower|client|guy|lady|person)|them|their|his|her|he |she |huyu|mteja huyu|top ?-?up|graduate|limit so low|are they|will they|can they|is he|is she)\b/i;

/** Talking about the assistant itself. */
const META =
  /\b(what can you do|who are you|what are you|can you (?:approve|disburse|delete|change)|are you (?:safe|sure|an ai)|do you (?:remember|know)|forget|your memory|unaweza nini|wewe ni nani)\b/i;

const hasAny = (q: string, phrases: readonly string[]) => phrases.some((p) => q.includes(p));

const tokensOf = (q: string) =>
  q.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

/** How many distinct catalogue words the question uses. */
function metricPressure(q: string): number {
  const lower = q.toLowerCase();
  let n = hasAny(lower, METRIC_PHRASES) ? 2 : 0;
  const seen = new Set<string>();
  for (const w of tokensOf(lower)) {
    if (seen.has(w)) continue;
    if (SHORT_METRIC_TOKENS.has(w)) { seen.add(w); n += 2; continue; }
    if (w.length > 3 && METRIC_WORDS.has(w)) { seen.add(w); n += 1; }
  }
  return n;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE DECISION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which engine answers this.
 *
 * Order is the whole design. Each rule is checked before the ones that could
 * override it, and the ordering is by COST OF BEING WRONG, not by likelihood:
 *
 *   1. A hard number reaching the reasoning engine is a fabricated figure with the
 *      lender's name on it. Checked first, and greedily.
 *   2. A how-to reaching the reasoning engine is an invented menu path. Second.
 *   3. Everything else is judgement, and judgement is what the assistant is for.
 *
 * The pinned-customer exception sits between 1 and 2 on purpose: "how much can THIS
 * customer borrow" is not a book metric, and running it as one would answer a
 * different question with a real number, which is the most convincing way to be wrong.
 */
export function routeQuestion(question: string, ctx: RouteContext = {}): Routing {
  const q = question.trim();
  const lower = q.toLowerCase();

  if (!q) return { engine: "support", confidence: "unsure", why: "Nothing to answer yet." };

  // ── 0. About the assistant itself ──────────────────────────────────────────
  if (META.test(lower)) {
    return { engine: "support", confidence: "certain", why: "You asked about me, not about the book." };
  }

  const quantity = QUANTITY.test(lower);
  const pressure = metricPressure(lower);
  const person = ctx.hasSubject || PERSON.test(lower);
  const howto = HOWTO.test(lower);
  const nav = isNavigationIntent(lower);
  const judgement = JUDGEMENT.test(lower);

  const screen = findScreens(q, ctx.access, 1)[0];
  const concept = findConcepts(q, 1)[0];
  const mapScore = Math.max(screen?.score ?? 0, concept?.score ?? 0);

  // ── 1. A NUMBER OFF THE BOOK ───────────────────────────────────────────────
  //
  // A quantity frame plus catalogue vocabulary is the clearest signal this product
  // has, and it beats everything below it. The one thing that outranks it is a
  // question about a specific person — see the guard.
  const aboutTheBook = quantity && pressure >= 1;
  // Bare catalogue vocabulary is the WEAKER of the two signals, so an explicit
  // request for a read overrides it. "What am I missing about this application"
  // is a person asking to be advised; it is not an application-count query, and
  // answering it with one would be a real number to a question nobody asked.
  const namesAFigure = pressure >= 2 && !howto && !nav && !judgement;

  if ((aboutTheBook || namesAFigure) && !(person && !quantity)) {
    // …unless it is a figure ABOUT THE PINNED PERSON. "How much do they owe" is a
    // record lookup, not an aggregate, and the analytics engine measures books, not
    // people. Route to the assistant, which reads their actual row.
    if (person && !/\b(all|every|total across|by product|by branch|by officer|portfolio|book)\b/.test(lower)) {
      return {
        engine: "assistant",
        confidence: "likely",
        why: "That's a figure about this customer, so I read it off their record.",
        alternative: { engine: "analytics", label: "Ask it of the whole book instead" },
      };
    }
    return {
      engine: "analytics",
      confidence: quantity && pressure >= 2 ? "certain" : "likely",
      why: "You asked for a number, so I ran it against the live book and I'll show you the query.",
      ...(quantity && pressure >= 2 ? {} : { alternative: { engine: "assistant", label: "I wanted your read on it, not the number" } }),
    };
  }

  // ── 2. HOW THE PLATFORM WORKS ──────────────────────────────────────────────
  if (nav) {
    return { engine: "support", confidence: "certain", why: "You asked to be taken somewhere." };
  }
  if (howto) {
    // "HOW DO I…" IS NOT ALWAYS ABOUT THE SOFTWARE.
    //
    // "How do I say no to them without losing them" opens with the same three words
    // as "how do I register a borrower", and one of them is a question about a
    // screen while the other is a question about a conversation. The tell is that
    // it names a PERSON and the system map does not recognise it as anything —
    // no screen, no rule, nothing to walk them through. Answering that from the
    // platform corpus produces a confident paragraph about the wrong subject.
    if ((person || judgement) && mapScore < 30) {
      return {
        engine: "assistant",
        confidence: "likely",
        why: "That's a 'how do I handle this', not a 'how does the software work' — so it's my read.",
        alternative: { engine: "support", label: "I meant how the platform does it" },
      };
    }
    return {
      engine: "support",
      confidence: mapScore >= 30 ? "certain" : "likely",
      why: "You asked how the platform works, so I answered from what it actually does.",
    };
  }
  // No how-to phrasing, but the question is unmistakably the NAME of a screen or a
  // rule of the system — "credit policy", "maker checker", "data scope".
  if (mapScore >= 46 && !judgement && !person) {
    return { engine: "support", confidence: "likely", why: "That's part of the platform, so I answered from the system itself." };
  }

  // ── 3. JUDGEMENT, A PERSON, OR WORDS TO SAY ────────────────────────────────
  if (judgement || person) {
    return {
      engine: "assistant",
      confidence: "certain",
      why: person && !judgement
        ? "That's about a customer, so I read their record and reasoned from it."
        : "You asked for my read, so this is reasoning — not a figure off the book.",
    };
  }

  // ── 4. GENUINELY UNSURE ────────────────────────────────────────────────────
  //
  // Somewhere between "explain something" and "advise me". The default leans to
  // the platform when the map recognised anything at all, because being told how
  // something works and not needing it costs a paragraph, while being reasoned at
  // when you wanted a documented rule costs a wrong belief about your own system.
  if (mapScore >= 20) {
    return {
      engine: "support",
      confidence: "unsure",
      why: "I read that as a question about the platform.",
      alternative: { engine: "assistant", label: "I meant it about my book" },
    };
  }

  return {
    engine: "assistant",
    confidence: "unsure",
    why: "I read that as one for my judgement rather than a number.",
    alternative: { engine: "analytics", label: "I wanted a number off the book" },
  };
}

/** What the badge under an answer says. Short — it sits in 10px type. */
export const ENGINE_LABEL: Record<Engine, string> = {
  support: "Platform",
  assistant: "Judgement",
  analytics: "Live book",
};

/**
 * What the answer's evidence IS, per engine. This is the honesty half of collapsing
 * the tiers: the user no longer picks the engine, so the answer has to say which one
 * ran and what it stood on.
 */
export const ENGINE_EVIDENCE: Record<Engine, string> = {
  support: "Read from the platform's own configuration and screens",
  assistant: "Reasoned from records — verify figures before acting",
  analytics: "Queried the live book — the SQL is attached",
};
