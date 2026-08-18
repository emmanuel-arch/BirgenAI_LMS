// ─────────────────────────────────────────────────────────────────────────────
// THE FIELD CATALOGUE + THE PLOTTABILITY CHECKER.
//
// This is the data model behind the chart builder: the columns a person may
// pick from, organised by the thing they describe (a borrower, a loan, a
// payment), and the rules that decide which chart forms a given selection can
// legally produce.
//
// ── WHY A CHECKER AND NOT JUST A LIST ────────────────────────────────────────
// Give somebody a column list and a chart-type dropdown and they will, within
// about ninety seconds, build a pie chart of average interest rate by month. It
// will render. It will be meaningless. Every self-service analytics tool has
// this failure mode, and the ones people trust are the ones that refuse.
//
// So the builder never offers a form it cannot honestly draw. Each form declares
// what it NEEDS — how many dimensions, how many measures, what kind of each —
// and `checkPlot()` returns, for every form, either "yes" or the specific reason
// why not. The reason is the product: "a scatter needs two numeric fields, you
// have one" teaches the person what to pick next, where a greyed-out button
// teaches them nothing.
//
// ── THE FOUR RULES THE CHECKER ENFORCES ──────────────────────────────────────
//   1. AGGREGATION MUST BE MEANINGFUL. You may sum a disbursement; you may not
//      sum an interest rate or a credit score. Fields declare which aggregates
//      they permit, and the checker refuses the rest rather than producing a
//      number that looks like money and is not.
//   2. PART-TO-WHOLE MUST HAVE A WHOLE. Donut and treemap only accept a measure
//      whose parts add to something (a sum), never an average or a ratio — a pie
//      of averages is the single most common dishonest chart in business.
//   3. CATEGORY COUNTS MUST FIT THE FORM. A donut of forty branches is unreadable
//      and the palette is validated for three simultaneous hues, so the checker
//      caps it and says so.
//   4. TIME BELONGS ON AN AXIS, NOT IN A SLICE. A date dimension is refused by
//      the part-to-whole forms outright.
// ─────────────────────────────────────────────────────────────────────────────
import type { VizForm } from "@/components/analytics/viz/VizPanel";
import type { MeasureFormat } from "./cube";

/** Where a field comes from — the grouping the picker shows. */
export type FieldSource = "loan" | "borrower" | "product" | "payment" | "application" | "installment" | "office" | "officer";

export const SOURCE_LABEL: Record<FieldSource, string> = {
  loan: "Loan",
  borrower: "Borrower",
  product: "Product",
  payment: "Payment",
  application: "Application",
  installment: "Repayment schedule",
  office: "Branch & region",
  officer: "Officer",
};

export const SOURCE_BLURB: Record<FieldSource, string> = {
  loan: "The loan itself — size, status, dates, balance.",
  borrower: "Who took it — demographics, score, verification.",
  product: "Which shelf it came off.",
  payment: "Money received, from M-Pesa and the counter.",
  application: "The request, before it became a loan.",
  installment: "What was due, when, and whether it arrived.",
  office: "Where in the org tree it was written.",
  officer: "Whose book it sits on.",
};

/** What a field IS, which decides where it can go on a chart. */
export type FieldRole =
  /** A category to split by. Goes on the x axis or becomes the slices. */
  | "dimension"
  /** A category with a natural order that must not be re-sorted. */
  | "ordinal"
  /** A date. Goes on the x axis, never into a pie. */
  | "temporal"
  /** A number to aggregate. Goes on the y axis. */
  | "measure";

export type Aggregate = "sum" | "avg" | "count" | "countDistinct" | "min" | "max" | "share";

export const AGGREGATE_LABEL: Record<Aggregate, string> = {
  sum: "Total",
  avg: "Average",
  count: "Count",
  countDistinct: "Distinct count",
  min: "Lowest",
  max: "Highest",
  share: "Share of total",
};

