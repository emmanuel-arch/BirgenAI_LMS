// ─────────────────────────────────────────────────────────────────────────────
// Riri Analyst — "talk to your loan book", now on the semantic layer.
//
// What changed, and why it matters more than it looks: this file used to hold
// thirteen hand-written Prisma queries, one per question Riri could answer. It was
// honest and it worked, but it could only ever answer the thirteen questions someone
// had thought to write, it could not slice any of them, and it was a second
// definition of measures the dashboard computed its own way.
//
// Now the numbers come from the catalogue (catalog.ts): ONE definition of PAR 30,
// compiled to SQL, sliced and dated by the plan (planner.ts), guarded (guard.ts),
// and run on a read-only tenant-stamped path (readpath.ts). This file is what is
// left over once the data layer is real — the part that turns a number into a
// sentence a Credit Manager would actually say.
//
// THREE RULES IT KEEPS:
//
//   1. SHOW THE SQL. Every answer carries the exact statement that produced it. A
//      lender who cannot check a number cannot act on it, and an analytics assistant
//      that asks to be taken on trust does not deserve to be.
//   2. NEVER INVENT. If the catalogue cannot express a question and no model is
//      configured to write SQL for it, Riri says so and the question is logged. The
//      failure mode of a confident wrong number in a lending business is a bad loan.
//   3. DON'T DOUBLE-SELL. Early warning is a Premium engine; Riri ships on Advanced.
//      Asking her about the watchlist must not become a side door around the package
//      the lender actually bought.
// ─────────────────────────────────────────────────────────────────────────────
import { hasFeature } from "@/lib/billing/entitlements";
import { cheapestPlanWith } from "@/lib/billing/plans";
import { portfolioEarlyWarning } from "@/lib/intelligence/earlywarning";
import { latestRun, portfolioTrend } from "@/lib/intelligence/portfolio";
import { modelDrift, MIN_RESOLVED, type DriftReport } from "@/lib/intelligence/drift";
import { bind, compile, compileSeries, metricSpec, type CompiledQuery, type MetricSpec, type MetricUnit, type TimeRange } from "./catalog";
import { metricsFor, targetVerdict, type ResolvedMetric } from "./definitions";
import { plan, previousRange, proposeSql, ALL_TIME } from "./planner";
import { validateReadSql } from "./guard";
import { displaySql, runReadQuery, type Row } from "./readpath";

export type MetricChip = { label: string; value: string; sub?: string; tone?: "good" | "warn" | "bad" };
export type Series = { unit: "KES" | "count"; points: { x: string; y: number }[] };
export type MiniTable = { head: string[]; rows: string[][] };

/** How the answer was arrived at. Written to RiriQueryLog, shown as a badge. */
export type AnalystRoute = "catalog" | "llm" | "engine" | "narrative" | "refused";

export type AnalystResult = {
  answer: string;
  kind: string;
  route: AnalystRoute;
  metricId?: string;
  chips?: MetricChip[];
  series?: Series;
  table?: MiniTable;
  /** The statement that produced these numbers, exactly as it ran. */
  sql?: string;
  rows?: number;
  ms?: number;
  ok: boolean;
  error?: string;
};

// ── Formatting ────────────────────────────────────────────────────────────────
const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const kesShort = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `KES ${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (a >= 1_000) return `KES ${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return kes(n);
};
const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

