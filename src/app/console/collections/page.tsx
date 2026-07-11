"use client";

// Collections — the workflow layer for the humans who chase what the
// early-warning engine flags. Three tabs, deep-linkable (?tab=):
//   Work Queue  — live arrears, freshest first, big Call button (officers work
//                 this from a phone), log-call sheet that can take a promise
//   Promises    — every PTP with its money-resolved status
//   Tickets     — disputes, hardship, escalations; resolution demands a note
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLoad } from "@/lib/hooks/useLoad";
import {
  PhoneCall, CalendarClock, Ticket as TicketIcon, Loader2, AlertTriangle, CheckCircle2,
  Phone, ClipboardList, Banknote, UserRound, X, Plus, Search,
} from "lucide-react";

// ── Types mirrored from the APIs ──────────────────────────────────────────────
type QueueRow = {
  loanId: string; borrowerId: string; name: string; phone: string; product: string;
  dpd: number; amountOverdue: number; balance: number; bucket: string;
  ptp: { id: string; amount: number; dueDate: string; overdue: boolean } | null;
  lastCall: { outcome: string; at: string; by: string | null } | null;
  openTickets: number;
};
type Summary = { loansOverdue: number; amountOverdue: number; ptpsPending: number; ptpsDueToday: number; ptpsBroken30d: number; ticketsOpen: number };
type Ptp = {
  id: string; loanId: string; borrowerId: string; borrower: { name: string; phone: string };
  amount: number; paidAmount: number; dueDate: string; status: string; note: string | null;
  takenBy: string; createdAt: string; resolvedAt: string | null;
};
type Ticket = {
  id: string; kind: string; status: string; title: string; detail: string | null;
  borrowerId: string; loanId: string | null; borrower: { name: string; phone: string };
  assignedTo: { id: string; name: string } | null; resolution: string | null;
  createdBy: string; createdAt: string; updatedAt: string;
};
type StaffOpt = { id: string; name: string };

const OUTCOMES: { key: string; label: string }[] = [
  { key: "REACHED", label: "Spoke to them" },
  { key: "PROMISE_TO_PAY", label: "Promised to pay" },
  { key: "CLAIMS_PAID", label: "Says already paid" },
  { key: "NO_ANSWER", label: "No answer" },
  { key: "PHONE_OFF", label: "Phone off" },
  { key: "CALLBACK_LATER", label: "Call back later" },
  { key: "WRONG_NUMBER", label: "Wrong number" },
  { key: "DISPUTED", label: "Disputes the debt" },
];
const OUTCOME_LABEL = Object.fromEntries(OUTCOMES.map((o) => [o.key, o.label]));

const PTP_TONE: Record<string, string> = {
  PENDING: "bg-sky-100 text-sky-700",
  KEPT: "bg-emerald-100 text-emerald-700",
  PARTIAL: "bg-amber-100 text-amber-700",
  BROKEN: "bg-red-100 text-red-700",
  CANCELLED: "bg-zinc-900/5 text-zinc-500",
};
const BUCKET_TONE: Record<string, string> = {
  "1-7": "bg-amber-100 text-amber-700",
  "8-30": "bg-orange-100 text-orange-700",
  "31-60": "bg-red-100 text-red-700",
  "60+": "bg-red-200 text-red-800",
};
const TICKET_TONE: Record<string, string> = {
  OPEN: "bg-amber-100 text-amber-700",
  IN_PROGRESS: "bg-sky-100 text-sky-700",
  RESOLVED: "bg-emerald-100 text-emerald-700",
  CLOSED: "bg-zinc-900/5 text-zinc-500",
};
const KINDS = ["DISPUTE", "HARDSHIP", "FRAUD", "COMPLAINT", "LEGAL", "OTHER"];

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

export default function CollectionsPage() {
  return (
    <Suspense fallback={null}>
      <Collections />
    </Suspense>
  );
}

