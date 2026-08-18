// ─────────────────────────────────────────────────────────────────────────────
// THE CUBE — measures, dimensions, and the vocabulary a question is asked in.
//
// WHY A CUBE AND NOT MORE PAGES. The obvious way to build an analytics product
// is to write one screen per question: an agent screen, a branch screen, a
// product screen. It is also the way you end up with forty screens that each
// answer one question and cannot answer the forty-first. So the studio is built
// the other way round: a small vocabulary of MEASURES (what you are counting), a
// small vocabulary of DIMENSIONS (what you are counting it by), and a filter set
// — and every screen in the studio is a saved combination of those three.
//
// That is what makes "best agent" a live argument instead of a hardcoded sort.
// There is no such thing as the best agent; there is the agent with the biggest
// book, the agent with the cleanest book, the agent who converts the most
// applications, and the agent who collects the most of what they are owed. Those
// are four different people at Micromart, and a product that silently picks one
// definition and calls it "best" is lying to whoever reads it. So the ranking
// metric is a control, the definition is written on the screen next to the
// answer, and swapping it reorders the table in front of you.
//
// ── THE ONE RULE ─────────────────────────────────────────────────────────────
// A measure defined here must mean the SAME thing everywhere it appears. The
// console's tiles, the studio's charts and Riri's spoken answer all read this
// catalogue, so there is exactly one definition of PAR 30 in the product. A
// lender who finds two is entitled to trust neither.
// ─────────────────────────────────────────────────────────────────────────────

export type MeasureKey =
  // Money
  | "disbursed" | "collected" | "olb" | "arrears" | "overdue" | "writtenOff"
  | "interestAccrued" | "feesCharged" | "netFlow"
  // Counts
  | "loans" | "newLoans" | "activeLoans" | "clearedLoans" | "borrowers" | "newBorrowers"
  | "applications" | "approvals" | "declines" | "installmentsDue" | "installmentsPaid"
  // Ratios
  | "par30" | "par90" | "nplRate" | "approvalRate" | "onTimeRate" | "collectionRate"
  | "repeatRate" | "avgLoanSize" | "avgScore" | "avgTenureDays" | "pqs" | "yield";

export type MeasureFormat = "money" | "count" | "percent" | "days" | "score";

export type Measure = {
  key: MeasureKey;
  label: string;
  /** The definition, in one sentence, exactly as it is computed. Shown on hover. */
  definition: string;
  format: MeasureFormat;
  /** Which way is good. Drives the colour of a delta — never guess from the sign. */
  goodDirection: "up" | "down" | "neutral";
  /**
   * A FLOW happens inside a period (disbursed, collected). A STOCK is a level at
   * a point in time (OLB, borrowers). The distinction is load-bearing: summing a
   * stock across months gives a meaningless number, and this flag is what stops
   * the engine doing it.
   */
  kind: "flow" | "stock" | "ratio";
  /** Which broad family it belongs to, for grouping the picker. */
  family: "money" | "volume" | "quality" | "people";
};

