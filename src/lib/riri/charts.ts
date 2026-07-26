// ─────────────────────────────────────────────────────────────────────────────
// WHAT SHAPE IS THIS ANSWER? — chart inference for Analytics exports.
//
// The analyst returns rows. Rows are not a chart, and the difference between a
// report someone forwards to their board and a report they close is almost
// entirely whether the shape was chosen correctly. So the form is DERIVED from
// the data's job, before any colour is picked:
//
//   one number                  → a hero figure, not a one-bar bar chart
//   a period column + a measure → columns in time order (never re-sorted)
//   a category + a measure      → horizontal bars, sorted by magnitude
//   many categories (>12)       → the table alone; more than ~7 classes that all
//                                 carry meaning is a table, not more colour
//   two+ measures               → the table, plus columns on the primary measure
//
// COLOUR FOLLOWS THE JOB, and for almost everything a lender asks the job is
// MAGNITUDE — "what's my PAR by product", "top 5 by balance", "disbursements over
// time". Magnitude wants ONE hue, light→dark, which is both the safest choice and
// the one that survives colour-blindness and a black-and-white printer without
// any further thought. Categorical hues are reserved for when the series are
// genuinely the subject.
//
// TIME IS NEVER SORTED BY VALUE. A trend re-ordered by magnitude stops being a
// trend and becomes a ranking that looks like a trend — the single most dangerous
// chart bug there is, because it is still readable and simply says something false.
// ─────────────────────────────────────────────────────────────────────────────

export type Row = Record<string, unknown>;

export type ChartForm = "hero" | "column" | "bar" | "table";

export type ChartPlan = {
  form: ChartForm;
  /** Column driving the category / time axis. Null for a hero figure. */
  labelKey: string | null;
  /** The measure being plotted. */
  valueKey: string | null;
  /** Extra numeric columns — rendered in the table, never as a second y-axis. */
  otherValueKeys: string[];
  title: string;
  /** Why this form was chosen — printed on the report so nobody has to guess. */
  rationale: string;
  points: { label: string; value: number }[];
  /** Headline stats for the KPI row. */
  kpis: { label: string; value: string }[];
  /** True when the axis is time and the order is meaningful. */
  timeOrdered: boolean;
  unit: "KES" | "count" | "percent" | "plain";
};

// ── Column sniffing ──────────────────────────────────────────────────────────

const TIME_HINT = /(month|date|day|week|year|period|quarter|time|_at|bucket)/i;
const MONEY_HINT = /(amount|balance|olb|principal|value|disbursed|collected|paid|interest|kes|total|sum|loss|exposure)/i;
const PCT_HINT = /(rate|pct|percent|par|ratio|share)/i;

const isNum = (v: unknown): v is number =>
  typeof v === "number" ? Number.isFinite(v)
    : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v));

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v));

/** A column is numeric when EVERY non-null cell parses. One stray label makes it a label. */
function numericColumns(rows: Row[], cols: string[]): string[] {
  return cols.filter((c) => {
    const vals = rows.map((r) => r[c]).filter((v) => v !== null && v !== undefined && v !== "");
    return vals.length > 0 && vals.every(isNum);
  });
}

