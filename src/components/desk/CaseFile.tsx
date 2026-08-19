"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE CASE FILE — three columns, and each one answers a different question.
//
//   LEFT    Who is this?          the person, their officer, their whole book
//   CENTRE  What happened?        the merged timeline across all five sources
//   RIGHT   What do I do now?     the disposition form, and it is the point
//
// ── THE DISPOSITION FORM IS THE PRODUCT ──────────────────────────────────────
// Everything else on this screen is context for one action: recording what
// happened on this call. So the form is never more than one click away, it
// enforces the rules the vocabulary carries (a "Promised to pay" without an
// amount and a date is refused, because it is not a promise), and it tells the
// agent — before they submit — exactly what will be written and where.
//
// ── THE SHADOW BANNER IS NOT A DISCLAIMER ────────────────────────────────────
// It is the most important control on the page. CollectBox is a live production
// database for a business running right now. An agent has to be able to see, at
// a glance and without asking anyone, whether what they are about to do lands in
// Micromart's real ledger or is recorded here for review. That state is never
// implied and never inferred from context.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Phone, ShieldCheck, ShieldAlert, Check, Loader2, CalendarClock,
  UserRoundPlus, MessageSquarePlus, TriangleAlert,
} from "lucide-react";
import {
  Card, CardHead, Chip, Tag, Btn, KES, N, PCT, ago, shortDate, Empty, TimeAgo,
} from "@/components/suite/kit";

type Disposition = {
  id: number; name: string; callStatus: number; requiresPromise: boolean;
  schedulesTask: boolean; suppresses: boolean; accent: string; meaning: string;
};
type TimelineItem = {
  id: string; at: string; system: string; kind: string; headline: string; detail: string;
  actor: string | null; actorRole: string | null; amount: number | null; tone: string; tags: string[];
};

