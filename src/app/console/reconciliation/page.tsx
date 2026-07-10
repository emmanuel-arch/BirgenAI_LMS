"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Loader2, AlertTriangle, CheckCircle2, Scale, RefreshCw, ShieldCheck,
  Banknote, EyeOff, Undo2, ExternalLink, Zap,
} from "lucide-react";

// Finance's exceptions queue. Every card is one disagreement between what
// M-Pesa says happened and what the book says happened. The queue empties by
// WORK (allocate, apply, fix) or by an explained decision — never silently.

type Ex = {
  id: string; kind: string; reference: string; severity: "HIGH" | "MEDIUM" | "LOW";
  amountKes: number | null; message: string; meta: Record<string, unknown> | null;
  status: string; detectedAt: string; lastSeenAt: string;
  resolvedAt: string | null; resolvedBy: string | null; resolution: string | null;
};
type Data = {
  open: Ex[]; closed: Ex[];
  tiles: { open: number; high: number; atIssueKes: number };
  lastCheckedAt: string | null;
};

const KIND_LABEL: Record<string, string> = {
  C2B_UNALLOCATED: "Paybill money not on a loan",
  STK_SUCCESS_UNAPPLIED: "Confirmed payment never posted",
  DISB_STUCK: "Payout stuck without confirmation",
  DISB_LOAN_STATE_MISMATCH: "Loan and payout disagree",
  DISB_AMOUNT_MISMATCH: "Payout differs from principal",
  DUP_RECEIPT: "One receipt, several payments",
  FLOAT_DRIFT: "Float ledger out of balance",
};

const SEV_TONE: Record<string, string> = {
  HIGH: "bg-red-100 text-red-700",
  MEDIUM: "bg-amber-100 text-amber-700",
  LOW: "bg-zinc-900/5 text-zinc-500",
};