export type Field = {
  key: string;
  label: string;
  source: FieldSource;
  role: FieldRole;
  format: MeasureFormat;
  /** What this column actually contains, in the lender's words. */
  hint: string;
  /**
   * Aggregates that are MEANINGFUL for this field. A rate may be averaged and
   * never summed; a score may be averaged and never summed; an amount may be
   * both. The checker reads this and refuses anything not listed — which is what
   * stops "total credit score by branch" ever being offered.
   */
  aggregates?: Aggregate[];
  /** For dimensions: roughly how many distinct values, so the checker can cap forms. */
  cardinality?: "low" | "medium" | "high";
  /** Fixed display order for an ordinal field. */
  order?: string[];
  /** Maps onto a cube DimensionKey where one exists — the engine's grouping. */
  dimensionKey?: string;
  /** Maps onto a CubeRow property where one exists — the engine's value. */
  measureKey?: string;
};

// ─────────────────────────────────────────────────────────────────────────────

export const FIELDS: Field[] = [
  // ── Loan ─────────────────────────────────────────────────────────────────
  { key: "loan.count", label: "Number of loans", source: "loan", role: "measure", format: "count", hint: "How many loans match.", aggregates: ["count"], measureKey: "newLoans" },
  { key: "loan.principal", label: "Principal", source: "loan", role: "measure", format: "money", hint: "Money lent out.", aggregates: ["sum", "avg", "min", "max"], measureKey: "disbursed" },
  { key: "loan.balance", label: "Outstanding balance", source: "loan", role: "measure", format: "money", hint: "What is still owed on open loans.", aggregates: ["sum", "avg"], measureKey: "olb" },
  { key: "loan.activeCount", label: "Active loans", source: "loan", role: "measure", format: "count", hint: "Loans open and being repaid.", aggregates: ["count"], measureKey: "activeLoans" },
  { key: "loan.clearedCount", label: "Cleared loans", source: "loan", role: "measure", format: "count", hint: "Loans fully repaid.", aggregates: ["count"], measureKey: "clearedLoans" },
  { key: "loan.avgSize", label: "Average loan size", source: "loan", role: "measure", format: "money", hint: "Mean principal. An average — it cannot be summed.", aggregates: ["avg"], measureKey: "avgLoanSize" },
  { key: "loan.tenureDays", label: "Loan tenure", source: "loan", role: "measure", format: "days", hint: "Days from disbursement to expected clearance.", aggregates: ["avg", "min", "max"], measureKey: "avgTenureDays" },
  { key: "loan.status", label: "Loan status", source: "loan", role: "dimension", format: "count", hint: "Where each loan is in its life.", cardinality: "low", dimensionKey: "status" },
  { key: "loan.sizeBand", label: "Loan size band", source: "loan", role: "ordinal", format: "count", hint: "Principal, bucketed. Ordered small to large.", cardinality: "low", dimensionKey: "loanSizeBand" },
  { key: "loan.tenureBand", label: "Tenure band", source: "loan", role: "ordinal", format: "count", hint: "Scheduled length, bucketed.", cardinality: "low", dimensionKey: "tenureBand" },
  { key: "loan.borrowDate", label: "Disbursement date", source: "loan", role: "temporal", format: "count", hint: "When the loan was written. Grain follows your date range.", cardinality: "high", dimensionKey: "time" },

  // ── Quality (loan-derived) ───────────────────────────────────────────────
  { key: "loan.par30", label: "PAR 30", source: "loan", role: "measure", format: "percent", hint: "Share of outstanding more than 30 days overdue. A ratio — averaging it across groups is wrong, so it is recomputed per row.", aggregates: ["avg"], measureKey: "par30" },
  { key: "loan.par30Amount", label: "PAR 30 balance", source: "loan", role: "measure", format: "money", hint: "The money sitting behind PAR 30. This one does add up.", aggregates: ["sum"], measureKey: "par30Amount" },
  { key: "loan.par90Amount", label: "PAR 90 balance", source: "loan", role: "measure", format: "money", hint: "Balance more than 90 days overdue — the line most lenders treat as lost.", aggregates: ["sum"], measureKey: "par90Amount" },
  { key: "loan.overdue", label: "Overdue amount", source: "loan", role: "measure", format: "money", hint: "Unpaid amount on installments past due.", aggregates: ["sum"], measureKey: "overdue" },

  // ── Borrower ─────────────────────────────────────────────────────────────
  { key: "borrower.count", label: "Number of borrowers", source: "borrower", role: "measure", format: "count", hint: "Distinct customers.", aggregates: ["countDistinct"], measureKey: "borrowers" },
  { key: "borrower.gender", label: "Gender", source: "borrower", role: "dimension", format: "count", hint: "As recorded on the customer file.", cardinality: "low", dimensionKey: "gender" },
  { key: "borrower.ageBand", label: "Age band", source: "borrower", role: "ordinal", format: "count", hint: "Ten-year bands from 18.", cardinality: "low", dimensionKey: "ageBand" },
  { key: "borrower.riskBand", label: "Risk band", source: "borrower", role: "ordinal", format: "count", hint: "Internal score band.", cardinality: "low", dimensionKey: "riskBand", order: ["PRIME", "STRONG", "WATCH", "HIGH", "Unscored"] },
  { key: "borrower.kycStatus", label: "KYC status", source: "borrower", role: "ordinal", format: "count", hint: "How far through verification each customer got.", cardinality: "low", dimensionKey: "kycStatus" },

  // ── Product ──────────────────────────────────────────────────────────────
  { key: "product.name", label: "Product", source: "product", role: "dimension", format: "count", hint: "The loan product.", cardinality: "medium", dimensionKey: "product" },

  // ── Office & officer ─────────────────────────────────────────────────────
  { key: "office.branch", label: "Branch", source: "office", role: "dimension", format: "count", hint: "The office the loan was written in.", cardinality: "medium", dimensionKey: "branch" },
  { key: "office.region", label: "Region", source: "office", role: "dimension", format: "count", hint: "The parent office — the top of your tree.", cardinality: "low", dimensionKey: "region" },
  { key: "officer.name", label: "Officer", source: "officer", role: "dimension", format: "count", hint: "Whose book the loan sits on.", cardinality: "high", dimensionKey: "officer" },

  // ── Application ──────────────────────────────────────────────────────────
  { key: "application.channel", label: "Channel", source: "application", role: "dimension", format: "count", hint: "Where the application came from — portal, console, field, USSD.", cardinality: "low", dimensionKey: "channel" },
];

