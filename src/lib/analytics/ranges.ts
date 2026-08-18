// ─────────────────────────────────────────────────────────────────────────────
// TIME — the axis every other question hangs off.
//
// The console's dashboard has six ranges hardcoded into an enum. That is enough
// for a dashboard and nowhere near enough for a studio, where "last quarter
// against the same quarter last year" is an ordinary question and "since
// inception" is the one a board asks first.
//
// THREE THINGS THIS FILE GETS RIGHT THAT AD-HOC DATE MATH GETS WRONG:
//
//   1. EVERY RANGE HAS A COMPARISON. A number without a previous number is a
//      fact, not an insight. `previous()` returns the period a range should be
//      read against — and it is not always "the same length immediately before":
//      the honest comparison for December is last December, not November.
//
//   2. PARTIAL PERIODS ARE COMPARED LIKE FOR LIKE. On the 9th of the month,
//      month-to-date against all of last month is a 70% "decline" that is purely
//      an artefact of the calendar. So a to-date range compares against the SAME
//      NUMBER OF DAYS into the previous period, and says so.
//
//   3. THE BUCKET FOLLOWS THE RANGE. A year plotted in days is 365 unreadable
//      pixels; a day plotted in months is one bar. `bucketFor()` picks the grain,
//      and it is overridable because sometimes you really do want 365 points.
//
// All arithmetic is in the SERVER's local zone, which for this deployment is the
// lender's. That is deliberate: a Kenyan lender's "today" ends at midnight in
// Nairobi, and a UTC day boundary would put the last three hours of every
// working day into tomorrow's figures.
// ─────────────────────────────────────────────────────────────────────────────

export type RangeKey =
  | "today"
  | "yesterday"
  | "7d"
  | "30d"
  | "90d"
  | "wtd"
  | "mtd"
  | "last-month"
  | "qtd"
  | "last-quarter"
  | "ytd"
  | "last-year"
  | "12mo"
  | "inception"
  | "custom";

export type Bucket = "hour" | "day" | "week" | "month" | "quarter" | "year";

export type Range = {
  key: RangeKey;
  label: string;
  /** Inclusive start. */
  from: Date;
  /** EXCLUSIVE end — every query is `>= from AND < to`, with no off-by-one. */
  to: Date;
  /** True when the period has not finished yet (today, MTD, YTD…). */
  partial: boolean;
  /** The natural bucket for plotting this span. */
  bucket: Bucket;
  /** How the comparison period was chosen, said in words for the UI. */
  compareLabel: string;
};

export type RangeDef = {
  key: Exclude<RangeKey, "custom">;
  label: string;
  short: string;
  /** Grouped in the picker: recent windows, calendar periods, everything. */
  group: "recent" | "calendar" | "all";
};

export const RANGE_DEFS: RangeDef[] = [
  { key: "today", label: "Today", short: "Today", group: "recent" },
  { key: "yesterday", label: "Yesterday", short: "Yday", group: "recent" },
  { key: "7d", label: "Last 7 days", short: "7d", group: "recent" },
  { key: "30d", label: "Last 30 days", short: "30d", group: "recent" },
  { key: "90d", label: "Last 90 days", short: "90d", group: "recent" },
  { key: "wtd", label: "Week to date", short: "WTD", group: "calendar" },
  { key: "mtd", label: "Month to date", short: "MTD", group: "calendar" },
  { key: "last-month", label: "Last month", short: "Last mo", group: "calendar" },
  { key: "qtd", label: "Quarter to date", short: "QTD", group: "calendar" },
  { key: "last-quarter", label: "Last quarter", short: "Last qtr", group: "calendar" },
  { key: "ytd", label: "Year to date", short: "YTD", group: "calendar" },
  { key: "last-year", label: "Last year", short: "Last yr", group: "calendar" },
  { key: "12mo", label: "Rolling 12 months", short: "12mo", group: "all" },
  { key: "inception", label: "Since inception", short: "All time", group: "all" },
];

export const rangeDef = (key: string): RangeDef | undefined => RANGE_DEFS.find((r) => r.key === key);

// ── Primitives ───────────────────────────────────────────────────────────────

const startOfDay = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const addDays = (d: Date, n: number): Date => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const addMonths = (d: Date, n: number): Date => {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
};

/**
 * Start of week — MONDAY.
 *
 * Not Sunday. Kenyan lenders run a Monday–Saturday collection week, field
 * rosters are built on it, and a "this week" that starts on Sunday puts the
 * weekend's collections in the wrong bucket every single time.
 */
const startOfWeek = (d: Date): Date => {
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7; // Mon=0 … Sun=6
  return addDays(x, -dow);
};
const startOfMonth = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), 1);
const startOfQuarter = (d: Date): Date => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
const startOfYear = (d: Date): Date => new Date(d.getFullYear(), 0, 1);