function fmt(value: number, unit: MetricUnit, short = false): string {
  switch (unit) {
    case "KES": return short ? kesShort(value) : kes(value);
    case "percent": return `${value.toFixed(1)}%`;
    case "score": return String(Math.round(value));
    default: return Math.round(value).toLocaleString();
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 || word.endsWith("s") ? "" : "s"}`;

// ── Running a compiled metric ─────────────────────────────────────────────────

type Ran = { rows: Row[]; sql: string; ms: number; ok: true } | { ok: false; error: string; sql: string; ms: number };

/**
 * Compile → guard → run. Our own SQL goes through the guard exactly as a model's
 * would: the day this file compiles something malformed, the guard should be what
 * catches it, not a lender reading a wrong number.
 */
async function run(orgId: string, q: CompiledQuery): Promise<Ran> {
  const { sql, params } = bind(q, orgId);
  const shown = displaySql(sql, params);

  const guard = validateReadSql(sql);
  if (!guard.ok) return { ok: false, error: guard.reason, sql: shown, ms: 0 };

  const res = await runReadQuery(orgId, sql, params);
  if (!res.ok) return { ok: false, error: res.error, sql: shown, ms: res.ms };
  return { ok: true, rows: res.rows, sql: shown, ms: res.ms };
}

/** The single number a metric evaluates to, for a period. */
async function scalar(orgId: string, spec: MetricSpec, range?: TimeRange): Promise<{ value: number; n: number | null } | null> {
  const r = await run(orgId, compile(spec, { range }));
  if (!r.ok || !r.rows.length) return null;
  const row = r.rows[0];
  return { value: num(row.value), n: row.n == null ? null : num(row.n) };
}

// ── The metric answer ─────────────────────────────────────────────────────────

async function answerMetric(
  orgId: string,
  m: ResolvedMetric,
  p: Extract<ReturnType<typeof plan>, { kind: "metric" }>,
): Promise<AnalystResult> {
  const spec = metricSpec(m.id)!;
  const label = m.displayLabel;

  // A trend question ("collections over time") is a different shape of answer.
  if (p.series) {
    const compiled = compileSeries(spec, 6);
    if (compiled) {
      const r = await run(orgId, compiled);
      if (!r.ok) return failed(m, r);
      const series = seriesFrom(r.rows, 6, spec.unit === "KES" ? "KES" : "count");
      const total = series.points.reduce((s, pt) => s + pt.y, 0);
      return {
        ok: true, route: "catalog", kind: m.id, metricId: m.id, sql: r.sql, ms: r.ms, rows: r.rows.length,
        answer: `Here's **${label.toLowerCase()}** month by month. Over the last six months it comes to **${fmt(total, spec.unit)}**.`,
        series,
      };
    }
  }

  // A sliced question ("by product", "top 5 borrowers").
  if (p.dimension) {
    const dim = spec.dimensions![p.dimension]!;
    const r = await run(orgId, compile(spec, { range: p.range, dimension: p.dimension, limit: p.limit }));
    if (!r.ok) return failed(m, r);
    if (!r.rows.length) {
      return {
        ok: true, route: "catalog", kind: m.id, metricId: m.id, sql: r.sql, ms: r.ms, rows: 0,
        answer: `There's nothing to show for **${label.toLowerCase()}** ${periodPhrase(p.range)} yet.`,
      };
    }

    const total = r.rows.reduce((s, row) => s + num(row.value), 0);
    const top = r.rows[0];
    const head = [dim.name, label, ...(spec.countExpr ? ["Count"] : [])];
    const table: MiniTable = {
      head,
      rows: r.rows.map((row) => [
        String(row.label ?? "—"),
        fmt(num(row.value), spec.unit, true),
        ...(spec.countExpr ? [String(num(row.n))] : []),
      ]),
    };

    // A share only means something when the parts add up to the whole — averages and
    // percentages do not sum, so we never claim a "share" of one.
    const additive = spec.unit === "KES" || spec.unit === "count";
    const share = additive && total > 0 ? ` — **${String(top.label)}** is the biggest at ${((num(top.value) / total) * 100).toFixed(0)}% of the total` : "";

    return {
      ok: true, route: "catalog", kind: m.id, metricId: m.id, sql: r.sql, ms: r.ms, rows: r.rows.length,
      answer: `Here's **${label.toLowerCase()}** by ${dim.label.toLowerCase()}${periodSuffix(p.range)}${share}.`,
      table,
    };
  }

  // The plain number.
  const r = await run(orgId, compile(spec, { range: p.range }));
  if (!r.ok) return failed(m, r);

  const row = r.rows[0] ?? {};
  const value = num(row.value);
  const n = row.n == null ? null : num(row.n);

  const chips: MetricChip[] = [{ label, value: fmt(value, spec.unit, true), tone: toneFor(m, value) }];
  if (n != null && spec.countNoun) chips.push({ label: titleCase(spec.countNoun), value: String(n) });

  const lines: string[] = [
    `${sentence(label, p.range, value, spec)}${n != null && spec.countNoun ? ` — across ${plural(n, spec.countNoun)}` : ""}.`,
  ];

  // "vs the month before" — only for flows, and only against a comparable window.
  const prev = spec.timeColumn ? previousRange(p.range) : null;
  if (prev) {
    const before = await scalar(orgId, spec, prev);
    if (before && before.value > 0) {
      const delta = ((value - before.value) / before.value) * 100;
      const dir = delta >= 0 ? "up" : "down";
      const good = spec.goodDirection ? (delta >= 0) === (spec.goodDirection === "up") : null;
      lines.push(`That's **${dir} ${Math.abs(delta).toFixed(0)}%** on ${prev.label} (${fmt(before.value, spec.unit, true)}).`);
      chips.push({
        label: `vs ${prev.label}`,
        value: `${delta >= 0 ? "+" : ""}${delta.toFixed(0)}%`,
        tone: good == null ? undefined : good ? "good" : "bad",
      });
    }
  }

  if (m.target != null && m.targetDirection) {
    const verdict = targetVerdict(m, value);
    chips.push({ label: "Your target", value: `${m.targetDirection === "below" ? "≤" : "≥"} ${fmt(m.target, spec.unit, true)}`, tone: verdict ?? undefined });
    lines.push(
      verdict === "good"
        ? `That's inside the target you set (${m.targetDirection === "below" ? "at or below" : "at or above"} ${fmt(m.target, spec.unit)}).`
        : `That's outside the target you set (${m.targetDirection === "below" ? "at or below" : "at or above"} ${fmt(m.target, spec.unit)}).`,
    );
  } else if (spec.id === "par30") {
    // The one measure with a conventional reading everyone in microfinance shares.
    lines.push(value < 5 ? `That's healthy.` : value < 10 ? `That's worth watching.` : `That's elevated — worth a collections push.`);
  }

  return {
    ok: true, route: "catalog", kind: m.id, metricId: m.id, sql: r.sql, ms: r.ms, rows: r.rows.length,
    answer: lines.join(" "),
    chips,
  };
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function periodPhrase(range: TimeRange): string {
  return range.label === "all-time" ? "" : range.label;
}
function periodSuffix(range: TimeRange): string {
  return range.label === "all-time" ? "" : `, ${range.label}`;
}

