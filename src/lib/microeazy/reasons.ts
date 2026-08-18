// ─────────────────────────────────────────────────────────────────────────────
// "WHY WAS I DECLINED, AND WHAT DO I DO ABOUT IT?"  (blueprint §7.1, task 0.8)
//
// A decline the customer cannot act on is not a decision, it is a door. The
// engine already records WHY (LoanApplication.reasonCodes); what has never
// existed is the other half — what to actually DO — so this module is the
// remedy library, and it is deliberately separate from the engine: the reason is
// a fact about a past assessment and must never be rewritten, while the advice
// is editorial and will be revised as we learn what actually helps.
//
// THREE STORED SHAPES, ALL REAL, ALL IN THE DATABASE RIGHT NOW. This was read off
// micromart's own rows, not inferred from the types:
//
//   { code, detail }                    · the funnel's decisions  (AFFORDABILITY…)
//   { code, factor, detail, direction } · the limit engine        (LIM_*)
//   { factor, points, direction }       · older scorecard rows    (INC REG RPY STB)
//
// The third has NO `code` at all. Anything built against `ReasonCode` alone
// renders those rows as blank bullets, which is precisely the screen a declined
// customer must never be shown. `normalise()` is the one place that knows this.
//
// RESPONSIBLE-AI POSITION (blueprint §6.5). Every line below is a plain-language
// restatement of a factor the model actually used — never a guess at one, and
// never a moral judgement about the customer. Where we cannot name the factor
// honestly we say so, rather than inventing a tidy reason, because a
// confident-sounding wrong explanation is worse than an admitted gap.
// ─────────────────────────────────────────────────────────────────────────────

export type ReasonDirection = "up" | "down" | "neutral";

/** One reason, after every stored shape has been flattened into the same thing. */
export type CustomerReason = {
  /** Stable identifier where the row had one; null for the factor-only shape. */
  code: string | null;
  /** The heading the customer reads. */
  title: string;
  /** What the assessment found — restated, never re-decided. */
  why: string;
  /** What to do about it. Null when nothing the customer does can change it. */
  howToFix: string | null;
  /** Did this push the decision up, down, or neither? */
  direction: ReasonDirection;
};

/** A stored reason, in any of the shapes above. Everything is optional. */
type StoredReason = {
  code?: unknown;
  label?: unknown;
  factor?: unknown;
  detail?: unknown;
  tone?: unknown;
  direction?: unknown;
  points?: unknown;
};

const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return s || null;
};

/**
 * The remedy library. `title` gives the reason a customer-facing name; `fix` is
 * the action.
 *
 * `fix: null` means NOTHING THE CUSTOMER DOES CHANGES THIS, and saying so is the
 * point — "improve your betting behaviour" alongside "wait 30 days" implies the
 * second is also a choice they are failing to make. Waiting is not a failing.
 */
const REMEDIES: Record<string, { title: string; fix: string | null }> = {
  // ── The funnel's own decision codes ────────────────────────────────────────
  AFFORDABILITY: {
    title: "Affordability",
    fix: "Ask for a smaller amount, or a longer term so each instalment is lower. The amount you qualify for is shown above — applying at or below it usually goes straight through.",
  },
  SCORE: {
    title: "Credit score",
    fix: "Your score moves with your repayment record. Clearing this lender's next loan on time is the fastest way it rises — and it rises automatically, with no application needed.",
  },
  BOUND: {
    title: "What set your limit",
    fix: "Your limit is the lower of what your cashflow supports and what your score supports. Whichever one is named above is the one to move.",
  },
  CADENCE: { title: "Repayment rhythm", fix: null },
  EXPOSURE: {
    title: "Existing loan load",
    fix: "A large share of your income is already going to loan repayments. Clearing one existing loan before applying again lifts this more than any other single action.",
  },
  BETTING: {
    title: "Betting spend",
    fix: "Betting is read from your M-Pesa statement as a share of money out. Where that share falls over the following months, a re-assessment will see the change.",
  },
  THIN_FILE: {
    title: "Length of history",
    fix: "There is not yet much statement history to read. This resolves on its own with time — a longer M-Pesa record, and one cleared loan, is usually enough.",
  },
  VOLATILITY: {
    title: "Income steadiness",
    fix: "Income that swings month to month is lent against more cautiously. A few months of steadier inflows, or a shorter term matched to your best weeks, both help.",
  },
  GRADUATION: {
    title: "Room to grow",
    fix: "First loans start small on purpose. Clear this one on time and the limit graduates automatically — you do not need to ask.",
  },
  CASHFLOW: { title: "Cashflow", fix: "The money moving through your M-Pesa is what capacity is calculated from. A fuller, more recent statement gives the assessment more to work with." },
  CASHFLOW_STABLE: { title: "Steady cashflow", fix: null },
  MATCH: { title: "Product match", fix: null },
  RECOMMENDED: { title: "Recommended offer", fix: null },

  // ── Hard stops. Each one ends the application then and there ───────────────
  STOP_AFFORDABILITY: {
    title: "Affordability stop",
    fix: "The instalment could not be covered by the income on the statement. A smaller amount over a longer term is the same loan at a lower instalment — that is the one to apply for.",
  },
  STOP_SCORE: {
    title: "Score below the floor",
    fix: "This lender sets a minimum score. It is not permanent: it moves with repayment behaviour, and a cleared loan anywhere on your record moves it.",
  },
  STOP_EXPOSURE: {
    title: "Too much borrowed already",
    fix: "Total borrowing across your record is already high relative to income. Clearing an existing loan is what changes this.",
  },
  STOP_HISTORY: {
    title: "Repayment history",
    fix: "Something in the repayment record stopped this application. You are entitled to see the detail — ask for it through support, and to appeal it.",
  },
  STOP_CASHFLOW: {
    title: "Not enough statement to read",
    fix: "The M-Pesa statement did not cover enough months to assess. Re-upload a longer one — six months is ideal — and apply again straight away.",
  },

  // ── The limit engine ──────────────────────────────────────────────────────
  LIM_DECLINED: { title: "No limit offered", fix: null },
  LIM_RISK: { title: "Risk adjustment", fix: null },
  LIM_FIRST_CYCLE: {
    title: "First loan here",
    fix: "There is no repayment history with this lender yet, so the ladder starts on this loan. It climbs from the first cleared repayment.",
  },

  // ── The older scorecard rows, which carry a factor and no code ────────────
  INC: { title: "Income", fix: "Assessed from the inflows on your M-Pesa statement. A fuller statement reads more of your income." },
  REG: { title: "Regularity of income", fix: "Money arriving on a predictable rhythm scores better than the same amount arriving unpredictably." },
  RPY: { title: "Repayment record", fix: "Loans cleared on time are the single strongest factor. Each one you clear improves this." },
  STB: { title: "Stability", fix: null },
};

