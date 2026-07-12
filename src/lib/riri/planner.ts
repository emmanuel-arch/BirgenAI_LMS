// ─────────────────────────────────────────────────────────────────────────────
// The planner — question in, plan out.
//
// This is the seam the original analyst promised ("swap the keyword router for an
// intent classifier and the metric handlers stay identical"), now cashed in. A
// question becomes a PLAN — a metric, a period, a slice — and the plan is compiled
// to SQL by the catalogue. Two things follow from planning rather than dispatching:
//
//   • "collected this month", "what did we collect by product last month" and "top 5
//     products by collections" stop being three handlers and become one metric with
//     three plans. The old router could not have answered the last two at all.
//   • The plan is a small, closed, inspectable object. When a language model starts
//     doing the planning, the thing it produces is still just a plan — and a plan can
//     only name a metric that exists, a slice that metric supports, and a period.
//
// TEXT-TO-SQL (blueprint: "guarded text-to-SQL for novel questions"). `proposeSql`
// is where a model writes SQL for the questions the catalogue cannot express. It is
// gated on `llmMode` (env RIRI_LLM_KEY) exactly like KYC, CRB and storage are gated
// on their credentials — no key, no LLM, and Riri says honestly that she can only
// answer from her catalogue rather than inventing a number. What does NOT change when
// the key arrives is the safety story: model-written SQL goes through the same
// guard.ts and the same read-only, tenant-stamped, row-capped path as ours, and is
// shown to the lender verbatim. The model is a planner, never an authority.
// ─────────────────────────────────────────────────────────────────────────────
import type { DimensionId, TimeRange } from "./catalog";
import { metricSpec } from "./catalog";
import type { ResolvedMetric } from "./definitions";
import { llmMode } from "./copilot";
import { READ_SURFACE } from "./guard";

export type Plan =
  /** A governed metric — the overwhelmingly common case. */
  | { kind: "metric"; metricId: string; dimension?: DimensionId; range: TimeRange; limit?: number; series: boolean }
  /** Not a SQL question: the early-warning model. */
  | { kind: "engine"; engine: "watchlist" }
  /** Riri introduces herself and reads the pulse of the book. */
  | { kind: "help" }
  /**
   * No metric in the catalogue explains this question. Deliberately NOT folded into
   * `help`: a lender who asks something we cannot measure must be told that, not
   * handed a cheerful menu. This is the plan that gets offered to text-to-SQL, and
   * failing that, honestly declined.
   */
  | { kind: "unknown" };

// ── Periods ───────────────────────────────────────────────────────────────────
//
// Server-local, matching the console's own dashboard tiles — a lender comparing
// Riri's "collected today" against the tile must not find two different numbers
// because one of them decided the day starts in UTC.

const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d = new Date()) => { const x = startOfDay(d); return addDays(x, -((x.getDay() + 6) % 7)); }; // Monday
const startOfMonth = (d = new Date()) => { const x = startOfDay(d); x.setDate(1); return x; };
const startOfYear = (d = new Date()) => { const x = startOfMonth(d); x.setMonth(0); return x; };
const addMonths = (d: Date, n: number) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };

export const ALL_TIME: TimeRange = { start: null, end: null, label: "all-time" };

/**
 * The period a question is about. Ranges are half-open [start, end) so a payment at
 * 23:59:59 on the last day of the month lands in that month and not the next one.
 */
export function detectRange(q: string, fallback: TimeRange): TimeRange {
  const today = startOfDay();

  if (/\byesterday\b/.test(q)) return { start: addDays(today, -1), end: today, label: "yesterday", unit: "day" };
  if (/\btoday\b|\bso far today\b|\bright now\b/.test(q)) return { start: today, end: null, label: "today", unit: "day" };
  if (/\blast (\d{1,3}) days?\b/.test(q)) {
    const n = Math.min(365, Number(/\blast (\d{1,3}) days?\b/.exec(q)![1]));
    return { start: addDays(today, -n), end: null, label: `the last ${n} days` };
  }
  if (/\blast week\b|\bprevious week\b/.test(q)) {
    const s = addDays(startOfWeek(), -7);
    return { start: s, end: startOfWeek(), label: "last week", unit: "week" };
  }
  if (/\bthis week\b|\bthe week\b|\bweek\b/.test(q)) return { start: startOfWeek(), end: null, label: "this week", unit: "week" };
  if (/\blast month\b|\bprevious month\b/.test(q)) {
    const s = addMonths(startOfMonth(), -1);
    return { start: s, end: startOfMonth(), label: "last month", unit: "month" };
  }
  if (/\bthis month\b|\bthe month\b|\bmtd\b|\bmonth\b/.test(q)) return { start: startOfMonth(), end: null, label: "this month", unit: "month" };
  if (/\blast year\b|\bprevious year\b/.test(q)) {
    const s = addMonths(startOfYear(), -12);
    return { start: s, end: startOfYear(), label: "last year", unit: "year" };
  }
  if (/\bthis year\b|\bytd\b|\byear\b|\bannual\b/.test(q)) return { start: startOfYear(), end: null, label: "this year", unit: "year" };
  if (/\ball[- ]?time\b|\bever\b|\bto date\b|\boverall\b|\bin total\b|\baltogether\b/.test(q)) return ALL_TIME;

  return fallback;
}

