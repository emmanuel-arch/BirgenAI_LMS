"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE CLOSED ML LOOP — the data-science view of the whole platform.
//
// Six acts, in the order the argument is actually made to a credit committee:
//
//   I    THE LOOP        the six stations, animated, each with the live count
//                        that proves it is running on THIS book.
//   II   THE THRESHOLD   where we are against 300 labelled outcomes, and what
//                        happens at the line.
//   III  THE EVIDENCE    the observed default rate with its Wilson interval, and
//                        the same interval at 300/500/1000. THIS is the argument
//                        for more borrowers: the estimate doesn't move, the
//                        uncertainty around it collapses.
//   IV   THE ERRORS      the confusion matrix at the live operating threshold,
//                        with both mistakes priced. Names recall as the target
//                        and says why.
//   V    THE FEATURES    what is being frozen onto every decision, by family,
//                        with the one-sentence justification each owes.
//   VI   THE FLEET       every engine, its stage, its population, its metric.
//
// Everything renders from measured rows. Where the evidence is thin the screen
// SAYS SO — an "INSUFFICIENT" panel is a feature here, because a module whose
// whole thesis is statistical honesty cannot open with a confident lie.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  ScanLine, Target, Landmark, Activity, Tag, RefreshCcw, ArrowRight, ArrowUpRight,
  CheckCircle2, AlertTriangle, Info, TrendingDown, ShieldCheck, Database, Infinity as InfinityIcon,
  type LucideIcon,
} from "lucide-react";
import type { LoopReport, StationKey } from "@/lib/intelligence/loop";

const STATION_ICON: Record<StationKey, LucideIcon> = {
  capture: ScanLine, decide: Target, book: Landmark, observe: Activity, label: Tag, retrain: RefreshCcw,
};

const kes = (n: number) =>
  n >= 1_000_000 ? `KES ${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `KES ${(n / 1000).toFixed(0)}k` : `KES ${Math.round(n)}`;
const pct = (n: number, dp = 1) => `${(n * 100).toFixed(dp)}%`;

function Section({ n, title, blurb, children }: { n: string; title: string; blurb: string; children: React.ReactNode }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="mt-10"
    >
      <div className="flex items-baseline gap-2.5">
        <span className="font-mono text-[11px] font-bold tracking-widest text-[color:var(--brand)]">{n}</span>
        <h2 className="text-lg font-bold tracking-tight text-zinc-900">{title}</h2>
      </div>
      <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-zinc-500">{blurb}</p>
      <div className="mt-4">{children}</div>
    </motion.section>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-zinc-900/[0.07] bg-white/70 p-4 shadow-sm ${className}`}>{children}</div>;
}