export default function CaseFile({
  canWork, posture, subject, row, borrower, loans, totals, timeline, dispositions, agents,
}: {
  canWork: boolean;
  posture: { armed: boolean; label: string; detail: string };
  subject: { loanId: number; borrowerId: number; entityId: number; categoryId: number; name: string; phone: string };
  row: {
    dpd: number;
    band: { id: number; short: string; name: string; accent: string; posture: string; commission: number };
    olb: number; amountDue: number; instalment: number; product: string;
    agentName: string | null; agentId: number | null; actioned: boolean;
    lastActionAt: string | null; lastComment: string; lastCallAt: string | null;
    callCount: number; recovered30d: number; ptpDate: string | null; ptpAmount: number;
    expectedClearDate: string | null;
  };
  borrower: {
    id: number; name: string; phone: string; altPhone: string; nationalId: string; email: string;
    branch: string; officer: string | null; officerPhone: string | null; creditScore: number;
    loanLimit: number; riskCategory: string; since: string | null; address: string;
  };
  loans: { id: number; product: string; amount: number; balance: number; borrowedAt: string | null; clearedAt: string | null; cleared: boolean; dpd: number }[];
  totals: { taken: number; repaid: number; outstanding: number; loansCleared: number; loansTotal: number };
  timeline: TimelineItem[];
  dispositions: Disposition[];
  agents: { id: number; name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [chosen, setChosen] = useState<Disposition | null>(null);
  const [comment, setComment] = useState("");
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 3);
    return d.toISOString().slice(0, 10);
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; sql?: string | null } | null>(null);
  const [showAll, setShowAll] = useState(false);

  const needsPromise = chosen?.requiresPromise ?? false;
  const canSubmit = !!chosen && (!needsPromise || (Number(amount) > 0 && !!due));

  async function submit() {
    if (!chosen || !canSubmit) return;
    setBusy(true); setResult(null);
    try {
      const res = await fetch("/api/desk/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loanId: subject.loanId,
          borrowerId: subject.borrowerId,
          entityId: subject.entityId,
          categoryId: subject.categoryId,
          name: subject.name,
          phone: subject.phone,
          dispositionId: chosen.id,
          comment: comment.trim() || undefined,
          promiseAmount: needsPromise ? Number(amount) : undefined,
          promiseDate: needsPromise ? due : undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.message ?? `Request failed (${res.status})`);
      setResult({
        ok: true,
        message: j.mirrorState === "MIRRORED"
          ? "Recorded here and written into CollectBox."
          : "Recorded here. The CollectBox statement was composed and stored for review — nothing was written to Micromart's database.",
        sql: j.shadowSql,
      });
      setChosen(null); setComment(""); setAmount("");
      start(() => router.refresh());
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  }

  const shown = showAll ? timeline : timeline.slice(0, 25);
  const repaidPct = totals.taken > 0 ? (totals.repaid / totals.taken) * 100 : 0;

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/desk/queue" className="mb-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-500 hover:text-zinc-800">
            <ArrowLeft className="h-3 w-3" /> Queue
          </Link>
          <h1 className="flex flex-wrap items-center gap-2 text-[22px] font-bold leading-tight tracking-[-0.018em] text-zinc-900">
            {borrower.name}
            <Chip label={row.band.short} accent={row.band.accent} title={row.band.name} />
            {subject.entityId === 3005 && <Tag tone="good">Micromart Fintech</Tag>}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-zinc-500">
            <span className="tabular-nums">{borrower.phone || "no number on file"}</span>
            <span aria-hidden>·</span>
            <span>ID {borrower.nationalId || "—"}</span>
            <span aria-hidden>·</span>
            <span>{borrower.branch}</span>
            <span aria-hidden>·</span>
            <span>Loan #{subject.loanId}</span>
            <span aria-hidden>·</span>
            <span>Customer since {shortDate(borrower.since)}</span>
          </p>
        </div>

        {/* The write posture. Never implied. */}
        <div
          className={`flex max-w-sm items-start gap-2 rounded-xl border px-3 py-2 ${
            posture.armed ? "border-red-500/30 bg-red-500/[0.05]" : "border-amber-500/30 bg-amber-500/[0.06]"
          }`}
        >
          {posture.armed ? (
            <ShieldAlert className="mt-px h-4 w-4 shrink-0 text-red-600" />
          ) : (
            <ShieldCheck className="mt-px h-4 w-4 shrink-0 text-amber-600" />
          )}
          <span className="min-w-0">
            <span className={`block text-[11.5px] font-bold ${posture.armed ? "text-red-800" : "text-amber-800"}`}>
              {posture.label}
            </span>
            <span className={`mt-0.5 block text-[10.5px] leading-snug ${posture.armed ? "text-red-700/85" : "text-amber-800/85"}`}>
              {posture.detail}
            </span>
          </span>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[300px_minmax(0,1fr)_340px]">
        {/* ── LEFT: who is this ───────────────────────────────────────────── */}
        <div className="space-y-3">
          <Card>
            <CardHead title="This loan" accent={row.band.accent} />
            <dl className="space-y-2 text-[12px]">
              <Line k="Outstanding" v={`KES ${KES(row.olb)}`} strong />
              <Line k="Instalment due" v={row.amountDue > 0 ? `KES ${KES(row.amountDue)}` : "—"} />
              <Line k="Days in arrears" v={`${N(row.dpd)}`} />
              <Line k="Instalment no." v={row.instalment ? String(row.instalment) : "—"} />
              <Line k="Product" v={row.product} />
              <Line k="Expected clear" v={shortDate(row.expectedClearDate)} />
              <Line k="Paid last 30 days" v={row.recovered30d > 0 ? `KES ${KES(row.recovered30d)}` : "nothing"} />
            </dl>
            <p className="mt-3 rounded-lg bg-zinc-900/[0.035] px-2.5 py-2 text-[11px] leading-relaxed text-zinc-600">
              {row.band.posture}
            </p>
            {row.band.commission > 0 && (
              <p className="mt-1.5 text-[10.5px] text-zinc-400">
                Recovery from this queue earns {row.band.commission}% commission.
              </p>
            )}
          </Card>

          <Card>
            <CardHead title="The relationship" sub={`${totals.loansTotal} loans · ${totals.loansCleared} cleared in full`} />
            <div className="mb-3">
              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Lifetime repaid</span>
                <span className="text-[11.5px] font-semibold tabular-nums text-zinc-700">{PCT(repaidPct, 0)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-900/[0.06]">
                <div className="h-full rounded-full bg-emerald-600" style={{ width: `${Math.min(100, repaidPct)}%` }} />
              </div>
              <p className="mt-1 text-[10.5px] text-zinc-400">
                KES {KES(totals.repaid)} repaid of KES {KES(totals.taken)} taken
              </p>
            </div>
            <dl className="space-y-2 text-[12px]">
              <Line k="Credit score" v={borrower.creditScore ? N(borrower.creditScore) : "—"} />
              <Line k="Loan limit" v={borrower.loanLimit ? `KES ${KES(borrower.loanLimit)}` : "—"} />
              <Line k="Risk band" v={borrower.riskCategory || "—"} />
            </dl>
          </Card>

          <Card>
            <CardHead title="Who owns them" sub="Two people can help this customer, and the second is usually forgotten." />
            <div className="space-y-2.5">
              <Person
                role="Relationship officer"
                name={borrower.officer ?? "Unassigned"}
                detail={borrower.officerPhone ?? "no number on file"}
                note="Originated and manages the lending relationship."
              />
              <Person
                role="Collections agent"
                name={row.agentName ?? "Unassigned"}
                detail={row.actioned ? <>Last worked <TimeAgo at={row.lastActionAt} /></> : "Not yet worked"}
                note={row.lastComment || undefined}
              />
            </div>
          </Card>

          <Card>
            <CardHead title="Every loan" sub="The whole book, oldest to newest." />
            <ol className="max-h-72 space-y-1 overflow-y-auto pr-1">
              {loans.map((l) => (
                <li
                  key={l.id}
                  className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 ${
                    l.id === subject.loanId ? "bg-[color:var(--accent)]/[0.07] ring-1 ring-[color:var(--accent)]/20" : ""
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[11.5px] font-medium text-zinc-700">{l.product}</span>
                    <span className="block text-[10px] tabular-nums text-zinc-400">{shortDate(l.borrowedAt)}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-[11.5px] font-semibold tabular-nums text-zinc-700">{KES(l.amount)}</span>
                    {l.cleared
                      ? <Tag tone="good">Cleared</Tag>
                      : <span className="block text-[10px] tabular-nums text-zinc-400">{KES(l.balance)} left</span>}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        {/* ── CENTRE: what happened ───────────────────────────────────────── */}
        <Card>
          <CardHead
            title="Everything that has ever happened"
            sub={`${N(timeline.length)} interactions, merged from the call centre, the core ledger, the PBX and this desk.`}
            right={
              <span className="flex flex-wrap items-center gap-1">
                {[...new Set(timeline.map((t) => t.system))].map((s) => (
                  <Tag key={s} tone={s === "Call Centre" ? "info" : s === "Fintech Pipeline" ? "good" : "neutral"}>{s}</Tag>
                ))}
              </span>
            }
          />
          {timeline.length === 0 ? (
            <Empty title="No interactions on record" detail="Nobody has called, messaged or taken a payment against this customer yet." />
          ) : (
            <>
              <ol className="relative space-y-0 border-l border-zinc-900/[0.08] pl-4">
                {shown.map((t) => (
                  <li key={t.id} className="relative pb-3.5 last:pb-0">
                    <span
                      aria-hidden
                      className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full ring-2 ring-white"
                      style={{
                        backgroundColor:
                          t.tone === "positive" ? "#059669" : t.tone === "negative" ? "#dc2626" : t.tone === "warning" ? "#d97706" : "#a1a1aa",
                      }}
                    />
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <p className="text-[12.5px] font-semibold text-zinc-800">{t.headline}</p>
                      <p className="text-[10.5px] tabular-nums text-zinc-400">
                        {new Date(t.at).toLocaleString("en-KE", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    {t.detail && <p className="mt-0.5 text-[11.5px] leading-relaxed text-zinc-500">{t.detail}</p>}
                    <p className="mt-1 flex flex-wrap items-center gap-1">
                      <Tag tone={t.system === "Call Centre" ? "info" : t.system === "Fintech Pipeline" ? "good" : "neutral"}>{t.system}</Tag>
                      {t.actor && <span className="text-[10.5px] text-zinc-400">{t.actor}{t.actorRole ? ` · ${t.actorRole}` : ""}</span>}
                      {t.tags.filter((x) => x && !["Payment", "Call"].includes(x)).slice(0, 3).map((x) => <Tag key={x}>{x}</Tag>)}
                    </p>
                  </li>
                ))}
              </ol>
              {timeline.length > 25 && !showAll && (
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="mt-3 w-full rounded-lg border border-zinc-900/10 py-1.5 text-[11.5px] font-semibold text-zinc-600 hover:bg-zinc-900/[0.03]"
                >
                  Show all {N(timeline.length)} interactions
                </button>
              )}
            </>
          )}
        </Card>

        {/* ── RIGHT: what do I do now ─────────────────────────────────────── */}
        <div className="space-y-3">
          <Card>
            <CardHead
              title="Log this call"
              sub={row.callCount > 0 ? <>{N(row.callCount)} calls already on file · last <TimeAgo at={row.lastCallAt} /></> : "No calls logged against this loan yet."}
            />

            {!canWork ? (
              <p className="rounded-lg bg-zinc-900/[0.035] px-3 py-2.5 text-[11.5px] leading-relaxed text-zinc-500">
                You have read access to the floor but not <code className="text-[10.5px]">collections.manage</code>, so dispositions
                cannot be recorded from this account.
              </p>
            ) : (
              <>
                <div className="mb-3 grid grid-cols-2 gap-1.5">
                  {dispositions.map((d) => {
                    const on = chosen?.id === d.id;
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => { setChosen(on ? null : d); setResult(null); }}
                        title={d.meaning}
                        className={`rounded-lg border px-2 py-1.5 text-left text-[11px] font-semibold transition-colors ${
                          on ? "border-transparent text-white" : "border-zinc-900/10 bg-white text-zinc-600 hover:bg-zinc-900/[0.03]"
                        }`}
                        style={on ? { backgroundColor: d.accent } : undefined}
                      >
                        <span className="flex items-center gap-1.5">
                          <span
                            aria-hidden
                            className="h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ backgroundColor: on ? "rgba(255,255,255,0.85)" : d.accent }}
                          />
                          <span className="truncate">{d.name}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                {chosen && (
                  <div className="space-y-2.5">
                    <p className="rounded-lg bg-zinc-900/[0.035] px-2.5 py-2 text-[11px] leading-relaxed text-zinc-600">
                      {chosen.meaning}
                    </p>

                    {needsPromise && (
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-zinc-400">Amount (KES)</span>
                          <input
                            type="number"
                            min={1}
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="0"
                            className="w-full rounded-lg border border-zinc-900/12 px-2 py-1.5 text-[12px] tabular-nums outline-none focus:border-[color:var(--accent)]"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-zinc-400">By</span>
                          <input
                            type="date"
                            value={due}
                            onChange={(e) => setDue(e.target.value)}
                            className="w-full rounded-lg border border-zinc-900/12 px-2 py-1.5 text-[12px] tabular-nums outline-none focus:border-[color:var(--accent)]"
                          />
                        </label>
                      </div>
                    )}

                    <label className="block">
                      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-zinc-400">What was said</span>
                      <textarea
                        rows={3}
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="The next agent to open this case reads this first."
                        className="w-full resize-y rounded-lg border border-zinc-900/12 px-2 py-1.5 text-[12px] leading-relaxed outline-none focus:border-[color:var(--accent)]"
                      />
                    </label>

                    {/* What is about to happen, before it happens. */}
                    <div className="rounded-lg border border-zinc-900/[0.08] bg-zinc-900/[0.02] px-2.5 py-2">
                      <p className="mb-1 text-[9.5px] font-bold uppercase tracking-[0.1em] text-zinc-400">This will</p>
                      <ul className="space-y-0.5 text-[11px] text-zinc-600">
                        <li>· record the disposition on this case, here</li>
                        {needsPromise && <li>· create a tracked promise to pay</li>}
                        {chosen.schedulesTask && <li>· suggest a follow-up task</li>}
                        {chosen.suppresses && <li>· flag this number to stop being dialled</li>}
                        <li className={posture.armed ? "font-semibold text-red-700" : "font-semibold text-amber-700"}>
                          · {posture.armed
                            ? "write into CollectBox.CallLogs and update the tracker"
                            : "compose the CollectBox statement and store it, unrun"}
                        </li>
                      </ul>
                    </div>

                    <Btn variant="solid" onClick={submit} disabled={!canSubmit || busy}>
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Phone className="h-3.5 w-3.5" />}
                      {busy ? "Recording…" : `Record ${chosen.name}`}
                    </Btn>
                    {!canSubmit && needsPromise && (
                      <p className="flex items-start gap-1 text-[10.5px] text-amber-700">
                        <TriangleAlert className="mt-px h-3 w-3 shrink-0" />
                        A promise needs an amount and a date. Without both it is not a promise and cannot be chased.
                      </p>
                    )}
                  </div>
                )}

                {result && (
                  <div
                    className={`mt-3 rounded-lg border px-2.5 py-2 ${
                      result.ok ? "border-emerald-500/25 bg-emerald-500/[0.06]" : "border-red-500/25 bg-red-500/[0.05]"
                    }`}
                  >
                    <p className={`flex items-start gap-1.5 text-[11.5px] font-medium ${result.ok ? "text-emerald-800" : "text-red-800"}`}>
                      {result.ok ? <Check className="mt-px h-3.5 w-3.5 shrink-0" /> : <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />}
                      {result.message}
                    </p>
                    {result.sql && (
                      <details className="mt-1.5">
                        <summary className="cursor-pointer text-[10.5px] font-semibold text-emerald-700/80">
                          Show the statement that was composed
                        </summary>
                        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-zinc-900 p-2 text-[9.5px] leading-relaxed text-emerald-300">
                          {result.sql}
                        </pre>
                      </details>
                    )}
                  </div>
                )}
              </>
            )}
          </Card>

          {canWork && <QuickActions subject={subject} agents={agents} currentAgentId={row.agentId} onDone={() => start(() => router.refresh())} />}

          {row.ptpDate && (
            <Card>
              <CardHead title="Promise on file" accent="#16a34a" />
              <p className="text-[19px] font-bold tabular-nums text-zinc-900">KES {KES(row.ptpAmount)}</p>
              <p className="mt-0.5 text-[11.5px] text-zinc-500">
                due {new Date(row.ptpDate).toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" })}
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Line({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="shrink-0 text-[11px] text-zinc-400">{k}</dt>
      <dd className={`min-w-0 truncate text-right tabular-nums ${strong ? "text-[13px] font-bold text-zinc-900" : "text-[12px] text-zinc-700"}`}>{v}</dd>
    </div>
  );
}

function Person({ role, name, detail, note }: { role: string; name: string; detail: React.ReactNode; note?: string }) {
  return (
    <div className="rounded-lg border border-zinc-900/[0.07] px-2.5 py-2">
      <p className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-zinc-400">{role}</p>
      <p className="mt-0.5 truncate text-[12.5px] font-semibold text-zinc-800">{name}</p>
      <p className="truncate text-[10.5px] tabular-nums text-zinc-500">{detail}</p>
      {note && <p className="mt-1 line-clamp-2 text-[10.5px] italic leading-snug text-zinc-400">“{note}”</p>}
    </div>
  );
}

/** Reassign, schedule, note, escalate — the actions that are not a disposition. */
function QuickActions({
  subject, agents, currentAgentId, onDone,
}: {
  subject: { loanId: number; borrowerId: number; entityId: number; categoryId: number; name: string; phone: string };
  agents: { id: number; name: string }[];
  currentAgentId: number | null;
  onDone: () => void;
}) {
  const [open, setOpen] = useState<"task" | "assign" | "note" | "escalate" | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [when, setWhen] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); });
  const [toAgent, setToAgent] = useState(String(currentAgentId ?? agents[0]?.id ?? ""));
  const [action, setAction] = useState<"1" | "2" | "3">("1");
  const [to, setTo] = useState<"field" | "legal" | "supervisor">("field");

  async function post(path: string, body: Record<string, unknown>) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...subject, ...body }),
      });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.message ?? "Failed");
      setMsg(j.mirrorState === "MIRRORED" ? "Done — written to CollectBox." : "Done — recorded here, CollectBox statement stored unrun.");
      setOpen(null); setText("");
      onDone();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHead title="Other actions" sub="Everything that is not a disposition." />
      <div className="grid grid-cols-2 gap-1.5">
        <Btn variant="outline" size="sm" onClick={() => setOpen(open === "task" ? null : "task")}>
          <CalendarClock className="h-3 w-3" /> Schedule
        </Btn>
        <Btn variant="outline" size="sm" onClick={() => setOpen(open === "assign" ? null : "assign")}>
          <UserRoundPlus className="h-3 w-3" /> Reassign
        </Btn>
        <Btn variant="outline" size="sm" onClick={() => setOpen(open === "note" ? null : "note")}>
          <MessageSquarePlus className="h-3 w-3" /> Add note
        </Btn>
        <Btn variant="outline" size="sm" onClick={() => setOpen(open === "escalate" ? null : "escalate")}>
          <TriangleAlert className="h-3 w-3" /> Escalate
        </Btn>
      </div>

      {open && (
        <div className="mt-3 space-y-2 rounded-lg border border-zinc-900/[0.08] p-2.5">
          {open === "task" && (
            <>
              <select value={action} onChange={(e) => setAction(e.target.value as "1" | "2" | "3")} className="w-full rounded-lg border border-zinc-900/12 px-2 py-1.5 text-[12px] outline-none">
                <option value="1">Call debtor</option>
                <option value="2">Meet debtor</option>
                <option value="3">Field visit</option>
              </select>
              <input type="date" value={when} onChange={(e) => setWhen(e.target.value)} className="w-full rounded-lg border border-zinc-900/12 px-2 py-1.5 text-[12px] tabular-nums outline-none" />
              <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Why" className="w-full resize-y rounded-lg border border-zinc-900/12 px-2 py-1.5 text-[12px] outline-none" />
              <Btn variant="solid" size="sm" disabled={busy} onClick={() => post("/api/desk/task", { action: Number(action), when, note: text })}>
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Schedule
              </Btn>
            </>
          )}
          {open === "assign" && (
            <>
              <select value={toAgent} onChange={(e) => setToAgent(e.target.value)} className="w-full rounded-lg border border-zinc-900/12 px-2 py-1.5 text-[12px] outline-none">
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Reason" className="w-full resize-y rounded-lg border border-zinc-900/12 px-2 py-1.5 text-[12px] outline-none" />
              <Btn variant="solid" size="sm" disabled={busy || !toAgent} onClick={() => post("/api/desk/assign", {
                toAgentId: Number(toAgent),
                toAgentName: agents.find((a) => a.id === Number(toAgent))?.name ?? "agent",
                reason: text,
              })}>
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Reassign
              </Btn>
            </>
          )}
          {open === "note" && (
            <>
              <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="A note stays on this case for whoever opens it next." className="w-full resize-y rounded-lg border border-zinc-900/12 px-2 py-1.5 text-[12px] outline-none" />
              <p className="text-[10.5px] leading-snug text-zinc-400">
                Notes are recorded here only. CollectBox has no note object — inventing a call to carry one would corrupt every contact-rate figure computed from that table.
              </p>
              <Btn variant="solid" size="sm" disabled={busy || !text.trim()} onClick={() => post("/api/desk/note", { note: text })}>
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Add note
              </Btn>
            </>
          )}
          {open === "escalate" && (
            <>
              <select value={to} onChange={(e) => setTo(e.target.value as "field" | "legal" | "supervisor")} className="w-full rounded-lg border border-zinc-900/12 px-2 py-1.5 text-[12px] outline-none">
                <option value="field">Field recovery</option>
                <option value="supervisor">Supervisor</option>
                <option value="legal">Legal</option>
              </select>
              <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Why this needs to leave the phone floor" className="w-full resize-y rounded-lg border border-zinc-900/12 px-2 py-1.5 text-[12px] outline-none" />
              <Btn variant="solid" size="sm" disabled={busy || !text.trim()} onClick={() => post("/api/desk/escalate", { to, reason: text })}>
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Escalate
              </Btn>
            </>
          )}
        </div>
      )}

      {msg && <p className="mt-2 text-[11px] font-medium text-zinc-600">{msg}</p>}
    </Card>
  );
}