/**
 * The comparable period before this one — for the "vs last month" chip.
 *
 * LIKE FOR LIKE, which matters more than it sounds. On the 12th of the month,
 * comparing month-to-date against the WHOLE of last month would show a lender a
 * collapse in collections that is really just a calendar. So the previous window is
 * this window shifted back one unit and given the same length: twelve days against
 * the same twelve days a month ago.
 *
 * Returns null when there is nothing fair to compare against (all-time, or an
 * ad-hoc "last 45 days" whose predecessor nobody has a name for).
 */
export function previousRange(range: TimeRange): TimeRange | null {
  if (!range.start || !range.unit) return null;
  const end = range.end ?? new Date();
  const shift = (d: Date): Date =>
    range.unit === "day" ? addDays(d, -1)
      : range.unit === "week" ? addDays(d, -7)
      : range.unit === "month" ? addMonths(d, -1)
      : addMonths(d, -12);

  const label =
    range.unit === "day" ? "the day before"
      : range.unit === "week" ? "the week before"
        : range.unit === "month" ? "the month before"
          : "the year before";

  return { start: shift(range.start), end: shift(end), label, unit: range.unit };
}

// ── Slices ────────────────────────────────────────────────────────────────────

const DIMENSION_PHRASES: { id: DimensionId; re: RegExp }[] = [
  { id: "product", re: /\b(by|per|across|for each|breakdown by|split by)\s+(loan\s+)?product\b|\bproduct (mix|breakdown|split)\b|\bwhich product\b/ },
  { id: "borrower", re: /\b(by|per)\s+(borrower|customer|client)\b|\btop\s+(\d+\s+)?(borrower|customer|client)/ },
  { id: "branch", re: /(by|per)\s+(branch|region|office|unit)|which branch|branch (mix|breakdown|split)/ },
  { id: "officer", re: /\b(by|per)\s+(officer|staff|agent|loan officer|who booked)\b|\bwhich officer\b/ },
  { id: "status", re: /\b(by|per)\s+(status|stage)\b|\bbreakdown of the (pipeline|queue)\b/ },
  { id: "channel", re: /\b(by|per)\s+(channel|method)\b|\bpaybill vs\b|\bstk vs\b/ },
  { id: "kyc_status", re: /\b(by|per)\s+kyc\b|\bkyc (status|breakdown)\b/ },
  { id: "risk_band", re: /\b(by|per)\s+(risk )?band\b|\brisk band(s| breakdown)?\b/ },
  // "by month" is a SLICE (a table of months); "over time" is a TREND (a sparkline).
  // They used to share this regex, and the slice always won — so "disbursements over
  // time" drew no chart. The split is the difference between the two answers.
  { id: "month", re: /\b(by|per)\s+month\b|\bmonthly\b|\bmonth by month\b/ },
];

/** The slice the QUESTION asked for, before we know which metric will answer it. */
function detectDimension(q: string): DimensionId | undefined {
  for (const { id, re } of DIMENSION_PHRASES) if (re.test(q)) return id;
  return undefined;
}

/** "top 5 borrowers" → 5. Bounded by the compiler regardless. */
function detectLimit(q: string): number | undefined {
  const m = /\btop\s+(\d{1,2})\b/.exec(q);
  if (m) return Math.max(1, Number(m[1]));
  if (/\btop\b|\blargest\b|\bbiggest\b/.test(q)) return 5;
  return undefined;
}

const WANTS_SERIES = /\btrend\b|\bover time\b|\bhistory\b|\bchart\b|\bgraph\b|\blast six months\b/;

// ── Routing ───────────────────────────────────────────────────────────────────

const WATCHLIST = /\bwatchlist\b|\bearly warning\b|who.*(default|risk|slip)|going to default|might default|about to default|risky borrower|flight risk/;
const GREETING = /^\s*(hi|hey|hello|help|good (morning|afternoon|evening)|what can you do|who are you|what do you do)\b/;

/**
 * Score a metric against a question by how much of the question its vocabulary
 * explains. Longer synonyms win: "default rate" must beat the bare word "rate", and
 * "loan book" must beat "loan" — otherwise the most generic metric swallows every
 * question that happens to contain a common noun.
 */
function scoreMetric(q: string, m: ResolvedMetric): number {
  let longest = 0;
  for (const syn of m.allSynonyms) {
    const s = syn.toLowerCase().trim();
    if (!s) continue;
    const re = new RegExp(`(^|[^a-z0-9])${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`);
    if (re.test(q)) longest = Math.max(longest, s.length);
  }
  return longest * (metricSpec(m.id)?.specificity ?? 1);
}

const bestFor = (q: string, metrics: ResolvedMetric[]): { metric: ResolvedMetric; score: number } | null => {
  let best: ResolvedMetric | null = null;
  let bestScore = 0;
  for (const m of metrics) {
    const s = scoreMetric(q, m);
    if (s > bestScore) { bestScore = s; best = m; }
  }
  return best ? { metric: best, score: bestScore } : null;
};