/**
 * The headline sentence. Flows happened over a period; stocks just *are*.
 *
 * Counts get a colon rather than a verb: "Your applications waiting is 1" is not a
 * sentence anyone would say, while "Applications waiting: 1" is how it would appear on
 * the board pack.
 */
function sentence(label: string, range: TimeRange, value: number, spec: MetricSpec): string {
  const v = `**${fmt(value, spec.unit)}**`;
  const periodless = !spec.timeColumn || range.label === "all-time";
  if (spec.unit === "count") return `**${titleCase(label)}**${periodless ? "" : ` ${range.label}`}: ${v}`;
  if (periodless) return `Your **${label.toLowerCase()}** is ${v}`;
  return `**${titleCase(label)}** ${range.label}: ${v}`;
}

function toneFor(m: ResolvedMetric, value: number): MetricChip["tone"] {
  const verdict = targetVerdict(m, value);
  if (verdict) return verdict;
  if (m.id === "par30") return value < 5 ? "good" : value < 10 ? "warn" : "bad";
  return undefined;
}

/**
 * Zero-fill the months the SQL didn't return. A month with no disbursements must
 * draw a bar of zero rather than vanish, or six sparse months render as six busy
 * ones and the trend line lies.
 */
function seriesFrom(rows: Row[], months: number, unit: "KES" | "count"): Series {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const now = new Date();
  const buckets = new Map<string, number>();
  for (const r of rows) {
    const at = new Date(String(r.bucket));
    if (!Number.isNaN(at.getTime())) buckets.set(`${at.getFullYear()}-${at.getMonth()}`, num(r.value));
  }
  const points: { x: string; y: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    points.push({ x: MONTHS[d.getMonth()], y: Math.round(buckets.get(`${d.getFullYear()}-${d.getMonth()}`) ?? 0) });
  }
  return { unit, points };
}

function failed(m: ResolvedMetric, r: Extract<Ran, { ok: false }>): AnalystResult {
  return {
    ok: false,
    route: "refused",
    kind: m.id,
    metricId: m.id,
    sql: r.sql,
    ms: r.ms,
    error: r.error,
    answer: `I couldn't read that one: ${r.error}`,
  };
}

// ── The early-warning engine (not SQL — a model) ──────────────────────────────