export const field = (key: string): Field | undefined => FIELDS.find((f) => f.key === key);

export const fieldsBySource = (): Array<{ source: FieldSource; fields: Field[] }> =>
  (Object.keys(SOURCE_LABEL) as FieldSource[])
    .map((source) => ({ source, fields: FIELDS.filter((f) => f.source === source) }))
    .filter((g) => g.fields.length > 0);

export const isMeasure = (f: Field): boolean => f.role === "measure";
export const isDimension = (f: Field): boolean => f.role === "dimension" || f.role === "ordinal" || f.role === "temporal";

// ─────────────────────────────────────────────────────────────────────────────
// THE CHECKER
// ─────────────────────────────────────────────────────────────────────────────

export type PlotSelection = {
  /** Field keys the person has ticked, in tick order. */
  fields: string[];
  /** How many distinct values the chosen dimension actually has, once known. */
  categoryCount?: number;
};

export type FormRule = {
  form: VizForm;
  label: string;
  /** What this form is FOR, so the builder can suggest rather than only permit. */
  purpose: string;
  minDimensions: number;
  maxDimensions: number;
  minMeasures: number;
  maxMeasures: number;
  /** Refuses a date on the category axis (part-to-whole forms). */
  rejectsTemporal?: boolean;
  /** Requires a date on the category axis (trend forms are honest without it too). */
  prefersTemporal?: boolean;
  /** Part-to-whole: the measure must be summable, and the slices must add to a whole. */
  requiresAdditive?: boolean;
  /** Hard cap on how many categories can be drawn legibly. */
  maxCategories?: number;
};