export const MEASURES: Measure[] = [
  // ── Money ────────────────────────────────────────────────────────────────
  { key: "disbursed", label: "Disbursed", definition: "Principal paid out to borrowers in the period.", format: "money", goodDirection: "up", kind: "flow", family: "money" },
  { key: "collected", label: "Collected", definition: "Cash received from borrowers in the period, deduplicated across STK and C2B so an M-Pesa receipt is never counted twice.", format: "money", goodDirection: "up", kind: "flow", family: "money" },
  { key: "netFlow", label: "Net flow", definition: "Collected less disbursed. Negative means the book is growing on cash you have put out.", format: "money", goodDirection: "neutral", kind: "flow", family: "money" },
  { key: "olb", label: "Outstanding (OLB)", definition: "Balance on open loans at the end of the period.", format: "money", goodDirection: "up", kind: "stock", family: "money" },
  { key: "arrears", label: "Arrears", definition: "Amount past due on loans that are still performing.", format: "money", goodDirection: "down", kind: "stock", family: "quality" },
  { key: "overdue", label: "Overdue balance", definition: "Total unpaid amount on installments past their due date.", format: "money", goodDirection: "down", kind: "stock", family: "quality" },
  { key: "writtenOff", label: "Written off", definition: "Balance on loans written off in the period.", format: "money", goodDirection: "down", kind: "flow", family: "quality" },
  { key: "interestAccrued", label: "Interest", definition: "Interest component of installments falling due in the period.", format: "money", goodDirection: "up", kind: "flow", family: "money" },
  { key: "feesCharged", label: "Fees & penalties", definition: "Penalties applied to installments in the period.", format: "money", goodDirection: "neutral", kind: "flow", family: "money" },

  // ── Volume ───────────────────────────────────────────────────────────────
  { key: "newLoans", label: "New loans", definition: "Loans booked in the period.", format: "count", goodDirection: "up", kind: "flow", family: "volume" },
  { key: "loans", label: "Loans (all time)", definition: "Every loan on the book, regardless of when it was booked.", format: "count", goodDirection: "up", kind: "stock", family: "volume" },
  { key: "activeLoans", label: "Active loans", definition: "Loans open and being repaid at the end of the period.", format: "count", goodDirection: "up", kind: "stock", family: "volume" },
  { key: "clearedLoans", label: "Cleared loans", definition: "Loans fully repaid in the period.", format: "count", goodDirection: "up", kind: "flow", family: "volume" },
  { key: "applications", label: "Applications", definition: "Applications submitted in the period.", format: "count", goodDirection: "up", kind: "flow", family: "volume" },
  { key: "approvals", label: "Approvals", definition: "Applications approved in the period.", format: "count", goodDirection: "up", kind: "flow", family: "volume" },
  { key: "declines", label: "Declines", definition: "Applications declined in the period.", format: "count", goodDirection: "neutral", kind: "flow", family: "volume" },
  { key: "installmentsDue", label: "Installments due", definition: "Installments falling due in the period.", format: "count", goodDirection: "neutral", kind: "flow", family: "volume" },
  { key: "installmentsPaid", label: "Installments paid", definition: "Installments settled in the period.", format: "count", goodDirection: "up", kind: "flow", family: "volume" },

  // ── People ───────────────────────────────────────────────────────────────
  { key: "borrowers", label: "Borrowers", definition: "Registered customers at the end of the period.", format: "count", goodDirection: "up", kind: "stock", family: "people" },
  { key: "newBorrowers", label: "New borrowers", definition: "Customers registered in the period.", format: "count", goodDirection: "up", kind: "flow", family: "people" },
  { key: "repeatRate", label: "Repeat rate", definition: "Share of borrowers with more than one loan. The single best signal that the product works.", format: "percent", goodDirection: "up", kind: "ratio", family: "people" },
  { key: "avgScore", label: "Average score", definition: "Mean internal credit score across scored borrowers.", format: "score", goodDirection: "up", kind: "ratio", family: "people" },

  // ── Quality ──────────────────────────────────────────────────────────────
  {
    key: "par30",
    label: "PAR 30",
    definition: "Balance on active loans with an installment more than 30 days overdue, as a share of total outstanding. The industry's standard measure of a book going wrong.",
    format: "percent", goodDirection: "down", kind: "ratio", family: "quality",
  },
  { key: "par90", label: "PAR 90", definition: "Same as PAR 30, at 90 days — the line most lenders treat as non-recoverable.", format: "percent", goodDirection: "down", kind: "ratio", family: "quality" },
  { key: "nplRate", label: "NPL rate", definition: "Share of the open book more than 90 days past its expected clear date.", format: "percent", goodDirection: "down", kind: "ratio", family: "quality" },
  { key: "pqs", label: "Portfolio quality (PQS)", definition: "Clean outstanding as a share of total outstanding — the performing book less what is in arrears. ServiceSuite's own definition, matched exactly.", format: "percent", goodDirection: "up", kind: "ratio", family: "quality" },
  { key: "onTimeRate", label: "On-time rate", definition: "Share of installments settled on or before their due date.", format: "percent", goodDirection: "up", kind: "ratio", family: "quality" },
  { key: "collectionRate", label: "Collection rate", definition: "Amount collected as a share of amount that fell due in the period.", format: "percent", goodDirection: "up", kind: "ratio", family: "quality" },
  { key: "approvalRate", label: "Approval rate", definition: "Approvals as a share of decided applications. Excludes applications still in the queue, which would otherwise depress it purely by being recent.", format: "percent", goodDirection: "neutral", kind: "ratio", family: "quality" },
  { key: "avgLoanSize", label: "Average loan", definition: "Mean principal on loans booked in the period.", format: "money", goodDirection: "neutral", kind: "ratio", family: "money" },
  { key: "avgTenureDays", label: "Average tenure", definition: "Mean days from disbursement to expected clear date.", format: "days", goodDirection: "neutral", kind: "ratio", family: "volume" },
  { key: "yield", label: "Yield", definition: "Interest and fees earned as a share of average outstanding, annualised.", format: "percent", goodDirection: "up", kind: "ratio", family: "money" },
];

