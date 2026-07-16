"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Banknote, MapPin, Loader2, CheckCircle2, AlertCircle, ExternalLink, Send } from "lucide-react";
import type { RiskRow, RiskBand } from "@/lib/intelligence/earlywarning";

const fmtKES = (n: number) => `KES ${Math.round(n).toLocaleString()}`;

const BAND: Record<RiskBand, { label: string; text: string; bg: string; bar: string }> = {
  HIGH: { label: "High risk", text: "text-rose-700", bg: "bg-rose-100", bar: "#e11d48" },
  ELEVATED: { label: "Elevated", text: "text-amber-700", bg: "bg-amber-100", bar: "#d97706" },
  WATCH: { label: "Watch", text: "text-zinc-600", bg: "bg-zinc-900/5", bar: "#a1a1aa" },
};

type Row = RiskRow;
type ActState = { busy?: boolean; ok?: boolean; msg?: string };

export function Watchlist({ rows }: { rows: Row[] }) {
  const [mounted, setMounted] = useState(false);
  const [act, setAct] = useState<Record<string, ActState>>({});
  useEffect(() => { const t = setTimeout(() => setMounted(true), 60); return () => clearTimeout(t); }, []);

  const set = (id: string, s: ActState) => setAct((a) => ({ ...a, [id]: s }));

  const requestPayment = async (r: Row) => {
    set(r.loanId, { busy: true });
    try {
      const res = await fetch(`/api/console/loans/${r.loanId}/stk`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const d = await res.json();
      set(r.loanId, { ok: !!d.success, msg: d.success ? `STK sent to ${r.phone}` : (d.message || "Could not send STK") });
    } catch { set(r.loanId, { ok: false, msg: "Network error" }); }
  };

  const dispatch = async (r: Row) => {
    if (r.lat == null || r.lng == null) return;
    set(r.loanId, { busy: true });
    try {
      const res = await fetch(`/api/console/field`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: `Collections — ${r.name}`, lat: r.lat, lng: r.lng, kind: "COLLECTION_VISIT", borrowerId: r.borrowerId }),
      });
      const d = await res.json();
      const a = d.allocation;
      set(r.loanId, { ok: !!d.success, msg: d.success ? (a ? `Assigned to ${a.agentName} · ${a.distanceKm?.toFixed?.(1) ?? a.distanceKm} km` : "Queued — no field agent available") : (d.message || "Could not dispatch") });
    } catch { set(r.loanId, { ok: false, msg: "Network error" }); }
  };

  return (
    <div className="space-y-2.5">
      {rows.map((r) => {
        const b = BAND[r.band];
        const st = act[r.loanId];
        return (
          <div key={r.loanId} className="glass p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold text-white shrink-0" style={{ backgroundColor: b.bar }}>
                  {r.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold truncate">{r.name}</p>
                    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${b.bg} ${b.text}`}>{b.label}</span>
                    {r.dpd > 0 && <span className="rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">{r.dpd}d overdue</span>}
                  </div>
                  <p className="text-xs text-zinc-500 truncate">{r.product} · {r.phone}</p>
                </div>
              </div>
              <div className="flex items-center gap-4 text-right shrink-0">
                <div><p className="text-[10px] uppercase text-zinc-500">Balance</p><p className="text-sm font-bold" style={{ color: "var(--brand)" }}>{fmtKES(r.balance)}</p></div>
                <div className="hidden sm:block"><p className="text-[10px] uppercase text-zinc-500">Proj. loss</p><p className="text-sm font-bold text-rose-600">{fmtKES(r.expectedLoss)}</p></div>
              </div>
            </div>

            {/* Risk meter */}
            <div className="mt-3 flex items-center gap-2.5">
              <div className="flex-1 h-2 rounded-full bg-zinc-900/8 overflow-hidden">
                <div className="h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: mounted ? `${r.riskScore}%` : "0%", backgroundColor: b.bar }} />
              </div>
              <span className="text-[11px] font-bold tabular-nums" style={{ color: b.bar }}>{r.riskScore}</span>
            </div>

            {/* Reason codes */}
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {r.reasons.map((reason, i) => (
                <span key={i} className="rounded-full border border-zinc-900/10 bg-white/60 px-2 py-0.5 text-[10px] text-zinc-600">{reason}</span>
              ))}
            </div>

            {/* Actions */}
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <button onClick={() => requestPayment(r)} disabled={st?.busy}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 ${r.action.kind === "REQUEST_PAYMENT" ? "" : "opacity-90"}`}
                style={{ backgroundColor: r.action.kind === "REQUEST_PAYMENT" ? "var(--brand)" : "#3f3f46" }}>
                {st?.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Banknote className="h-3.5 w-3.5" />} Request payment
              </button>
              {r.hasGeo && (
                <button onClick={() => dispatch(r)} disabled={st?.busy}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                  style={r.action.kind === "FIELD_VISIT" ? { backgroundColor: "var(--brand)", color: "#fff" } : { backgroundColor: "rgba(0,0,0,0.05)", color: "#3f3f46" }}>
                  {st?.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapPin className="h-3.5 w-3.5" />} Dispatch agent
                </button>
              )}
              <button data-riri-open="analytics" className="inline-flex items-center gap-1.5 rounded-lg bg-white/70 border border-zinc-900/10 px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:text-zinc-900">
                <Send className="h-3.5 w-3.5" /> Ask Riri
              </button>
              <Link href={`/console/borrowers/${r.borrowerId}`} className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800">
                View <ExternalLink className="h-3 w-3" />
              </Link>
              {st?.msg && (
                <span className={`inline-flex items-center gap-1 text-[11px] ${st.ok ? "text-emerald-600" : "text-rose-600"}`}>
                  {st.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />} {st.msg}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
