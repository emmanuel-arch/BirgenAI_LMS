"use client";

// ─────────────────────────────────────────────────────────────────────────────
// The staff console home — a cinematic, interactive portfolio command centre.
//
// This replaces the old launcher grid as the first thing staff see. It is the
// "PowerBI in the product" surface: one page that blends the KPIs, the flows,
// the risk aging, the collection gauges and the approval pipeline, with live
// controls — switch the date range, recut by role scope, change chart type, and
// overlay the comparison period. The numbers come from `simulate()` for an empty
// book (a new lender on demo day); a live book swaps in real figures with the
// same shape (the MainDashboard metric contract).
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState, useEffect, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  ResponsiveContainer, ComposedChart, Area, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, BarChart,
} from "recharts";
import { Banknote, Landmark, Gauge, ArrowUpRight, ArrowDownRight, Activity } from "lucide-react";
import {
  simulate, applyLive, RANGES, SCOPES, KES, KESc, compact, pct,
  type RangeKey, type Scope, type SeriesPoint, type LiveSnapshot,
} from "@/lib/dashboard/model";

type ChartType = "area" | "bar" | "line";

const TONE: Record<string, string> = { good: "#16a34a", warn: "#f59e0b", high: "#f97316", bad: "#ef4444" };

export default function CinematicDashboard({
  orgName, orgSlug, accent, accent2, initialScope, canPickScope, live,
}: {
  orgName: string;
  orgSlug: string;
  accent: string;
  accent2: string;
  initialScope: Scope;
  canPickScope: boolean;
  live?: LiveSnapshot | null;
}) {
  const [range, setRange] = useState<RangeKey>("30d");
  const [scope, setScope] = useState<Scope>(initialScope);
  const [chart, setChart] = useState<ChartType>("area");
  const [compare, setCompare] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const data = useMemo(() => {
    const sim = simulate(range, scope, { seed: orgSlug });
    // Live snapshot overrides range-invariant KPIs only on the whole-book view at
    // the natural period; drilled-down scopes fall back to the modeled cut.
    return live && scope === "entity" ? applyLive(sim, live) : sim;
  }, [range, scope, orgSlug, live]);
  const k = data.kpis;

  // Deltas vs the comparison period drive the trend chips.
  const sum = (s: SeriesPoint[], f: (p: SeriesPoint) => number) => s.reduce((a, p) => a + f(p), 0);
  const dDisb = deltaPct(sum(data.series, (p) => p.disbursed), sum(data.prevSeries, (p) => p.disbursed));
  const dColl = deltaPct(sum(data.series, (p) => p.collected), sum(data.prevSeries, (p) => p.collected));

  const green = "#16a34a";

  return (
    <div className="space-y-4">
      {/* ── Command bar ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Portfolio Command</h1>
            <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
              style={{ color: accent, backgroundColor: `${accent}14` }}>
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ backgroundColor: accent }} />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent }} />
              </span>
              {data.simulated ? "Showcase" : "Live"}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-zinc-500">
            {orgName} · {SCOPES.find((s) => s.key === scope)?.label} · updated moments ago
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canPickScope && (
            <Segmented value={scope} onChange={(v) => setScope(v as Scope)}
              options={SCOPES.map((s) => ({ value: s.key, label: s.label }))} accent={accent} />
          )}
          <Segmented value={range} onChange={(v) => setRange(v as RangeKey)}
            options={RANGES.map((r) => ({ value: r.key, label: r.short }))} accent={accent} />
        </div>
      </div>

      {/* ── KPI hero row ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={Landmark} label="Outstanding book" value={KESc(k.olb)} accent={accent}
          delta={deltaPct(k.olb, k.olb * 0.94)} spark={data.spark.olb} sub={`${k.activeLoans.toLocaleString()} active loans`} />
        <StatTile icon={Gauge} label="PAR 30" value={pct(k.par)} accent={k.par > 10 ? TONE.bad : k.par > 6 ? TONE.warn : green}
          delta={-deltaPct(k.par, k.par * 1.05)} spark={data.spark.par} invertDelta sub={KESc(k.totalArrears)} />
        <StatTile icon={Banknote} label={range === "today" ? "Disbursed today" : "Disbursed"} value={KESc(k.disbursedAmount)} accent={accent}
          delta={dDisb} spark={data.spark.disbursed} sub={`${k.disbursedCount} loans`} />
        <StatTile icon={Activity} label={range === "today" ? "Collected today" : "Collected"} value={KESc(k.collectedAmount)} accent={green}
          delta={dColl} spark={data.spark.collections} sub={`CPR ${pct(k.cpr)}`} />
      </div>

      {/* ── Production + composition ────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title="Production & collections" subtitle="Money out vs money in"
          right={
            <div className="flex items-center gap-2">
              <button onClick={() => setCompare((c) => !c)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ring-1 transition-colors ${compare ? "text-white" : "text-zinc-500 ring-zinc-900/10 hover:bg-zinc-900/5"}`}
                style={compare ? { backgroundColor: accent, borderColor: accent } : undefined}>
                vs previous
              </button>
              <Segmented value={chart} onChange={(v) => setChart(v as ChartType)} accent={accent}
                options={[{ value: "area", label: "Area" }, { value: "bar", label: "Bars" }, { value: "line", label: "Line" }]} />
            </div>
          }>
          <div className="h-72 w-full">
            {mounted ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={mergeCompare(data.series, compare ? data.prevSeries : null)} margin={{ top: 8, right: 6, bottom: 0, left: -8 }}>
                  <defs>
                    <linearGradient id="gDisb" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={accent} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={accent} stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="gColl" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={green} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={green} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#00000010" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#71717a" }} tickLine={false} axisLine={false} minTickGap={16} />
                  <YAxis tick={{ fontSize: 11, fill: "#71717a" }} tickLine={false} axisLine={false} tickFormatter={(v) => compact(v as number)} width={44} />
                  <Tooltip content={<ChartTip />} />
                  {chart === "area" && <>
                    <Area type="monotone" dataKey="disbursed" name="Disbursed" stroke={accent} strokeWidth={2} fill="url(#gDisb)" />
                    <Area type="monotone" dataKey="collected" name="Collected" stroke={green} strokeWidth={2} fill="url(#gColl)" />
                  </>}
                  {chart === "bar" && <>
                    <Bar dataKey="disbursed" name="Disbursed" fill={accent} radius={[4, 4, 0, 0]} maxBarSize={22} />
                    <Bar dataKey="collected" name="Collected" fill={green} radius={[4, 4, 0, 0]} maxBarSize={22} />
                  </>}
                  {chart === "line" && <>
                    <Line type="monotone" dataKey="disbursed" name="Disbursed" stroke={accent} strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="collected" name="Collected" stroke={green} strokeWidth={2.5} dot={false} />
                  </>}
                  {compare && <>
                    <Line type="monotone" dataKey="disbursedPrev" name="Disbursed (prev)" stroke={accent} strokeWidth={1.5} strokeDasharray="4 4" dot={false} opacity={0.55} />
                    <Line type="monotone" dataKey="collectedPrev" name="Collected (prev)" stroke={green} strokeWidth={1.5} strokeDasharray="4 4" dot={false} opacity={0.55} />
                  </>}
                </ComposedChart>
              </ResponsiveContainer>
            ) : <ChartSkeleton />}
          </div>
          <Legend items={[{ c: accent, label: "Disbursed" }, { c: green, label: "Collected" }]} />
        </Panel>

        {/* Portfolio composition donut */}
        <Panel title="Portfolio quality" subtitle={`PQS ${pct(k.pqs)} · ${k.cleanOlbCount.toLocaleString()} clean loans`}>
          <div className="relative h-56">
            {mounted ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.composition} dataKey="value" nameKey="name" innerRadius="64%" outerRadius="92%" paddingAngle={2} strokeWidth={0}>
                    {data.composition.map((s) => <Cell key={s.name} fill={s.color} />)}
                  </Pie>
                  <Tooltip content={<ChartTip money />} />
                </PieChart>
              </ResponsiveContainer>
            ) : <ChartSkeleton />}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <p className="text-[10px] uppercase tracking-wide text-zinc-400">Book value</p>
              <p className="text-xl font-bold" style={{ color: accent }}>{KESc(k.olb)}</p>
            </div>
          </div>
          <div className="mt-2 space-y-1.5">
            {data.composition.map((s) => (
              <div key={s.name} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} />{s.name}</span>
                <span className="font-semibold text-zinc-700">{KESc(s.value)}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* ── Risk aging + gauges + pipeline ──────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title="Arrears aging" subtitle="Where the risk sits, by days overdue">
          <div className="h-56 w-full">
            {mounted ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.aging} margin={{ top: 8, right: 6, bottom: 0, left: -8 }}>
                  <CartesianGrid stroke="#00000010" vertical={false} />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: "#71717a" }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#71717a" }} tickLine={false} axisLine={false} tickFormatter={(v) => compact(v as number)} width={44} />
                  <Tooltip content={<ChartTip money />} />
                  <Bar dataKey="amount" radius={[6, 6, 0, 0]} maxBarSize={54}>
                    {data.aging.map((b) => <Cell key={b.bucket} fill={TONE[b.tone]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <ChartSkeleton />}
          </div>
        </Panel>

        <Panel title="Collection health" subtitle="Rates that decide the month">
          <div className="grid grid-cols-3 gap-2">
            <Radial label="Today" value={k.todayCR} color={accent} />
            <Radial label="CPR (mo)" value={k.cpr} color={green} />
            <Radial label="PQS" value={k.pqs} color={k.pqs > 88 ? green : TONE.warn} />
          </div>
          <div className="mt-4 space-y-2">
            <MiniStat label="Due today" value={KESc(k.dueAmount)} sub={`${k.dueCount} installments`} />
            <MiniStat label="Paid today" value={KESc(k.paidAmount)} sub={`${k.paidCount} settled`} tone={green} />
            <MiniStat label="Unpaid today" value={KESc(k.unpaidAmount)} sub={`${k.unpaidCount} outstanding`} tone={TONE.warn} />
          </div>
        </Panel>
      </div>

      {/* ── Approval pipeline + product mix + NPL ───────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Approval pipeline" subtitle="Applications awaiting a decision">
          <div className="space-y-2.5">
            <Pipe label="At initiator" count={k.atInitiator} total={k.atInitiator + k.atAuthorizer + k.atValidator} color={accent} />
            <Pipe label="At authorizer" count={k.atAuthorizer} total={k.atInitiator + k.atAuthorizer + k.atValidator} color={accent2} />
            <Pipe label="At validator" count={k.atValidator} total={k.atInitiator + k.atAuthorizer + k.atValidator} color={green} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <MiniStat label="New customers" value={k.newCustomers.toLocaleString()} sub="this month" />
            <MiniStat label="Declined" value={k.declinedLoans.toLocaleString()} sub="this month" tone={TONE.warn} />
          </div>
        </Panel>

        <Panel title="Product mix" subtitle="Book split by product">
          <div className="space-y-2">
            {data.productMix.map((p, i) => {
              const share = (p.olb / data.kpis.olb) * 100;
              const c = [accent, accent2, green, TONE.warn, TONE.high][i % 5];
              return (
                <div key={p.name}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-zinc-700">{p.name}</span>
                    <span className="text-zinc-500">{KESc(p.olb)} · {p.count}</span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-zinc-900/5">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${share}%` }} transition={{ duration: 0.7, ease: "easeOut" }}
                      className="h-full rounded-full" style={{ backgroundColor: c }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel title="NPL watch" subtitle="Non-performing, and what's coming back">
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-bold" style={{ color: TONE.bad }}>{KESc(k.npl)}</p>
            <span className="text-xs text-zinc-500">{k.nplCount} loans</span>
          </div>
          <div className="mt-3 space-y-2">
            <MiniStat label="Recovered this month" value={KESc(k.nplCollectedMonth)} sub="from NPL book" tone={green} />
            <MiniStat label="Arrears paid today" value={KESc(k.arrearsPaid)} sub="chasing the tail" tone={green} />
            <MiniStat label="Prepaid today" value={KESc(k.prepaidAmount)} sub={`${k.prepaidCount} ahead of schedule`} />
          </div>
        </Panel>
      </div>

      {/* ── Branch league table ─────────────────────────────────────── */}
      <Panel title="Branch performance" subtitle="Book and risk by branch"
        right={<span className="text-[11px] text-zinc-400">{data.branches.length} branches</span>}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-400">
                <th className="pb-2 font-semibold">Branch</th>
                <th className="pb-2 text-right font-semibold">Outstanding</th>
                <th className="pb-2 text-right font-semibold">PAR</th>
                <th className="pb-2 text-right font-semibold">Officers</th>
                <th className="pb-2 text-right font-semibold">Health</th>
              </tr>
            </thead>
            <tbody>
              {data.branches.map((b) => (
                <tr key={b.name} className="border-t border-zinc-900/5">
                  <td className="py-2.5 font-medium">{b.name}</td>
                  <td className="py-2.5 text-right tabular-nums">{KESc(b.olb)}</td>
                  <td className="py-2.5 text-right tabular-nums" style={{ color: b.par > 10 ? TONE.bad : b.par > 6 ? TONE.warn : green }}>{pct(b.par)}</td>
                  <td className="py-2.5 text-right tabular-nums text-zinc-500">{b.officers}</td>
                  <td className="py-2.5">
                    <div className="ml-auto h-1.5 w-24 overflow-hidden rounded-full bg-zinc-900/5">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(6, 100 - b.par * 5)}%`, backgroundColor: b.par > 10 ? TONE.bad : b.par > 6 ? TONE.warn : green }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────
function deltaPct(now: number, prev: number): number {
  if (!prev) return 0;
  return ((now - prev) / prev) * 100;
}
function mergeCompare(cur: SeriesPoint[], prev: SeriesPoint[] | null) {
  return cur.map((p, i) => ({
    ...p,
    disbursedPrev: prev?.[i]?.disbursed ?? null,
    collectedPrev: prev?.[i]?.collected ?? null,
  }));
}

function Segmented({ value, onChange, options, accent }: {
  value: string; onChange: (v: string) => void; accent: string; options: { value: string; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-xl bg-zinc-900/5 p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={o.value} onClick={() => onChange(o.value)}
            className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${active ? "text-white shadow-sm" : "text-zinc-500 hover:text-zinc-800"}`}
            style={active ? { backgroundColor: accent } : undefined}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Panel({ title, subtitle, right, children, className = "" }: {
  title: string; subtitle?: string; right?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
      className={`glass rounded-2xl p-4 sm:p-5 ${className}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {subtitle && <p className="text-[11px] text-zinc-500">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </motion.section>
  );
}

function StatTile({ icon: Icon, label, value, sub, delta, spark, accent, invertDelta }: {
  icon: typeof Landmark; label: string; value: string; sub?: string; delta?: number; spark?: number[]; accent: string; invertDelta?: boolean;
}) {
  const up = (delta ?? 0) >= 0;
  const good = invertDelta ? !up : up;
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
      className="glass relative overflow-hidden rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: `${accent}14`, color: accent }}>
          <Icon className="h-4 w-4" />
        </span>
        {delta != null && (
          <span className="inline-flex items-center gap-0.5 text-[11px] font-bold" style={{ color: good ? "#16a34a" : "#ef4444" }}>
            {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>
      <p className="mt-2.5 text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-0.5 text-lg font-bold leading-tight sm:text-xl">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-zinc-400">{sub}</p>}
      {spark && spark.length > 1 && <Sparkline data={spark} color={accent} />}
    </motion.div>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const w = 100, h = 26;
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / span) * (h - 4) - 2}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="mt-2 h-6 w-full">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
    </svg>
  );
}

function Radial({ label, value, color }: { label: string; value: number; color: string }) {
  const v = Math.max(0, Math.min(100, value));
  const r = 26, c = 2 * Math.PI * r, off = c - (v / 100) * c;
  return (
    <div className="flex flex-col items-center">
      <div className="relative h-[64px] w-[64px]">
        <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
          <circle cx="32" cy="32" r={r} fill="none" stroke="#00000010" strokeWidth={7} />
          <motion.circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth={7} strokeLinecap="round"
            strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: off }} transition={{ duration: 0.9, ease: "easeOut" }} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-sm font-bold" style={{ color }}>{Math.round(v)}%</div>
      </div>
      <p className="mt-1 text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
    </div>
  );
}

function MiniStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-zinc-900/5 bg-white/50 px-3 py-2">
      <div>
        <p className="text-[11px] text-zinc-500">{label}</p>
        {sub && <p className="text-[10px] text-zinc-400">{sub}</p>}
      </div>
      <p className="text-sm font-bold tabular-nums" style={{ color: tone ?? "#18181b" }}>{value}</p>
    </div>
  );
}

function Pipe({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const share = total > 0 ? (count / total) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-zinc-700">{label}</span>
        <span className="font-bold tabular-nums" style={{ color }}>{count}</span>
      </div>
      <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-zinc-900/5">
        <motion.div initial={{ width: 0 }} animate={{ width: `${share}%` }} transition={{ duration: 0.7, ease: "easeOut" }}
          className="h-full rounded-full" style={{ backgroundColor: color }} />
      </div>
    </div>
  );
}

function Legend({ items }: { items: { c: string; label: string }[] }) {
  return (
    <div className="mt-2 flex items-center gap-4">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5 text-[11px] text-zinc-500">
          <span className="h-2 w-3 rounded-sm" style={{ backgroundColor: i.c }} /> {i.label}
        </span>
      ))}
    </div>
  );
}

function ChartSkeleton() {
  return <div className="h-full w-full animate-pulse rounded-xl bg-zinc-900/5" />;
}

// Recharts tooltip payload is loosely typed; keep the surface minimal.
function ChartTip({ active, payload, label, money }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string }>; label?: string; money?: boolean }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-zinc-900/10 bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
      {label && <p className="mb-1 font-semibold text-zinc-700">{label}</p>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-zinc-500"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />{p.name}</span>
          <span className="font-semibold tabular-nums text-zinc-800">{money ? KES(p.value ?? 0) : KESc(p.value ?? 0)}</span>
        </div>
      ))}
    </div>
  );
}