/**
 * The deterministic plan. Runs whether or not an LLM key exists — when one does,
 * the model gets first refusal on the questions this cannot place (see `proposeSql`),
 * and this remains the floor beneath it.
 */
export function plan(question: string, metrics: ResolvedMetric[]): Plan {
  const q = question.toLowerCase().trim();

  if (!q || q.length < 3 || GREETING.test(q)) return { kind: "help" };
  if (WATCHLIST.test(q)) return { kind: "engine", engine: "watchlist" };

  const live = metrics.filter((m) => m.enabled);
  const wanted = detectDimension(q);
  let best = bestFor(q, live)?.metric ?? null;

  // The SLICE IS PART OF THE QUESTION. "Top 5 borrowers" names no measure at all,
  // and "how many borrowers do I have, by product" names one that cannot be sliced
  // that way. In both cases the honest reading is that the lender wants the slice —
  // so re-pick among the metrics that can actually produce it, and when none of them
  // was named, fall back to the outstanding book, which is what a lender means by
  // "biggest" when they don't say.
  if (wanted && (!best || !best.dimensions?.[wanted])) {
    const capable = live.filter((m) => m.dimensions?.[wanted]);
    best = bestFor(q, capable)?.metric ?? capable.find((m) => m.id === "olb") ?? best;
  }

  if (!best) return { kind: "unknown" };

  const spec = metricSpec(best.id)!;

  // THE "DON'T INVENT" RULE, made mechanical.
  //
  // "What is the average shoe size of my borrowers?" matched the `borrowers` metric on
  // the single word "borrowers" and got answered — confidently, with a number, from a
  // question about footwear. That is precisely the failure this assistant must not
  // have: in a lending business the cost of a confident wrong number is a bad loan.
  //
  // A keyword router cannot know what a shoe is. But it CAN know that it was asked for
  // an average of something it does not average, and that a metric matched on one
  // generic noun is a weak basis for a number. So: an aggregation word the metric
  // cannot honour disqualifies the match, and the question goes to text-to-SQL or to an
  // honest "I can't answer that".
  const AVERAGES = new Set(["avg_score", "avg_loan_size"]);
  if (/\b(average|avg|mean)\b/.test(q) && !AVERAGES.has(spec.id)) return { kind: "unknown" };
  if (/\bmedian\b|\bpercentile\b|\bstandard deviation\b/.test(q)) return { kind: "unknown" }; // we compute none of these

  const dimension = wanted && best.dimensions?.[wanted] ? wanted : undefined;
  const series = Boolean(spec.timeColumn) && WANTS_SERIES.test(q) && dimension !== "month";

  // A stock metric ("what do I have out right now") has no time column: a period filter
  // on it would be meaningless, so the range is only consulted for flows — and even
  // then, the metric decides what "no period given" means (see MetricSpec.defaultRange).
  const fallback: TimeRange = spec.defaultRange === "all"
    ? ALL_TIME
    : { start: startOfMonth(), end: null, label: "this month", unit: "month" };
  const range = spec.timeColumn ? detectRange(q, fallback) : ALL_TIME;

  return { kind: "metric", metricId: best.id, dimension, range, limit: detectLimit(q), series };
}

// ── The text-to-SQL seam ──────────────────────────────────────────────────────

/**
 * The schema a model is given to write SQL against — Riri's published views and
 * nothing else. Generated from READ_SURFACE so it can never describe a table the
 * guard would refuse, which is the usual way text-to-SQL systems produce confident
 * garbage: a prompt that advertises tables the runtime won't allow.
 */
export function schemaPrompt(): string {
  return [
    "You may read ONLY these views. They are already scoped to the caller's lender;",
    "never add an org filter, never name any other table, never write a comment,",
    "never use a quoted identifier, and return exactly one SELECT statement.",
    "",
    ...READ_SURFACE.map((v) => `- ${v}`),
  ].join("\n");
}

export type SqlProposal = { sql: string } | null;

/**
 * Ask a model for SQL for a question the catalogue cannot express.
 *
 * Returns null in simulation mode — which is the whole point of the seam. Riri does
 * not guess: with no model behind her she says she can only answer from her
 * catalogue, and the question lands in RiriQueryLog where it becomes evidence for
 * which metric to add next. An analytics assistant that invents a number when it
 * does not know one is worse than useless in a lending business.
 *
 * When RIRI_LLM_KEY is set, the model's SQL returns here and goes straight into
 * validateReadSql() → runReadQuery(). It is never trusted, only checked.
 */
export async function proposeSql(orgId: string, _question: string): Promise<SqlProposal> {
  const mode = await llmMode(orgId);
  if (mode === "simulation") return null;

  // The live call slots in here behind this exact contract: prompt with
  // schemaPrompt(), take the statement back, hand it to the caller unmodified. The
  // caller guards it. Deliberately not implemented against a provider we have no key
  // for — a mock would only prove that the mock works.
  return null;
}
