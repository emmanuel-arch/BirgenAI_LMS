"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE BRIDGE, DRAWN.
//
// ── HOW THIS SCREEN ARGUES ───────────────────────────────────────────────────
// It does not open with a chart. It opens with the gap, stated as a number:
// 93,376 loans on the floor, ZERO of them Fintech. Then it shows the machinery
// that closes it, in the order a sceptical CTO would ask for it:
//
//   1. THE GAP        what is connected and what is not, side by side
//   2. THE MECHANISM  a diagram of the actual join, with real table names
//   3. THE EVIDENCE   the ageing rule checked against their own nightly job
//   4. THE OUTCOME    which queues, which agents, what commission
//   5. THE CASES      the real customers, by name, that would arrive tomorrow
//   6. THE SWITCH     one button, and exactly what it writes
//
// ── THE DIAGRAM IS SVG AND NOT A PICTURE ─────────────────────────────────────
// Because the numbers in it are the live numbers. A screenshot of an
// architecture diagram is a claim; a diagram whose node labels are read from the
// database at render time is a demonstration. If the Fintech book grows by five
// loans during the meeting, the diagram says so.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Loader2, ShieldAlert, ShieldCheck, TriangleAlert, Zap } from "lucide-react";
import { Card, CardHead, PageHead, Chip, Tag, Btn, Stat, KES, N, PCT, shortDate, Empty } from "@/components/suite/kit";

type Band = { id: number; name: string; short: string; accent: string; commission: number; loans: number; olb: number; commissionAtFull: number; share: number };
type Row = {
  loanId: number; borrowerId: number; name: string; phone: string; product: string;
  principal: number; olb: number; dpd: number;
  band: { id: number; short: string; accent: string; name: string };
  dueAt: string | null; officer: string | null; branch: string;
  priorLoans: number; priorRepaid: number; migrated: boolean; commissionAtFull: number;
};

