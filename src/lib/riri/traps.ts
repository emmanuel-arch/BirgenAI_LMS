// ─────────────────────────────────────────────────────────────────────────────
// THE GROUNDING TRAPS — the places where the obvious reading of this data is wrong.
//
// A retrieval system is only as honest as the facts it is pointed at, and this
// estate has six areas where a competent, careful, well-prompted model produces a
// confident and completely wrong answer — because the DATA lies, not the model.
//
// `Loans.DateCleared` is NULL on all 344,332 rows. Ask "how long do loans take to
// settle" and the honest thing to do with that column is return nothing; what a
// model actually does is find the column, use it, get zero, and report zero. Zero
// is a number. It renders. It goes in a board pack.
//
// This is not the same problem as hallucination and it is not fixed by the same
// tools. Better retrieval makes it WORSE — it finds the column faster. A bigger
// model makes it worse. The only fix is to write down what is actually true and
// put it in front of the answer, which is what this file is.
//
// ── HOW IT IS USED ───────────────────────────────────────────────────────────
// `checkTraps(question)` runs before the engine does. Two severities:
//
//   refuse — the underlying data cannot answer this at all. Riri says what is
//            wrong and what she would need, and produces NO figure. The failure
//            has to be loud, because a quiet one is a plausible number.
//   caveat — the data can answer, but the answer is misleading without a sentence
//            beside it. The sentence is not optional and not a footnote.
//
// Deliberately keyword-matched and pure: no model, no database, no network. A
// guard that can fail, time out or be reasoned with is not a guard. It runs on
// every question in every engine, so it has to be free.
//
// ── WHY THESE SIX ────────────────────────────────────────────────────────────
// They are not edge cases. They are the questions a lender asks in their first
// week: how fast do we settle, what are we earning in penalties, is this customer
// verified, where did my payment go, did the SMS send, and how is entity X doing.
// Each was discovered the expensive way — by someone reading a figure that was
// wrong — and each is one paragraph to write down.
// ─────────────────────────────────────────────────────────────────────────────

export type TrapSeverity = "refuse" | "caveat";

export type Trap = {
  id: string;
  /** What area this covers, for the log and the console. */
  title: string;
  severity: TrapSeverity;
  /**
   * Vocabulary that means the question is in this area. Whole words, matched
   * case-insensitively. Kept broad on purpose: a false positive costs one extra
   * sentence of caution, a false negative costs a wrong number.
   */
  match: RegExp;
  /**
   * The pinned truth, injected into the model's grounding. Written as fact, not as
   * instruction — a model follows facts about the world more reliably than it
   * follows rules about its own behaviour.
   */
  truth: string;
  /** What Riri says. For `refuse`, this IS the answer. */
  say: string;
};