/** Looks like an ordered period axis — the one case where sorting by value is forbidden. */
function looksTemporal(key: string, values: unknown[]): boolean {
  if (TIME_HINT.test(key)) return true;
  // ISO-ish or YYYY-MM values, even under a column called something else.
  return values.every((v) => typeof v === "string" && /^\d{4}(-\d{2}){0,2}/.test(v));
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function fmtValue(v: number, unit: ChartPlan["unit"]): string {
  if (unit === "percent") {
    // Rates arrive either as 0.071 or as 7.1 depending on the query. Treat
    // anything ≤ 1 as a fraction; a genuine 0.4% PAR is rarer than a fraction.
    const p = Math.abs(v) <= 1 ? v * 100 : v;
    return `${p.toFixed(1)}%`;
  }
  if (unit === "KES") {
    const a = Math.abs(v);
    if (a >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
    if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
    if (a >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
    return String(Math.round(v));
  }
  return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2);
}

function unitFor(key: string): ChartPlan["unit"] {
  if (PCT_HINT.test(key)) return "percent";
  if (MONEY_HINT.test(key)) return "KES";
  return "plain";
}

/** Turn a column name into something a person would write on a slide. */
export function humanise(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b(olb|par|kes|pd|npl|id)\b/gi, (m) => m.toUpperCase())
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

// ── The plan ─────────────────────────────────────────────────────────────────

/** Rows a chart stops helping with. Past this it is a table — see the header. */
const MAX_CATEGORIES = 12;

export function planChart(rows: Row[], question: string): ChartPlan {
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const nums = numericColumns(rows, cols);
  const labels = cols.filter((c) => !nums.includes(c));

  const empty: ChartPlan = {
    form: "table", labelKey: null, valueKey: null, otherValueKeys: [],
    title: question, rationale: "No rows to plot.", points: [], kpis: [],
    timeOrdered: false, unit: "plain",
  };
  if (rows.length === 0 || cols.length === 0) return empty;

  // ONE NUMBER. A single value is a hero figure — a bar chart with one bar
  // communicates nothing a large number doesn't, and wastes the page doing it.
  if (rows.length === 1 && nums.length >= 1) {
    const key = nums[0];
    const unit = unitFor(key);
    const v = num(rows[0][key]);
    return {
      form: "hero", labelKey: labels[0] ?? null, valueKey: key,
      otherValueKeys: nums.slice(1),
      title: question,
      rationale: "One value — shown as a figure, because a single bar is not a comparison.",
      points: [{ label: humanise(key), value: v }],
      kpis: nums.slice(0, 4).map((k) => ({ label: humanise(k), value: fmtValue(num(rows[0][k]), unitFor(k)) })),
      timeOrdered: false, unit,
    };
  }

  const valueKey = nums[0] ?? null;
  const labelKey = labels[0] ?? cols.find((c) => c !== valueKey) ?? null;

  if (!valueKey || !labelKey) {
    return { ...empty, rationale: "No single measure to plot — the table carries it." };
  }

  const unit = unitFor(valueKey);
  const rawLabels = rows.map((r) => String(r[labelKey] ?? ""));
  const temporal = looksTemporal(labelKey, rows.map((r) => r[labelKey]));

  let points = rows.map((r, i) => ({ label: rawLabels[i], value: num(r[valueKey]) }));

  // TIME KEEPS ITS ORDER. Everything else ranks by magnitude, because a reader
  // scanning "which product is worst" should not have to hunt.
  if (!temporal) points = [...points].sort((a, b) => b.value - a.value);

  const total = points.reduce((s, p) => s + p.value, 0);
  const top = points.reduce((a, p) => (p.value > a.value ? p : a), points[0]);
  const kpis: { label: string; value: string }[] = [
    { label: unit === "percent" ? "Average" : "Total", value: fmtValue(unit === "percent" ? total / points.length : total, unit) },
    { label: temporal ? "Peak period" : "Highest", value: top.label.slice(0, 22) },
    { label: temporal ? "Peak value" : `Highest ${humanise(valueKey).toLowerCase()}`, value: fmtValue(top.value, unit) },
    { label: temporal ? "Periods" : "Categories", value: String(points.length) },
  ];

  if (points.length > MAX_CATEGORIES) {
    return {
      form: "table", labelKey, valueKey, otherValueKeys: nums.slice(1),
      title: question,
      rationale: `${points.length} categories — past a dozen a chart hides more than it shows, so this is the table.`,
      points, kpis, timeOrdered: temporal, unit,
    };
  }

  return {
    form: temporal ? "column" : "bar",
    labelKey, valueKey, otherValueKeys: nums.slice(1),
    title: question,
    rationale: temporal
      ? "A period axis — columns in time order, never re-sorted by size."
      : "Comparing magnitude across categories — horizontal bars, largest first.",
    points, kpis, timeOrdered: temporal, unit,
  };
}

// ── The sequential ramp ──────────────────────────────────────────────────────
//
// One hue, light→dark, from the validated reference palette. Magnitude is the job
// in almost every lender question, and a single-hue ramp is the only encoding
// that survives colour-blindness, a greyscale printer and a projector at once.
// Categorical hues are deliberately NOT used here: the bars are one measure, not
// competing series, and painting them eight colours would imply otherwise.

export const RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#2a78d6", "#1c5cab", "#0d366b"] as const;

/** Darkest for the largest value. `t` is 0–1 within the plotted range. */
export function rampColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  // Start at index 2 so even the smallest bar keeps enough chroma to read as data
  // rather than as a gridline.
  const lo = 2, hi = RAMP.length - 1;
  return RAMP[Math.round(lo + clamped * (hi - lo))];
}

/** "Nice" axis ceiling — 1/2/5×10ⁿ above the max, so gridlines land on round numbers. */
export function niceMax(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(max));
  const n = max / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * mag;
}

/** Evenly spaced gridline values from 0 to a nice ceiling. */
export function gridlines(max: number, count = 4): number[] {
  const top = niceMax(max);
  return Array.from({ length: count + 1 }, (_, i) => (top / count) * i);
}
