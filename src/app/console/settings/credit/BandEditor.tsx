"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE FACTOR CURVE — a scoring table you can see the shape of.
//
// A factor's bands are four numbers in a JSON array, and the difference between
// a fair lender and a brutal one is entirely in their spacing. "One day late
// costs 70 points" is invisible as `{ threshold: 3, points: 30 }` and obvious as
// a cliff. So the table is drawn as the step function it actually is: drag a
// divider to move a threshold, drag a plateau to change what that band awards.
//
// THE STEP FUNCTION IS NOT DECORATION — it is exactly what `bandFor()` computes.
// The array-order inversion that makes a `gte` factor read right-to-left lives in
// lib/scoring/band-geometry.ts, on its own, verified against the engine's own
// arithmetic. This file is the pixels and the pointer.
//
// The numeric table stays underneath. Dragging is for finding the shape; typing
// is for committing to 0.75 rather than 0.74.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, Move } from "lucide-react";
import {
  metricSpec, type FactorMetric, type ScoreFactor, type ScoreBandRule,
} from "@/lib/scoring/behaviour-policy";
import { bandGeometry, clampThreshold as clampBandThreshold } from "@/lib/scoring/band-geometry";

/** How each metric is drawn: where its axis runs, and how a value reads in words. */
const AXIS = {
  installment_paid_ratio: { max: 1.2, step: 0.01, fmt: (v: number) => `${Math.round(v * 100)}%`, axis: "of the installment paid" },
  days_late: { max: 30, step: 1, fmt: (v: number) => `${v} day${v === 1 ? "" : "s"}`, axis: "days past the due date" },
  arrears_streak: { max: 8, step: 1, fmt: (v: number) => `${v} in a row`, axis: "consecutive missed installments" },
  days_early: { max: 21, step: 1, fmt: (v: number) => `${v} day${v === 1 ? "" : "s"}`, axis: "days ahead of the due date" },
  limit_utilisation: { max: 1.5, step: 0.01, fmt: (v: number) => `${Math.round(v * 100)}%`, axis: "of their limit drawn" },
} satisfies Record<FactorMetric, { max: number; step: number; fmt: (v: number) => string; axis: string }>;

const H = 176;
const PAD = { l: 34, r: 14, t: 14, b: 30 };