export function LoopClient({ report, orgName }: { report: LoopReport; orgName: string }) {
  const { evidence: e, matrix, economics, families, models, drift, artifact, stations, book } = report;
  const [active, setActive] = useState<StationKey | null>(null);

  const pctToTarget = Math.round(e.pctOfTarget);
  const armed = e.resolved >= e.target;

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 pt-6 sm:px-6">
      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-3xl border border-zinc-900/[0.07] bg-zinc-950 p-6 text-white sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full blur-3xl" style={{ background: "var(--brand)", opacity: 0.35 }} />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-16 h-72 w-72 rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="relative">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">
            <InfinityIcon className="h-3.5 w-3.5" /> Closed ML Loop
          </p>
          <h1 className="mt-2 max-w-2xl text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
            Every decision {orgName} makes is a training example it hasn&apos;t collected yet.
          </h1>
          <p className="mt-3 max-w-2xl text-[13.5px] leading-relaxed text-white/70">
            A lending platform that scores borrowers and forgets what happened is a calculator. This one
            freezes the features behind every decision, waits for the outcome, and joins them back together.
            At <span className="font-semibold text-white">{e.target} labelled outcomes</span> the model fitted on
            this book&apos;s own borrowers takes over from the expert scorecard — and never stops improving after that.
          </p>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { k: "Borrowers", v: book.borrowers.toLocaleString() },
              { k: "Scored decisions", v: e.scored.toLocaleString() },
              { k: "Labelled outcomes", v: e.resolved.toLocaleString() },
              { k: "Awaiting a label", v: e.pending.toLocaleString() },
            ].map((s) => (
              <div key={s.k} className="rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5 backdrop-blur">
                <p className="text-[10px] uppercase tracking-wide text-white/50">{s.k}</p>
                <p className="mt-0.5 text-xl font-bold tabular-nums">{s.v}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── I · THE LOOP ───────────────────────────────────────────────────── */}
      <Section
        n="I"
        title="The loop"
        blurb="Six stations. Data leaves the borrower, becomes a decision, becomes exposure, becomes an outcome, and returns as a label. Tap any station to see what it does and how much of it has actually run here."
      >
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {stations.map((s, i) => {
            const SIcon = STATION_ICON[s.key];
            const on = active === s.key;
            return (
              <motion.button
                key={s.key}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.06, duration: 0.4 }}
                onClick={() => setActive(on ? null : s.key)}
                className={`relative rounded-2xl border p-3 text-left transition-all ${
                  on ? "border-[color:var(--brand)] bg-white shadow-md" : "border-zinc-900/[0.07] bg-white/70 hover:border-zinc-900/20"
                }`}
              >
                {/* The connector — a hairline that says these are sequential, and
                    lights only where data has actually flowed. */}
                {i < stations.length - 1 && (
                  <span
                    aria-hidden
                    className="absolute -right-1 top-1/2 hidden h-px w-2 lg:block"
                    style={{ background: s.live ? "var(--brand)" : "rgba(9,9,11,0.12)" }}
                  />
                )}
                <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${s.live ? "text-white" : "bg-zinc-900/5 text-zinc-400"}`}
                  style={s.live ? { backgroundColor: "var(--brand)" } : undefined}>
                  <SIcon className="h-4 w-4" />
                </span>
                <p className="mt-2 text-[12px] font-bold text-zinc-800">{s.title}</p>
                <p className="mt-0.5 text-lg font-bold leading-none tabular-nums text-zinc-900">{s.count.toLocaleString()}</p>
                <p className="mt-0.5 text-[9.5px] leading-tight text-zinc-500">{s.unit}</p>
              </motion.button>
            );
          })}
        </div>

        <AnimatePresence mode="wait">
          {active && (
            <motion.div
              key={active}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden"
            >
              {stations.filter((s) => s.key === active).map((s) => (
                <div key={s.key} className="mt-2.5 rounded-2xl border border-zinc-900/[0.07] bg-white/70 p-4">
                  <p className="text-[13px] leading-relaxed text-zinc-700">{s.what}</p>
                  {s.href && (
                    <Link href={s.href} className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-[color:var(--brand)] hover:gap-1.5">
                      Open the screen <ArrowUpRight className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </Section>

      {/* ── II · THE THRESHOLD ─────────────────────────────────────────────── */}
      <Section
        n="II"
        title={`The road to ${e.target}`}
        blurb="The trained model already exists and already scores — in shadow, beside the expert scorecard. What it is waiting for is not code. It is evidence: enough loans whose ending we have actually seen."
      >
        <Card>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-zinc-500">Labelled outcomes on this book</p>
              <p className="mt-0.5 text-4xl font-bold tabular-nums text-zinc-900">
                {e.resolved.toLocaleString()}
                <span className="ml-1.5 text-lg font-semibold text-zinc-400">/ {e.target}</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-wide text-zinc-500">Status</p>
              <p className={`mt-0.5 text-sm font-bold ${armed ? "text-emerald-600" : "text-amber-600"}`}>
                {armed ? "MODEL ARMED" : `${e.remaining} to go`}
              </p>
              {e.etaMonths != null && !armed && (
                <p className="text-[11px] text-zinc-500">
                  ~{e.etaMonths} month{e.etaMonths === 1 ? "" : "s"} at {Math.round(e.velocity ?? 0)}/mo
                </p>
              )}
            </div>
          </div>

          {/* The bar */}
          <div className="relative mt-4 h-3 overflow-hidden rounded-full bg-zinc-900/[0.06]">
            <motion.div
              initial={{ width: 0 }}
              whileInView={{ width: `${Math.max(1.5, pctToTarget)}%` }}
              viewport={{ once: true }}
              transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
              className="h-full rounded-full"
              style={{ background: "linear-gradient(90deg, var(--brand), #10b981)" }}
            />
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] text-zinc-400">
            <span>0 — expert scorecard decides</span>
            <span className="font-semibold text-zinc-600">{pctToTarget}%</span>
            <span>{e.target} — this book&apos;s own model decides</span>
          </div>

          {/* Cadence */}
          <div className="mt-5">
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">Decisions scored, last 6 months</p>
            <div className="mt-2 flex h-20 items-end gap-1.5">
              {e.monthly.map((m) => {
                const max = Math.max(...e.monthly.map((x) => x.scored), 1);
                return (
                  <div key={m.month} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                    <span className="text-[9px] tabular-nums text-zinc-400">{m.scored || ""}</span>
                    <div className="flex w-full flex-1 flex-col justify-end gap-px">
                      <motion.div
                        initial={{ height: 0 }}
                        whileInView={{ height: `${(m.resolved / max) * 100}%` }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.6, delay: 0.1 }}
                        className="w-full rounded-t bg-emerald-500"
                        title={`${m.resolved} labelled`}
                      />
                      <motion.div
                        initial={{ height: 0 }}
                        whileInView={{ height: `${((m.scored - m.resolved) / max) * 100}%` }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.6 }}
                        className="w-full rounded-t"
                        style={{ backgroundColor: "var(--brand)", opacity: 0.25 }}
                        title={`${m.scored - m.resolved} still pending`}
                      />
                    </div>
                    <span className="text-[8.5px] text-zinc-400">{m.month.slice(5)}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-1.5 flex gap-3 text-[9.5px] text-zinc-500">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500" /> labelled</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: "var(--brand)", opacity: 0.25 }} /> awaiting outcome</span>
            </div>
          </div>
        </Card>
      </Section>

      {/* ── III · THE EVIDENCE ─────────────────────────────────────────────── */}
      <Section
        n="III"
        title="Why more borrowers actually matter"
        blurb="Not because the model magically improves — because below a certain sample size you cannot TELL whether it improved. This is the same default rate measured at four sample sizes. The number barely moves; the honesty around it collapses."
      >
        {e.resolved === 0 ? (
          <Card className="flex items-start gap-2.5">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
            <p className="text-[13px] leading-relaxed text-zinc-600">
              No outcome has been labelled yet, so there is nothing to be confident or unconfident about.
              The loop starts producing evidence the first time a scored loan reaches its ending.
            </p>
          </Card>
        ) : (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <Card>
              <p className="text-[11px] uppercase tracking-wide text-zinc-500">Observed default rate</p>
              <p className="mt-1 text-4xl font-bold tabular-nums text-zinc-900">{pct(e.observedDefaultRate ?? 0)}</p>
              <p className="mt-1 text-[12px] text-zinc-500">
                {e.defaulted} of {e.resolved} labelled loans
              </p>
              {e.interval && (
                <>
                  <div className="mt-4 rounded-xl bg-zinc-900/[0.03] px-3 py-2.5">
                    <p className="text-[10.5px] uppercase tracking-wide text-zinc-500">95% confidence (Wilson)</p>
                    <p className="mt-0.5 font-mono text-[13px] font-bold text-zinc-800">
                      {pct(e.interval.lo)} — {pct(e.interval.hi)}
                    </p>
                    <p className="mt-1 text-[11px] leading-snug text-zinc-500">
                      The true rate is somewhere in that range. Today it is ±{pct(e.interval.halfWidth)} wide —
                      {e.interval.halfWidth > 0.08
                        ? " far too wide to price against, or to tell a good model from a lucky one."
                        : " tight enough to start pricing against."}
                    </p>
                  </div>
                  <p className="mt-3 text-[11px] leading-snug text-zinc-400">
                    Wilson rather than the textbook normal interval: at these sample sizes the normal
                    approximation returns negative default rates, which is not a defensible thing to
                    put in front of a credit committee.
                  </p>
                </>
              )}
            </Card>

            <Card>
              <p className="text-[11px] uppercase tracking-wide text-zinc-500">The same rate, at four sample sizes</p>
              <div className="mt-3 space-y-2.5">
                {[
                  { n: e.resolved, halfWidth: e.interval?.halfWidth ?? 0.5, reachable: true, now: true },
                  ...e.projection.map((p) => ({ ...p, now: false })),
                ].map((p, i) => {
                  const width = Math.min(100, p.halfWidth * 2 * 100 * 2.4);
                  return (
                    <div key={i}>
                      <div className="flex items-baseline justify-between text-[11px]">
                        <span className={p.now ? "font-bold text-zinc-800" : "text-zinc-600"}>
                          n = {p.n.toLocaleString()}{p.now ? " (today)" : ""}
                        </span>
                        <span className="font-mono tabular-nums text-zinc-500">±{pct(p.halfWidth)}</span>
                      </div>
                      <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-zinc-900/[0.05]">
                        <motion.div
                          initial={{ width: 0 }}
                          whileInView={{ width: `${Math.max(3, width)}%` }}
                          viewport={{ once: true }}
                          transition={{ duration: 0.7, delay: i * 0.1, ease: [0.16, 1, 0.3, 1] }}
                          className="h-full rounded-full"
                          style={{ backgroundColor: p.now ? "#f43f5e" : p.reachable ? "#10b981" : "var(--brand)", opacity: p.now ? 0.85 : 0.55 }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 flex items-start gap-1.5 text-[11.5px] leading-snug text-zinc-500">
                <TrendingDown className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Shorter is better. Uncertainty falls with the square root of n — which is why
                {" "}{e.target} is a real line and not a round number: it is roughly where the interval
                gets tight enough that a 5-point move in default rate is a signal rather than noise.
              </p>
            </Card>
          </div>
        )}
      </Section>

      {/* ── IV · THE ERRORS ────────────────────────────────────────────────── */}
      <Section
        n="IV"
        title="The two mistakes, and which one we optimise against"
        blurb="A credit model makes two errors and they cost wildly different amounts. Approving someone who defaults costs the principal. Declining someone who would have repaid costs the margin. In micro-lending the first is roughly seven times worse — so the target is RECALL: catch as many defaults as possible, held against a precision floor so the book doesn't starve."
      >
        {!matrix ? (
          <Card className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div>
              <p className="text-[13px] font-semibold text-zinc-800">Not enough labelled outcomes for a matrix yet.</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-600">
                A confusion matrix on a handful of loans is four numbers that will all change next week.
                This panel fills in at 25 labelled outcomes with a predicted probability;
                there {e.resolved === 1 ? "is" : "are"} {e.resolved}.
              </p>
            </div>
          </Card>
        ) : (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Card>
              <div className="flex items-baseline justify-between">
                <p className="text-[11px] uppercase tracking-wide text-zinc-500">At the live operating threshold</p>
                <span className="font-mono text-[11px] font-bold text-zinc-700">PD ≥ {pct(matrix.threshold)}</span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-1.5">
                {[
                  { l: "Caught defaults", v: matrix.tp, sub: "flagged · defaulted", tone: "emerald" },
                  { l: "False alarms", v: matrix.fp, sub: "flagged · repaid", tone: "amber" },
                  { l: "Missed defaults", v: matrix.fn, sub: "approved · defaulted", tone: "rose" },
                  { l: "Correct approvals", v: matrix.tn, sub: "approved · repaid", tone: "zinc" },
                ].map((c) => (
                  <div key={c.l} className={`rounded-xl px-3 py-2.5 ${
                    c.tone === "emerald" ? "bg-emerald-50" : c.tone === "amber" ? "bg-amber-50" : c.tone === "rose" ? "bg-rose-50" : "bg-zinc-900/[0.03]"
                  }`}>
                    <p className={`text-2xl font-bold tabular-nums ${
                      c.tone === "emerald" ? "text-emerald-700" : c.tone === "amber" ? "text-amber-700" : c.tone === "rose" ? "text-rose-700" : "text-zinc-700"
                    }`}>{c.v}</p>
                    <p className="text-[11px] font-semibold leading-tight text-zinc-700">{c.l}</p>
                    <p className="text-[9.5px] leading-tight text-zinc-500">{c.sub}</p>
                  </div>
                ))}
              </div>

              <div className="mt-3 grid grid-cols-3 gap-1.5">
                {[
                  { l: "Recall", v: matrix.recall, hero: true, help: "Share of real defaults we flagged" },
                  { l: "Precision", v: matrix.precision, hero: false, help: "Share of our flags that were real" },
                  { l: "AUC", v: matrix.auc, hero: false, help: "Ranking power, 0.5 = coin flip" },
                ].map((m) => (
                  <div key={m.l} className={`rounded-xl border px-2.5 py-2 ${m.hero ? "border-[color:var(--brand)]" : "border-zinc-900/[0.07]"}`} title={m.help}>
                    <p className="text-[9.5px] uppercase tracking-wide text-zinc-500">{m.l}</p>
                    <p className={`text-lg font-bold tabular-nums ${m.hero ? "text-[color:var(--brand)]" : "text-zinc-800"}`}>
                      {m.v == null ? "—" : m.l === "AUC" ? m.v.toFixed(3) : pct(m.v, 0)}
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10.5px] leading-snug text-zinc-400">
                Measured over {matrix.n} labelled decisions.
                {matrix.ks != null && ` KS ${matrix.ks.toFixed(3)}.`}
                {matrix.brier != null && ` Brier ${matrix.brier.toFixed(3)}.`}
              </p>
            </Card>

            {economics && (
              <Card>
                <p className="text-[11px] uppercase tracking-wide text-zinc-500">What each mistake cost, in shillings</p>
                <div className="mt-3 space-y-2.5">
                  <div className="rounded-xl border border-rose-200 bg-rose-50/60 px-3 py-2.5">
                    <div className="flex items-baseline justify-between">
                      <p className="text-[12px] font-semibold text-rose-800">Missed defaults ({matrix.fn})</p>
                      <p className="text-lg font-bold tabular-nums text-rose-700">{kes(economics.falseNegativeCost)}</p>
                    </div>
                    <p className="mt-0.5 text-[11px] leading-snug text-rose-900/70">
                      Principal lent to people the model approved and who did not repay. The full amount is at risk.
                    </p>
                  </div>
                  <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2.5">
                    <div className="flex items-baseline justify-between">
                      <p className="text-[12px] font-semibold text-amber-800">False alarms ({matrix.fp})</p>
                      <p className="text-lg font-bold tabular-nums text-amber-700">{kes(economics.falsePositiveCost)}</p>
                    </div>
                    <p className="mt-0.5 text-[11px] leading-snug text-amber-900/70">
                      Margin forgone on customers who would have repaid, at an assumed {pct(economics.assumedMargin, 0)} yield.
                      Painful, but it is lost profit — not lost capital.
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex items-start gap-2 rounded-xl bg-zinc-900/[0.03] px-3 py-2.5">
                  <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--brand)]" />
                  <p className="text-[11.5px] leading-snug text-zinc-600">
                    Average exposure on this book is {kes(economics.avgExposure)}.
                    {economics.recallPointValue != null && (
                      <> Each percentage point of recall is worth about <span className="font-semibold text-zinc-800">{kes(economics.recallPointValue)}</span> of principal moved from &ldquo;missed&rdquo; to &ldquo;caught&rdquo;.</>
                    )}
                    {" "}That number is the objective function. Everything else on this page exists to move it.
                  </p>
                </div>
              </Card>
            )}
          </div>
        )}

        {/* Drift — the other half of "is it still true" */}
        <Card className="mt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">Is the model still telling the truth?</p>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
              drift.status === "STABLE" ? "bg-emerald-100 text-emerald-700"
                : drift.status === "WATCH" ? "bg-amber-100 text-amber-700"
                  : drift.status === "DRIFTING" ? "bg-rose-100 text-rose-700" : "bg-zinc-900/5 text-zinc-500"
            }`}>{drift.status}</span>
          </div>
          <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
            <div className="rounded-xl border border-zinc-900/[0.07] px-3 py-2.5">
              <p className="text-[11px] font-semibold text-zinc-700">Calibration</p>
              <p className="mt-0.5 text-[11.5px] leading-snug text-zinc-500">{drift.calibration.note}</p>
            </div>
            <div className="rounded-xl border border-zinc-900/[0.07] px-3 py-2.5">
              <p className="text-[11px] font-semibold text-zinc-700">Population stability</p>
              <p className="mt-0.5 text-[11.5px] leading-snug text-zinc-500">{drift.population.note}</p>
            </div>
          </div>
        </Card>
      </Section>

      {/* ── V · THE FEATURES ───────────────────────────────────────────────── */}
      <Section
        n="V"
        title="What gets frozen onto every decision"
        blurb="A score is worthless as a training example unless the inputs that produced it are stored beside it. These are the signals lifted out of an M-Pesa statement and written onto the decision row — grouped by what they are evidence OF, because a feature that can't be justified in one sentence gets argued out of the model the first time it declines someone important."
      >
        <div className="grid gap-2.5 sm:grid-cols-2">
          {families.map((f, i) => (
            <motion.div
              key={f.family}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05, duration: 0.4 }}
              className="rounded-2xl border border-zinc-900/[0.07] bg-white/70 p-3.5"
            >
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-bold text-zinc-800">{f.family}</p>
                <span className="rounded-full bg-zinc-900/5 px-2 py-0.5 text-[9.5px] font-semibold text-zinc-500">
                  {f.features.length} signal{f.features.length === 1 ? "" : "s"}
                </span>
              </div>
              <p className="mt-1 text-[11.5px] leading-snug text-zinc-500">{f.why}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {f.features.map((x) => (
                  <span key={x.key} className="inline-flex items-center gap-1 rounded-md border border-zinc-900/[0.07] bg-white px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">
                    <CheckCircle2 className={`h-2.5 w-2.5 ${x.captured ? "text-emerald-500" : "text-zinc-300"}`} /> {x.label}
                  </span>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
        <p className="mt-2.5 flex items-start gap-1.5 text-[11.5px] leading-snug text-zinc-500">
          <Database className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Alongside these, the raw cashflow vector, the derived model features, the internal score,
          the starting limit and the reason codes are all persisted on the decision — so a model
          refitted a year from now sees exactly what the officer saw on the day.
        </p>
      </Section>

      {/* ── VI · THE FLEET ─────────────────────────────────────────────────── */}
      <Section
        n="VI"
        title="The engines"
        blurb="Different borrowers carry different evidence, so the platform runs a fleet rather than a model. A first-time applicant has a statement and nothing else; a returning one has a repayment record. Each gets scored by the engine that can actually see them."
      >
        <div className="space-y-2">
          {models.map((m, i) => (
            <motion.div
              key={m.key}
              initial={{ opacity: 0, x: -10 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05, duration: 0.4 }}
              className="rounded-2xl border border-zinc-900/[0.07] bg-white/70 p-3.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[13px] font-bold text-zinc-800">{m.name}</p>
                <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                  m.stage === "LIVE" ? "bg-emerald-100 text-emerald-700" : m.stage === "SHADOW" ? "bg-violet-100 text-violet-700" : "bg-zinc-900/5 text-zinc-500"
                }`}>{m.stage}</span>
                {m.metric && <span className="rounded bg-zinc-900/5 px-1.5 py-0.5 font-mono text-[9.5px] font-bold text-zinc-600">{m.metric}</span>}
                <span className="ml-auto text-[11px] tabular-nums text-zinc-500">{m.scores.toLocaleString()} scored here</span>
              </div>
              <p className="mt-1 text-[11.5px] text-zinc-500">{m.population}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-zinc-600">{m.note}</p>
            </motion.div>
          ))}
        </div>

        <Card className="mt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">Thin-file artifact</p>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${artifact.active ? "bg-emerald-100 text-emerald-700" : "bg-violet-100 text-violet-700"}`}>
              {artifact.active ? "DECIDING" : "SHADOW"}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { k: "Version", v: artifact.version },
              { k: "Fitted", v: artifact.trainedAt ? new Date(artifact.trainedAt).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" }) : "—" },
              { k: "Observed outcomes", v: artifact.nObserved.toLocaleString() },
              { k: "AUC (fit)", v: artifact.metrics.n > 0 ? artifact.metrics.auc.toFixed(3) : "—" },
            ].map((x) => (
              <div key={x.k} className="rounded-xl bg-zinc-900/[0.03] px-2.5 py-2">
                <p className="text-[9.5px] uppercase tracking-wide text-zinc-500">{x.k}</p>
                <p className="mt-0.5 truncate font-mono text-[11.5px] font-bold text-zinc-800">{x.v}</p>
              </div>
            ))}
          </div>
          {!artifact.active && (
            <p className="mt-2.5 flex items-start gap-1.5 text-[11.5px] leading-snug text-zinc-600">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-500" />
              The trained model scores every applicant already — its number is recorded and compared,
              but the expert scorecard still makes the call. That is deliberate: a model promoted
              on {artifact.nObserved} outcomes would be fitted mostly to noise, and the first time it
              declined a good customer nobody would be able to say whether it was right.
            </p>
          )}
        </Card>
      </Section>

      {/* ── CLOSE ──────────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="mt-10 rounded-3xl border border-zinc-900/[0.07] bg-gradient-to-br from-zinc-900 to-zinc-800 p-6 text-white sm:p-7"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">What compounds</p>
        <p className="mt-2 max-w-3xl text-[14.5px] leading-relaxed text-white/85">
          Every lender starts with the pooled model, because it is the only honest option when a book
          has no history. Every decision after that is a row of evidence about {orgName}&apos;s own
          borrowers — how they earn, how they spend, and whether they paid. At {e.target} of them the
          platform stops borrowing someone else&apos;s judgement and starts using its own, and every
          decision from that day makes the next one better.
        </p>
        <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-white/55">
          There is no shortcut. A lender who buys a scorecard buys a fixed opinion about a different
          country&apos;s borrowers. A lender who runs this loop owns an asset that appreciates —
          and the only way to get one is to have been collecting since the first customer.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/console/intelligence/scoring" className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-[13px] font-semibold text-zinc-900 hover:bg-white/90">
            Credit Scoring <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <Link href="/console/crunch" className="inline-flex items-center gap-1.5 rounded-xl border border-white/25 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-white/10">
            Statement Cruncher <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </motion.div>

      <p className="mt-6 text-center text-[11px] text-zinc-400">
        Every figure on this page is computed from rows this platform stores. Generated {new Date(report.generatedAt).toLocaleString("en-KE")}.
      </p>
    </main>
  );
}
