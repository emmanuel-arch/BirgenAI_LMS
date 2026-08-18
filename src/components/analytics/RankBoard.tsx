"use client";

// ─────────────────────────────────────────────────────────────────────────────
// A LEAGUE TABLE WHOSE RULE IS VISIBLE.
//
// The metric picker is the point of this component. Change it and the order
// changes in front of you — which is the only way to make somebody understand
// that "best" was a choice all along, and that the person at the top of one
// definition is often halfway down another.
//
// Three things travel with every ranking and none of them is optional:
//   · the FORMULA, written out
//   · the CAVEAT — what this metric systematically over-rewards
//   · the SPREAD — whether the gap top-to-bottom is big enough to be real
//
// The last one matters most and is the one nobody ships. A table sorted on a
// measure where everybody is within 3% of each other is noise with an ordering
// imposed on it, and somebody will still be praised for being first.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Info, TriangleAlert, Loader2 } from "lucide-react";
import { RANK_METRICS, formatValue, type MeasureFormat } from "@/lib/analytics/cube";
import { buildQuery } from "@/lib/analytics/params";
import type { RankedRow } from "@/lib/analytics/rank";
import { CATEGORICAL, STATUS } from "./viz/theme";

export default function RankBoard({
  rows,
  metricKey,
  metricLabel,
  formula,
  caveat,
  question,
  spreadNote,
  unitLabel,
}: {
  rows: RankedRow[];
  metricKey: string;
  metricLabel: string;
  formula: string;
  caveat?: string;
  question: string;
  spreadNote: string | null;
  /** "officers", "branches", "products" — used in the copy. */
  unitLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const current = useMemo(() => new URLSearchParams(sp.toString()), [sp]);

  const setMetric = (key: string) =>
    startTransition(() => router.push(`${pathname}${buildQuery(current, { rank: key })}`, { scroll: false }));

  const max = Math.max(1, ...rows.map((r) => Math.abs(r.score)));

  return (
    <div className="space-y-3">
      {/* ── The definition picker ─────────────────────────────────────────── */}
      <div className="rounded-2xl border border-zinc-900/10 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12px] font-bold text-zinc-800">
            &ldquo;Best&rdquo; means what, exactly?
          </p>
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />}
        </div>
        <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">
          There is no single best {unitLabel.replace(/s$/, "")}. Pick the definition you actually mean — the order below
          changes with it, and the ones that move most are the ones worth talking about.
        </p>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {RANK_METRICS.map((m) => {
            const on = m.key === metricKey;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => setMetric(m.key)}
                title={`${m.question} — ${m.formula}`}
                className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                  on ? "bg-zinc-900 text-white" : "bg-zinc-900/[0.05] text-zinc-600 hover:bg-zinc-900/10"
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── What we are looking at ────────────────────────────────────────── */}
      <div className="rounded-2xl border border-zinc-900/10 bg-white p-4 sm:p-5">
        <h3 className="text-[13px] font-bold text-zinc-800">{question}</h3>
        <p className="mt-0.5 text-[11px] text-zinc-500">
          Ranked by <span className="font-semibold text-zinc-700">{metricLabel}</span> — {formula.toLowerCase()}.
        </p>

        {caveat && (
          <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800 ring-1 ring-amber-200">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{caveat}</span>
          </p>
        )}

        {/* ── The table ───────────────────────────────────────────────────── */}
        <div className="mt-3 space-y-2">
          {rows.length === 0 && (
            <p className="py-8 text-center text-[13px] text-zinc-500">
              No {unitLabel} with any activity in this cut.
            </p>
          )}
          {rows.map((r) => {
            const width = (Math.abs(r.score) / max) * 100;
            return (
              <div key={r.key} className="group">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="w-4 shrink-0 text-right text-[10px] font-bold tabular-nums text-zinc-300">
                      {r.position}
                    </span>
                    <span className="truncate text-[12.5px] font-medium text-zinc-800">{r.label}</span>
                    {r.thin && (
                      <span
                        className="inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-100 px-1 py-0.5 text-[8px] font-bold uppercase text-amber-700"
                        title="Too few loans for this score to be meaningful — a clean book of two loans is not a clean book."
                      >
                        <TriangleAlert className="h-2 w-2" /> thin
                      </span>
                    )}
                  </span>
                  {/* Values in ink, never in the series colour. */}
                  <span className="shrink-0 text-[12.5px] font-bold tabular-nums text-zinc-900">
                    {formatValue(r.score, r.format)}
                  </span>
                </div>

                <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-900/[0.05]">
                  <div
                    className="h-full rounded-r-[4px] transition-all duration-500"
                    style={{
                      width: `${width}%`,
                      // Thin rows are drawn in the muted status colour rather
                      // than the series hue, so a flattering score off a tiny
                      // sample never looks like a leading one.
                      backgroundColor: r.thin ? STATUS.neutral : CATEGORICAL[0],
                    }}
                  />
                </div>

                {/* The context behind the rank. This is what stops a league table
                    being read as a verdict: the numbers that produced it. */}
                <p className="mt-0.5 text-[10px] tabular-nums text-zinc-400">
                  {r.row.activeLoans.toLocaleString()} active · {formatValue(r.row.olb, "money", { compact: true })} out ·{" "}
                  {r.row.par30.toFixed(1)}% PAR 30 · {r.row.newLoans.toLocaleString()} booked ·{" "}
                  {formatValue(r.row.disbursed, "money", { compact: true })} lent
                </p>
              </div>
            );
          })}
        </div>

        {spreadNote && (
          <p className="mt-4 border-t border-zinc-900/[0.06] pt-3 text-[11.5px] leading-snug text-zinc-600">
            {spreadNote}
          </p>
        )}
      </div>
    </div>
  );
}

/** The format a metric's score renders in — re-exported for the server page. */
export type { MeasureFormat };