export const measure = (key: string): Measure | undefined => MEASURES.find((m) => m.key === key);

// ─────────────────────────────────────────────────────────────────────────────
// DIMENSIONS — what you slice by.
// ─────────────────────────────────────────────────────────────────────────────

export type DimensionKey =
  | "time" | "entity" | "region" | "branch" | "officer" | "product" | "channel"
  | "riskBand" | "gender" | "ageBand" | "loanSizeBand" | "tenureBand" | "status" | "kycStatus";

export type Dimension = {
  key: DimensionKey;
  label: string;
  /** What this axis is FOR — shown under the picker. */
  hint: string;
  /**
   * An ORDINAL dimension has a natural order that must be preserved (age bands,
   * loan-size bands). Sorting those by value produces a chart that reads as
   * nonsense, so the engine never re-sorts them.
   */
  ordinal: boolean;
  /** Roughly how many distinct values to expect. Drives the default chart form. */
  cardinality: "low" | "medium" | "high";
  family: "who" | "what" | "where" | "when";
};

export const DIMENSIONS: Dimension[] = [
  { key: "time", label: "Time", hint: "The trend. Grain follows the range.", ordinal: true, cardinality: "high", family: "when" },
  { key: "entity", label: "Entity", hint: "Each company in the group. Bridged lenders only.", ordinal: false, cardinality: "low", family: "where" },
  { key: "region", label: "Region", hint: "The top level of your office tree.", ordinal: false, cardinality: "low", family: "where" },
  { key: "branch", label: "Branch", hint: "Individual offices.", ordinal: false, cardinality: "medium", family: "where" },
  { key: "officer", label: "Officer", hint: "The staff member whose book the loan sits on.", ordinal: false, cardinality: "high", family: "who" },
  { key: "product", label: "Product", hint: "The loan product.", ordinal: false, cardinality: "medium", family: "what" },
  { key: "channel", label: "Channel", hint: "Where the application came from — portal, console, field, USSD.", ordinal: false, cardinality: "low", family: "what" },
  { key: "riskBand", label: "Risk band", hint: "Internal score band at the time of reading.", ordinal: true, cardinality: "low", family: "who" },
  { key: "gender", label: "Gender", hint: "As recorded on the customer file.", ordinal: false, cardinality: "low", family: "who" },
  { key: "ageBand", label: "Age band", hint: "Ten-year bands from 18.", ordinal: true, cardinality: "low", family: "who" },
  { key: "loanSizeBand", label: "Loan size", hint: "Principal, bucketed.", ordinal: true, cardinality: "low", family: "what" },
  { key: "tenureBand", label: "Tenure", hint: "Scheduled loan length, bucketed.", ordinal: true, cardinality: "low", family: "what" },
  { key: "status", label: "Loan status", hint: "Where each loan is in its life.", ordinal: false, cardinality: "low", family: "what" },
  { key: "kycStatus", label: "KYC status", hint: "How far each customer got through verification.", ordinal: true, cardinality: "low", family: "who" },
];