/** Days between two dates, as a positive whole number. */
export const daysBetween = (a: Date, b: Date): number =>
  Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));

/**
 * The bucket a span should be plotted in.
 *
 * The thresholds are chosen so a chart lands between roughly 7 and 60 marks —
 * below 7 the shape is not a trend, above 60 the marks are thinner than the gaps
 * between them and the eye reads noise.
 */
export function bucketFor(from: Date, to: Date): Bucket {
  const days = daysBetween(from, to);
  if (days <= 2) return "hour";
  if (days <= 62) return "day";
  if (days <= 180) return "week";
  if (days <= 1100) return "month";
  if (days <= 3700) return "quarter";
  return "year";
}

// ── Resolution ───────────────────────────────────────────────────────────────

export type ResolveOptions = {
  /** Anchor for "now". Injectable so the tests are not a clock race. */
  now?: Date;
  /** Where the book starts, for "since inception". */
  inceptionFrom?: Date | null;
  /** Custom range bounds — required when key === "custom". */
  customFrom?: Date | null;
  customTo?: Date | null;
  /** Force a plotting grain instead of taking the natural one. */
  bucket?: Bucket | null;
};

export function resolveRange(key: RangeKey, opts: ResolveOptions = {}): Range {
  const now = opts.now ?? new Date();
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);

  let from: Date;
  let to: Date;
  let partial = false;
  let compareLabel = "the previous period";

  switch (key) {
    case "today":
      from = today; to = tomorrow; partial = true;
      compareLabel = "yesterday, to the same hour";
      break;
    case "yesterday":
      from = addDays(today, -1); to = today;
      compareLabel = "the day before";
      break;
    case "7d":
      from = addDays(today, -6); to = tomorrow; partial = true;
      compareLabel = "the 7 days before that";
      break;
    case "30d":
      from = addDays(today, -29); to = tomorrow; partial = true;
      compareLabel = "the 30 days before that";
      break;
    case "90d":
      from = addDays(today, -89); to = tomorrow; partial = true;
      compareLabel = "the 90 days before that";
      break;
    case "wtd":
      from = startOfWeek(now); to = tomorrow; partial = true;
      compareLabel = "last week, to the same day";
      break;
    case "mtd":
      from = startOfMonth(now); to = tomorrow; partial = true;
      compareLabel = "last month, to the same day";
      break;
    case "last-month":
      from = startOfMonth(addMonths(now, -1)); to = startOfMonth(now);
      compareLabel = "the month before";
      break;
    case "qtd":
      from = startOfQuarter(now); to = tomorrow; partial = true;
      compareLabel = "last quarter, to the same day";
      break;
    case "last-quarter": {
      const q = startOfQuarter(now);
      from = addMonths(q, -3); to = q;
      compareLabel = "the quarter before";
      break;
    }
    case "ytd":
      from = startOfYear(now); to = tomorrow; partial = true;
      compareLabel = "last year, to the same day";
      break;
    case "last-year":
      from = new Date(now.getFullYear() - 1, 0, 1); to = startOfYear(now);
      compareLabel = "the year before";
      break;
    case "12mo":
      from = addDays(addMonths(today, -12), 1); to = tomorrow; partial = true;
      compareLabel = "the 12 months before that";
      break;
    case "inception":
      // No book start known ⇒ ten years back. Far enough to be "everything" for
      // any lender on this platform, and bounded so the query planner still has
      // a range to work with rather than scanning to the epoch.
      from = opts.inceptionFrom ? startOfDay(opts.inceptionFrom) : new Date(now.getFullYear() - 10, 0, 1);
      to = tomorrow;
      partial = true;
      compareLabel = "— nothing precedes inception";
      break;
    case "custom":
      from = startOfDay(opts.customFrom ?? addDays(today, -29));
      to = opts.customTo ? addDays(startOfDay(opts.customTo), 1) : tomorrow;
      partial = to > now;
      compareLabel = "the equivalent span before";
      break;
  }

  return {
    key,
    label: key === "custom"
      ? `${from.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} – ${addDays(to, -1).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`
      : (rangeDef(key)?.label ?? "Range"),
    from,
    to,
    partial,
    bucket: opts.bucket ?? bucketFor(from, to),
    compareLabel,
  };
}

/**
 * The period a range should be read AGAINST.
 *
 * Calendar ranges compare to the same calendar period one unit back — December
 * against last December, Q3 against Q2 — because that is what the business
 * means. Rolling windows compare to the window immediately before.
 *
 * A PARTIAL period is truncated to the same elapsed length, which is the part
 * everybody gets wrong: on the 9th, month-to-date must be compared against the
 * first 9 days of last month, not against all 31. Otherwise every month opens
 * with an apparent collapse that corrects itself by the 30th.
 *
 * "Since inception" has no predecessor and returns null rather than inventing one.
 */
