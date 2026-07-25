"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Guided reconciliation for money that arrived but isn't on a loan.
//
// The incumbent leaves this at "here's an unmatched payment" and sends you to
// another screen. Here it is one motion, in place: SEE the money and where it came
// from → FIND the customer → pick their loan → RECONCILE. The allocation itself
// runs through the same proven endpoint the Repayments screen uses (which posts the
// money and closes this exception), so no new money-movement code is introduced.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { Search, Loader2, Banknote, CheckCircle2, ArrowRight } from "lucide-react";

type Loan = { id: string; ref: string; borrower: string; phone: string; product: string; balance: number; nextDue: { date: string; amount: number } | null };
type Borrower = { id: string; name: string | null; phone: string };

const last9 = (s: string) => s.replace(/\D/g, "").slice(-9);

export function ReconcileToCustomer({ receiptId, amount, source, onDone }: {
  receiptId: string; amount: number | null; source: string; onDone: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Borrower[]>([]);
  const [picked, setPicked] = useState<Borrower | null>(null);
  const [loans, setLoans] = useState<Loan[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const search = async () => {
    if (!q.trim()) return;
    setError(null);
    try {
      const res = await fetch(`/api/console/borrowers?q=${encodeURIComponent(q.trim())}`);
      const d = await res.json();
      if (d.success) setResults((d.borrowers ?? []).slice(0, 6));
    } catch { setError("Search failed."); }
  };

  const pick = async (b: Borrower) => {
    setPicked(b); setLoans(null); setError(null); setBusy(true);
    try {
      const res = await fetch("/api/console/repayments");
      const d = await res.json();
      const nine = last9(b.phone);
      setLoans(((d.loans ?? []) as Loan[]).filter((l) => last9(l.phone) === nine));
    } catch { setError("Couldn't load their loans."); } finally { setBusy(false); }
  };

  const allocate = async (loanId: string) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/console/repayments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiptId, loanId }),
      });
      const d = await res.json();
      if (!d.success) { setError(d.message || "Couldn't reconcile."); return; }
      setDone(true);
      setTimeout(onDone, 1000);
    } catch { setError("Couldn't reconcile."); } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-700">
        <CheckCircle2 className="h-4 w-4" /> Reconciled to {picked?.name ?? "the customer"} — the payment is on their loan.
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-zinc-900/10 bg-white/70 p-3">
      {/* The money, and where it came from */}
      <div className="flex items-center gap-2 rounded-lg bg-zinc-900/[0.03] px-3 py-2">
        <Banknote className="h-4 w-4 shrink-0 text-zinc-400" />
        <div className="min-w-0">
          <p className="text-sm font-bold">{amount != null ? `KES ${Math.round(amount).toLocaleString()}` : "Payment"}</p>
          <p className="truncate text-[11px] text-zinc-500">{source}</p>
        </div>
      </div>

      {!picked ? (
        <>
          <div className="mt-2.5 flex gap-1.5">
            <div className="flex flex-1 items-center gap-2 rounded-lg border border-zinc-900/15 bg-white px-2.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()}
                placeholder="Find the customer — name, phone or ID" className="flex-1 bg-transparent py-2 text-xs outline-none" autoFocus />
            </div>
            <button onClick={search} className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white">Search</button>
          </div>
          <div className="mt-1.5 space-y-1">
            {results.map((b) => (
              <button key={b.id} onClick={() => pick(b)}
                className="flex w-full items-center justify-between rounded-lg border border-zinc-900/10 bg-white px-3 py-2 text-left text-xs hover:bg-zinc-50">
                <span className="font-medium">{b.name ?? "Borrower"}</span><span className="text-zinc-400">{b.phone}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="mt-2.5 text-xs text-zinc-600">
            Reconcile to <span className="font-semibold">{picked.name ?? picked.phone}</span>{" "}
            <button className="text-zinc-400 underline" onClick={() => { setPicked(null); setLoans(null); }}>change</button>
          </p>
          {busy && !loans && <div className="mt-2 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-zinc-400" /></div>}
          {loans && loans.length === 0 && <p className="mt-2 text-xs text-amber-700">No active loan for this customer — pick another, or record it as savings from Repayments.</p>}
          <div className="mt-1.5 space-y-1">
            {loans?.map((l) => (
              <button key={l.id} onClick={() => allocate(l.id)} disabled={busy}
                className="flex w-full items-center justify-between rounded-lg border border-zinc-900/10 bg-white px-3 py-2 text-left text-xs hover:bg-zinc-50 disabled:opacity-50">
                <span>
                  <span className="font-medium">{l.product}</span> <span className="text-zinc-400">· {l.ref}</span>
                  <span className="block text-[10px] text-zinc-400">balance KES {Math.round(l.balance).toLocaleString()}{l.nextDue ? ` · next due ${l.nextDue.date}` : ""}</span>
                </span>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" /> : <ArrowRight className="h-3.5 w-3.5 text-zinc-400" />}
              </button>
            ))}
          </div>
        </>
      )}
      {error && <p className="mt-1.5 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