async function answerWatchlist(orgId: string): Promise<AnalystResult> {
  if (!(await hasFeature(orgId, "portfolio-scan"))) {
    const p = cheapestPlanWith("portfolio-scan");
    return {
      ok: true, route: "narrative", kind: "watchlist",
      answer: `Portfolio early-warning isn't on your package yet. **${p?.name}** (KES ${p?.monthlyKes.toLocaleString()}/mo) scores every active loan for the early signs of default. Open **Billing** to add it.`,
    };
  }

  const ew = await portfolioEarlyWarning(orgId);
  const pctOfBook = ew.tiles.olb > 0 ? (ew.tiles.atRiskValue / ew.tiles.olb) * 100 : 0;

  return {
    ok: true,
    route: "engine",
    kind: "watchlist",
    answer: ew.rows.length === 0
      ? `Nothing on the early-warning watchlist right now — every active loan is behaving. I'll flag them the moment they start to slip.`
      : `**${ew.rows.length}** borrower${ew.rows.length === 1 ? "" : "s"} on the early-warning watchlist — ${ew.tiles.high} high-risk, ${kesShort(ew.tiles.atRiskValue)} at risk (${pctOfBook.toFixed(0)}% of book), ~${kesShort(ew.tiles.projectedLoss)} projected loss. Open **Credit Intelligence** to act on them.\n\nThis one comes from the risk model rather than a SQL query — it weighs arrears, the score at origination and structural risk together.`,
    chips: [
      { label: "Watchlist", value: String(ew.rows.length), tone: ew.rows.length > 0 ? "warn" : "good" },
      { label: "High risk", value: String(ew.tiles.high), tone: ew.tiles.high > 0 ? "bad" : "good" },
      { label: "Value at risk", value: kesShort(ew.tiles.atRiskValue) },
      { label: "Projected loss", value: kesShort(ew.tiles.projectedLoss), tone: "bad" },
    ],
    table: ew.rows.length
      ? { head: ["Borrower", "DPD", "Risk", "Balance"], rows: ew.rows.slice(0, 5).map((r) => [r.name, String(r.dpd), r.band, kesShort(r.balance)]) }
      : undefined,
  };
}

async function answerDrift(orgId: string): Promise<AnalystResult> {
  if (!(await hasFeature(orgId, "portfolio-scan"))) {
    const p = cheapestPlanWith("portfolio-scan");
    return {
      ok: true, route: "narrative", kind: "drift",
      answer: `Model-health monitoring rides on portfolio early-warning, which isn't on your package yet. **${p?.name}** (KES ${p?.monthlyKes.toLocaleString()}/mo) adds it. Open **Billing** to upgrade.`,
    };
  }

  // Prefer the recorded run (it also gives the trend); compute live only when no
  // run exists yet — same numbers, just not yet a point on a line.
  const [last, trend] = await Promise.all([latestRun(orgId), portfolioTrend(orgId, 30)]);
  const drift: DriftReport = last?.drift ?? (await modelDrift(orgId));
  const cal = drift.calibration;
  const pop = drift.population;

  const trendLine = (() => {
    if (trend.length < 2) return "";
    const first = trend[0], lastPt = trend[trend.length - 1];
    const delta = lastPt.atRiskPct - first.atRiskPct;
    const dir = Math.abs(delta) < 0.05 ? "flat" : delta > 0 ? `up ${delta.toFixed(1)}pp` : `down ${Math.abs(delta).toFixed(1)}pp`;
    return ` Over the last ${trend.length} runs the at-risk share of the book is ${dir} (${first.atRiskPct.toFixed(1)}% → ${lastPt.atRiskPct.toFixed(1)}%).`;
  })();

  const headline =
    drift.status === "INSUFFICIENT"
      ? `Honest answer: **not enough outcomes yet to judge the model.** ${cal.note}`
      : drift.status === "STABLE"
        ? `The model is holding up. ${cal.note}`
        : drift.status === "WATCH"
          ? `Worth watching. ${cal.verdict !== "STABLE" && cal.verdict !== "INSUFFICIENT" ? cal.note : pop.note}`
          : `**The model is drifting.** ${cal.verdict === "DRIFTING" ? cal.note : pop.note}`;

  const tone = (v: string): "good" | "warn" | "bad" | undefined =>
    v === "STABLE" ? "good" : v === "WATCH" ? "warn" : v === "DRIFTING" ? "bad" : undefined;

  return {
    ok: true,
    route: "engine",
    kind: "drift",
    answer:
      `${headline}${trendLine}\n\nThis comes from the closed ML loop, not a SQL query — every score the platform issued, joined back to what the loan actually did. The full report is on **Credit Intelligence**.`,
    chips: [
      { label: "Model health", value: drift.status === "INSUFFICIENT" ? "TOO EARLY" : drift.status, tone: tone(drift.status) },
      { label: "Calibration", value: cal.realisedRate != null ? `${(cal.realisedRate * 100).toFixed(1)}% vs ${(cal.predictedRate! * 100).toFixed(1)}%` : `${cal.resolved} outcomes`, sub: cal.realisedRate != null ? "realised vs predicted" : `of ${MIN_RESOLVED} needed`, tone: tone(cal.verdict) },
      { label: "Population PSI", value: pop.psi != null ? pop.psi.toFixed(2) : "—", tone: tone(pop.verdict) },
    ],
  };
}

// ── Help ──────────────────────────────────────────────────────────────────────