export function previousRange(range: Range, now: Date = new Date()): Range | null {
  if (range.key === "inception") return null;

  const elapsedMs = Math.min(range.to.getTime(), now.getTime()) - range.from.getTime();

  const shifted = (from: Date, to: Date): Range => {
    const end = range.partial ? new Date(from.getTime() + elapsedMs) : to;
    return {
      ...range,
      key: range.key,
      label: `vs ${range.compareLabel}`,
      from,
      to: end,
      partial: false,
    };
  };

  switch (range.key) {
    case "today":
    case "yesterday":
      return shifted(addDays(range.from, -1), range.from);
    case "wtd":
      return shifted(addDays(range.from, -7), range.from);
    case "mtd":
    case "last-month":
      return shifted(addMonths(range.from, -1), range.from);
    case "qtd":
    case "last-quarter":
      return shifted(addMonths(range.from, -3), range.from);
    case "ytd":
    case "last-year":
      return shifted(addMonths(range.from, -12), range.from);
    case "12mo":
      return shifted(addMonths(range.from, -12), range.from);
    default: {
      // Rolling windows: the same span, immediately before.
      const span = range.to.getTime() - range.from.getTime();
      const from = new Date(range.from.getTime() - span);
      return shifted(from, range.from);
    }
  }
}

// ── Bucketing ────────────────────────────────────────────────────────────────

/** The bucket key a timestamp falls into — the join key between SQL and the chart. */
export function bucketKey(d: Date, bucket: Bucket): string {
  const y = d.getFullYear();
  const p = (n: number) => String(n).padStart(2, "0");
  switch (bucket) {
    case "hour": return `${y}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}`;
    case "day": return `${y}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    case "week": { const s = startOfWeek(d); return `${s.getFullYear()}-W${p(Math.ceil(((s.getTime() - startOfYear(s).getTime()) / 86_400_000 + 1) / 7))}`; }
    case "month": return `${y}-${p(d.getMonth() + 1)}`;
    case "quarter": return `${y}-Q${Math.floor(d.getMonth() / 3) + 1}`;
    case "year": return String(y);
  }
}

/** A short human label for a bucket key — the x-axis tick. */
export function bucketLabel(d: Date, bucket: Bucket): string {
  switch (bucket) {
    case "hour": return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    case "day": return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
    case "week": return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
    case "month": return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
    case "quarter": return `Q${Math.floor(d.getMonth() / 3) + 1} ${String(d.getFullYear()).slice(2)}`;
    case "year": return String(d.getFullYear());
  }
}

/** Advance one bucket. */
function stepBucket(d: Date, bucket: Bucket): Date {
  const x = new Date(d);
  switch (bucket) {
    case "hour": x.setHours(x.getHours() + 1); break;
    case "day": x.setDate(x.getDate() + 1); break;
    case "week": x.setDate(x.getDate() + 7); break;
    case "month": x.setMonth(x.getMonth() + 1); break;
    case "quarter": x.setMonth(x.getMonth() + 3); break;
    case "year": x.setFullYear(x.getFullYear() + 1); break;
  }
  return x;
}

/** Snap a date to the start of its bucket. */
function snapBucket(d: Date, bucket: Bucket): Date {
  switch (bucket) {
    case "hour": { const x = new Date(d); x.setMinutes(0, 0, 0); return x; }
    case "day": return startOfDay(d);
    case "week": return startOfWeek(d);
    case "month": return startOfMonth(d);
    case "quarter": return startOfQuarter(d);
    case "year": return startOfYear(d);
  }
}

/**
 * Every bucket in a range, INCLUDING THE EMPTY ONES.
 *
 * This is the difference between a chart that tells the truth and one that
 * flatters. A GROUP BY only returns buckets that had activity, so a week with no
 * disbursements simply vanishes and the line joins straight across it — the
 * outage looks like a plateau. Building the axis here and left-joining the
 * aggregate onto it means a zero week is drawn as a zero.
 */
export function bucketAxis(range: Range): Array<{ key: string; label: string; at: Date }> {
  const out: Array<{ key: string; label: string; at: Date }> = [];
  let cursor = snapBucket(range.from, range.bucket);
  // A hard ceiling: a misconfigured custom range must not build a million points.
  for (let i = 0; cursor < range.to && i < 2000; i++) {
    out.push({ key: bucketKey(cursor, range.bucket), label: bucketLabel(cursor, range.bucket), at: new Date(cursor) });
    cursor = stepBucket(cursor, range.bucket);
  }
  return out;
}

/** The SQL date_trunc unit for a bucket (Postgres). */
export const PG_TRUNC: Record<Bucket, string> = {
  hour: "hour", day: "day", week: "week", month: "month", quarter: "quarter", year: "year",
};

/** The T-SQL DATEPART/DATEADD unit for a bucket (SQL Server, bridged mode). */
export const MSSQL_UNIT: Record<Bucket, string> = {
  hour: "hour", day: "day", week: "week", month: "month", quarter: "quarter", year: "year",
};
