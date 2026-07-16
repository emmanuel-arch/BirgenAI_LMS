"use client";

// The credit-bureau panel, and only that.
//
// It used to carry a second set of action buttons — a "Request payment" that posted to
// the old bespoke /api/console/loans/[id]/stk while the header's button used the one
// payment spine, plus its own Dispatch and Ask Riri. Two buttons with the same name
// taking different roads on one page is how an officer learns to trust neither. They
// now live once, together, at the top: see BorrowerActions.tsx.
import { useState } from "react";
import { FileSearch, FlaskConical, Loader2, ShieldCheck, RefreshCw } from "lucide-react";
import type { CrbReport } from "@/lib/crb/provider";

const fmtKES = (n: number) => `KES ${Math.round(n).toLocaleString()}`;

const BAND_COLOR: Record<CrbReport["band"], string> = { Excellent: "#059669", Good: "#0284c7", Fair: "#d97706", Poor: "#e11d48" };
const VERDICT: Record<CrbReport["verdict"], { text: string; cls: string }> = {
  CLEAR: { text: "Clear to lend", cls: "bg-emerald-100 text-emerald-700" },
  CAUTION: { text: "Lend with caution", cls: "bg-amber-100 text-amber-700" },
  ADVERSE: { text: "Adverse — decline / secure", cls: "bg-rose-100 text-rose-700" },
};

export function Customer360Client({ borrowerId, initialCrb }: { borrowerId: string; initialCrb: CrbReport | null }) {
  const [report, setReport] = useState<CrbReport | null>(initialCrb);
  const [crbBusy, setCrbBusy] = useState(false);

  const runCrb = async () => {
    setCrbBusy(true);
    try {
      const res = await fetch("/api/console/crb", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ borrowerId }) });
      const d = await res.json();
      if (d.success) setReport(d.report);
    } catch { /* leave prior report */ } finally { setCrbBusy(false); }
  };

  const scorePct = report ? Math.max(2, Math.min(100, ((report.score - 200) / 700) * 100)) : 0;

  return (
    <div className="glass p-5 lg:col-span-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-semibold flex items-center gap-2"><FileSearch className="h-4 w-4" style={{ color: "var(--brand)" }} /> Credit bureau (CRB)</h2>
        <div className="flex items-center gap-2">
          {report && (
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold ${report.mode === "live" ? "bg-emerald-100 text-emerald-700" : "bg-violet-100 text-violet-700"}`}>
              {report.mode === "live" ? <ShieldCheck className="h-3 w-3" /> : <FlaskConical className="h-3 w-3" />}{report.mode === "live" ? "LIVE" : "SIMULATED"}
            </span>
          )}
          <button onClick={runCrb} disabled={crbBusy} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand)" }}>
            {crbBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : report ? <RefreshCw className="h-3.5 w-3.5" /> : <FileSearch className="h-3.5 w-3.5" />}
            {report ? "Refresh" : "Run CRB check"}
          </button>
        </div>
      </div>

      {!report ? (
        <p className="mt-3 text-sm text-zinc-500">No bureau file pulled yet. Run a check to see accounts, listings and the bureau score{" "}
          <span className="text-zinc-400">— simulated until a bureau subscription is added in Settings → Vault.</span></p>
      ) : (
        <div className="mt-4">
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">{report.bureau} · score</p>
              <p className="text-3xl font-bold leading-none" style={{ color: BAND_COLOR[report.band] }}>{report.score} <span className="text-sm font-semibold">{report.band}</span></p>
            </div>
            <span className={`rounded-md px-2 py-1 text-[11px] font-bold ${VERDICT[report.verdict].cls}`}>{VERDICT[report.verdict].text}</span>
          </div>
          <div className="mt-2 h-2 rounded-full bg-zinc-900/8 overflow-hidden">
            <div className="h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${scorePct}%`, backgroundColor: BAND_COLOR[report.band] }} />
          </div>

          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="rounded-lg border border-zinc-900/10 bg-white/60 px-2.5 py-2"><p className="text-[9px] uppercase text-zinc-500">Model PD</p><p className="text-sm font-bold">{(report.probabilityOfDefault * 100).toFixed(1)}%</p></div>
            <div className="rounded-lg border border-zinc-900/10 bg-white/60 px-2.5 py-2"><p className="text-[9px] uppercase text-zinc-500">Accounts</p><p className="text-sm font-bold">{report.accounts.active} active / {report.accounts.total}</p></div>
            <div className="rounded-lg border border-zinc-900/10 bg-white/60 px-2.5 py-2"><p className="text-[9px] uppercase text-zinc-500">NPL</p><p className={`text-sm font-bold ${report.accounts.npl > 0 ? "text-rose-600" : "text-emerald-600"}`}>{report.accounts.npl}</p></div>
            <div className="rounded-lg border border-zinc-900/10 bg-white/60 px-2.5 py-2"><p className="text-[9px] uppercase text-zinc-500">Exposure</p><p className="text-sm font-bold">{fmtKES(report.totalExposure)}</p></div>
            <div className="rounded-lg border border-zinc-900/10 bg-white/60 px-2.5 py-2"><p className="text-[9px] uppercase text-zinc-500">Worst arrears</p><p className="text-sm font-bold">{report.worstArrearsDays}d</p></div>
            <div className="rounded-lg border border-zinc-900/10 bg-white/60 px-2.5 py-2"><p className="text-[9px] uppercase text-zinc-500">Enquiries 6m</p><p className="text-sm font-bold">{report.enquiriesLast6m}</p></div>
            <div className="col-span-2 rounded-lg border border-zinc-900/10 bg-white/60 px-2.5 py-2"><p className="text-[9px] uppercase text-zinc-500">Reference</p><p className="text-sm font-bold tabular-nums truncate">{report.reference}</p></div>
          </div>

          {report.negativeListings.length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] font-semibold text-rose-600">Adverse listings</p>
              <div className="mt-1.5 space-y-1">
                {report.negativeListings.map((l, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50/70 px-2.5 py-1.5 text-xs">
                    <span className="font-medium text-rose-700">{l.lender}</span>
                    <span className="text-rose-600">{fmtKES(l.amount)} · {l.status} · since {l.since}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="mt-3 text-xs text-zinc-500">{report.summary}</p>
        </div>
      )}

    </div>
  );
}