async function answerHelp(orgId: string, metrics: ResolvedMetric[]): Promise<AnalystResult> {
  const olb = metricSpec("olb")!;
  const par = metricSpec("par30")!;
  const waiting = metricSpec("apps_waiting")!;
  const [book, par30, queue] = await Promise.all([
    scalar(orgId, olb, ALL_TIME),
    scalar(orgId, par, ALL_TIME),
    scalar(orgId, waiting, ALL_TIME),
  ]);

  const live = metrics.filter((m) => m.enabled);
  const known = live.slice(0, 8).map((m) => m.displayLabel.toLowerCase()).join(", ");

  return {
    ok: true,
    route: "narrative",
    kind: "help",
    answer:
      `I'm **Riri Analyst** — I read your live book so you don't have to pull a report. Right now you're carrying ${kesShort(book?.value ?? 0)} across ${plural(book?.n ?? 0, "active loan")}, PAR 30 at ${(par30?.value ?? 0).toFixed(1)}%, with ${plural(queue?.value ?? 0, "application")} waiting on a decision.\n\n` +
      `I know **${live.length} measures** of your book — ${known}, and more. Ask for any of them by period ("collected last month"), sliced ("PAR by product"), ranked ("top 5 borrowers") or as a trend ("disbursements over time"). Every answer shows you the SQL it came from.`,
    chips: [
      { label: "Outstanding book", value: kesShort(book?.value ?? 0) },
      { label: "PAR 30", value: `${(par30?.value ?? 0).toFixed(1)}%`, tone: (par30?.value ?? 0) < 5 ? "good" : (par30?.value ?? 0) < 10 ? "warn" : "bad" },
      { label: "Apps waiting", value: String(queue?.value ?? 0) },
    ],
  };
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Answer a question about this org's book.
 *
 * The order is deliberate: the governed catalogue gets first refusal, because a
 * definition someone reviewed beats a definition a model improvised. Only what the
 * catalogue cannot express is offered to the text-to-SQL path — and if there is no
 * model configured, Riri says what she cannot do rather than guessing.
 */
export async function analyze(orgId: string, question: string): Promise<AnalystResult> {
  const metrics = await metricsFor(orgId);
  const p = plan(question, metrics);

  if (p.kind === "help") return answerHelp(orgId, metrics);
  if (p.kind === "engine") return p.engine === "drift" ? answerDrift(orgId) : answerWatchlist(orgId);

  if (p.kind === "metric") {
    const m = metrics.find((x) => x.id === p.metricId);
    if (m?.enabled) return answerMetric(orgId, m, p);
  }

  // Nothing in the catalogue fits. Offer it to a model — which, with no key, declines.
  const proposal = await proposeSql(orgId, question);
  if (!proposal) {
    return {
      ok: true,
      route: "narrative",
      kind: "unknown",
      answer:
        `I can't answer that one from my metric catalogue, and I'd rather tell you that than guess a number.\n\n` +
        `I'm good for: your outstanding book, PAR 30 and value at risk, arrears and what's due today, disbursements and collections, your application pipeline and approval rate, default rate, borrowers, average loan size and scores — each by period, by product, by borrower, or as a trend.`,
    };
  }

  // Model-written SQL. It gets NO more trust than the string a user could have typed:
  // same guard, same read-only tenant-stamped path, same row cap, and it is shown.
  const guard = validateReadSql(proposal.sql);
  if (!guard.ok) {
    return {
      ok: false, route: "refused", kind: "llm", sql: proposal.sql, error: guard.reason,
      answer: `I wrote a query for that and then refused to run it: ${guard.reason}`,
    };
  }

  const res = await runReadQuery(orgId, guard.sql);
  if (!res.ok) {
    return { ok: false, route: "refused", kind: "llm", sql: guard.sql, ms: res.ms, error: res.error, answer: `I couldn't run that: ${res.error}` };
  }

  return {
    ok: true,
    route: "llm",
    kind: "llm",
    sql: guard.sql,
    ms: res.ms,
    rows: res.rows.length,
    answer: `Here's what I found. This one isn't a governed metric — I wrote the query for it, so check the SQL below before you act on it.`,
    table: tableFrom(res.rows),
  };
}

/** Render arbitrary result rows as a small table — used only by the text-to-SQL path. */
function tableFrom(rows: Row[]): MiniTable | undefined {
  if (!rows.length) return undefined;
  const head = Object.keys(rows[0]).slice(0, 4);
  return {
    head,
    rows: rows.slice(0, 12).map((r) =>
      head.map((h) => {
        const v = r[h];
        if (v == null) return "—";
        if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2);
        return String(v);
      }),
    ),
  };
}