/** Sentence-case a bare code so an unmapped one still reads as words. */
function titleFromCode(code: string): string {
  const words = code.replace(/^(STOP|LIM)_/, "").replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function directionOf(r: StoredReason): ReasonDirection {
  const raw = (str(r.direction) ?? str(r.tone) ?? "").toLowerCase();
  if (raw === "up" || raw === "positive") return "up";
  if (raw === "down" || raw === "negative") return "down";
  if (raw) return "neutral";
  // No direction stored. Points carry the sign on the old scorecard shape.
  const pts = typeof r.points === "number" ? r.points : Number(r.points);
  if (Number.isFinite(pts) && pts !== 0) return pts > 0 ? "up" : "down";
  return "neutral";
}

/**
 * Flatten one stored reason of ANY shape into something a customer can read.
 * Returns null only when the row carries no usable words at all — better to drop
 * a bullet than to print an empty one.
 */
export function normaliseReason(raw: unknown): CustomerReason | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as StoredReason;

  const code = str(r.code);
  const detail = str(r.detail);
  const factor = str(r.factor);
  const label = str(r.label);

  const remedy = code ? REMEDIES[code] : undefined;

  // The heading, in order of how specific it is: the remedy library knows the
  // best wording; then whatever the row itself carried; then the bare code.
  const title = remedy?.title ?? label ?? factor ?? (code ? titleFromCode(code) : null);

  // The body. `detail` is the engine's own sentence about THIS application and
  // is always preferred — it names the customer's real numbers.
  const why = detail ?? factor ?? label;

  if (!title && !why) return null;

  return {
    code,
    title: title ?? "Assessment factor",
    why: why ?? "This was one of the factors in the assessment.",
    howToFix: remedy ? remedy.fix : null,
    direction: directionOf(r),
  };
}

/** Flatten a stored `reasonCodes` array. Non-arrays and junk rows fall away. */
export function normaliseReasons(raw: unknown): CustomerReason[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normaliseReason).filter((r): r is CustomerReason => r !== null);
}

/**
 * The one-line headline above the list.
 *
 * REFER is NOT a decline and must never be worded as one — it is a person
 * reading the file, and a customer told "declined" who is actually in a review
 * queue will not come back to collect an approval.
 */
export function verdictHeadline(verdict: string | null | undefined, lenderName: string | null): {
  tone: "declined" | "review" | "approved" | "pending";
  headline: string;
  body: string;
} {
  const lender = lenderName ?? "the lender";
  switch ((verdict ?? "").toUpperCase()) {
    case "DECLINE":
      return {
        tone: "declined",
        headline: "This application was not approved",
        body: `${lender} could not approve this one. Here is exactly what the assessment weighed, and what changes it.`,
      };
    case "REFER":
      return {
        tone: "review",
        headline: "A person is reviewing this",
        body: `This did not decline — it went to ${lender} for a human decision. Nothing more is needed from you right now.`,
      };
    case "APPROVE":
      return {
        tone: "approved",
        headline: "This application was approved",
        body: "Here is what the assessment weighed, including what is holding the limit where it is.",
      };
    default:
      return {
        tone: "pending",
        headline: "This is still being assessed",
        body: "No decision has been recorded yet. Check back shortly.",
      };
  }
}
