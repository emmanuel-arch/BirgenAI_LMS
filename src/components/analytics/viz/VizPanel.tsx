"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE VIZ PANEL — one component, many forms, switched by the reader.
//
// The founder's ask was "dynamic visualisations — area, bar, line, histogram,
// scatter". The naive way to build that is a component per form and a big
// switch at every call site. This is the other way: ONE panel that owns the
// frame (title, form switcher, legend, tooltip, the numbers table) and swaps
// only the marks inside it.
//
// Two consequences, and both are the point:
//
//   · A READER CAN CHANGE THE FORM. The same eight branches are a bar chart when
//     you are ranking them and a line when you are watching them move. Making
//     that a control instead of a developer decision is most of the difference
//     between a dashboard and a studio.
//
//   · EVERY FORM INHERITS THE SAME RULES. One axis, capped bar widths, the 2px
//     surface gap, a legend the moment there are two series, values in ink and
//     never in the series colour, and a table under every chart. A new screen
//     cannot accidentally ship a chart that breaks them, because a new screen
//     does not draw charts — it describes them.
//
// ── ONE AXIS, ENFORCED ───────────────────────────────────────────────────────
// There is deliberately no prop for a second y-axis. Two measures of different
// scale go in two panels or get indexed to a common base. A dual-axis chart can
// be made to show any correlation you like by choosing the scales, which is
// exactly why it is the most common way a chart lies.
//
// ── THE ALL-PAIRS CAP ────────────────────────────────────────────────────────
// Scatter, donut and treemap put every series on screen simultaneously, so they
// draw from the three-slot all-pairs-validated list rather than the eight-slot
// adjacent one. That is handled here, once, rather than trusted to each caller.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState, type ReactNode } from "react";
import {
  ResponsiveContainer, ComposedChart, Area, Line, Bar, Scatter, ScatterChart,
  PieChart, Pie, Cell, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip,
  Treemap, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ReferenceLine,
} from "recharts";
import {
  ChartLine, ChartArea, ChartColumn, ChartBarBig, Layers, ChartScatter,
  ChartPie, Grid3x3, Radar as RadarIcon, Table2, ChevronDown,
} from "lucide-react";
import { CATEGORICAL, CATEGORICAL_ALL_PAIRS, INK, MARK, AXIS, GRID, seqAt, inkOn } from "./theme";
import { formatValue, compactNumber, type MeasureFormat } from "@/lib/analytics/cube";

export type VizForm =
  | "line" | "area" | "stackedArea"
  | "column" | "stackedColumn" | "bar"
  | "histogram" | "scatter" | "donut" | "heatmap" | "treemap" | "radar";

export type VizSeries = {
  key: string;
  label: string;
  format?: MeasureFormat;
  /** Pin a colour (a status series, or a measure that must keep its hue). */
  color?: string;
};

/** One row. `label` is the x/category value; the rest are series values. */
export type VizRow = { label: string; [seriesKey: string]: string | number | null };

const FORM_META: Record<VizForm, { label: string; icon: typeof ChartLine; allPairs: boolean; single: boolean }> = {
  line: { label: "Line", icon: ChartLine, allPairs: false, single: false },
  area: { label: "Area", icon: ChartArea, allPairs: false, single: false },
  stackedArea: { label: "Stacked area", icon: Layers, allPairs: false, single: false },
  column: { label: "Column", icon: ChartColumn, allPairs: false, single: false },
  stackedColumn: { label: "Stacked column", icon: Layers, allPairs: false, single: false },
  bar: { label: "Bar", icon: ChartBarBig, allPairs: false, single: false },
  histogram: { label: "Histogram", icon: ChartColumn, allPairs: false, single: true },
  scatter: { label: "Scatter", icon: ChartScatter, allPairs: true, single: false },
  donut: { label: "Donut", icon: ChartPie, allPairs: true, single: true },
  heatmap: { label: "Heatmap", icon: Grid3x3, allPairs: false, single: true },
  treemap: { label: "Treemap", icon: Grid3x3, allPairs: true, single: true },
  radar: { label: "Radar", icon: RadarIcon, allPairs: false, single: false },
};