export default function PipelineBoard({
  canRun, posture, book, totals, alreadyTracked, bands, rows, allocation, accuracy, mainBook,
}: {
  canRun: boolean;
  posture: { armed: boolean; label: string; detail: string };
  book: {
    entityId: number; loansEver: number; loansOpen: number; loansCarrying: number;
    borrowers: number; disbursedLast30d: number; disbursedValueLast30d: number;
    products: { id: number; name: string; loans: number; olb: number }[];
  };
  totals: { loans: number; olb: number; borrowers: number; commissionAtFull: number; withHistory: number; migrated: number; avgPriorLoans: number; officers: number };
  alreadyTracked: number;
  bands: Band[];
  rows: Row[];
  allocation: { agentId: number; agentName: string; loans: number; olb: number; commissionAtFull: number }[];
  accuracy: {
    compared: number; within3: number; within7: number; within3Pct: number; within7Pct: number;
    noSchedule: number; sampled: number; bookTotal: number; marginPp: number;
  };
  mainBook: { loans: number; olb: number; agents: number; recoveredToday: number };
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; pulled?: number; sample?: string[] } | null>(null);

  async function run(dryRun: boolean) {
    setBusy(true); setResult(null);
    try {
      const r = await fetch("/api/desk/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId: book.entityId, dryRun }),
      });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.message ?? `Failed (${r.status})`);
      setResult({ ok: true, message: j.message, pulled: j.pulled, sample: j.sample });
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }

  const maxBandOlb = Math.max(...bands.map((b) => b.olb), 1);
  const maxAlloc = Math.max(...allocation.map((a) => a.olb), 1);

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6">
      <PageHead
        eyebrow="The pipeline"
        title="Micromart Fintech → the collections floor"
        sub="Entity 3005 has a live, growing loan book and no collections engine. This is the bridge that gives it one — without migrating a single row."
        right={
          <span
            className={`inline-flex items-start gap-2 rounded-xl border px-3 py-2 ${
              posture.armed ? "border-red-500/30 bg-red-500/[0.05]" : "border-amber-500/30 bg-amber-500/[0.06]"
            }`}
          >
            {posture.armed ? <ShieldAlert className="mt-px h-4 w-4 shrink-0 text-red-600" /> : <ShieldCheck className="mt-px h-4 w-4 shrink-0 text-amber-600" />}
            <span className={`text-[11.5px] font-bold ${posture.armed ? "text-red-800" : "text-amber-800"}`}>{posture.label}</span>
          </span>
        }
      />

      {/* ── 1 · THE GAP ───────────────────────────────────────────────────── */}
      <Card className="mb-3 overflow-hidden" pad={false}>
        <div className="grid md:grid-cols-2">
          <div className="border-b border-zinc-900/[0.07] p-4 md:border-b-0 md:border-r">
            <p className="mb-1 text-[9.5px] font-bold uppercase tracking-[0.14em] text-zinc-400">Entity 3002 · the main book</p>
            <p className="text-[26px] font-bold leading-none tabular-nums text-zinc-900">{N(mainBook.loans)}</p>
            <p className="mt-1 text-[12px] text-zinc-500">loans on the collections floor</p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[11.5px]">
              <span className="text-zinc-500">KES <span className="font-semibold tabular-nums text-zinc-800">{KES(mainBook.olb, { compact: true })}</span> under management</span>
              <span className="text-zinc-500"><span className="font-semibold tabular-nums text-zinc-800">{mainBook.agents}</span> agents working it</span>
              <span className="text-zinc-500">KES <span className="font-semibold tabular-nums text-emerald-700">{KES(mainBook.recoveredToday)}</span> recovered today</span>
            </div>
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-800">
              <Check className="h-3 w-3" /> Connected — 1.3 million calls on record
            </p>
          </div>

          <div className="bg-[color:var(--accent)]/[0.035] p-4">
            <p className="mb-1 text-[9.5px] font-bold uppercase tracking-[0.14em] text-[color:var(--accent)]">Entity 3005 · Micromart Fintech</p>
            <p className="text-[26px] font-bold leading-none tabular-nums text-zinc-900">{N(alreadyTracked)}</p>
            <p className="mt-1 text-[12px] text-zinc-500">loans on the collections floor</p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[11.5px]">
              <span className="text-zinc-500"><span className="font-semibold tabular-nums text-zinc-800">{N(book.borrowers)}</span> borrowers</span>
              <span className="text-zinc-500"><span className="font-semibold tabular-nums text-zinc-800">{N(book.loansEver)}</span> loans ever booked</span>
              <span className="text-zinc-500"><span className="font-semibold tabular-nums text-zinc-800">{N(book.disbursedLast30d)}</span> disbursed in 30 days</span>
            </div>
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-amber-500/15 px-2 py-1 text-[11px] font-semibold text-amber-800">
              <TriangleAlert className="h-3 w-3" /> Not connected — no queue, no agent, no promise tracking
            </p>
          </div>
        </div>
      </Card>

      {/* ── 2 · THE MECHANISM ─────────────────────────────────────────────── */}
      <Card className="mb-3">
        <CardHead
          title="What the bridge actually is"
          sub="One INSERT. The loan stays where it was booked; only a reference crosses."
        />
        <Mechanism book={book} projected={totals.loans} olb={totals.olb} />
      </Card>

      {/* ── 3 · THE EVIDENCE ──────────────────────────────────────────────── */}
      <div className="mb-3 grid gap-3 lg:grid-cols-4">
        <Stat
          label="Cases that would join"
          value={N(totals.loans)}
          foot={`${N(totals.borrowers)} distinct borrowers`}
        />
        <Stat
          label="Balance it would carry"
          value={KES(totals.olb, { compact: true })}
          unit="KES"
          foot={`${N(book.loansCarrying)} of ${N(book.loansOpen)} open loans carry a balance`}
        />
        <Stat
          label="Arriving with history"
          value={PCT((totals.withHistory / Math.max(totals.loans, 1)) * 100, 0)}
          foot={`avg ${totals.avgPriorLoans.toFixed(1)} prior loans each · ${N(totals.migrated)} came across in the 2 Aug migration`}
        />
        <Stat
          label="Ageing rule agreement"
          value={PCT(accuracy.within7Pct, 1)}
          foot={`±${accuracy.marginPp.toFixed(2)}pp · within 7 days of their own nightly job, on ${N(accuracy.compared)} sampled loans`}
        />
      </div>

      <Card className="mb-3">
        <CardHead
          title="Why the ageing can be trusted"
          sub="The projection claims a Fintech loan would land in the band their own system would put it in. That is testable without touching 3005 at all."
        />
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
          <p className="text-[12px] leading-relaxed text-zinc-600">
            Their nightly job writes its own answer into <code className="rounded bg-zinc-900/[0.06] px-1 text-[11px]">CollectionTracker.DaysInArears</code>.
            So the rule can be checked against it loan by loan, on the 3002 book, where both figures exist. Taking the days since the
            earliest unpaid row in <code className="rounded bg-zinc-900/[0.06] px-1 text-[11px]">loanSchedule</code> reproduces their figure
            for <strong className="font-semibold text-zinc-800">{PCT(accuracy.within7Pct, 1)}</strong> of a random sample of {N(accuracy.compared)}
            tracked loans within a week, and <strong className="font-semibold text-zinc-800">{PCT(accuracy.within3Pct, 1)}</strong> within three days.
            <br /><br />
            The first attempt aged off the loan&rsquo;s final maturity date instead and was wrong by up to 242% — a weekly loan on instalment
            three of ten that missed Monday is one day in arrears, not thirty days early. That failure is why this panel exists: the number
            it reports is the one that makes everything downstream admissible.
          </p>
          <div className="space-y-2">
            <Meter label="Within 3 days" value={accuracy.within3} total={accuracy.compared} accent="#0d9488" />
            <Meter label="Within 7 days" value={accuracy.within7} total={accuracy.compared} accent="#059669" />
            <p className="pt-1 text-[10.5px] leading-snug text-zinc-400">
              Measured on a random sample of {N(accuracy.sampled)} of the {N(accuracy.bookTotal)} tracked loans — 95% interval
              ±{accuracy.marginPp.toFixed(2)}pp. Of those, {N(accuracy.noSchedule)} carry no schedule row and fall back to final
              maturity, which is correct for a single-bullet loan and the only answer available for the rest.
            </p>
          </div>
        </div>
      </Card>

      {/* ── 4 · THE OUTCOME ───────────────────────────────────────────────── */}
      <div className="mb-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHead title="Which queues it lands in" sub="Same bands, same commission rates, same rules the 3002 floor runs on." />
          {bands.filter((b) => b.loans > 0).length === 0 ? (
            <Empty title="Nothing to place" />
          ) : (
            <div className="space-y-1.5">
              {bands.filter((b) => b.loans > 0).map((b) => (
                <div key={b.id} className="flex items-center gap-3">
                  <span className="flex w-[132px] shrink-0 items-center gap-1.5">
                    <Chip label={b.short} accent={b.accent} title={b.name} />
                    <span className="truncate text-[11.5px] font-medium text-zinc-600">{b.name}</span>
                  </span>
                  <span className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-900/[0.055]">
                    <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(b.olb / maxBandOlb) * 100}%`, backgroundColor: b.accent }} />
                  </span>
                  <span className="w-[64px] shrink-0 text-right text-[11.5px] font-semibold tabular-nums text-zinc-700">{N(b.loans)}</span>
                  <span className="w-[86px] shrink-0 text-right text-[11.5px] tabular-nums text-zinc-500">{KES(b.olb)}</span>
                  <span className="w-[52px] shrink-0 text-right text-[10.5px] tabular-nums text-zinc-400">{b.commission}%</span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 border-t border-zinc-900/[0.06] pt-2.5 text-[11px] text-zinc-500">
            Commission at full recovery: <strong className="font-semibold tabular-nums text-zinc-800">KES {KES(totals.commissionAtFull)}</strong>
            {" "}— weighted by the band each shilling would come out of, not a flat rate.
          </p>
        </Card>

        <Card>
          <CardHead
            title="Who would carry it"
            sub="Balanced by value, not by row count — forty NPL cases worth 2,000 is not the same load as four worth 200,000."
          />
          {allocation.length === 0 ? (
            <Empty title="No agents available to allocate to" />
          ) : (
            <div className="max-h-[260px] space-y-1 overflow-y-auto pr-1">
              {allocation.map((a) => (
                <div key={a.agentId} className="flex items-center gap-3">
                  <span className="w-[118px] shrink-0 truncate text-[11.5px] font-medium text-zinc-700">{a.agentName}</span>
                  <span className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-900/[0.055]">
                    <span className="absolute inset-y-0 left-0 rounded-full bg-[color:var(--accent)]" style={{ width: `${(a.olb / maxAlloc) * 100}%` }} />
                  </span>
                  <span className="w-[48px] shrink-0 text-right text-[11.5px] tabular-nums text-zinc-600">{N(a.loans)}</span>
                  <span className="w-[76px] shrink-0 text-right text-[11.5px] font-semibold tabular-nums text-zinc-700">{KES(a.olb)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── 5 · THE CASES ─────────────────────────────────────────────────── */}
      <Card className="mb-3" pad={false}>
        <div className="p-4 pb-2">
          <CardHead
            title="The customers who would arrive tomorrow"
            sub={`Real Micro Eazy borrowers, read live from entity ${book.entityId}. ${N(totals.withHistory)} of them already have a repayment record this floor has never been able to see.`}
          />
        </div>
        {rows.length === 0 ? (
          <div className="p-4"><Empty title="No open Fintech loans carry a balance right now" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left">
              <thead>
                <tr className="border-y border-zinc-900/[0.07] text-[9.5px] font-bold uppercase tracking-[0.1em] text-zinc-400">
                  <th className="px-4 py-2">Customer</th>
                  <th className="px-3 py-2">Band</th>
                  <th className="px-3 py-2 text-right">Balance</th>
                  <th className="px-3 py-2">Next due</th>
                  <th className="px-3 py-2 text-right">History</th>
                  <th className="px-3 py-2">Relationship officer</th>
                  <th className="px-3 py-2 text-right">Commission</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.loanId} className="border-b border-zinc-900/[0.045] last:border-0 hover:bg-zinc-900/[0.022]">
                    <td className="px-4 py-2">
                      <Link href={`/desk/case/${r.loanId}`} className="block min-w-0">
                        <span className="block truncate text-[12.5px] font-semibold text-zinc-800 hover:text-[color:var(--accent)]">{r.name}</span>
                        <span className="block truncate text-[10.5px] text-zinc-400">
                          <span className="tabular-nums">{r.phone}</span> · {r.product} · {r.branch}
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5">
                        <Chip label={r.band.short} accent={r.band.accent} title={r.band.name} />
                        <span className="text-[10.5px] tabular-nums text-zinc-500">{r.dpd >= 0 ? `${r.dpd}d` : `${Math.abs(r.dpd)}d early`}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-[12.5px] font-semibold tabular-nums text-zinc-800">{KES(r.olb)}</td>
                    <td className="px-3 py-2 text-[11.5px] tabular-nums text-zinc-500">{shortDate(r.dueAt)}</td>
                    <td className="px-3 py-2 text-right">
                      {r.priorLoans > 0 ? (
                        <span className="block">
                          <span className="block text-[11.5px] font-semibold tabular-nums text-emerald-700">{N(r.priorLoans)} loans</span>
                          <span className="block text-[10px] tabular-nums text-zinc-400">KES {KES(r.priorRepaid)} repaid</span>
                        </span>
                      ) : (
                        <Tag tone="warn">New customer</Tag>
                      )}
                    </td>
                    <td className="px-3 py-2 truncate text-[11.5px] text-zinc-600">{r.officer ?? "—"}</td>
                    <td className="px-3 py-2 text-right text-[11.5px] tabular-nums text-zinc-500">
                      {r.commissionAtFull > 0 ? KES(r.commissionAtFull) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── 6 · THE SWITCH ────────────────────────────────────────────────── */}
      <Card>
        <CardHead
          title="Run the pipeline"
          sub="One INSERT per case into CollectionTracker. Nothing is migrated, nothing is copied, and the loans stay in Serviceconnect where they were booked."
        />
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_300px]">
          <div>
            <p className="mb-2 text-[9.5px] font-bold uppercase tracking-[0.1em] text-zinc-400">What it writes</p>
            <pre className="overflow-x-auto rounded-lg bg-zinc-900 p-3 text-[10.5px] leading-relaxed text-emerald-300">
{`INSERT INTO CollectBox.dbo.CollectionTracker
    (LoanId, DaysInArears, Create_date, Last_update, FirstDateInArrears,
     IsAgentAssigned, AgentAssigned, IsActioned, Loantype, AmountDue,
     Watch1, Installment, LastDateAssigned, PtpStatus)
SELECT  <loanId>, <dpd>, GETDATE(), GETDATE(), GETDATE(),
        1, <agentId>, 0, <band>, <due>, <due>, <instalment>, GETDATE(), 0
 WHERE NOT EXISTS (SELECT 1 FROM CollectBox.dbo.CollectionTracker
                    WHERE LoanId = <loanId>)`}
            </pre>
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
              The <code className="rounded bg-zinc-900/[0.06] px-1 text-[10.5px]">NOT EXISTS</code> guard is load-bearing: pulling the same
              case twice would give it two queue positions and double-count it in every band total on the floor. Re-running the pipeline is
              therefore safe and idempotent.
            </p>
          </div>

          <div className="space-y-2">
            {!canRun ? (
              <p className="rounded-lg bg-zinc-900/[0.035] px-3 py-2.5 text-[11.5px] leading-relaxed text-zinc-500">
                Running the pipeline needs <code className="text-[10.5px]">collections.manage</code>.
              </p>
            ) : (
              <>
                <Btn variant="outline" onClick={() => run(true)} disabled={busy}>
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Preview — compose, do not run
                </Btn>
                <Btn variant="solid" onClick={() => run(false)} disabled={busy}>
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                  Pull {N(totals.loans)} cases onto the floor
                </Btn>
                <p className={`text-[10.5px] leading-snug ${posture.armed ? "text-red-700" : "text-amber-700"}`}>
                  {posture.armed
                    ? "The mirror is ARMED. This writes into Micromart's production CollectBox."
                    : "The mirror is disarmed. Each case is recorded here and its statement stored for review; CollectBox is untouched until COLLECTBOX_POSTING_ENABLED is set."}
                </p>
              </>
            )}

            {result && (
              <div className={`rounded-lg border px-2.5 py-2 ${result.ok ? "border-emerald-500/25 bg-emerald-500/[0.06]" : "border-red-500/25 bg-red-500/[0.05]"}`}>
                <p className={`flex items-start gap-1.5 text-[11.5px] font-medium ${result.ok ? "text-emerald-800" : "text-red-800"}`}>
                  {result.ok ? <Check className="mt-px h-3.5 w-3.5 shrink-0" /> : <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />}
                  {result.message}
                </p>
                {result.sample && result.sample.length > 0 && (
                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-[10.5px] font-semibold text-emerald-700/80">Show statements</summary>
                    <pre className="mt-1 max-h-52 overflow-auto whitespace-pre-wrap break-all rounded bg-zinc-900 p-2 text-[9px] leading-relaxed text-emerald-300">
                      {result.sample.join("\n\n")}
                    </pre>
                  </details>
                )}
                {result.ok && (
                  <Link href="/desk/queue" className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 hover:underline">
                    See them in the queue <ArrowRight className="h-3 w-3" />
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Meter({ label, value, total, accent }: { label: string; value: number; total: number; accent: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">{label}</span>
        <span className="text-[12px] font-semibold tabular-nums text-zinc-800">{PCT(pct, 1)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-900/[0.06]">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: accent }} />
      </div>
      <p className="mt-0.5 text-[10px] tabular-nums text-zinc-400">{N(value)} of {N(total)}</p>
    </div>
  );
}

/**
 * The join, drawn with live numbers.
 *
 * Inline SVG rather than an image so the labels can be data. Every figure in it
 * came out of the database when this page rendered.
 */
function Mechanism({ book, projected, olb }: {
  book: { entityId: number; borrowers: number; loansOpen: number; products: { id: number; name: string; loans: number; olb: number }[] };
  projected: number;
  olb: number;
}) {
  return (
    <div className="overflow-x-auto">
      <svg viewBox="0 0 900 200" className="w-full min-w-[760px]" role="img" aria-label="How the Fintech pipeline joins Serviceconnect to CollectBox">
        <defs>
          <marker id="pipe-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
          </marker>
        </defs>

        {/* Serviceconnect */}
        <g>
          <rect x="8" y="30" width="250" height="140" rx="10" fill="#f1f5f9" stroke="#cbd5e1" />
          <text x="24" y="54" className="fill-zinc-500" style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em" }}>SERVICECONNECT</text>
          <text x="24" y="76" className="fill-zinc-900" style={{ fontSize: 14, fontWeight: 700 }}>Entity {book.entityId} · Fintech</text>
          <text x="24" y="98" className="fill-zinc-600" style={{ fontSize: 11 }}>{book.borrowers.toLocaleString()} borrowers</text>
          <text x="24" y="116" className="fill-zinc-600" style={{ fontSize: 11 }}>{book.loansOpen.toLocaleString()} open loans</text>
          <text x="24" y="134" className="fill-zinc-600" style={{ fontSize: 11 }}>
            {book.products.map((p) => p.name).join(" · ") || "Micro Eazy"}
          </text>
          <text x="24" y="154" className="fill-zinc-400" style={{ fontSize: 10 }}>dbo.Loans · dbo.Borrowers · dbo.loanSchedule</text>
        </g>

        {/* The bridge */}
        <g>
          <line x1="262" y1="100" x2="356" y2="100" stroke="var(--accent)" strokeWidth="2" markerEnd="url(#pipe-arrow)" />
          <rect x="360" y="52" width="180" height="96" rx="10" fill="var(--accent)" fillOpacity="0.08" stroke="var(--accent)" strokeOpacity="0.35" />
          <text x="450" y="76" textAnchor="middle" className="fill-zinc-900" style={{ fontSize: 12, fontWeight: 700 }}>The bridge</text>
          <text x="450" y="95" textAnchor="middle" className="fill-zinc-600" style={{ fontSize: 10 }}>age from loanSchedule</text>
          <text x="450" y="110" textAnchor="middle" className="fill-zinc-600" style={{ fontSize: 10 }}>band · assign · commission</text>
          <text x="450" y="130" textAnchor="middle" style={{ fontSize: 11, fontWeight: 700, fill: "var(--accent)" }}>
            {projected} cases · KES {Math.round(olb).toLocaleString("en-KE")}
          </text>
          <line x1="544" y1="100" x2="638" y2="100" stroke="var(--accent)" strokeWidth="2" markerEnd="url(#pipe-arrow)" />
        </g>

        {/* CollectBox */}
        <g>
          <rect x="642" y="30" width="250" height="140" rx="10" fill="#f1f5f9" stroke="#cbd5e1" />
          <text x="658" y="54" className="fill-zinc-500" style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em" }}>COLLECTBOX</text>
          <text x="658" y="76" className="fill-zinc-900" style={{ fontSize: 14, fontWeight: 700 }}>The collections floor</text>
          <text x="658" y="98" className="fill-zinc-600" style={{ fontSize: 11 }}>dbo.CollectionTracker</text>
          <text x="658" y="116" className="fill-zinc-600" style={{ fontSize: 11 }}>dbo.CallLogs · dbo.PayedAmount</text>
          <text x="658" y="134" className="fill-zinc-600" style={{ fontSize: 11 }}>dbo.PromisedToPay</text>
          <text x="658" y="154" className="fill-zinc-400" style={{ fontSize: 10 }}>same SQL Server · same instance</text>
        </g>

        <text x="450" y="188" textAnchor="middle" className="fill-zinc-400" style={{ fontSize: 10 }}>
          Both databases are on host &ldquo;services&rdquo;. Nothing moves — only a reference crosses.
        </text>
      </svg>
    </div>
  );
}
