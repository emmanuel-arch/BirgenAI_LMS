"use client";

// KYC Verification — the customers you have registered but not yet proved.
//
// The list is deliberately unflattering. It sorts OLDEST FIRST, it counts the days,
// and it says out loud how many of these people have already asked for money they
// cannot legally be given. A lender should be able to clear this screen every day; if
// it is long, that is the finding, not a rendering problem.
//
// Two ways out of the queue for each person, and one way to admit they were never real:
//   Verify at the counter — open the verification wizard with the customer present
//   Send them the link    — they finish it on their own phone, where their face is
//   Remove                — a customer who never applied and never verified is not a
//                           customer; deleting them is how the queue stays honest.
import { useState } from "react";
import { ShieldCheck, Search, Loader2, AlertCircle, Send, Trash2, ExternalLink, Clock, CheckCircle2 } from "lucide-react";
import { useLoad } from "@/lib/hooks/useLoad";

type Row = {
  id: string;
  name: string;
  phone: string;
  nationalId: string | null;
  kycStatus: "NONE" | "IN_PROGRESS" | "PENDING_REVIEW" | "FAILED";
  branch: string | null;
  officer: string | null;
  selfRegistered: boolean;
  waitingDays: number;
  applications: number;
  loans: number;
};

const STATUS: Record<Row["kycStatus"], { label: string; cls: string }> = {
  NONE: { label: "Not started", cls: "bg-zinc-900/5 text-zinc-600" },
  IN_PROGRESS: { label: "Half-finished", cls: "bg-amber-100 text-amber-700" },
  PENDING_REVIEW: { label: "Needs a human look", cls: "bg-sky-100 text-sky-700" },
  FAILED: { label: "Failed", cls: "bg-rose-100 text-rose-700" },
};

const SCOPE_NOTE: Record<string, string> = {
  OWN: "You're seeing the customers you registered.",
  BRANCH: "You're seeing your branch's customers.",
  BRANCH_TREE: "You're seeing every customer in your region.",
  ORG: "You're seeing every customer in the organisation.",
};

