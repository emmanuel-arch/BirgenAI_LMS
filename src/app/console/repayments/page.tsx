"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, AlertTriangle, CheckCircle2, Landmark, Send } from "lucide-react";

type LoanRow = { id: string; ref: string; borrower: string; phone: string; product: string; balance: number; nextDue: { date: string; amount: number } | null };
type Receipt = { id: string; transId: string; amount: number; phone: string | null; billRef: string | null; allocatedLoanId: string | null; createdAt: string };
type Intent = { id: string; amount: number; phone: string; state: string; resultDesc: string | null; mpesaReceipt: string | null; createdAt: string };

const fmtKES = (n: number) => `KES ${Math.round(n).toLocaleString()}`;

export default function RepaymentsPage() {
  const [loans, setLoans] = useState<LoanRow[] | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [intents, setIntents] = useState<Intent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [allocFor, setAllocFor] = useState<string | null>(null);
  const [allocLoan, setAllocLoan] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/console/repayments");
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not load."); return; }
      setLoans(data.loans); setReceipts(data.receipts); setIntents(data.intents);
    } catch { setError("Could not load."); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const stk = async (loanId: string) => {
    setActing(loanId); setError(null); setNotice(null);
    try {
      const res = await fetch(`/api/console/loans/${loanId}/stk`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json();
      if (!data.success) { setError(data.message || "STK failed."); return; }
      setNotice(data.message);
      await load();
    } catch { setError("STK failed."); } finally { setActing(null); }
  };

  const allocate = async (receiptId: string) => {
    setActing(receiptId); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/console/repayments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiptId, loanId: allocLoan }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Allocation failed."); return; }
      setNotice(`Allocated — new balance ${fmtKES(data.result.newBalance)}${data.result.cleared ? " · LOAN CLEARED" : ""}.`);
      setAllocFor(null); setAllocLoan("");
      await load();
    } catch { setError("Allocation failed."); } finally { setActing(null); }
  };

  const unallocated = receipts.filter((r) => !r.allocatedLoanId);

  return (
    <div className="min-h-screen relative text-zinc-900">
      <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />
      <main className="relative z-10 mx-auto max-w-5xl px-4 sm:px-6 py-8">
        <Link href="/console" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800">
          <ArrowLeft className="h-4 w-4" /> Console
        </Link>
        <h1 className="mt-3 text-xl font-bold flex items-center gap-2"><Landmark className="h-5 w-5" style={{ color: "var(--brand)" }} /> Repayments</h1>

        {notice && <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50/90 px-3 py-2.5 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> {notice}</div>}
        {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}</div>}
        {!loans && !error && <div className="mt-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>}

        {unallocated.length > 0 && (
          <section className="mt-6">
            <h2 className="text-sm font-semibold text-amber-700">Unallocated receipts ({unallocated.length}) — needs action</h2>
            <div className="mt-2 space-y-2">
              {unallocated.map((r) => (
                <div key={r.id} className="glass p-4 border-amber-200">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <p className="text-sm font-semibold">{r.transId} · {fmtKES(r.amount)} {r.phone ? `from ${r.phone}` : ""} {r.billRef ? `· ref "${r.billRef}"` : ""}</p>
                    <button onClick={() => { setAllocFor(allocFor === r.id ? null : r.id); setAllocLoan(""); }}
                      className="rounded-lg border border-zinc-900/15 bg-white/70 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-white">
                      Allocate to loan
                    </button>
                  </div>
                  {allocFor === r.id && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <select value={allocLoan} onChange={(e) => setAllocLoan(e.target.value)}
                        className="rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2 text-sm outline-none flex-1 min-w-56">
                        <option value="">Choose the loan…</option>
                        {loans?.map((l) => <option key={l.id} value={l.id}>{l.ref} · {l.borrower} · bal {fmtKES(l.balance)}</option>)}
                      </select>
                      <button disabled={!allocLoan || acting === r.id} onClick={() => allocate(r.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
                        {acting === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Allocate
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="mt-6">
          <h2 className="text-sm font-semibold text-zinc-700">Active loans ({loans?.length ?? 0})</h2>
          <div className="mt-2 space-y-2">
            {loans?.map((l) => (
              <div key={l.id} className="glass p-4 flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{l.borrower} · {l.product} · <span style={{ color: "var(--brand)" }}>{fmtKES(l.balance)}</span></p>
                  <p className="text-xs text-zinc-500">REF {l.ref}{l.nextDue ? ` · next ${fmtKES(l.nextDue.amount)} due ${l.nextDue.date}` : ""}</p>
                </div>
                <button disabled={acting === l.id} onClick={() => stk(l.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
                  {acting === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Request payment (STK)
                </button>
              </div>
            ))}
            {loans?.length === 0 && <p className="text-sm text-zinc-500">No active loans.</p>}
          </div>
        </section>

        <section className="mt-6">
          <h2 className="text-sm font-semibold text-zinc-700">Recent receipts & STK requests</h2>
          <div className="mt-2 space-y-2">
            {receipts.filter((r) => r.allocatedLoanId).slice(0, 10).map((r) => (
              <div key={r.id} className="glass p-3 flex items-center justify-between gap-3">
                <p className="text-xs text-zinc-600 truncate">{r.transId} · {fmtKES(r.amount)} {r.phone ? `· ${r.phone}` : ""} · {new Date(r.createdAt).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 shrink-0">ALLOCATED</span>
              </div>
            ))}
            {intents.slice(0, 10).map((i) => (
              <div key={i.id} className="glass p-3 flex items-center justify-between gap-3">
                <p className="text-xs text-zinc-600 truncate">STK · {fmtKES(i.amount)} · {i.phone} {i.mpesaReceipt ? `· ${i.mpesaReceipt}` : ""} {i.resultDesc ? `· ${i.resultDesc}` : ""}</p>
                <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold shrink-0 ${i.state === "SUCCESS" ? "bg-emerald-100 text-emerald-700" : i.state === "FAILED" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{i.state}</span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