export type VizPanelProps = {
  title: string;
  /** The question this chart answers. Not decoration — it is what makes it readable. */
  subtitle?: string;
  data: VizRow[];
  series: VizSeries[];
  /** Which forms the reader may switch to. First is the default. */
  forms?: VizForm[];
  /** Format for the y axis and the tooltip when a series does not declare one. */
  format?: MeasureFormat;
  height?: number;
  /** Drawn as a dashed horizontal rule — a target, a policy limit, a book average. */
  reference?: { value: number; label: string } | null;
  /** Extra controls in the header (a rank-metric picker, a grain toggle). */
  children?: ReactNode;
  /** Shown in place of the chart when there is nothing to draw. */
  emptyHint?: string;
  /** Note printed under the chart — a caveat, a definition, a data-quality warning. */
  footnote?: ReactNode;
};

export function VizPanel({
  title, subtitle, data, series, forms, format = "count",
  height = 240, reference = null, children, emptyHint, footnote,
}: VizPanelProps) {
  const offered = forms?.length ? forms : (["column", "line", "area", "bar"] as VizForm[]);
  const [form, setForm] = useState<VizForm>(offered[0]);
  const [showTable, setShowTable] = useState(false);

  const meta = FORM_META[form];
  // A single-series form ignores the extra series rather than silently summing
  // them — a donut of three measures is a lie about a whole that does not exist.
  const active = meta.single ? series.slice(0, 1) : series;
  const palette = meta.allPairs ? CATEGORICAL_ALL_PAIRS : CATEGORICAL;
  const colorOf = (s: VizSeries, i: number) => s.color ?? palette[i % palette.length];

  const hasData = data.length > 0 && active.length > 0;

  const tickFmt = (v: number) => (format === "percent" ? `${Math.round(v)}%` : compactNumber(v));

  return (
    <section className="rounded-2xl border border-ash-900/10 bg-paper p-4 sm:p-5">
      {/* ── Header: what this is, and how to look at it ─────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-bold text-ash-800">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[11px] leading-snug text-ash-500">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {children}
          {offered.length > 1 && (
            <div className="flex items-center gap-0.5 rounded-lg bg-ash-900/[0.05] p-0.5">
              {offered.map((f) => {
                const M = FORM_META[f];
                const on = form === f;
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setForm(f)}
                    title={M.label}
                    aria-label={M.label}
                    aria-pressed={on}
                    className={`rounded-md p-1.5 transition-colors ${on ? "bg-paper text-ash-800 shadow-sm" : "text-ash-400 hover:text-ash-600"}`}
                  >
                    <M.icon className="h-3.5 w-3.5" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Legend: always present for two or more series, never for one ─── */}
      {active.length > 1 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {active.map((s, i) => (
            <span key={s.key} className="inline-flex items-center gap-1.5 text-[11px] text-ash-600">
              <span className="inline-block h-2 w-2 rounded-[3px]" style={{ backgroundColor: colorOf(s, i) }} aria-hidden />
              {s.label}
            </span>
          ))}
        </div>
      )}

      {/* ── The marks ────────────────────────────────────────────────────── */}
      <div className="mt-3" style={{ height }}>
        {!hasData ? (
          <div className="flex h-full items-center justify-center rounded-xl bg-ash-900/[0.02] px-4 text-center">
            <p className="text-[12px] text-ash-500">{emptyHint ?? "Nothing in this period to draw."}</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {renderForm({ form, data, series: active, colorOf, format, reference, tickFmt })}
          </ResponsiveContainer>
        )}
      </div>

      {footnote && <p className="mt-2 text-[11px] leading-snug text-ash-500">{footnote}</p>}

      {/* ── The numbers ──────────────────────────────────────────────────
          Not an optional extra. Three hues in the validated categorical order
          sit under 3:1 against a white surface, and the rule for that is relief:
          the values must be readable without resolving a colour. This table is
          that relief, and it is also how anybody checks the chart. */}
      {hasData && (
        <div className="mt-3 border-t border-ash-900/[0.06] pt-2">
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-ash-500 hover:text-ash-700"
          >
            <Table2 className="h-3 w-3" />
            The numbers behind the chart
            <ChevronDown className={`h-3 w-3 transition-transform ${showTable ? "rotate-180" : ""}`} />
          </button>
          {showTable && (
            <div className="mt-2 max-h-64 overflow-auto">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-paper">
                  <tr className="text-left text-ash-400">
                    <th className="py-1 pr-3 font-medium">{/* category */}</th>
                    {active.map((s) => (
                      <th key={s.key} className="py-1 pr-3 text-right font-medium">{s.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.map((row, i) => (
                    <tr key={`${row.label}-${i}`} className="border-t border-ash-900/[0.05]">
                      <td className="py-1 pr-3 text-ash-600">{row.label}</td>
                      {active.map((s) => (
                        <td key={s.key} className="py-1 pr-3 text-right tabular-nums text-ash-700">
                          {formatValue(Number(row[s.key] ?? 0), s.format ?? format, { compact: true })}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

type RenderArgs = {
  form: VizForm;
  data: VizRow[];
  series: VizSeries[];
  colorOf: (s: VizSeries, i: number) => string;
  format: MeasureFormat;
  reference: { value: number; label: string } | null;
  tickFmt: (v: number) => string;
};

function renderForm(a: RenderArgs): React.ReactElement {
  const { form, data, series, colorOf, format, reference, tickFmt } = a;

  const tip = (
    <Tooltip
      cursor={{ fill: "rgba(15,15,25,0.04)" }}
      contentStyle={{
        borderRadius: 10,
        border: `1px solid ${INK.grid}`,
        boxShadow: "0 8px 24px rgba(15,15,25,0.10)",
        fontSize: 11,
        padding: "8px 10px",
      }}
      labelStyle={{ color: INK.secondary, fontWeight: 600, marginBottom: 2 }}
      formatter={((v: unknown, name: unknown) => {
        const s = series.find((x) => x.label === name || x.key === name);
        return [formatValue(Number(v), s?.format ?? format), s?.label ?? String(name ?? "")];
      }) as never}
    />
  );

  const refLine = reference ? (
    <ReferenceLine
      y={reference.value}
      stroke={INK.muted}
      strokeDasharray="4 4"
      label={{ value: reference.label, position: "right", fontSize: 9, fill: INK.muted }}
    />
  ) : null;

  switch (form) {
    // ── Time / trend ─────────────────────────────────────────────────────
    case "line":
    case "area":
    case "stackedArea": {
      const stacked = form === "stackedArea";
      return (
        <ComposedChart data={data} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={16} />
          <YAxis {...AXIS} width={44} tickFormatter={tickFmt} />
          {tip}
          {refLine}
          {series.map((s, i) =>
            form === "line" ? (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={colorOf(s, i)}
                strokeWidth={MARK.lineWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                // A dot only where the reader is pointing — a marker on every
                // point is noise, and the surface ring keeps it legible where
                // two lines cross.
                activeDot={{ r: MARK.dotRadius, strokeWidth: MARK.dotRingWidth, stroke: INK.surface }}
              />
            ) : (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stackId={stacked ? "a" : undefined}
                stroke={colorOf(s, i)}
                strokeWidth={MARK.lineWidth}
                fill={colorOf(s, i)}
                fillOpacity={stacked ? 0.5 : MARK.areaOpacity}
                activeDot={{ r: MARK.dotRadius, strokeWidth: MARK.dotRingWidth, stroke: INK.surface }}
              />
            ),
          )}
        </ComposedChart>
      );
    }

    // ── Magnitude ────────────────────────────────────────────────────────
    case "column":
    case "stackedColumn":
    case "histogram": {
      const stacked = form === "stackedColumn";
      return (
        <ComposedChart data={data} margin={{ top: 6, right: 12, left: 0, bottom: 0 }} barCategoryGap="18%">
          <CartesianGrid {...GRID} />
          <XAxis dataKey="label" {...AXIS} interval={form === "histogram" ? 0 : "preserveStartEnd"} minTickGap={8} />
          <YAxis {...AXIS} width={44} tickFormatter={tickFmt} />
          {tip}
          {refLine}
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stackId={stacked ? "a" : undefined}
              fill={colorOf(s, i)}
              maxBarSize={MARK.barMaxWidth}
              // 4px rounded data-end, square at the baseline.
              radius={stacked ? undefined : MARK.barRadius}
              // The 2px surface gap that separates touching segments.
              stroke={stacked ? INK.surface : undefined}
              strokeWidth={stacked ? MARK.gap : 0}
            />
          ))}
        </ComposedChart>
      );
    }

    case "bar": {
      // Horizontal — the right form when the categories have long names, which
      // for a lender is every branch and every officer.
      return (
        <ComposedChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }} barCategoryGap="18%">
          <CartesianGrid {...GRID} vertical horizontal={false} />
          <XAxis type="number" {...AXIS} tickFormatter={tickFmt} />
          <YAxis type="category" dataKey="label" {...AXIS} width={110} interval={0} />
          {tip}
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={colorOf(s, i)}
              maxBarSize={MARK.barMaxWidth}
              radius={MARK.barRadiusH}
            />
          ))}
        </ComposedChart>
      );
    }

    // ── Relationship ─────────────────────────────────────────────────────
    case "scatter": {
      // Two measures against each other — the x is the FIRST series, the y the
      // second, and a third (if present) sizes the point. This is the one form
      // where a second measure on a second scale is legitimate, because the two
      // scales are orthogonal axes rather than a shared vertical.
      const [xs, ys, zs] = series;
      const points = data.map((r) => ({
        label: r.label,
        x: Number(r[xs.key] ?? 0),
        y: Number(r[ys?.key ?? xs.key] ?? 0),
        z: zs ? Number(r[zs.key] ?? 0) : 60,
      }));
      return (
        <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid {...GRID} vertical />
          <XAxis type="number" dataKey="x" name={xs.label} {...AXIS} tickFormatter={tickFmt} />
          <YAxis type="number" dataKey="y" name={ys?.label ?? ""} {...AXIS} width={44} tickFormatter={tickFmt} />
          {zs && <ZAxis type="number" dataKey="z" range={[40, 400]} name={zs.label} />}
          <Tooltip
            cursor={{ strokeDasharray: "3 3", stroke: INK.grid }}
            contentStyle={{ borderRadius: 10, border: `1px solid ${INK.grid}`, fontSize: 11 }}
            formatter={((v: unknown, name: unknown) => [formatValue(Number(v), format), String(name ?? "")]) as never}
            labelFormatter={() => ""}
          />
          <Scatter
            data={points}
            fill={CATEGORICAL_ALL_PAIRS[0]}
            // The surface ring: overlapping points stay countable.
            stroke={INK.surface}
            strokeWidth={MARK.dotRingWidth}
          />
        </ScatterChart>
      );
    }

    // ── Part to whole ────────────────────────────────────────────────────
    case "donut": {
      const s = series[0];
      const total = data.reduce((t, r) => t + Number(r[s.key] ?? 0), 0);
      return (
        <PieChart margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
          <Tooltip
            contentStyle={{ borderRadius: 10, border: `1px solid ${INK.grid}`, fontSize: 11 }}
            formatter={((v: unknown, n: unknown) => [
              `${formatValue(Number(v), s.format ?? format)}${total ? ` · ${((Number(v) / total) * 100).toFixed(1)}%` : ""}`,
              String(n ?? ""),
            ]) as never}
          />
          <Pie
            data={data.map((r) => ({ name: r.label, value: Number(r[s.key] ?? 0) }))}
            dataKey="value"
            nameKey="name"
            innerRadius="58%"
            outerRadius="86%"
            // The 2px surface gap, as a stroke in the surface colour.
            stroke={INK.surface}
            strokeWidth={MARK.gap}
            paddingAngle={1}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={CATEGORICAL_ALL_PAIRS[i % CATEGORICAL_ALL_PAIRS.length]} />
            ))}
          </Pie>
        </PieChart>
      );
    }

    case "treemap": {
      const s = series[0];
      return (
        <Treemap
          data={data.map((r, i) => ({
            name: r.label,
            size: Math.max(0, Number(r[s.key] ?? 0)),
            fill: CATEGORICAL_ALL_PAIRS[i % CATEGORICAL_ALL_PAIRS.length],
          }))}
          dataKey="size"
          stroke={INK.surface}
          isAnimationActive={false}
        >
          <Tooltip
            contentStyle={{ borderRadius: 10, border: `1px solid ${INK.grid}`, fontSize: 11 }}
            formatter={((v: unknown) => formatValue(Number(v), s.format ?? format)) as never}
          />
        </Treemap>
      );
    }

    // ── Grid magnitude ───────────────────────────────────────────────────
    case "heatmap": {
      // Sequential by definition: ONE hue, more is darker. Recharts has no
      // heatmap, and it does not need one — a grid of divs is the honest
      // implementation and is a great deal more legible than a forced scatter.
      const s = series[0];
      const values = data.map((r) => Number(r[s.key] ?? 0));
      const max = Math.max(1, ...values);
      return (
        <div className="flex h-full flex-wrap content-start gap-[2px] overflow-auto">
          {data.map((r, i) => {
            const v = Number(r[s.key] ?? 0);
            const fill = seqAt(v / max);
            return (
              <div
                key={`${r.label}-${i}`}
                className="flex min-w-[64px] flex-1 flex-col justify-between rounded-[4px] px-2 py-1.5"
                style={{ backgroundColor: fill }}
                title={`${r.label}: ${formatValue(v, s.format ?? format)}`}
              >
                <span className="truncate text-[9px] font-medium" style={{ color: inkOn(fill) }}>{r.label}</span>
                <span className="text-[11px] font-bold tabular-nums" style={{ color: inkOn(fill) }}>
                  {formatValue(v, s.format ?? format, { compact: true })}
                </span>
              </div>
            );
          })}
        </div>
      );
    }

    // ── Profile ──────────────────────────────────────────────────────────
    case "radar": {
      return (
        <RadarChart data={data} margin={{ top: 8, right: 24, left: 24, bottom: 8 }}>
          <PolarGrid stroke={INK.grid} />
          <PolarAngleAxis dataKey="label" tick={{ fontSize: 10, fill: INK.muted }} />
          <PolarRadiusAxis tick={{ fontSize: 9, fill: INK.faint }} tickFormatter={tickFmt} />
          {tip}
          {series.map((s, i) => (
            <Radar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stroke={colorOf(s, i)}
              strokeWidth={MARK.lineWidth}
              fill={colorOf(s, i)}
              fillOpacity={MARK.areaOpacity}
            />
          ))}
        </RadarChart>
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STAT TILE — the form for a single number.
//
// Explicitly not a one-bar bar chart. A tile is label + value + a delta against
// a NAMED period + an optional sparkline, and the delta's colour comes from the
// measure's own goodDirection, never from the sign: PAR falling is good news in
// green, and a product that paints every increase green has taught its readers
// to stop reading the number.
// ─────────────────────────────────────────────────────────────────────────────
export function StatTile({
  label, value, format = "count", deltaPct, deltaGood, compareLabel, spark, hint, hero, breakdown,
}: {
  label: string;
  value: number | null;
  format?: MeasureFormat;
  deltaPct?: number | null;
  deltaGood?: boolean | null;
  compareLabel?: string;
  /** 12-ish points; the last one is drawn in the accent. */
  spark?: number[];
  hint?: string;
  /** The one number a view leads with. Exactly one per screen. */
  hero?: boolean;
  /**
   * The same measure per book, printed UNDER the combined figure when the cut is
   * split across entities. Deliberately additive: the total stays the headline,
   * because a general manager needs "how are we doing" before "how is each book
   * doing", and replacing one with the other loses the question they asked.
   */
  breakdown?: Array<{ label: string; value: number | null; color: string }>;
}) {
  const tone = deltaGood == null ? "text-ash-500" : deltaGood ? "text-emerald-600" : "text-rose-600";
  return (
    <div className="rounded-2xl border border-ash-900/10 bg-paper p-4" title={hint}>
      <p className="text-[10px] uppercase tracking-wide text-ash-500">{label}</p>
      {/* Proportional figures at display size; tabular is for columns only. */}
      <p className={`mt-1 font-bold leading-tight text-ash-900 ${hero ? "text-4xl" : "text-lg"}`}>
        {formatValue(value, format, { compact: !hero })}
      </p>
      {deltaPct != null && (
        <p className={`mt-0.5 text-[11px] font-semibold ${tone}`}>
          {deltaPct >= 0 ? "▲" : "▼"} {Math.abs(deltaPct).toFixed(1)}%
          {compareLabel && <span className="ml-1 font-normal text-ash-400">{compareLabel}</span>}
        </p>
      )}
      {breakdown && breakdown.length > 0 && (
        <div className="mt-2.5 space-y-1 border-t border-ash-900/[0.07] pt-2">
          {breakdown.map((b) => (
            <div key={b.label} className="flex items-baseline justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: b.color }} />
                <span className="truncate text-[11px] text-ash-500">{b.label}</span>
              </span>
              <span className="shrink-0 font-mono text-[11px] font-semibold tabular-nums text-ash-700">
                {formatValue(b.value, format, { compact: true })}
              </span>
            </div>
          ))}
        </div>
      )}
      {spark && spark.length > 1 && <Sparkline points={spark} />}
    </div>
  );
}

/** A 12-point trace. Context, not a chart — no axes, no labels, no tooltip. */
export function Sparkline({ points, color = CATEGORICAL[0], height = 24 }: { points: number[]; color?: string; height?: number }) {
  const path = useMemo(() => {
    const min = Math.min(...points);
    const max = Math.max(...points);
    const span = max - min || 1;
    const w = 100;
    return points
      .map((p, i) => {
        const x = (i / (points.length - 1)) * w;
        const y = height - ((p - min) / span) * (height - 4) - 2;
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }, [points, height]);

  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="mt-1.5 w-full" style={{ height }} aria-hidden>
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * METER — one ratio against a limit.
 *
 * The unfilled track is a LIGHTER STEP OF THE SAME RAMP rather than a neutral
 * grey, so the state reads across the whole bar and not only across the filled
 * part. That is the difference between a meter and a progress bar.
 */
export function Meter({
  label, value, max = 100, format = "percent", tone, caption,
}: {
  label: string;
  value: number;
  max?: number;
  format?: MeasureFormat;
  tone?: string;
  caption?: string;
}) {
  const pct = Math.min(100, Math.max(0, (value / (max || 1)) * 100));
  const fill = tone ?? CATEGORICAL[0];
  return (
    <div className="rounded-2xl border border-ash-900/10 bg-paper p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wide text-ash-500">{label}</p>
        <p className="text-sm font-bold tabular-nums text-ash-900">{formatValue(value, format)}</p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ backgroundColor: `${fill}22` }}>
        <div className="h-full rounded-r-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: fill }} />
      </div>
      {caption && <p className="mt-1.5 text-[11px] leading-snug text-ash-500">{caption}</p>}
    </div>
  );
}