const kes = (n: number) => `KES ${Math.round(Math.abs(n)).toLocaleString()}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

export default function ReconciliationPage() {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // One inline note form at a time: { id, mode } — the note is mandatory.
  const [noteFor, setNoteFor] = useState<{ id: string; mode: "resolve" | "ignore" } | null>(null);
  const [note, setNote] = useState("");
  const [showClosed, setShowClosed] = useState(false);

  const load = async () => {
    try {
      const res = await fetch("/api/console/reconciliation");
      const d = await res.json();
      if (!d.success) { setError(d.message || "Could not load."); return; }
      setData(d);
    } catch { setError("Could not load."); }
  };
  useEffect(() => { void load(); }, []);

  const post = async (body: Record<string, unknown>, key: string, okMsg?: string) => {
    setBusy(key); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/console/reconciliation", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!d.success) { setError(d.message || "Action failed."); return; }
      setNotice(okMsg ?? (body.action === "sweep"
        ? `Checked. ${d.opened ?? 0} new, ${d.selfHealed ?? 0} self-healed, ${d.stillOpen ?? 0} still open.`
        : "Done."));
      setNoteFor(null); setNote("");
      await load();
    } catch { setError("Action failed."); } finally { setBusy(null); }
  };

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center text-zinc-500">
        {error ? <span className="text-red-600">{error}</span> : <Loader2 className="h-5 w-5 animate-spin" />}
      </div>
    );
  }

  return (
    <div className="min-h-screen relative text-zinc-900">
      <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />
      <main className="relative z-10 mx-auto max-w-4xl px-4 sm:px-6 py-8">
        <Link href="/console" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800">
          <ArrowLeft className="h-4 w-4" /> Console
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Scale className="h-5 w-5" style={{ color: "var(--brand)" }} /> Reconciliation
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Every shilling M-Pesa moved, checked against the book. Checked nightly — or right now.
            </p>
          </div>
          <button onClick={() => post({ action: "sweep" }, "sweep")} disabled={busy !== null}
            className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
            {busy === "sweep" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Check now
          </button>
        </div>

        {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}</div>}
        {notice && <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50/90 px-3 py-2.5 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> {notice}</div>}

        <div className="mt-5 grid grid-cols-3 gap-3">
          <Tile label="Open" value={String(data.tiles.open)} alarm={data.tiles.open > 0} />
          <Tile label="High severity" value={String(data.tiles.high)} alarm={data.tiles.high > 0} />
          <Tile label="At issue" value={kes(data.tiles.atIssueKes)} alarm={data.tiles.atIssueKes > 0} />
        </div>
        {data.lastCheckedAt && (
          <p className="mt-2 text-[11px] text-zinc-400">Last checked {new Date(data.lastCheckedAt).toLocaleString("en-GB")}</p>
        )}

        {data.open.length === 0 ? (
          <div className="mt-6 glass p-8 text-center">
            <ShieldCheck className="mx-auto h-8 w-8 text-emerald-600" />
            <p className="mt-2 text-sm font-semibold">The money and the book agree.</p>
            <p className="mt-1 text-xs text-zinc-500">Nothing is waiting on Finance.</p>
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            {data.open.map((e) => (
              <div key={e.id} className="glass p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${SEV_TONE[e.severity]}`}>{e.severity}</span>
                    <p className="text-sm font-semibold">{KIND_LABEL[e.kind] ?? e.kind}</p>
                  </div>
                  {e.amountKes !== null && (
                    <span className="inline-flex items-center gap-1 text-sm font-bold tabular-nums">
                      <Banknote className="h-3.5 w-3.5 text-zinc-400" /> {kes(e.amountKes)}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm text-zinc-600">{e.message}</p>
                <p className="mt-1.5 text-[11px] text-zinc-400">
                  Detected {day(e.detectedAt)} · last seen {day(e.lastSeenAt)}
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {e.kind === "STK_SUCCESS_UNAPPLIED" && (e.meta as { loanId?: string } | null)?.loanId ? (
                    <button onClick={() => post({ action: "apply", id: e.id }, e.id + "apply", "Payment posted to the loan.")}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                      style={{ backgroundColor: "#1E8B3A" }}>
                      {busy === e.id + "apply" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                      Apply to loan
                    </button>
                  ) : null}
                  {e.kind === "C2B_UNALLOCATED" && (
                    <Link href="/console/repayments"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white hover:bg-zinc-800">
                      <ExternalLink className="h-3.5 w-3.5" /> Allocate in Repayments
                    </Link>
                  )}
                  <button onClick={() => { setNoteFor({ id: e.id, mode: "resolve" }); setNote(""); }}
                    disabled={busy !== null}
                    className="rounded-lg border border-zinc-900/15 bg-white/70 px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-white disabled:opacity-60">
                    Resolve…
                  </button>
                  <button onClick={() => { setNoteFor({ id: e.id, mode: "ignore" }); setNote(""); }}
                    disabled={busy !== null}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-900/15 bg-white/70 px-3 py-2 text-xs text-zinc-500 hover:bg-white disabled:opacity-60">
                    <EyeOff className="h-3.5 w-3.5" /> Ignore…
                  </button>
                </div>

                {noteFor?.id === e.id && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <input value={note} onChange={(ev) => setNote(ev.target.value)} autoFocus
                      placeholder={noteFor.mode === "resolve" ? "What was done? — this note is the record" : "Why is this fine? — this note is the record"}
                      className="min-w-52 flex-1 rounded-lg border border-zinc-900/15 bg-white px-3 py-2 text-xs outline-none" />
                    <button disabled={!note.trim() || busy !== null}
                      onClick={() => post({ action: noteFor.mode, id: e.id, note: note.trim() }, e.id + noteFor.mode,
                        noteFor.mode === "resolve" ? "Resolved." : "Ignored — it will stay quiet even if re-detected.")}
                      className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
                      {busy === e.id + noteFor.mode ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : noteFor.mode === "resolve" ? "Mark resolved" : "Ignore"}
                    </button>
                    <button onClick={() => setNoteFor(null)} className="text-xs text-zinc-400 hover:text-zinc-600">Cancel</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {data.closed.length > 0 && (
          <div className="mt-6">
            <button onClick={() => setShowClosed(!showClosed)} className="text-xs font-semibold text-zinc-500 hover:text-zinc-800">
              {showClosed ? "Hide" : "Show"} recently closed ({data.closed.length})
            </button>
            {showClosed && (
              <div className="mt-2 space-y-1.5">
                {data.closed.map((e) => (
                  <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/70 px-3 py-2 text-xs">
                    <div className="min-w-0">
                      <span className={`mr-2 rounded px-1.5 py-0.5 text-[10px] font-semibold ${e.status === "IGNORED" ? "bg-zinc-900/5 text-zinc-500" : "bg-emerald-100 text-emerald-700"}`}>
                        {e.status.toLowerCase()}
                      </span>
                      <span className="font-medium">{KIND_LABEL[e.kind] ?? e.kind}</span>
                      {e.resolution && <span className="text-zinc-400"> — {e.resolution}</span>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-zinc-400">
                      {e.resolvedAt ? day(e.resolvedAt) : ""}
                      <button onClick={() => post({ action: "reopen", id: e.id }, e.id + "reopen", "Reopened.")}
                        disabled={busy !== null} title="Reopen"
                        className="inline-flex items-center gap-1 text-zinc-400 hover:text-zinc-700 disabled:opacity-60">
                        <Undo2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <p className="mt-6 text-[11px] text-zinc-400">
          Exceptions are raised the moment a payment fails to post, and every check is re-run nightly. A condition that
          stops reproducing closes itself; anything resolved that comes back is reopened.
        </p>
      </main>
    </div>
  );
}

function Tile({ label, value, alarm }: { label: string; value: string; alarm: boolean }) {
  return (
    <div className="glass p-3.5">
      <p className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${alarm ? "text-red-600" : "text-emerald-700"}`}>{value}</p>
    </div>
  );
}