export const dimension = (key: string): Dimension | undefined => DIMENSIONS.find((d) => d.key === key);

/** Fixed band orders — the engine must never re-sort these by value. */
export const AGE_BANDS: Array<[label: string, min: number, max: number]> = [
  ["18–24", 18, 24], ["25–34", 25, 34], ["35–44", 35, 44],
  ["45–54", 45, 54], ["55–64", 55, 64], ["65+", 65, 200],
];

export const LOAN_SIZE_BANDS: Array<[label: string, min: number, max: number]> = [
  ["< 5k", 0, 4_999], ["5k–20k", 5_000, 19_999], ["20k–50k", 20_000, 49_999],
  ["50k–150k", 50_000, 149_999], ["150k–500k", 150_000, 499_999], ["500k+", 500_000, Number.MAX_SAFE_INTEGER],
];

export const TENURE_BANDS: Array<[label: string, min: number, max: number]> = [
  ["≤ 30 days", 0, 30], ["1–3 months", 31, 92], ["3–6 months", 93, 183],
  ["6–12 months", 184, 365], ["> 1 year", 366, 100_000],
];

export const RISK_BAND_ORDER = ["PRIME", "STRONG", "WATCH", "HIGH", "Unscored"];

/** Which band a value falls into, preserving the declared order. */
export function bandOf(value: number | null, bands: Array<[string, number, number]>): string {
  if (value == null || !Number.isFinite(value)) return "Unknown";
  return bands.find(([, lo, hi]) => value >= lo && value <= hi)?.[0] ?? "Unknown";
}

// ─────────────────────────────────────────────────────────────────────────────
// RANKING — "best" is an argument, so it is a control.
//
// Every leaderboard in the studio (agents, branches, products, regions) is
// driven by one of these. The definition travels with the ranking and is printed
// beside the table, because a league table whose rule is invisible is a
// political document, not an analysis.
// ─────────────────────────────────────────────────────────────────────────────

export type RankMetricKey =
  | "book" | "quality" | "growth" | "conversion" | "collection"
  | "productivity" | "retention" | "riskAdjusted" | "efficiency";

export type RankMetric = {
  key: RankMetricKey;
  label: string;
  /** The question this ranking actually answers. */
  question: string;
  /** How it is computed, so nobody has to guess. */
  formula: string;
  /** Which measures must be present for it to be computable. */
  needs: MeasureKey[];
  format: MeasureFormat;
  goodDirection: "up" | "down";
  /** A caution the screen prints when this metric is chosen. Honest, not hedging. */
  caveat?: string;
};

