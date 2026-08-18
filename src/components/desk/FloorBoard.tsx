"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE FLOOR BOARD — the live collections screen.
//
// ── HOW THIS IS LAID OUT, AND WHY ────────────────────────────────────────────
// Four tiles across the top: today's cash, the book under management, the floor's
// headcount, and the promises outstanding. Those are the four numbers a
// collections manager would ask for on the phone, so they are the four that get
// hero treatment and no chart.
//
// Below them the screen splits. On the left, the shape of the book — a
// horizontal bar per band, because the reader is comparing magnitudes across a
// short ORDERED list and bars share a baseline while a donut makes you compare
// angles. On the right, the day's rhythm by hour and the thirty-day trend, both
// as columns with a hover layer.
//
// Then the two things that make this a *connected* system rather than a
// collections report: the agent board, ranked by CASH rather than by dials, and
// the cross-system activity stream where a call logged here, a payment landing
// on their PBX and a loan disbursed in the core ledger appear in one list.
//
// ── ONE RULE ABOUT THE NUMBERS ───────────────────────────────────────────────
// Recovered, promised and contacted are three different quantities and are never
// added together. Recovered is cash. Promised is a forecast. Contacted is
// activity. A floor managed on a screen that blends them is a floor managed on
// a number that means nothing.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import Link from "next/link";
import { Phone, TrendingUp, Users, Handshake, ArrowRight } from "lucide-react";
import {
  Card, CardHead, PageHead, Stat, Chip, Tag, BarRow, Columns, LivePulse,
  KES, N, PCT, ago, shortTime, Empty,
} from "@/components/suite/kit";

type Band = {
  id: number; name: string; short: string; accent: string; commission: number;
  loans: number; olb: number; assigned: number; actioned: number; promises: number; recoveredToday: number;
};
type Agent = {
  agentId: number; name: string; recovered: number; payments: number; assigned: number;
  assignedOlb: number; commission: number; calls: number; contactRate: number; lastActivityAt: string | null;
};
type Feed = {
  id: string; at: string; system: string; kind: string; headline: string; detail: string;
  subject: string; actor: string | null; amount: number | null; tone: string; tags: string[]; loanId: number;
};