export const FORM_RULES: FormRule[] = [
  {
    form: "line", label: "Line", purpose: "A trend. Best when the x axis is time.",
    minDimensions: 1, maxDimensions: 1, minMeasures: 1, maxMeasures: 6, prefersTemporal: true,
  },
  {
    form: "area", label: "Area", purpose: "A trend where the volume under it matters.",
    minDimensions: 1, maxDimensions: 1, minMeasures: 1, maxMeasures: 4, prefersTemporal: true,
  },
  {
    form: "stackedArea", label: "Stacked area", purpose: "A trend split into parts that add to a total.",
    minDimensions: 1, maxDimensions: 1, minMeasures: 2, maxMeasures: 6, prefersTemporal: true, requiresAdditive: true,
  },
  {
    form: "column", label: "Column", purpose: "Comparing magnitudes across a handful of categories.",
    minDimensions: 1, maxDimensions: 1, minMeasures: 1, maxMeasures: 4, maxCategories: 40,
  },
  {
    form: "stackedColumn", label: "Stacked column", purpose: "Part-to-whole, per category.",
    minDimensions: 1, maxDimensions: 1, minMeasures: 2, maxMeasures: 6, requiresAdditive: true, maxCategories: 40,
  },
  {
    form: "bar", label: "Bar (horizontal)", purpose: "A ranking. The right form when the names are long — branches, officers.",
    minDimensions: 1, maxDimensions: 1, minMeasures: 1, maxMeasures: 3, maxCategories: 25,
  },
  {
    form: "histogram", label: "Histogram", purpose: "The shape of a distribution across ordered bands.",
    minDimensions: 1, maxDimensions: 1, minMeasures: 1, maxMeasures: 1, rejectsTemporal: true,
  },
  {
    form: "scatter", label: "Scatter", purpose: "Whether two numbers move together — the form that finds a relationship.",
    minDimensions: 1, maxDimensions: 1, minMeasures: 2, maxMeasures: 3,
  },
  {
    form: "donut", label: "Donut", purpose: "One measure split into a few parts of a whole.",
    minDimensions: 1, maxDimensions: 1, minMeasures: 1, maxMeasures: 1,
    rejectsTemporal: true, requiresAdditive: true, maxCategories: 8,
  },
  {
    form: "treemap", label: "Treemap", purpose: "Part-to-whole where the parts differ by orders of magnitude.",
    minDimensions: 1, maxDimensions: 1, minMeasures: 1, maxMeasures: 1,
    rejectsTemporal: true, requiresAdditive: true, maxCategories: 20,
  },
  {
    form: "heatmap", label: "Heatmap", purpose: "Magnitude across many categories at once, as colour intensity.",
    minDimensions: 1, maxDimensions: 1, minMeasures: 1, maxMeasures: 1,
  },
  {
    form: "radar", label: "Radar", purpose: "A profile across several axes — comparing two or three things on the same shape.",
    minDimensions: 1, maxDimensions: 1, minMeasures: 1, maxMeasures: 3, rejectsTemporal: true, maxCategories: 12,
  },
];

export type PlotVerdict = {
  form: VizForm;
  label: string;
  purpose: string;
  ok: boolean;
  /** Why not, written so it says what to DO next — never just "invalid". */
  reason?: string;
  /** True when this is the form the selection is most naturally asking for. */
  recommended?: boolean;
};

/**
 * Can this selection be drawn as each form, and if not, what is missing?
 *
 * Returns a verdict for EVERY form, always — the builder shows the unavailable
 * ones with their reason rather than hiding them, because the reason is the
 * teaching. "Donut needs a total you can add up; average loan size is an
 * average" is a lesson; a missing button is a mystery.
 */