export const RANK_METRICS: RankMetric[] = [
  {
    key: "book",
    label: "Biggest book",
    question: "Who is carrying the most money?",
    formula: "Outstanding balance on their loans",
    needs: ["olb"],
    format: "money",
    goodDirection: "up",
    caveat: "Rewards tenure and territory as much as skill. A five-year officer in Nairobi will beat a good one in Endebess every time.",
  },
  {
    key: "quality",
    label: "Cleanest book",
    question: "Whose book is not going bad?",
    formula: "100% − (PAR 30 balance ÷ outstanding balance)",
    needs: ["olb", "par30"],
    format: "percent",
    goodDirection: "up",
    caveat: "An officer with three loans can score 100%. Read it beside book size, never alone.",
  },
  {
    key: "growth",
    label: "Fastest growing",
    question: "Who is bringing in new money?",
    formula: "Disbursed in the period",
    needs: ["disbursed"],
    format: "money",
    goodDirection: "up",
    caveat: "Growth and quality diverge on a 90-day lag. The officer at the top of this list today is often at the bottom of Cleanest Book next quarter.",
  },
  {
    key: "conversion",
    label: "Best closer",
    question: "Who turns applications into loans?",
    formula: "Approved and disbursed ÷ applications taken",
    needs: ["applications", "approvals"],
    format: "percent",
    goodDirection: "up",
    caveat: "A high rate can mean good screening at intake or weak screening at approval. Check it against PAR.",
  },
  {
    key: "collection",
    label: "Best collector",
    question: "Who gets paid what they are owed?",
    formula: "Collected ÷ amount that fell due in the period",
    needs: ["collected", "installmentsDue"],
    format: "percent",
    goodDirection: "up",
  },
  {
    key: "productivity",
    label: "Most productive",
    question: "Who is doing the most work?",
    formula: "Loans booked in the period",
    needs: ["newLoans"],
    format: "count",
    goodDirection: "up",
  },
  {
    key: "retention",
    label: "Best retention",
    question: "Whose customers come back?",
    formula: "Borrowers with more than one loan ÷ borrowers with any loan",
    needs: ["repeatRate"],
    format: "percent",
    goodDirection: "up",
    caveat: "Needs at least two loan cycles of history to mean anything. A new officer's number is noise.",
  },
  {
    key: "riskAdjusted",
    label: "Risk-adjusted book",
    question: "Who is carrying the most money that is actually performing?",
    formula: "Outstanding balance × (1 − PAR 30 share)",
    needs: ["olb", "par30"],
    format: "money",
    goodDirection: "up",
    caveat: "The fairest single number, and the one most likely to disagree with the officer's own view of themselves.",
  },
  {
    key: "efficiency",
    label: "Book per loan",
    question: "Who is writing the bigger tickets?",
    formula: "Outstanding balance ÷ active loans",
    needs: ["olb", "activeLoans"],
    format: "money",
    goodDirection: "neutral" as never,
    caveat: "Not a virtue on its own — a book of ten large loans is more concentrated, not better.",
  },
];

export const rankMetric = (key: string): RankMetric | undefined => RANK_METRICS.find((m) => m.key === key);

// ─────────────────────────────────────────────────────────────────────────────
// FORMATTING — one place, so a percentage never renders three different ways.
// ─────────────────────────────────────────────────────────────────────────────

export function formatValue(v: number | null, format: MeasureFormat, opts: { compact?: boolean } = {}): string {
  if (v == null || !Number.isFinite(v)) return "—";
  switch (format) {
    case "money":
      return opts.compact ? `KES ${compactNumber(v)}` : `KES ${Math.round(v).toLocaleString("en-KE")}`;
    case "count":
      return opts.compact ? compactNumber(v) : Math.round(v).toLocaleString("en-KE");
    case "percent":
      return `${v.toFixed(1)}%`;
    case "days":
      return `${Math.round(v)}d`;
    case "score":
      return String(Math.round(v));
  }
}

/**
 * A running total across a series.
 *
 * Written as a fold rather than a `let` accumulated inside `.map()` because
 * these pages are React Server Components: a variable mutated during render is
 * flagged by react-hooks/immutability, and rightly — it is the shape that breaks
 * the moment a render is retried or streamed out of order.
 */
export function runningTotal<T>(rows: T[], pick: (row: T) => number): number[] {
  return rows.reduce<number[]>((acc, row) => {
    acc.push((acc.at(-1) ?? 0) + pick(row));
    return acc;
  }, []);
}

export function compactNumber(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${(n / 1_000).toFixed(a >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

/**
 * A delta and whether it is good news.
 *
 * `good` is derived from the measure's own `goodDirection`, never from the sign.
 * PAR falling is green; PAR rising is red; and a product that colours every
 * increase green has taught its users to read the colour instead of the number.
 */
export function delta(current: number | null, previous: number | null, dir: "up" | "down" | "neutral") {
  if (current == null || previous == null || previous === 0) {
    return { pct: null as number | null, good: null as boolean | null, absolute: current != null && previous != null ? current - previous : null };
  }
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const good = dir === "neutral" ? null : dir === "up" ? pct >= 0 : pct <= 0;
  return { pct, good, absolute: current - previous };
}
