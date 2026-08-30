"use client";

// ─────────────────────────────────────────────────────────────────────────────
// ANALYSIS STUDIO — the customer & behaviour half, drawn cinematically.
//
// The book half (money flow, officers, products) is server-rendered above this.
// This is the DEMOGRAPHIC + REPAYMENT read the incumbents show as flat bars: who
// the customers are (age, gender, risk), where they are (region), how they repay
// (on-time / late / missed), and whether they come back (retention).
//
// House dataviz rules, followed on purpose: one axis per chart; categorical hues
// in a FIXED, CVD-validated order (blue #2a78d6 · orange #eb6834 · aqua #1baf7a —
// validated all-pairs both modes); status semantics use the reserved status ramp
// (good/warning/critical) WITH a legend, never colour alone; magnitude uses one
// blue; values live in ink, not the series colour; and every chart carries a
// "numbers" table beneath it — a chart you can't check is one you shouldn't act on.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  PieChart, Pie, Legend,
} from "recharts";
import { Users, PieChart as PieIcon, MapPin, CalendarCheck, Repeat, ShieldAlert } from "lucide-react";

// Validated palette (references/palette.md).
const BLUE = "#2a78d6", ORANGE = "#eb6834", AQUA = "#1baf7a", BLUE_DK = "#256abf";
const GOOD = "#0ca30c", WARN = "#fab219", CRIT = "#d03b3b";
const INK = "#0b0b0b", MUTED = "#898781", GRID = "#e1e0d9";
const RISK_TONE: Record<string, string> = { PRIME: GOOD, STRONG: BLUE, WATCH: WARN, HIGH: CRIT, Unscored: MUTED };

export type AnalysisData = {
  age: { bucket: string; count: number }[];
  gender: { label: string; count: number }[];
  risk: { band: string; count: number }[];
  regions: { name: string; customers: number }[];
  repayment: { month: string; onTime: number; late: number; missed: number }[];
  retention: { month: string; created: number; returning: number }[];
  headline: { customers: number; avgAge: number | null; repeatRatePct: number; onTimeRatePct: number | null };
};

const nf = (n: number) => n.toLocaleString();