export function KycQueueClient({ focusId }: { focusId: string | null }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [canVerify, setCanVerify] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [scope, setScope] = useState<string>("ORG");
  const [blocked, setBlocked] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = async (search = q) => {
    const res = await fetch(`/api/console/kyc/queue?q=${encodeURIComponent(search)}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.message ?? "Could not load the queue.");
    setRows(data.borrowers);
    setCanVerify(data.canVerify);
    setCanDelete(data.canDelete);
    setScope(data.scope);
    setBlocked(data.blocked);
  };

  useLoad(async () => {
    try { await load(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load the queue."); }
    finally { setLoading(false); }
  });

  const search = async (value: string) => {
    setQ(value);
    try { await load(value); } catch { /* keep the last good list */ }
  };

  const sendLink = async (r: Row) => {
    setBusy(r.id); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/console/kyc/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ borrowerId: r.id, action: "send-link" }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      setNotice(data.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the link.");
    } finally { setBusy(null); }
  };

  const remove = async (r: Row) => {
    setBusy(r.id); setError(null); setNotice(null);
    try {
      const res = await fetch(`/api/console/kyc/queue?id=${r.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      setNotice(data.message);
      setConfirming(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove them.");
    } finally { setBusy(null); }
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-10">
        <p className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading the queue…</p>
      </main>
    );
  }

  const ordered = focusId ? [...rows].sort((a, b) => (a.id === focusId ? -1 : b.id === focusId ? 1 : 0)) : rows;

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-900">
          <ShieldCheck className="h-6 w-6" style={{ color: "var(--brand)" }} /> KYC Verification
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-zinc-500">
          Customers you have registered but not yet verified. No money can be disbursed to anyone on this list —
          verification is the gate. {SCOPE_NOTE[scope] ?? ""}
        </p>
      </header>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="flex flex-1 min-w-[220px] items-center gap-2 rounded-xl border border-zinc-900/15 bg-white/80 px-3">
          <Search className="h-4 w-4 shrink-0 text-zinc-400" />
          <input
            value={q}
            onChange={(e) => search(e.target.value)}
            placeholder="Search a name, phone or ID number…"
            className="flex-1 bg-transparent py-2.5 text-sm outline-none placeholder:text-zinc-400"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-zinc-900/5 px-2.5 py-1 text-[12px] font-semibold text-zinc-600">{rows.length} waiting</span>
          {blocked > 0 && (
            <span className="rounded-full bg-rose-100 px-2.5 py-1 text-[12px] font-bold text-rose-700">{blocked} blocked from disbursement</span>
          )}
        </div>
      </div>

      {error && (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}
      {notice && (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-700">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {notice}
        </p>
      )}

      {ordered.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-10 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
          <p className="mt-2 text-sm font-semibold text-emerald-800">Nobody is waiting.</p>
          <p className="mt-0.5 text-[13px] text-emerald-700">
            Every customer you can see has been verified. That is exactly how this screen should look.
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-2">
          {ordered.map((r) => {
            const s = STATUS[r.kycStatus];
            const stale = r.waitingDays >= 7;
            const isFocus = r.id === focusId;
            return (
              <div
                key={r.id}
                className={`rounded-xl border bg-white/70 px-4 py-3 ${isFocus ? "border-[color:var(--brand)] ring-2 ring-[color:var(--brand)]/20" : "border-zinc-900/10"}`}
              >
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <a href={`/console/borrowers/${r.id}`} className="text-[15px] font-semibold text-zinc-900 hover:underline">{r.name}</a>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${s.cls}`}>{s.label}</span>
                      {(r.applications > 0 || r.loans > 0) && (
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                          Waiting on money — blocked
                        </span>
                      )}
                      {stale && (
                        <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                          <Clock className="h-2.5 w-2.5" /> {r.waitingDays} days
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[12px] text-zinc-500">
                      {r.phone}
                      {r.nationalId ? ` · ID ${r.nationalId}` : " · no ID captured"}
                      {r.branch ? ` · ${r.branch}` : ""}
                      {r.selfRegistered ? " · signed up themselves" : r.officer ? ` · registered by ${r.officer}` : ""}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {canVerify && (
                      <>
                        <a
                          href={`/verify?phone=${encodeURIComponent(r.phone)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-white"
                          style={{ backgroundColor: "var(--brand)" }}
                        >
                          <ExternalLink className="h-3.5 w-3.5" /> Verify at the counter
                        </a>
                        <button
                          disabled={busy === r.id}
                          onClick={() => sendLink(r)}
                          className="flex items-center gap-1.5 rounded-lg border border-zinc-900/12 bg-white px-2.5 py-1.5 text-[12px] font-medium text-zinc-600 hover:text-zinc-900 disabled:opacity-50"
                        >
                          {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send link
                        </button>
                      </>
                    )}
                    {canDelete && r.applications === 0 && r.loans === 0 && (
                      confirming === r.id ? (
                        <button
                          disabled={busy === r.id}
                          onClick={() => remove(r)}
                          className="rounded-lg bg-rose-600 px-2.5 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
                        >
                          {busy === r.id ? "Removing…" : "Really remove"}
                        </button>
                      ) : (
                        <button
                          onClick={() => setConfirming(r.id)}
                          title="Remove this unverified customer"
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-[12px] leading-relaxed text-zinc-400">
        &ldquo;Verify at the counter&rdquo; opens the verification wizard for a customer standing in front of you — they confirm the
        code sent to their phone, then their ID and face are captured. &ldquo;Send link&rdquo; lets them do it themselves.
        A customer who has never applied and never verified can be removed; one who has applied stays, because a declined
        application is still part of your record.
      </p>
    </main>
  );
}