export function checkPlot(sel: PlotSelection): PlotVerdict[] {
  const chosen = sel.fields.map(field).filter((f): f is Field => !!f);
  const dims = chosen.filter(isDimension);
  const measures = chosen.filter(isMeasure);
  const temporal = dims.some((d) => d.role === "temporal");
  const ordinal = dims.some((d) => d.role === "ordinal");
  const cats = sel.categoryCount;

  // Additive = the parts genuinely add to a whole. An average or a ratio does
  // not, and a part-to-whole chart of one is a lie with a legend on it.
  const additive = measures.every((m) => m.aggregates?.some((a) => a === "sum" || a === "count" || a === "countDistinct"));

  return FORM_RULES.map((rule) => {
    const v: PlotVerdict = { form: rule.form, label: rule.label, purpose: rule.purpose, ok: true };

    if (dims.length < rule.minDimensions) {
      return { ...v, ok: false, reason: `Pick something to split by — a branch, a product, a date. ${rule.label} needs one category axis.` };
    }
    if (dims.length > rule.maxDimensions) {
      return { ...v, ok: false, reason: `${rule.label} draws one category axis. You have ${dims.length} — untick all but one, or use the table.` };
    }
    if (measures.length < rule.minMeasures) {
      return {
        ...v, ok: false,
        reason: rule.minMeasures === 1
          ? "Pick a number to plot — an amount, a count, a rate."
          : `${rule.label} needs ${rule.minMeasures} numbers. You have ${measures.length}.`,
      };
    }
    if (measures.length > rule.maxMeasures) {
      return { ...v, ok: false, reason: `${rule.label} can carry ${rule.maxMeasures} number${rule.maxMeasures === 1 ? "" : "s"}; you have ${measures.length}.` };
    }
    if (rule.rejectsTemporal && temporal) {
      return { ...v, ok: false, reason: "Time belongs on an axis, not in a slice. Split by a category instead, or use a line." };
    }
    if (rule.requiresAdditive && !additive) {
      const bad = measures.find((m) => !m.aggregates?.some((a) => a === "sum" || a === "count" || a === "countDistinct"));
      return {
        ...v, ok: false,
        reason: `${rule.label} shows parts of a whole, and "${bad?.label ?? "this measure"}" is an average or a rate — the parts do not add up to anything. Use a total instead.`,
      };
    }
    if (rule.maxCategories != null && cats != null && cats > rule.maxCategories) {
      return {
        ...v, ok: false,
        reason: `${cats} categories is too many for a ${rule.label.toLowerCase()} to read. ${
          rule.form === "donut" || rule.form === "treemap"
            ? "Group the tail into \"Other\", or switch to a horizontal bar."
            : "Narrow the filter, or switch to a heatmap."
        }`,
      };
    }

    // ── Recommendation. Not a rule — a nudge toward the honest form. ────────
    const recommended =
      (temporal && (rule.form === "line" || (measures.length > 1 && rule.form === "stackedArea"))) ||
      (!temporal && ordinal && rule.form === "histogram") ||
      (!temporal && !ordinal && (cats ?? 0) > 8 && rule.form === "bar") ||
      (!temporal && !ordinal && (cats ?? 0) <= 8 && (cats ?? 0) > 0 && measures.length === 1 && rule.form === "column") ||
      (measures.length === 2 && !temporal && rule.form === "scatter");

    return { ...v, recommended };
  });
}

/** The forms a selection can actually draw, best first. */
export function plottableForms(sel: PlotSelection): PlotVerdict[] {
  const all = checkPlot(sel);
  return all.filter((v) => v.ok).sort((a, b) => Number(!!b.recommended) - Number(!!a.recommended));
}

/**
 * The one-line coaching message above the builder.
 *
 * A builder that only says "no" is an obstacle. This says what to add next, in
 * the order that gets somebody to a chart fastest: a split, then a number.
 */
export function guidance(sel: PlotSelection): { tone: "hint" | "warn" | "ok"; text: string } {
  const chosen = sel.fields.map(field).filter((f): f is Field => !!f);
  const dims = chosen.filter(isDimension);
  const measures = chosen.filter(isMeasure);

  if (chosen.length === 0) {
    return { tone: "hint", text: "Start with one thing to split by — a branch, a product, a month — and one number to plot." };
  }
  if (dims.length === 0) {
    return { tone: "hint", text: `You have ${measures.length} number${measures.length === 1 ? "" : "s"} but nothing to split ${measures.length === 1 ? "it" : "them"} by. Tick a category: branch, product, risk band or a date.` };
  }
  if (measures.length === 0) {
    return { tone: "hint", text: `Split by ${dims[0].label.toLowerCase()} — now pick a number to plot. Amount lent, loans, outstanding balance.` };
  }
  if (dims.length > 1) {
    return { tone: "warn", text: `Two category axes (${dims.map((d) => d.label).join(" and ")}) cannot go on one chart. Keep one — the other belongs in the filter, or in a second chart beside this one.` };
  }
  const ok = plottableForms(sel);
  if (ok.length === 0) {
    return { tone: "warn", text: "Nothing can be drawn from this combination. The reasons are on each form below." };
  }
  const rec = ok.find((v) => v.recommended);
  return {
    tone: "ok",
    text: rec
      ? `${ok.length} form${ok.length === 1 ? "" : "s"} available. ${rec.label} is the natural one here — ${rec.purpose.toLowerCase()}`
      : `${ok.length} form${ok.length === 1 ? "" : "s"} available.`,
  };
}
