"use client";

// Risk over time + model health — the recorded side of Credit Intelligence.
//
// The tiles above this panel are live; everything here comes from PortfolioRuns,
// so a Credit Manager can see direction, not just position: the at-risk share of
// the book as a line, who moved since the last run, and whether the scoring model
// itself is still calibrated against what the book actually did.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, RefreshCw, TrendingDown, TrendingUp, ShieldCheck, ShieldAlert, ShieldQuestion } from "lucide-react";
import type { TrendPoint } from "@/lib/intelligence/portfolio";
import type { DriftReport, DriftVerdict } from "@/lib/intelligence/drift";

type LatestLite = {
  ranAt: string;
  trigger: string;
  policy: string;
  drift: DriftReport | null;
  counts: { entered: number; left: number; escalated: number; improved: number };
} | null;

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const kesShort = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(Math.round(n)));

// ── Sparkline ─────────────────────────────────────────────────────────────────
// One series per tile (never two scales on one plot); the line wears the series
// colour, every number stays in ink. Hover names the exact run and value.

function Sparkline({ points, color, format }: { points: { x: string; y: number }[]; color: string; format: (y: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 240, H = 56, PAD = 4;
  const ys = points.map((p) => p.y);
  const min = Math.min(...ys), max = Math.max(...ys);
  const span = max - min || 1;
  const px = (i: number) => (points.length === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (points.length - 1));
  const py = (y: number) => H - PAD - ((y - min) / span) * (H - 2 * PAD);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(1)},${py(p.y).toFixed(1)}`).join(" ");
  const area = `${d} L${px(points.length - 1).toFixed(1)},${H - PAD} L${px(0).toFixed(1)},${H - PAD} Z`;

  return (
    <div className="relative mt-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-14"
        role="img"
        aria-label={points.map((p) => `${p.x}: ${format(p.y)}`).join(", ")}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * W;
          let best = 0;
          for (let i = 1; i < points.length; i++) if (Math.abs(px(i) - x) < Math.abs(px(best) - x)) best = i;
          setHover(best);
        }}
      >
        <path d={area} fill={color} opacity={0.12} />
        <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {hover != null && (
          <>
            <line x1={px(hover)} x2={px(hover)} y1={PAD} y2={H - PAD} stroke={color} strokeWidth={1} opacity={0.35} />
            <circle cx={px(hover)} cy={py(points[hover].y)} r={4} fill={color} stroke="#fff" strokeWidth={2} />
          </>
        )}
        {hover == null && points.length > 0 && (
          <circle cx={px(points.length - 1)} cy={py(points[points.length - 1].y)} r={3.5} fill={color} stroke="#fff" strokeWidth={1.5} />
        )}
      </svg>
      {hover != null && (
        <div className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 rounded-md border border-zinc-900/10 bg-white px-2 py-0.5 text-[10px] font-medium text-zinc-700 shadow-sm whitespace-nowrap">
          {points[hover].x} · {format(points[hover].y)}
        </div>
      )}
    </div>
  );
}

// ── Model health ──────────────────────────────────────────────────────────────

const VERDICT_UI: Record<DriftVerdict, { label: string; color: string; Icon: typeof ShieldCheck }> = {
  STABLE: { label: "Stable", color: "#059669", Icon: ShieldCheck },
  WATCH: { label: "Watch", color: "#d97706", Icon: ShieldAlert },
  DRIFTING: { label: "Drifting", color: "#e11d48", Icon: ShieldAlert },
  INSUFFICIENT: { label: "Not enough outcomes yet", color: "#71717a", Icon: ShieldQuestion },
};

function VerdictPill({ verdict }: { verdict: DriftVerdict }) {
  const v = VERDICT_UI[verdict];
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ color: v.color, backgroundColor: `${v.color}14`, border: `1px solid ${v.color}33` }}>
      <v.Icon className="h-3 w-3" /> {v.label}
    </span>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function TrendPanel({ trend, latest }: { trend: TrendPoint[]; latest: LatestLite }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runNow = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/console/intelligence/run", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.success) setError(data.message ?? "The scan failed.");
      else router.refresh();
    } catch {
      setError("The scan failed.");
    } finally {
      setRunning(false);
    }
  };

  const day = (iso: string) => new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short" });
  const pctPoints = trend.map((t) => ({ x: day(t.ranAt), y: t.atRiskPct }));
  const lossPoints = trend.map((t) => ({ x: day(t.ranAt), y: t.projectedLoss }));
  const last = trend.length ? trend[trend.length - 1] : null;
  const prev = trend.length > 1 ? trend[trend.length - 2] : null;
  const delta = last && prev ? last.atRiskPct - prev.atRiskPct : null;

  const m = latest?.counts;
  const movement: { label: string; tone: "bad" | "good" }[] = [];
  if (m) {
    if (m.entered > 0) movement.push({ label: `${m.entered} new on watchlist`, tone: "bad" });
    if (m.escalated > 0) movement.push({ label: `${m.escalated} escalated`, tone: "bad" });
    if (m.improved > 0) movement.push({ label: `${m.improved} improved`, tone: "good" });
    if (m.left > 0) movement.push({ label: `${m.left} recovered off the list`, tone: "good" });
  }

  const drift = latest?.drift ?? null;

  return (
    <section className="mt-7">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Activity className="h-4 w-4" style={{ color: "var(--brand)" }} /> Risk over time
          {last && <span className="text-zinc-400 font-normal">· scored nightly under the {last.policy} policy</span>}
        </h2>
        <div className="flex items-center gap-2">
          {latest && (
            <span className="text-[11px] text-zinc-400">
              Last run {new Date(latest.ranAt).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{latest.trigger === "manual" ? " · manual" : ""}
            </span>
          )}
          <button
            onClick={runNow}
            disabled={running}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-900/15 bg-white/70 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-white disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} /> {running ? "Scoring…" : "Run now"}
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}

      {trend.length === 0 ? (
        <div className="mt-3 glass p-6 text-center">
          <p className="text-sm font-semibold">No runs recorded yet</p>
          <p className="mt-1 text-sm text-zinc-500 max-w-xl mx-auto">
            The book is scored automatically every night, and each run becomes a point on this line. Run one now to lay down the first point.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="glass p-3.5">
              <div className="flex items-baseline justify-between">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">At risk · % of book</p>
                {delta != null && delta !== 0 && (
                  <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${delta > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                    {delta > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {delta > 0 ? "+" : ""}{delta.toFixed(1)}pp
                  </span>
                )}
              </div>
              <p className="mt-1 text-base font-bold" style={{ color: "#d97706" }}>{last!.atRiskPct.toFixed(1)}%</p>
              <Sparkline points={pctPoints} color="#d97706" format={(y) => `${y.toFixed(1)}% of book`} />
            </div>
            <div className="glass p-3.5">
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">Projected loss</p>
              <p className="mt-1 text-base font-bold" style={{ color: "#e11d48" }}>{kes(last!.projectedLoss)}</p>
              <Sparkline points={lossPoints} color="#e11d48" format={(y) => `KES ${kesShort(y)}`} />
            </div>
          </div>

          {movement.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-zinc-500">Since the previous run:</span>
              {movement.map((c) => (
                <span
                  key={c.label}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${c.tone === "bad" ? "text-rose-700 bg-rose-50 border-rose-200" : "text-emerald-700 bg-emerald-50 border-emerald-200"}`}
                >
                  {c.label}
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {drift && (
        <div className="mt-4 glass p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-sm font-semibold">Model health</h3>
            <VerdictPill verdict={drift.status} />
          </div>
          <p className="mt-1 text-[11px] text-zinc-400 max-w-2xl">
            Measured from the closed ML loop — every score the platform issued, joined back to what the loan actually did.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-zinc-900/10 bg-white/60 p-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Calibration</p>
                <VerdictPill verdict={drift.calibration.verdict} />
              </div>
              {drift.calibration.realisedRate != null && (
                <p className="mt-1.5 text-sm font-bold text-zinc-800">
                  {(drift.calibration.realisedRate * 100).toFixed(1)}% realised
                  <span className="font-normal text-zinc-500"> vs {(drift.calibration.predictedRate! * 100).toFixed(1)}% predicted</span>
                </p>
              )}
              <p className="mt-1 text-xs text-zinc-500">{drift.calibration.note}</p>
            </div>
            <div className="rounded-lg border border-zinc-900/10 bg-white/60 p-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Applicant population</p>
                <VerdictPill verdict={drift.population.verdict} />
              </div>
              {drift.population.psi != null && (
                <p className="mt-1.5 text-sm font-bold text-zinc-800">
                  PSI {drift.population.psi.toFixed(2)}
                  <span className="font-normal text-zinc-500"> · mean score {drift.population.baselineMeanScore} → {drift.population.recentMeanScore}</span>
                </p>
              )}
              <p className="mt-1 text-xs text-zinc-500">{drift.population.note}</p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