export default function FloorBoard({
  bands, totals, trackerLastWrite, lastPaymentAt, agents, pulse, trend, feed,
}: {
  bands: Band[];
  totals: {
    loans: number; olb: number; assigned: number; actioned: number; agentsOnFloor: number;
    recoveredToday: number; paymentsToday: number; callsToday: number; promisesOpen: number;
  };
  trackerLastWrite: string | null;
  lastPaymentAt: string | null;
  agents: Agent[];
  pulse: { hour: number; recovered: number; payments: number; agents: number }[];
  trend: { day: string; recovered: number; payments: number }[];
  feed: Feed[];
}) {
  const [bandView, setBandView] = useState<"olb" | "loans" | "recovered">("olb");

  const maxBand = useMemo(
    () => Math.max(...bands.map((b) => (bandView === "olb" ? b.olb : bandView === "loans" ? b.loans : b.recoveredToday)), 1),
    [bands, bandView],
  );

  // Yesterday against today, for the delta on the cash tile. `trend` ends today.
  const yesterday = trend.length >= 2 ? trend[trend.length - 2].recovered : 0;
  const cashDelta = yesterday > 0 ? ((totals.recoveredToday - yesterday) / yesterday) * 100 : null;

  // The working day, not the calendar day: nobody needs six empty columns for
  // the small hours, and dropping them lets the ones that matter be wider.
  const workingHours = pulse.filter((p) => p.hour >= 6 && p.hour <= 22);
  const trendCols = trend.slice(-30).map((t) => ({
    label: t.day.slice(5),
    value: t.recovered,
    sub: `${N(t.payments)} payments`,
  }));

  const totalCommission = agents.reduce((s, a) => s + a.commission, 0);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <PageHead
        eyebrow="ConnectDesk"
        title="The live floor"
        sub="Micromart's collections book, read from CollectBox and the core ledger at the moment this page rendered. Nothing here is cached."
        right={<LivePulse label={`${totals.agentsOnFloor} agents`} at={lastPaymentAt} />}
      />

      {/* ── The four numbers ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Recovered today"
          value={KES(totals.recoveredToday)}
          unit="KES"
          delta={cashDelta}
          deltaLabel="vs yesterday"
          tone="up-good"
          spark={trend.slice(-14).map((t) => t.recovered)}
          foot={`${N(totals.paymentsToday)} payments · last ${ago(lastPaymentAt)}`}
        />
        <Stat
          label="Book under collection"
          value={KES(totals.olb, { compact: true })}
          unit="KES"
          foot={`${N(totals.loans)} loans tracked · ${PCT((totals.assigned / Math.max(totals.loans, 1)) * 100, 0)} assigned to an agent`}
        />
        <Stat
          label="On the floor"
          value={String(totals.agentsOnFloor)}
          unit="agents"
          foot={`${N(totals.callsToday)} dispositions logged today`}
        />
        <Stat
          label="Promises outstanding"
          value={N(totals.promisesOpen)}
          foot={`Commission earned today ${KES(totalCommission)}`}
        />
      </div>

      {/* ── The shape of the book, and the shape of the day ───────────────── */}
      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <Card>
          <CardHead
            title="Where the book is sitting"
            sub="Seven queues, ordered by severity. Colour carries the rung; the code carries the name."
            right={
              <div className="flex rounded-lg bg-zinc-900/[0.045] p-0.5">
                {(["olb", "loans", "recovered"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setBandView(v)}
                    className={`rounded-md px-2 py-1 text-[10.5px] font-semibold transition-colors ${
                      bandView === v ? "bg-white text-zinc-800 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                    }`}
                  >
                    {v === "olb" ? "Balance" : v === "loans" ? "Loans" : "Today"}
                  </button>
                ))}
              </div>
            }
          />
          <div className="space-y-0.5">
            {bands.map((b) => {
              const value = bandView === "olb" ? b.olb : bandView === "loans" ? b.loans : b.recoveredToday;
              return (
                <BarRow
                  key={b.id}
                  label={b.name}
                  chip={<Chip label={b.short} accent={b.accent} title={`${b.name} · ${b.commission}% commission`} />}
                  value={value}
                  max={maxBand}
                  accent={b.accent}
                  right={bandView === "loans" ? N(value) : KES(value, { compact: true })}
                />
              );
            })}
          </div>
          <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-900/[0.06] pt-2.5">
            <p className="text-[10.5px] text-zinc-400">
              Tracker last written {ago(trackerLastWrite)} · {N(totals.actioned)} of {N(totals.loans)} cases actioned
            </p>
            <Link href="/desk/queue" className="inline-flex items-center gap-1 text-[11px] font-semibold text-[color:var(--accent)] hover:underline">
              Work the queue <ArrowRight className="h-3 w-3" />
            </Link>
          </footer>
        </Card>

        <div className="grid gap-3">
          <Card>
            <CardHead title="Today, by hour" sub="When the money actually arrives — the shape a shift is managed on." />
            {workingHours.some((h) => h.recovered > 0) ? (
              <Columns
                data={workingHours.map((h) => ({
                  label: `${h.hour}h`,
                  value: h.recovered,
                  sub: `${N(h.payments)} payments · ${h.agents} agents`,
                }))}
                height={104}
              />
            ) : (
              <Empty title="Nothing recovered yet today" detail="The first payments usually land after 08:00." />
            )}
          </Card>

          <Card>
            <CardHead title="Thirty days" sub="Daily recovery. The weekly rhythm is the floor's roster showing through." />
            <Columns data={trendCols} height={104} accent="#0d9488" />
          </Card>
        </div>
      </div>

      {/* ── The people, and the pulse ─────────────────────────────────────── */}
      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
        <Card>
          <CardHead
            title="The floor today"
            sub="Ranked by cash recovered, not by calls made. Commission is weighted by the band each shilling came out of."
            right={
              <Link href="/desk/agents" className="text-[11px] font-semibold text-[color:var(--accent)] hover:underline">
                All agents
              </Link>
            }
          />
          {agents.length === 0 ? (
            <Empty title="No agent activity recorded today" />
          ) : (
            <div className="-mx-1 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left">
                <thead>
                  <tr className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-zinc-400">
                    <th className="px-1 pb-1.5 font-bold">Agent</th>
                    <th className="px-1 pb-1.5 text-right font-bold">Recovered</th>
                    <th className="px-1 pb-1.5 text-right font-bold">Pmts</th>
                    <th className="px-1 pb-1.5 text-right font-bold">Book</th>
                    <th className="px-1 pb-1.5 text-right font-bold">Comm.</th>
                    <th className="px-1 pb-1.5 text-right font-bold">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((a, i) => {
                    const top = agents[0]?.recovered || 1;
                    return (
                      <tr key={a.agentId} className="group border-t border-zinc-900/[0.05]">
                        <td className="px-1 py-1.5">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="w-4 shrink-0 text-right text-[10px] font-bold tabular-nums text-zinc-300">{i + 1}</span>
                            <span className="min-w-0">
                              <span className="block truncate text-[12px] font-medium text-zinc-800">{a.name}</span>
                              {/* The bar is the comparison; the number beside it is the value.
                                  Both, because a bar alone cannot be read off a projector. */}
                              <span className="mt-0.5 block h-1 w-24 overflow-hidden rounded-full bg-zinc-900/[0.06]">
                                <span
                                  className="block h-full rounded-full"
                                  style={{ width: `${(a.recovered / top) * 100}%`, backgroundColor: "var(--accent)" }}
                                />
                              </span>
                            </span>
                          </span>
                        </td>
                        <td className="px-1 py-1.5 text-right text-[12px] font-semibold tabular-nums text-zinc-800">{KES(a.recovered)}</td>
                        <td className="px-1 py-1.5 text-right text-[11.5px] tabular-nums text-zinc-500">{N(a.payments)}</td>
                        <td className="px-1 py-1.5 text-right text-[11.5px] tabular-nums text-zinc-500">{N(a.assigned)}</td>
                        <td className="px-1 py-1.5 text-right text-[11.5px] tabular-nums text-zinc-500">{KES(a.commission)}</td>
                        <td className="px-1 py-1.5 text-right text-[10.5px] tabular-nums text-zinc-400">{ago(a.lastActivityAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHead
            title="Across the suite"
            sub="Calls, payments and disbursements from every system, in one stream."
            right={
              <Link href="/desk/activity" className="text-[11px] font-semibold text-[color:var(--accent)] hover:underline">
                Full stream
              </Link>
            }
          />
          <ol className="max-h-[420px] space-y-px overflow-y-auto pr-1">
            {feed.map((f) => (
              <li key={f.id}>
                <Link
                  href={`/desk/case/${f.loanId}`}
                  className="flex items-start gap-2.5 rounded-lg px-1.5 py-2 transition-colors hover:bg-zinc-900/[0.03]"
                >
                  <span
                    aria-hidden
                    className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor:
                        f.tone === "positive" ? "#059669" : f.tone === "negative" ? "#dc2626" : f.tone === "warning" ? "#d97706" : "#94a3b8",
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[12px] font-medium text-zinc-800">{f.headline}</span>
                      <span className="shrink-0 text-[10px] tabular-nums text-zinc-400">{shortTime(f.at)}</span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 truncate text-[10.5px] text-zinc-500">
                      <span className="truncate">{f.subject}</span>
                      {f.actor && <span className="truncate text-zinc-400">· {f.actor}</span>}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      <Tag tone={f.system === "Call Centre" ? "info" : f.system === "Fintech Pipeline" ? "good" : "neutral"}>{f.system}</Tag>
                      {f.tags.slice(0, 2).filter((t) => t && t !== "Payment" && t !== "Call").map((t) => (
                        <Tag key={t}>{t}</Tag>
                      ))}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      {/* ── The provenance line ───────────────────────────────────────────── */}
      <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-zinc-400">
        <span className="inline-flex items-center gap-1"><TrendingUp className="h-3 w-3" /> CollectBox.PayedAmount · PaymentHistory</span>
        <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" /> CollectBox.CallLogs · CollectionTracker</span>
        <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" /> CollectBox.UserMaster · Serviceconnect.CollectionAgents</span>
        <span className="inline-flex items-center gap-1"><Handshake className="h-3 w-3" /> CollectBox.PromisedToPay</span>
      </p>
    </div>
  );
}