export function AnalysisStudioCharts({ data }: { data: AnalysisData }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const genderColors = [BLUE, ORANGE, AQUA];
  const genderTotal = data.gender.reduce((s, g) => s + g.count, 0);

  return (
    <section className="mt-6">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-ash-500">Portfolio &amp; customers</h2>
        <span className="h-px flex-1 bg-ash-900/10" />
      </div>

      {/* Headline strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="Customers" value={nf(data.headline.customers)} />
        <Kpi label="Average age" value={data.headline.avgAge != null ? `${data.headline.avgAge} yrs` : "—"} />
        <Kpi label="Repeat customers" value={`${data.headline.repeatRatePct.toFixed(0)}%`} accent={AQUA} />
        <Kpi label="On-time repayment" value={data.headline.onTimeRatePct != null ? `${data.headline.onTimeRatePct.toFixed(0)}%` : "—"}
          accent={data.headline.onTimeRatePct != null && data.headline.onTimeRatePct >= 85 ? GOOD : WARN} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Age distribution — magnitude, one hue */}
        <Panel icon={Users} title="Customer age distribution" sub="Where the book sits by age band">
          <Chart mounted={mounted}>
            <BarChart data={data.age} margin={{ top: 8, right: 6, bottom: 0, left: -14 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: MUTED }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: MUTED }} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
              <Tooltip content={<Tip unit="customers" />} cursor={{ fill: "#00000008" }} />
              <Bar dataKey="count" name="Customers" fill={BLUE_DK} radius={[4, 4, 0, 0]} maxBarSize={48} />
            </BarChart>
          </Chart>
          <NumbersTable rows={data.age.map((a) => [a.bucket, nf(a.count)])} cols={["Age band", "Customers"]} />
        </Panel>

        {/* Gender — categorical donut (≤3, all-pairs safe) */}
        <Panel icon={PieIcon} title="Gender split" sub="Men · women · other, across the book">
          <div className="relative">
            <Chart mounted={mounted} height={196}>
              <PieChart>
                <Pie data={data.gender} dataKey="count" nameKey="label" innerRadius="60%" outerRadius="90%" paddingAngle={2} strokeWidth={0}>
                  {data.gender.map((g, i) => <Cell key={g.label} fill={genderColors[i % genderColors.length]} />)}
                </Pie>
                <Tooltip content={<Tip unit="customers" />} />
                <Legend verticalAlign="bottom" height={24} iconType="circle" formatter={(v) => <span style={{ color: INK, fontSize: 12 }}>{v}</span>} />
              </PieChart>
            </Chart>
            <div className="pointer-events-none absolute inset-x-0 top-[86px] flex flex-col items-center">
              <p className="text-[10px] uppercase tracking-wide text-ash-400">Customers</p>
              <p className="text-lg font-bold text-ash-800">{nf(genderTotal)}</p>
            </div>
          </div>
          <NumbersTable rows={data.gender.map((g) => [g.label, nf(g.count), pct(g.count, genderTotal)])} cols={["Gender", "Count", "Share"]} />
        </Panel>

        {/* Risk band — ordinal good→bad, labelled on the axis (colour is secondary) */}
        <Panel icon={ShieldAlert} title="Risk-band distribution" sub="Behavioural quality of the customer base">
          <Chart mounted={mounted}>
            <BarChart data={data.risk} margin={{ top: 8, right: 6, bottom: 0, left: -14 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="band" tick={{ fontSize: 11, fill: MUTED }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: MUTED }} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
              <Tooltip content={<Tip unit="customers" />} cursor={{ fill: "#00000008" }} />
              <Bar dataKey="count" name="Customers" radius={[4, 4, 0, 0]} maxBarSize={56}>
                {data.risk.map((r) => <Cell key={r.band} fill={RISK_TONE[r.band] ?? MUTED} />)}
              </Bar>
            </BarChart>
          </Chart>
          <NumbersTable rows={data.risk.map((r) => [r.band, nf(r.count)])} cols={["Band", "Customers"]} />
        </Panel>

        {/* Customers by region — magnitude, horizontal, one hue */}
        <Panel icon={MapPin} title="Customers by region" sub="Where the customers are, top branches">
          <Chart mounted={mounted}>
            <BarChart data={data.regions} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
              <CartesianGrid stroke={GRID} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: MUTED }} tickLine={false} axisLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: INK }} tickLine={false} axisLine={false} width={96} />
              <Tooltip content={<Tip unit="customers" />} cursor={{ fill: "#00000008" }} />
              <Bar dataKey="customers" name="Customers" fill={BLUE_DK} radius={[0, 4, 4, 0]} maxBarSize={20} />
            </BarChart>
          </Chart>
          <NumbersTable rows={data.regions.map((r) => [r.name, nf(r.customers)])} cols={["Region", "Customers"]} />
        </Panel>

        {/* Repayment trends — status stack, legend + reserved status ramp */}
        <Panel icon={CalendarCheck} title="Repayment trends" sub="Installments settled on time, late, or missed">
          <Chart mounted={mounted}>
            <BarChart data={data.repayment} margin={{ top: 8, right: 6, bottom: 0, left: -14 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: MUTED }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: MUTED }} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
              <Tooltip content={<Tip unit="installments" />} cursor={{ fill: "#00000008" }} />
              <Legend verticalAlign="top" height={26} iconType="circle" formatter={(v) => <span style={{ color: INK, fontSize: 12 }}>{v}</span>} />
              <Bar stackId="r" dataKey="onTime" name="On time" fill={GOOD} maxBarSize={38} />
              <Bar stackId="r" dataKey="late" name="Late" fill={WARN} maxBarSize={38} />
              <Bar stackId="r" dataKey="missed" name="Missed" fill={CRIT} radius={[3, 3, 0, 0]} maxBarSize={38} />
            </BarChart>
          </Chart>
          <NumbersTable rows={data.repayment.map((m) => [m.month, nf(m.onTime), nf(m.late), nf(m.missed)])} cols={["Month", "On time", "Late", "Missed"]} />
        </Panel>

        {/* Retention — new vs returning, categorical stack */}
        <Panel icon={Repeat} title="Customer retention" sub="New customers vs returning borrowers, by month">
          <Chart mounted={mounted}>
            <BarChart data={data.retention} margin={{ top: 8, right: 6, bottom: 0, left: -14 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: MUTED }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: MUTED }} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
              <Tooltip content={<Tip unit="loans" />} cursor={{ fill: "#00000008" }} />
              <Legend verticalAlign="top" height={26} iconType="circle" formatter={(v) => <span style={{ color: INK, fontSize: 12 }}>{v}</span>} />
              <Bar stackId="t" dataKey="created" name="New" fill={BLUE} maxBarSize={38} />
              <Bar stackId="t" dataKey="returning" name="Returning" fill={ORANGE} radius={[3, 3, 0, 0]} maxBarSize={38} />
            </BarChart>
          </Chart>
          <NumbersTable rows={data.retention.map((m) => [m.month, nf(m.created), nf(m.returning)])} cols={["Month", "New", "Returning"]} />
        </Panel>
      </div>
    </section>
  );
}

