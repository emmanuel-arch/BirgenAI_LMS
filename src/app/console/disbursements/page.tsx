"use client";

import { useCallback, useState } from "react";
import { useLoad } from "@/lib/hooks/useLoad";
import { Loader2, AlertTriangle, CheckCircle2, Banknote, Wallet, Plus, Send, RotateCcw } from "lucide-react";

type Disb = {
  id: string; state: string; amount: number; phone: string; makerId: string | null; checkerId: string | null;
  receiptRef: string | null; failReason: string | null; createdAt: string;
  loanId: string; loanStatus: string; borrower: string; product: string; mode: string;
  payee: { name: string | null; paybill: string; account: string | null } | null;
};

const fmtKES = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const TONE: Record<string, string> = {
  PENDING_MAKER: "bg-zinc-900/5 text-zinc-600",
  PENDING_CHECKER: "bg-amber-100 text-amber-700",
  SENDING: "bg-blue-100 text-blue-700",
  SENT: "bg-blue-100 text-blue-700",
  CONFIRMED: "bg-emerald-100 text-emerald-700",
  MANUAL_CONFIRMED: "bg-emerald-100 text-emerald-700",
  FAILED: "bg-red-100 text-red-700",
};

export default function DisbursementsPage() {
  const [rows, setRows] = useState<Disb[] | null>(null);
  const [balance, setBalance] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [manualFor, setManualFor] = useState<string | null>(null);
  const [manualRef, setManualRef] = useState("");
  const [showTopup, setShowTopup] = useState(false);
  const [topupAmount, setTopupAmount] = useState("");
  const [topupRef, setTopupRef] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/console/disbursements");
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not load."); return; }
      setRows(data.disbursements);
      setBalance(data.floatBalance);
    } catch { setError("Could not load."); }
  }, []);
  useLoad(load);

  const act = async (id: string, action: string, ref?: string) => {
    setActing(id + action); setError(null); setNotice(null);
    try {
      const res = await fetch(`/api/console/disbursements/${id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ref }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Action failed."); return; }
      setNotice(`Disbursement ${data.state.replace(/_/g, " ").toLowerCase()}.`);
      setManualFor(null); setManualRef("");
      await load();
    } catch { setError("Action failed."); } finally { setActing(null); }
  };

  const topup = async () => {
    setActing("topup"); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/console/float", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(topupAmount), ref: topupRef }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Top-up failed."); return; }
      setNotice(`Float topped up — balance ${fmtKES(data.balance)}.`);
      setShowTopup(false); setTopupAmount(""); setTopupRef("");
      await load();
    } catch { setError("Top-up failed."); } finally { setActing(null); }
  };

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
        <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-xl font-bold flex items-center gap-2"><Banknote className="h-5 w-5" style={{ color: "var(--brand)" }} /> Disbursements</h1>
          <div className="glass px-4 py-2 flex items-center gap-3">
            <Wallet className="h-4 w-4" style={{ color: "var(--brand)" }} />
            <div>
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">Float balance</p>
              <p className="text-sm font-bold">{fmtKES(balance)}</p>
            </div>
            <button onClick={() => setShowTopup((s) => !s)} className="ml-2 inline-flex items-center gap-1 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-zinc-800">
              <Plus className="h-3 w-3" /> Top up
            </button>
          </div>
        </div>

        {showTopup && (
          <div className="glass mt-4 p-4 flex flex-wrap items-center gap-3">
            <input value={topupAmount} onChange={(e) => setTopupAmount(e.target.value)} inputMode="numeric" placeholder="Amount (KES)"
              className="rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2 text-sm outline-none w-36" />
            <input value={topupRef} onChange={(e) => setTopupRef(e.target.value)} placeholder="Reference (bank/M-Pesa)"
              className="rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2 text-sm outline-none flex-1 min-w-40" />
            <button onClick={topup} disabled={acting === "topup"} className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
              {acting === "topup" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Record top-up
            </button>
          </div>
        )}

        {notice && <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50/90 px-3 py-2.5 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> {notice}</div>}
        {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}</div>}
        {!rows && !error && <div className="mt-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>}
        {rows?.length === 0 && <p className="mt-10 text-center text-sm text-zinc-500">No disbursements yet — approve an application to queue one.</p>}

        <div className="mt-5 space-y-3">
          {rows?.map((d) => (
            <div key={d.id} className="glass p-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">
                    {d.borrower} · {fmtKES(d.amount)} → {d.payee ? (d.payee.name || `paybill ${d.payee.paybill}`) : d.phone}
                  </p>
                  <p className="text-xs text-zinc-500 truncate">
                    {d.product} · loan {d.loanId.slice(0, 8)} · {new Date(d.createdAt).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    {d.receiptRef && <> · ref {d.receiptRef}</>}
                  </p>
                  {d.payee && (
                    <p className="mt-0.5 inline-flex items-center gap-1 rounded-md bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                      Pays {d.payee.name || "institution"} · paybill {d.payee.paybill}{d.payee.account ? ` · a/c ${d.payee.account}` : ""}
                    </p>
                  )}
                  {d.failReason && <p className="text-xs text-red-600 mt-0.5">{d.failReason}</p>}
                </div>
                <span className={`rounded-md px-2 py-1 text-[11px] font-semibold shrink-0 ${TONE[d.state] ?? TONE.PENDING_MAKER}`}>{d.state.replace(/_/g, " ")}</span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {d.state === "PENDING_MAKER" && (
                  <button disabled={!!acting} onClick={() => act(d.id, "submit")}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
                    {acting === d.id + "submit" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Submit for approval
                  </button>
                )}
                {d.state === "PENDING_CHECKER" && (
                  <>
                    {/* Pay-to-institution loans can't ride B2C to a phone (§7). Until
                        the direct-paybill rail ships they're paid outside + recorded. */}
                    {!d.payee && (
                      <button disabled={!!acting} onClick={() => act(d.id, "approve")}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
                        {acting === d.id + "approve" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Banknote className="h-3.5 w-3.5" />} Pay via M-Pesa B2C
                      </button>
                    )}
                    <button disabled={!!acting} onClick={() => setManualFor(manualFor === d.id ? null : d.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-900/15 bg-white/70 px-4 py-2 text-xs font-semibold text-zinc-700 hover:bg-white disabled:opacity-60"
                      style={d.payee ? { backgroundColor: "var(--brand)", color: "#fff", borderColor: "transparent" } : undefined}>
                      {d.payee ? `Confirm paid to paybill ${d.payee.paybill}` : "Record manual payment"}
                    </button>
                  </>
                )}
                {d.state === "FAILED" && (
                  <button disabled={!!acting} onClick={() => act(d.id, "retry")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-900/15 bg-white/70 px-4 py-2 text-xs font-semibold text-zinc-700 hover:bg-white disabled:opacity-60">
                    <RotateCcw className="h-3.5 w-3.5" /> Retry
                  </button>
                )}
              </div>

              {manualFor === d.id && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input value={manualRef} onChange={(e) => setManualRef(e.target.value)} placeholder="M-Pesa/bank reference"
                    className="rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2 text-sm outline-none flex-1 min-w-48" />
                  <button disabled={!!acting} onClick={() => act(d.id, "manual", manualRef)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
                    {acting === d.id + "manual" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Confirm paid
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </main>
  );
}