function Collections() {
  const router = useRouter();
  const search = useSearchParams();
  const tab = (search.get("tab") ?? "queue") as "queue" | "ptp" | "tickets";

  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadSummary = async () => {
    try {
      const res = await fetch("/api/console/collections/queue");
      const data = await res.json();
      if (data.success) setSummary(data.summary);
      else setError(data.message || "Could not load collections.");
    } catch { setError("Could not load collections."); }
  };
  useLoad(loadSummary);

  const setTab = (t: string) => router.replace(t === "queue" ? "/console/collections" : `/console/collections?tab=${t}`);

  const TILES = summary
    ? [
        { label: "Loans overdue", value: String(summary.loansOverdue) },
        { label: "In arrears", value: kes(summary.amountOverdue) },
        { label: "Promises pending", value: String(summary.ptpsPending) },
        { label: "Promises due today", value: String(summary.ptpsDueToday) },
        { label: "Broken (30d)", value: String(summary.ptpsBroken30d) },
        { label: "Open tickets", value: String(summary.ticketsOpen) },
      ]
    : [];

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
      <h1 className="text-xl font-bold flex items-center gap-2">
        <PhoneCall className="h-5 w-5" style={{ color: "var(--brand)" }} /> Collections
      </h1>
      <p className="mt-1 text-sm text-zinc-500 max-w-2xl">
        The arrears work queue, live from the book — freshest first, because day-one borrowers still answer their phones.
        Promises resolve against the money that actually lands, never a checkbox.
      </p>

      {notice && <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50/90 px-3 py-2.5 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> {notice}</div>}
      {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}</div>}

      {summary && (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {TILES.map((t) => (
            <div key={t.label} className="glass p-3.5">
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">{t.label}</p>
              <p className="mt-1 text-base font-bold leading-tight" style={{ color: "var(--brand)" }}>{t.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 flex gap-1.5">
        {[
          { key: "queue", label: "Work Queue", icon: PhoneCall },
          { key: "ptp", label: "Promises", icon: CalendarClock },
          { key: "tickets", label: "Tickets", icon: TicketIcon },
        ].map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold ${tab === t.key ? "text-white" : "bg-white/70 text-zinc-600 border border-zinc-900/10 hover:bg-white"}`}
            style={tab === t.key ? { backgroundColor: "var(--brand)" } : undefined}>
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "queue" && <QueueTab onChanged={loadSummary} setNotice={setNotice} setError={setError} />}
      {tab === "ptp" && <PtpTab setNotice={setNotice} setError={setError} />}
      {tab === "tickets" && <TicketsTab setNotice={setNotice} setError={setError} />}
    </main>
  );
}

// ── Work queue ────────────────────────────────────────────────────────────────

function QueueTab({ onChanged, setNotice, setError }: { onChanged: () => void; setNotice: (s: string | null) => void; setError: (s: string | null) => void }) {
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [bucket, setBucket] = useState<string>("all");
  const [logFor, setLogFor] = useState<QueueRow | null>(null);
  const [stkFor, setStkFor] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch("/api/console/collections/queue");
    const data = await res.json();
    if (data.success) setRows(data.rows);
  };
  useLoad(load);

  const requestStk = async (r: QueueRow) => {
    setStkFor(r.loanId); setError(null); setNotice(null);
    try {
      const res = await fetch(`/api/console/loans/${r.loanId}/stk`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Math.min(r.amountOverdue, r.balance) }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not send the payment request."); return; }
      setNotice(`Payment request sent to ${r.name} (${kes(Math.min(r.amountOverdue, r.balance))}).`);
    } catch { setError("Could not send the payment request."); } finally { setStkFor(null); }
  };

  const visible = (rows ?? []).filter((r) =>
    bucket === "all" ? true
    : bucket === "promised" ? !!r.ptp
    : bucket === "broken-ptp" ? !!r.ptp?.overdue
    : r.bucket === bucket,
  );

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-1.5">
        {["all", "1-7", "8-30", "31-60", "60+", "promised"].map((b) => (
          <button key={b} onClick={() => setBucket(b)}
            className={`rounded-full px-3 py-1 text-[11px] font-semibold capitalize ${bucket === b ? "bg-zinc-900 text-white" : "bg-white/70 text-zinc-600 border border-zinc-900/10 hover:bg-white"}`}>
            {b === "all" ? "All" : b === "promised" ? "Has a promise" : `${b} days`}
          </button>
        ))}
      </div>

      {rows === null ? (
        <div className="glass mt-4 p-5 text-sm text-zinc-500 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Reading the book…</div>
      ) : visible.length === 0 ? (
        <div className="glass mt-4 p-8 text-center text-sm text-zinc-500">
          {rows.length === 0 ? "Nothing overdue — the book is clean." : "Nothing in this bucket."}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {visible.map((r) => (
            <div key={r.loanId} className="glass p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/console/borrowers/${r.borrowerId}`} className="text-sm font-semibold hover:underline">{r.name}</Link>
                    <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${BUCKET_TONE[r.bucket]}`}>{r.dpd}d overdue</span>
                    {r.openTickets > 0 && <span className="rounded-md bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">{r.openTickets} ticket{r.openTickets > 1 ? "s" : ""}</span>}
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500">{r.product} · owes {kes(r.amountOverdue)} of {kes(r.balance)} balance</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                    {r.ptp && (
                      <span className={`rounded-md px-2 py-0.5 font-semibold ${r.ptp.overdue ? "bg-red-100 text-red-700" : "bg-sky-100 text-sky-700"}`}>
                        Promised {kes(r.ptp.amount)} by {day(r.ptp.dueDate)}{r.ptp.overdue ? " — date passed" : ""}
                      </span>
                    )}
                    {r.lastCall && (
                      <span className="rounded-md bg-zinc-900/5 px-2 py-0.5 text-zinc-500">
                        Last call: {OUTCOME_LABEL[r.lastCall.outcome] ?? r.lastCall.outcome} · {day(r.lastCall.at)}{r.lastCall.by ? ` · ${r.lastCall.by}` : ""}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold text-white" style={{ backgroundColor: "var(--brand)" }}>
                    <Phone className="h-3.5 w-3.5" /> Call
                  </a>
                  <button onClick={() => setLogFor(r)} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-900/15 bg-white/70 px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-white">
                    <ClipboardList className="h-3.5 w-3.5" /> Log call
                  </button>
                  <button onClick={() => requestStk(r)} disabled={stkFor === r.loanId}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60">
                    {stkFor === r.loanId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Banknote className="h-3.5 w-3.5" />} Request payment
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {logFor && (
        <LogCallSheet
          row={logFor}
          onClose={() => setLogFor(null)}
          onLogged={async (msg) => { setLogFor(null); setNotice(msg); await load(); onChanged(); }}
          setError={setError}
        />
      )}
    </div>
  );
}

function LogCallSheet({ row, onClose, onLogged, setError }: {
  row: QueueRow; onClose: () => void; onLogged: (msg: string) => void; setError: (s: string | null) => void;
}) {
  const [outcome, setOutcome] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState(String(Math.round(row.amountOverdue)));
  const [dueDate, setDueDate] = useState(() => new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!outcome) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/console/collections/calls", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loanId: row.loanId, outcome, note: note.trim() || undefined,
          ...(outcome === "PROMISE_TO_PAY" ? { ptp: { amount: Number(amount), dueDate } } : {}),
        }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not log the call."); return; }
      onLogged(outcome === "PROMISE_TO_PAY" ? `Promise taken: ${kes(Number(amount))} by ${day(dueDate)}.` : "Call logged.");
    } catch { setError("Could not log the call."); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div aria-hidden className="absolute inset-0 bg-zinc-950/40" onClick={onClose} />
      <div className="relative w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Log a call — {row.name}</p>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-900/5"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {OUTCOMES.map((o) => (
            <button key={o.key} onClick={() => setOutcome(o.key)}
              className={`rounded-lg border px-2.5 py-2 text-[12px] font-medium text-left ${outcome === o.key ? "border-transparent text-white" : "border-zinc-900/15 bg-white text-zinc-700 hover:bg-zinc-50"}`}
              style={outcome === o.key ? { backgroundColor: "var(--brand)" } : undefined}>
              {o.label}
            </button>
          ))}
        </div>
        {outcome === "PROMISE_TO_PAY" && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[11px] font-semibold text-zinc-600">Amount (KES)</span>
              <input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-900/15 px-2.5 py-2 text-sm tabular-nums" />
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold text-zinc-600">By when</span>
              <input type="date" value={dueDate} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDueDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-900/15 px-2.5 py-2 text-sm" />
            </label>
          </div>
        )}
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notes (what they said, context for the next caller)"
          className="mt-3 w-full rounded-lg border border-zinc-900/15 px-3 py-2 text-sm" rows={2} />
        <button onClick={submit} disabled={busy || !outcome || (outcome === "PROMISE_TO_PAY" && !(Number(amount) > 0))}
          className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          style={{ backgroundColor: "var(--brand)" }}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
        </button>
      </div>
    </div>
  );
}

// ── Promises tab ──────────────────────────────────────────────────────────────

function PtpTab({ setNotice, setError }: { setNotice: (s: string | null) => void; setError: (s: string | null) => void }) {
  const [filter, setFilter] = useState("pending");
  const [ptps, setPtps] = useState<Ptp[] | null>(null);

  const load = async (f = filter) => {
    const res = await fetch(`/api/console/collections/ptps?filter=${f}`);
    const data = await res.json();
    if (data.success) setPtps(data.ptps);
    else setError(data.message || "Could not load promises.");
  };
  useLoad(() => load(filter), [filter]);

  const cancel = async (p: Ptp) => {
    const note = prompt(`Cancel ${p.borrower.name}'s promise of ${kes(p.amount)}? Say why — this is the only record.`);
    if (!note?.trim()) return;
    const res = await fetch("/api/console/collections/ptps", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: p.id, action: "cancel", note: note.trim() }),
    });
    const data = await res.json();
    if (!data.success) { setError(data.message || "Could not cancel."); return; }
    setNotice("Promise cancelled.");
    await load();
  };

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-1.5">
        {["pending", "due-today", "broken", "kept", "all"].map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-[11px] font-semibold capitalize ${filter === f ? "bg-zinc-900 text-white" : "bg-white/70 text-zinc-600 border border-zinc-900/10 hover:bg-white"}`}>
            {f.replace("-", " ")}
          </button>
        ))}
      </div>
      {ptps === null ? (
        <div className="glass mt-4 p-5 text-sm text-zinc-500 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : ptps.length === 0 ? (
        <div className="glass mt-4 p-8 text-center text-sm text-zinc-500">No promises here.</div>
      ) : (
        <div className="mt-4 space-y-2">
          {ptps.map((p) => (
            <div key={p.id} className="glass flex flex-wrap items-center justify-between gap-3 p-3.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link href={`/console/borrowers/${p.borrowerId}`} className="text-sm font-semibold hover:underline">{p.borrower.name}</Link>
                  <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${PTP_TONE[p.status]}`}>{p.status.toLowerCase()}</span>
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {kes(p.amount)} by {day(p.dueDate)} · taken by {p.takenBy} on {day(p.createdAt)}
                  {p.status !== "PENDING" && p.status !== "CANCELLED" ? ` · paid ${kes(p.paidAmount)}` : ""}
                </p>
                {p.note && <p className="mt-0.5 text-[11px] text-zinc-400">&ldquo;{p.note}&rdquo;</p>}
              </div>
              {p.status === "PENDING" && (
                <button onClick={() => cancel(p)} className="rounded-lg border border-zinc-900/15 bg-white/70 px-3 py-1.5 text-[11px] font-semibold text-zinc-600 hover:bg-white">
                  Cancel
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tickets tab ───────────────────────────────────────────────────────────────

function TicketsTab({ setNotice, setError }: { setNotice: (s: string | null) => void; setError: (s: string | null) => void }) {
  const [status, setStatus] = useState<"open" | "all">("open");
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [staff, setStaff] = useState<StaffOpt[]>([]);
  const [creating, setCreating] = useState(false);

  const load = async (s = status) => {
    const res = await fetch(`/api/console/collections/tickets?status=${s}`);
    const data = await res.json();
    if (data.success) { setTickets(data.tickets); setStaff(data.staff ?? []); }
    else setError(data.message || "Could not load tickets.");
  };
  useLoad(() => load(status), [status]);

  const update = async (body: Record<string, unknown>, msg: string) => {
    const res = await fetch("/api/console/collections/tickets", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.success) { setError(data.message || "Could not update the ticket."); return; }
    setNotice(msg);
    await load();
  };

  const resolve = async (t: Ticket) => {
    const resolution = prompt(`Resolve "${t.title}"? Say how — this may be the only record of the decision.`);
    if (!resolution?.trim()) return;
    await update({ id: t.id, status: "RESOLVED", resolution: resolution.trim() }, "Ticket resolved.");
  };

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {(["open", "all"] as const).map((s) => (
            <button key={s} onClick={() => setStatus(s)}
              className={`rounded-full px-3 py-1 text-[11px] font-semibold capitalize ${status === s ? "bg-zinc-900 text-white" : "bg-white/70 text-zinc-600 border border-zinc-900/10 hover:bg-white"}`}>
              {s}
            </button>
          ))}
        </div>
        <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-zinc-800">
          <Plus className="h-3.5 w-3.5" /> New ticket
        </button>
      </div>

      {tickets === null ? (
        <div className="glass mt-4 p-5 text-sm text-zinc-500 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : tickets.length === 0 ? (
        <div className="glass mt-4 p-8 text-center text-sm text-zinc-500">No {status === "open" ? "open " : ""}tickets.</div>
      ) : (
        <div className="mt-4 space-y-2">
          {tickets.map((t) => (
            <div key={t.id} className="glass p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold">{t.title}</p>
                    <span className="rounded-md bg-zinc-900/5 px-2 py-0.5 text-[10px] font-semibold text-zinc-500">{t.kind}</span>
                    <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${TICKET_TONE[t.status]}`}>{t.status.replace("_", " ").toLowerCase()}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    <UserRound className="inline h-3 w-3 -mt-0.5" />{" "}
                    <Link href={`/console/borrowers/${t.borrowerId}`} className="hover:underline">{t.borrower.name}</Link>
                    {" · "}opened by {t.createdBy} · {day(t.createdAt)}
                  </p>
                  {t.detail && <p className="mt-1 text-[12px] text-zinc-600">{t.detail}</p>}
                  {t.resolution && <p className="mt-1 text-[11px] text-emerald-700">Resolved: {t.resolution}</p>}
                </div>
                {(t.status === "OPEN" || t.status === "IN_PROGRESS") && (
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <select
                      value={t.assignedTo?.id ?? ""}
                      onChange={(e) => update({ id: t.id, assignedToId: e.target.value || null, ...(e.target.value ? { status: "IN_PROGRESS" } : {}) }, "Assignment updated.")}
                      className="rounded-lg border border-zinc-900/15 bg-white px-2 py-1.5 text-[11px] font-medium outline-none">
                      <option value="">Unassigned</option>
                      {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <button onClick={() => resolve(t)} className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50">
                      Resolve
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <NewTicketSheet
          staff={staff}
          onClose={() => setCreating(false)}
          onCreated={async () => { setCreating(false); setNotice("Ticket opened."); await load(); }}
          setError={setError}
        />
      )}
    </div>
  );
}

function NewTicketSheet({ staff, onClose, onCreated, setError }: {
  staff: StaffOpt[]; onClose: () => void; onCreated: () => void; setError: (s: string | null) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; name: string | null; phone: string }[]>([]);
  const [borrower, setBorrower] = useState<{ id: string; name: string | null; phone: string } | null>(null);
  const [kind, setKind] = useState("DISPUTE");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [assignedToId, setAssignedToId] = useState("");
  const [busy, setBusy] = useState(false);

  const searchBorrowers = async () => {
    if (!q.trim()) return;
    const res = await fetch(`/api/console/borrowers?q=${encodeURIComponent(q.trim())}`);
    const data = await res.json();
    if (data.success) setResults((data.borrowers ?? []).slice(0, 5));
  };

  const submit = async () => {
    if (!borrower) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/console/collections/tickets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ borrowerId: borrower.id, kind, title, detail: detail.trim() || undefined, assignedToId: assignedToId || undefined }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not open the ticket."); return; }
      onCreated();
    } catch { setError("Could not open the ticket."); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div aria-hidden className="absolute inset-0 bg-zinc-950/40" onClick={onClose} />
      <div className="relative w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">New ticket</p>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-900/5"><X className="h-4 w-4" /></button>
        </div>

        {!borrower ? (
          <>
            <div className="mt-3 flex gap-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && searchBorrowers()}
                placeholder="Find the borrower — name, phone or ID"
                className="flex-1 rounded-lg border border-zinc-900/15 px-3 py-2 text-sm" />
              <button onClick={searchBorrowers} className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white"><Search className="h-4 w-4" /></button>
            </div>
            <div className="mt-2 space-y-1">
              {results.map((b) => (
                <button key={b.id} onClick={() => setBorrower(b)} className="flex w-full items-center justify-between rounded-lg border border-zinc-900/10 px-3 py-2 text-left text-sm hover:bg-zinc-50">
                  <span className="font-medium">{b.name ?? "Borrower"}</span>
                  <span className="text-xs text-zinc-500">{b.phone}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="mt-3 text-xs text-zinc-500">For <span className="font-semibold text-zinc-800">{borrower.name ?? borrower.phone}</span> <button className="underline" onClick={() => setBorrower(null)}>change</button></p>
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="mt-3 w-full rounded-lg border border-zinc-900/15 px-3 py-2 text-sm">
              {KINDS.map((k) => <option key={k} value={k}>{k.charAt(0) + k.slice(1).toLowerCase()}</option>)}
            </select>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short title"
              className="mt-2 w-full rounded-lg border border-zinc-900/15 px-3 py-2 text-sm" />
            <textarea value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="What happened?"
              className="mt-2 w-full rounded-lg border border-zinc-900/15 px-3 py-2 text-sm" rows={3} />
            <select value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)} className="mt-2 w-full rounded-lg border border-zinc-900/15 px-3 py-2 text-sm">
              <option value="">Assign later</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button onClick={submit} disabled={busy || title.trim().length < 4}
              className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: "var(--brand)" }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Open ticket
            </button>
          </>
        )}
      </div>
    </div>
  );
}