export const TRAPS: Trap[] = [
  {
    id: "settlement-date",
    title: "Settlement and clearance dates",
    severity: "refuse",
    // `cleared` on its own is deliberate: "show me loans cleared last month" is the
    // most common phrasing of this question and the one most likely to be believed.
    match: /\b(date ?cleared|datecleared|settle(?:s|d|ment)?|clear(?:ed|ance)|time to (?:clear|settle)|how long .{0,30}(?:clear|settle|repay in full)|early settle|paid off|payoff)\b/i,
    truth:
      "Loans.DateCleared is NULL on all 344,332 rows in this book — it has never been populated by any " +
      "process. Any aggregate over it returns 0 or NULL, which renders as a real figure and is not one. " +
      "Settlement is derivable, but only from CustomerStatement, by finding the transaction that takes a " +
      "loan's balance to zero. That derivation has not been built yet.",
    say:
      "I can't answer that one honestly yet. The column this book stores clearance dates in — " +
      "`Loans.DateCleared` — is empty on every single loan, so any settlement figure I gave you would be a " +
      "zero dressed up as an answer. The real dates are recoverable from the customer statements, but that " +
      "has to be built before I can read it. I'd rather tell you that than hand you a clean-looking number.",
  },
  {
    id: "penalties",
    title: "Penalties and late fees",
    severity: "caveat",
    match: /\b(penalt(?:y|ies)|late fees?|fine[sd]?|punitive|default charges?|overdue charges?)\b/i,
    truth:
      "Penalties are effectively switched off on this book and have been since June. They are configured on " +
      "only 6 of 37 products, charge once per loan rather than accruing, and have not fired at all since " +
      "June 2026. Separately, a NULL-handling bug in the penalty calculation drops roughly a third of the " +
      "rows that should appear. So the true figure is both near-zero AND under-reported.",
    say:
      "Worth knowing before you read this: penalties are effectively off on this book. They're set on 6 of " +
      "37 products, they charge once per loan rather than accruing, and nothing has actually fired since " +
      "June. There's also a NULL bug that eats about a third of what's left. So a low number here isn't good " +
      "news about customer behaviour — it's the configuration.",
  },
  {
    id: "kyc-simulated",
    title: "KYC and identity verification results",
    severity: "caveat",
    match: /\b(kyc|ocr|id (?:check|verif)|identity (?:check|verif)|liveness|document (?:check|scan)|verified\??|iprs)\b/i,
    truth:
      "The KYC OCR silently falls back to SIMULATION. When it does, it invents a complete, plausible " +
      "identity — name, ID number, date of birth — and reports it at 96% confidence. Nothing in the result " +
      "says it was simulated except the `ocr.engine` field. A simulated result is indistinguishable from a " +
      "real verification unless that field is read.",
    say:
      "One thing I have to flag: the ID reader simulates when it can't reach the real engine, and a " +
      "simulated result still comes back at 96% confidence with a full name and ID number that were made " +
      "up. The only tell is the `ocr.engine` field on the record. So I can't treat a verification result as " +
      "proof of identity unless that field says a real engine ran — and neither should anyone approving on it.",
  },
  {
    id: "repayment-allocation",
    title: "Where a repayment goes",
    severity: "caveat",
    match: /\b(allocat|where (?:does|did|will) (?:my|the|this) (?:payment|money|repayment)|apply (?:my|the) payment|purpose of (?:the )?payment|split .{0,20}payment|pay (?:towards|toward|into) (?:savings|my loan))\b/i,
    truth:
      "Allocation is owned by Micromart's RepaymentTrigger, in the database. It applies the money to the " +
      "loan first and sends any remainder to savings. Neither the customer nor an officer can route a " +
      "payment elsewhere; a purpose picker in any interface is a display, not a routing instruction.",
    say:
      "Just so we're both right about this: the allocation isn't a choice anyone gets to make. The database " +
      "trigger applies a repayment to the loan first and anything left over goes to savings. If a screen " +
      "offers a purpose, it's labelling the payment, not directing it.",
  },
  {
    id: "sms-outbox",
    title: "SMS delivery and the outbox",
    severity: "caveat",
    // The gap that matters is the passive voice — "how many messages were delivered"
    // is how this is actually asked, and it is the phrasing that reads the wrong table.
    match: /\b(sms|text messages?|messages?\b.{0,18}\b(?:sent|delivered|queued|failed)|outbox|notification sent|did (?:we|they) (?:get|receive) the (?:sms|message))\b/i,
    truth:
      "Live SMS is in Notifications.dbo.SMS, not the SMS table that shares the application database and " +
      "looks like the obvious one. Reading the obvious table under-reports delivery. Also: entities 3002 " +
      "and 3005 are one physical database, so an SMS count that does not filter on entity mixes both books.",
    say:
      "Note on where this comes from: the live outbox is `Notifications.dbo.SMS`, not the SMS table sitting " +
      "in the application database — that one looks right and isn't. And 3002 and 3005 share one database, " +
      "so anything not filtered by entity is counting both books together.",
  },
  {
    id: "entity-identity",
    title: "Which lender an EntityId names",
    severity: "caveat",
    match: /\b(entity ?id|entity \d{3,}|across (?:entities|lenders|servers)|other (?:entity|lender)|compare .{0,25}(?:entity|lender)|which lender)\b/i,
    truth:
      "EntityId is not unique across servers. EntityId 3003 is 'Micromart Check-off' on one server and " +
      "'Axe — Boresha' on the other. Fifteen members currently exist under this scheme. The stable key is " +
      "the KRA PIN in BsEntity.EntityTaxRef.",
    say:
      "Careful with this one: an EntityId only means something on the server it came from. 3003, for " +
      "instance, is Micromart Check-off on one and Axe — Boresha on the other. If this question spans " +
      "servers I'd want to key it on the KRA PIN rather than the id, or we'll confidently merge two " +
      "different lenders.",
  },
];

export type TrapHit = { trap: Trap };

/**
 * Which traps this question touches.
 *
 * Runs on every question, in every engine, before anything else. Cheap by
 * construction — six regexes over one short string.
 */
export function checkTraps(question: string): TrapHit[] {
  const q = (question ?? "").trim();
  if (!q) return [];
  return TRAPS.filter((t) => t.match.test(q)).map((trap) => ({ trap }));
}

/** Does any hit require a hard refusal? */
export const mustRefuse = (hits: TrapHit[]): TrapHit | null =>
  hits.find((h) => h.trap.severity === "refuse") ?? null;

/**
 * The block appended to the model's grounding.
 *
 * Phrased as facts about the data rather than as instructions to the model, and
 * placed with the rest of the FACTS, because "the column is empty on every row" is
 * something a model reasons correctly from, while "do not answer questions about
 * settlement" is something it negotiates with itself when the question is phrased
 * slightly differently.
 */
export function trapGrounding(hits: TrapHit[]): string {
  if (!hits.length) return "";
  return [
    "KNOWN DEFECTS IN THIS DATA — these are established facts about the book, not guesses.",
    "Where one applies, say so plainly in your answer; never present an affected figure without it.",
    ...hits.map((h) => `- ${h.trap.title}: ${h.trap.truth}`),
  ].join("\n");
}

/** For the query log — which traps fired, so we can see what people keep asking. */
export const trapIds = (hits: TrapHit[]): string[] => hits.map((h) => h.trap.id);