const pct = (n: number, total: number) => (total > 0 ? `${Math.round((n / total) * 100)}%` : "—");

function Kpi({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="glass px-3 py-2.5">
      <p className="text-[9px] uppercase tracking-wide text-ash-500">{label}</p>
      <p className="text-sm font-bold leading-tight" style={{ color: accent ?? INK }}>{value}</p>
    </div>
  );
}

function Panel({ icon: Icon, title, sub, children }: { icon: typeof Users; title: string; sub?: string; children: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="glass p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4" style={{ color: "var(--brand)" }} /> {title}</h3>
      {sub && <p className="mt-0.5 text-[11px] text-ash-500">{sub}</p>}
      <div className="mt-3">{children}</div>
    </motion.div>
  );
}

function Chart({ mounted, children, height = 208 }: { mounted: boolean; children: React.ReactElement; height?: number }) {
  return (
    <div style={{ height }} className="w-full">
      {mounted ? <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
        : <div className="h-full w-full animate-pulse rounded-xl bg-ash-900/5" />}
    </div>
  );
}

function Tip({ active, payload, label, unit }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string; payload?: { label?: string; bucket?: string; band?: string; name?: string } }>; label?: string; unit?: string }) {
  if (!active || !payload?.length) return null;
  const head = label ?? payload[0]?.payload?.label ?? payload[0]?.payload?.bucket ?? payload[0]?.payload?.band ?? payload[0]?.payload?.name;
  return (
    <div className="rounded-xl border border-ash-900/10 bg-paper/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
      {head && <p className="mb-1 font-semibold text-ash-700">{head}</p>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-ash-500"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />{p.name}</span>
          <span className="font-semibold tabular-nums text-ash-800">{(p.value ?? 0).toLocaleString()}{unit ? ` ${unit}` : ""}</span>
        </div>
      ))}
    </div>
  );
}

function NumbersTable({ rows, cols }: { rows: (string | number)[][]; cols: string[] }) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-[11px] text-ash-400">The numbers behind the chart</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-ash-500">
              {cols.map((c, i) => <th key={c} className={`py-1 pr-3 font-medium ${i > 0 ? "text-right" : ""}`}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} className="border-t border-ash-900/5">
                {r.map((cell, ci) => <td key={ci} className={`py-1 pr-3 ${ci > 0 ? "text-right tabular-nums text-ash-700" : "text-ash-600"}`}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