export function BandEditor({
  factor, onChange,
}: {
  factor: ScoreFactor;
  onChange: (next: ScoreFactor) => void;
}) {
  const spec = metricSpec(factor.metric);
  const axis = AXIS[factor.metric];
  const svgRef = useRef<SVGSVGElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(560);
  const [selected, setSelected] = useState<number | null>(null);
  const drag = useRef<{ kind: "threshold" | "points"; band: number } | null>(null);

  // Pixel units, so a pointer position IS a user-space coordinate and hit-testing
  // needs no inverse transform.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    setW(Math.max(280, el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);

  // The axis must always contain the lender's own numbers, however far out they sit.
  const dmax = useMemo(() => {
    const highest = Math.max(0, ...factor.bands.map((b) => b.threshold ?? 0));
    return Math.max(axis.max, Math.ceil((highest * 1.25) / axis.step) * axis.step);
  }, [factor.bands, axis]);

  const plotW = Math.max(40, w - PAD.l - PAD.r);
  const plotH = H - PAD.t - PAD.b;
  const X = useCallback((v: number) => PAD.l + (v / dmax) * plotW, [dmax, plotW]);
  const Y = useCallback((p: number) => PAD.t + (1 - Math.max(0, Math.min(100, p)) / 100) * plotH, [plotH]);

  const { segments, dividers } = useMemo(
    () => bandGeometry(factor.bands, spec.compare, dmax),
    [factor.bands, spec.compare, dmax],
  );

  const setBands = (bands: ScoreBandRule[]) => onChange({ ...factor, bands });

  const patch = (i: number, p: Partial<ScoreBandRule>) =>
    setBands(factor.bands.map((b, idx) => (idx === i ? { ...b, ...p } : b)));

  const clampThreshold = (i: number, v: number) =>
    clampBandThreshold(factor.bands, spec.compare, i, v, dmax, axis.step);

  const snap = (v: number) => Math.round(v / axis.step) * axis.step;
  const tidy = (v: number) => Math.round(v * 1000) / 1000;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!d || !rect) return;
    if (d.kind === "threshold") {
      const v = ((e.clientX - rect.left - PAD.l) / plotW) * dmax;
      patch(d.band, { threshold: tidy(clampThreshold(d.band, snap(v))) });
    } else {
      const p = (1 - (e.clientY - rect.top - PAD.t) / plotH) * 100;
      patch(d.band, { points: Math.max(0, Math.min(100, Math.round(p))) });
    }
  };

  const start = (e: React.PointerEvent, kind: "threshold" | "points", band: number) => {
    e.preventDefault();
    drag.current = { kind, band };
    setSelected(band);
    svgRef.current?.setPointerCapture(e.pointerId);
  };
  const end = () => { drag.current = null; };

  const addBand = () => {
    const b = [...factor.bands];
    const last = b[b.length - 1];
    const prev = b.length >= 2 ? b[b.length - 2].threshold ?? 0 : null;
    // Slot the new rung between the last real threshold and the end of the axis.
    const seed = prev === null
      ? snap(dmax / 2)
      : spec.compare === "lte" ? tidy(prev + Math.max(axis.step, (dmax - prev) / 2)) : tidy(prev / 2);
    b.splice(b.length - 1, 0, {
      threshold: tidy(clampThreshold(b.length - 1, seed)),
      points: Math.round((last.points + (b[b.length - 2]?.points ?? 100)) / 2),
      label: "New band",
    });
    setBands(b);
  };

  const removeBand = (i: number) => {
    if (factor.bands.length <= 2) return;
    setSelected(null);
    setBands(factor.bands.filter((_, idx) => idx !== i));
  };

  const ticks = useMemo(() => {
    const count = 5;
    return Array.from({ length: count + 1 }, (_, i) => tidy((dmax / count) * i));
  }, [dmax]);

  return (
    <div>
      <div ref={wrapRef} className="rounded-xl bg-[color:var(--ink)]/[0.02] px-1 pb-1 pt-2 ring-1 ring-[color:var(--ink)]/[0.06]">
        <svg
          ref={svgRef}
          width="100%"
          height={H}
          viewBox={`0 0 ${w} ${H}`}
          className="block touch-none select-none"
          onPointerMove={onMove}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={end}
          role="group"
          aria-label={`${factor.label} scoring curve`}
        >
          {/* Points gridlines — the score is out of 100 and should look it. */}
          {[0, 25, 50, 75, 100].map((p) => (
            <g key={p}>
              <line x1={PAD.l} x2={w - PAD.r} y1={Y(p)} y2={Y(p)} stroke="rgba(15,15,25,0.07)" strokeWidth={1} />
              <text x={PAD.l - 7} y={Y(p) + 3.5} textAnchor="end" fontSize={9} fill="var(--ink-faint)">{p}</text>
            </g>
          ))}

          {segments.map((s, i) => {
            const band = factor.bands[s.band];
            if (!band) return null;
            const x0 = X(Math.max(0, Math.min(dmax, s.x0)));
            const x1 = X(Math.max(0, Math.min(dmax, s.x1)));
            const y = Y(band.points);
            const on = selected === s.band;
            const width = Math.max(0, x1 - x0);
            return (
              <g key={`${s.band}-${i}`}>
                {/* The area is what makes a cliff read as a cliff. */}
                <rect
                  x={x0} y={y} width={width} height={Math.max(0, PAD.t + plotH - y)}
                  fill="var(--brand)" opacity={on ? 0.2 : 0.1}
                />
                {/* Grab-anywhere plateau: drag up or down to change the points. */}
                <rect
                  x={x0} y={y - 9} width={width} height={18}
                  fill="transparent" style={{ cursor: "ns-resize" }}
                  onPointerDown={(e) => start(e, "points", s.band)}
                />
                <line x1={x0} x2={x1} y1={y} y2={y} stroke="var(--brand)" strokeWidth={on ? 3.5 : 2.5} strokeLinecap="round" />
                {width > 46 && (
                  <text x={x0 + width / 2} y={y - 14} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--ink)">
                    {band.points}
                  </text>
                )}
              </g>
            );
          })}

          {dividers.map((d) => {
            const x = X(Math.max(0, Math.min(dmax, d.x)));
            return (
              <g key={d.band}>
                <line x1={x} x2={x} y1={PAD.t} y2={PAD.t + plotH} stroke="rgba(15,15,25,0.28)" strokeWidth={1} strokeDasharray="3 3" />
                <rect
                  x={x - 9} y={PAD.t} width={18} height={plotH}
                  fill="transparent" style={{ cursor: "ew-resize" }}
                  onPointerDown={(e) => start(e, "threshold", d.band)}
                />
                <circle
                  cx={x} cy={PAD.t + plotH} r={selected === d.band ? 6 : 5}
                  fill="var(--brand)" stroke="#fff" strokeWidth={2}
                  style={{ cursor: "ew-resize" }}
                  onPointerDown={(e) => start(e, "threshold", d.band)}
                />
                <text x={x} y={PAD.t + plotH + 21} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="var(--ink-muted)">
                  {axis.fmt(d.x)}
                </text>
              </g>
            );
          })}

          <line x1={PAD.l} x2={w - PAD.r} y1={PAD.t + plotH} y2={PAD.t + plotH} stroke="rgba(15,15,25,0.18)" strokeWidth={1} />
          {ticks.map((t) => (
            <line key={t} x1={X(t)} x2={X(t)} y1={PAD.t + plotH} y2={PAD.t + plotH + 3} stroke="rgba(15,15,25,0.18)" strokeWidth={1} />
          ))}
        </svg>
      </div>

      <p className="t-meta mt-1.5 flex items-center gap-1.5 text-[11px]">
        <Move className="h-3 w-3 shrink-0" />
        Drag a marker sideways to move the threshold, or a plateau up and down to change the points.
        Horizontal axis: {axis.axis}.
      </p>

      {/* The numbers themselves. Dragging finds the shape; this commits to it. */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[26rem] text-left">
          <thead>
            <tr>
              <th className="t-label pb-1.5">Band</th>
              <th className="t-label pb-1.5 w-28">{spec.compare === "gte" ? "At least" : "Up to"}</th>
              <th className="t-label pb-1.5 w-24">Points</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {factor.bands.map((b, i) => {
              const last = i === factor.bands.length - 1;
              return (
                <tr
                  key={i}
                  onMouseEnter={() => setSelected(i)}
                  onMouseLeave={() => setSelected(null)}
                  className="align-middle odd:bg-[color:var(--ink)]/[0.02]"
                >
                  <td className="py-1 pr-2">
                    <input
                      value={b.label}
                      onChange={(e) => patch(i, { label: e.target.value })}
                      className="w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-[13px] font-semibold text-[color:var(--ink)] hover:border-[color:var(--ink)]/12 focus:border-[color:var(--brand)] focus:outline-none"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    {last ? (
                      <span className="px-2 text-[12px] italic text-[color:var(--ink-faint)]">everything else</span>
                    ) : (
                      <input
                        type="number" inputMode="decimal" step={axis.step} min={0}
                        value={b.threshold ?? 0}
                        onChange={(e) => patch(i, { threshold: tidy(clampThreshold(i, Number(e.target.value) || 0)) })}
                        className="w-24 rounded-md border border-[color:var(--ink)]/12 bg-paper px-2 py-1.5 text-[13px] tabular-nums outline-none focus:border-[color:var(--brand)]"
                      />
                    )}
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="number" inputMode="numeric" min={0} max={100}
                      value={b.points}
                      onChange={(e) => patch(i, { points: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })}
                      className="w-20 rounded-md border border-[color:var(--ink)]/12 bg-paper px-2 py-1.5 text-[13px] tabular-nums outline-none focus:border-[color:var(--brand)]"
                    />
                  </td>
                  <td className="py-1">
                    <button
                      type="button"
                      aria-label={`Remove ${b.label}`}
                      disabled={factor.bands.length <= 2}
                      title={factor.bands.length <= 2 ? "A factor needs at least one rung and a catch-all." : "Remove this band"}
                      onClick={() => removeBand(i)}
                      className="rounded-md p-1.5 text-[color:var(--ink-faint)] hover:bg-red-500/10 hover:text-red-700 disabled:pointer-events-none disabled:opacity-30"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={addBand}
        className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-[color:var(--ink-muted)] ring-1 ring-[color:var(--ink)]/10 hover:text-[color:var(--ink)]"
      >
        <Plus className="h-3.5 w-3.5" /> Add a band
      </button>
      <p className="t-meta mt-2 text-[11px]">
        The final band is the catch-all: anything that matched no rung above lands here. Without it a
        value outside every rung would score nothing at all.
      </p>
    </div>
  );
}
