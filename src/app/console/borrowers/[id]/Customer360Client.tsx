"use client";

// The credit-bureau panel, and only that.
//
// It used to carry a second set of action buttons — a "Request payment" that posted to
// the old bespoke /api/console/loans/[id]/stk while the header's button used the one
// payment spine, plus its own Dispatch and Ask Riri. Two buttons with the same name
// taking different roads on one page is how an officer learns to trust neither. They
// now live once, together, at the top: see BorrowerActions.tsx.
import { useState } from "react";
import { FileSearch, FlaskConical, Loader2, ShieldCheck, RefreshCw, BadgeCheck, Wallet, AlertOctagon } from "lucide-react";
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
  const [crbError, setCrbError] = useState<string | null>(null);

  const runCrb = async () => {
    setCrbBusy(true);
    setCrbError(null);
    try {
      const res = await fetch("/api/console/crb", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ borrowerId }) });
      const d = await res.json();
      if (d.success) setReport(d.report);
      else setCrbError(d.message || "The bureau check could not be completed.");
    } catch {
      setCrbError("Could not reach the server for the bureau check.");
    } finally { setCrbBusy(false); }
  };

  const scorePct = report ? Math.max(2, Math.min(100, ((report.score - 200) / 700) * 100)) : 0;

  return (
    <div className="glass p-5 lg:col-span-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-semibold flex items-center gap-2"><FileSearch className="h-4 w-4" style={{ color: "var(--brand)" }} /> Credit bureau (CRB)</h2>
        <div className="flex items-center gap-2">
          {report && (
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold ${report.sandbox ? "bg-amber-100 text-amber-700" : report.mode === "live" ? "bg-emerald-100 text-emerald-700" : "bg-violet-100 text-violet-700"}`}>
              {report.mode === "live" ? <ShieldCheck className="h-3 w-3" /> : <FlaskConical className="h-3 w-3" />}
              {report.sandbox ? "LIVE · SANDBOX" : report.mode === "live" ? "LIVE" : "SIMULATED"}
            </span>
          )}
          <button onClick={runCrb} disabled={crbBusy} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand)" }}>
            {crbBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : report ? <RefreshCw className="h-3.5 w-3.5" /> : <FileSearch className="h-3.5 w-3.5" />}
            {report ? "Refresh" : "Run CRB check"}
          </button>
        </div>
      </div>

      {crbError && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50/80 px-3 py-2 text-xs text-rose-700">{crbError}</div>
      )}

      {!report ? (
        <p className="mt-3 text-sm text-ash-500">No bureau file pulled yet. Run a check to see accounts, listings and the bureau score{" "}
          <span className="text-ash-400">— simulated until a bureau subscription is added in Settings → Vault.</span></p>
      ) : (
        <div className="mt-4">
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-ash-500">{report.bureau} · score</p>
              <p className="text-3xl font-bold leading-none" style={{ color: BAND_COLOR[report.band] }}>{report.score} <span className="text-sm font-semibold">{report.band}</span></p>
            </div>
            <span className={`rounded-md px-2 py-1 text-[11px] font-bold ${VERDICT[report.verdict].cls}`}>{VERDICT[report.verdict].text}</span>
          </div>
          <div className="mt-2 h-2 rounded-full bg-ash-900/8 overflow-hidden">
            <div className="h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${scorePct}%`, backgroundColor: BAND_COLOR[report.band] }} />
          </div>

          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="rounded-lg border border-ash-900/10 bg-paper/60 px-2.5 py-2"><p className="text-[9px] uppercase text-ash-500">Model PD</p><p className="text-sm font-bold">{(report.probabilityOfDefault * 100).toFixed(1)}%</p></div>
            <div className="rounded-lg border border-ash-900/10 bg-paper/60 px-2.5 py-2"><p className="text-[9px] uppercase text-ash-500">Accounts</p><p className="text-sm font-bold">{report.accounts.active} active / {report.accounts.total}</p></div>
            <div className="rounded-lg border border-ash-900/10 bg-paper/60 px-2.5 py-2"><p className="text-[9px] uppercase text-ash-500">NPL</p><p className={`text-sm font-bold ${report.accounts.npl > 0 ? "text-rose-600" : "text-emerald-600"}`}>{report.accounts.npl}</p></div>
            <div className="rounded-lg border border-ash-900/10 bg-paper/60 px-2.5 py-2"><p className="text-[9px] uppercase text-ash-500">Exposure</p><p className="text-sm font-bold">{fmtKES(report.totalExposure)}</p></div>
            <div className="rounded-lg border border-ash-900/10 bg-paper/60 px-2.5 py-2"><p className="text-[9px] uppercase text-ash-500">Worst arrears</p><p className="text-sm font-bold">{report.worstArrearsDays}d</p></div>
            <div className="rounded-lg border border-ash-900/10 bg-paper/60 px-2.5 py-2"><p className="text-[9px] uppercase text-ash-500">Enquiries 6m</p><p className="text-sm font-bold">{report.enquiriesLast6m}</p></div>
            <div className="col-span-2 rounded-lg border border-ash-900/10 bg-paper/60 px-2.5 py-2"><p className="text-[9px] uppercase text-ash-500">Reference</p><p className="text-sm font-bold tabular-nums truncate">{report.reference}</p></div>
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

          <p className="mt-3 text-xs text-ash-500">{report.summary}</p>

          {report.metropol && <MetropolDetail m={report.metropol} />}
        </div>
      )}

    </div>
  );
}

function MetropolDetail({ m }: { m: NonNullable<CrbReport["metropol"]> }) {
  const trend = m.scoreTrend.filter((t) => t.score != null);
  return (
    <div className="mt-4 border-t border-ash-900/10 pt-4">
      {/* Identity + income + fraud row */}
      <div className="flex flex-wrap items-center gap-2">
        {m.identity && (
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${m.identity.verified ? "bg-emerald-100 text-emerald-700" : "bg-ash-900/5 text-ash-600"}`}>
            <BadgeCheck className="h-3 w-3" />
            {m.identity.verified ? "Identity verified" : "Identity"}{m.identity.name ? `: ${m.identity.name}` : ""}
            {m.identity.dob ? ` · ${m.identity.dob}` : ""}
          </span>
        )}
        {m.incomeEstimate != null && m.incomeEstimate > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
            <Wallet className="h-3 w-3" /> Est. income {fmtKES(m.incomeEstimate)}
          </span>
        )}
        {m.hasFraud && (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
            <AlertOctagon className="h-3 w-3" /> Fraud flag on file
          </span>
        )}
        {m.thinFile && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Thin file</span>
        )}
      </div>

      {/* Signal tiles */}
      <div className="mt-3 grid grid-cols-3 sm:grid-cols-6 gap-2">
        <Tile label="Delinquency" value={m.delinquencyText} small />
        <Tile label="Enquiries 12m" value={String(m.enquiries.last12m)} />
        <Tile label="Bounced chq 12m" value={String(m.bouncedCheques.last12m)} />
        <Tile label="Applications 12m" value={String(m.creditApplications.last12m)} />
        <Tile label="Guarantors" value={String(m.guarantors)} />
        <Tile label="Stakeholders" value={String(m.stakeholders)} />
      </div>

      {/* Product mix */}
      {m.productMix.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {m.productMix.map((p) => (
            <span key={p.product} className="rounded-md bg-ash-900/5 px-2 py-1 text-[10px] font-medium text-ash-600">{p.product} × {p.count}</span>
          ))}
        </div>
      )}

      {/* Score trend (last 12 months of Metro Score) */}
      {trend.length > 1 && (
        <div className="mt-3">
          <p className="text-[10px] uppercase tracking-wide text-ash-500">Metro Score, last {trend.length} months</p>
          <Sparkline points={trend.map((t) => t.score as number)} />
        </div>
      )}

      {/* Accounts table */}
      {m.accounts.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="text-ash-500">
              <tr className="border-b border-ash-900/10">
                <th className="py-1 pr-2 font-medium">Product</th>
                <th className="py-1 px-2 font-medium">Status</th>
                <th className="py-1 px-2 font-medium text-right">Balance</th>
                <th className="py-1 px-2 font-medium text-right">Overdue</th>
                <th className="py-1 pl-2 font-medium text-right">Arrears</th>
              </tr>
            </thead>
            <tbody>
              {m.accounts.slice(0, 8).map((a, i) => (
                <tr key={i} className="border-b border-ash-900/5">
                  <td className="py-1 pr-2 font-medium text-ash-700">{a.product}</td>
                  <td className={`py-1 px-2 ${/Non-Performing|Write-Off|Legal|Collection/i.test(a.status) ? "text-rose-600 font-semibold" : "text-ash-600"}`}>{a.status}</td>
                  <td className="py-1 px-2 text-right tabular-nums">{fmtKES(a.balance)}</td>
                  <td className={`py-1 px-2 text-right tabular-nums ${a.overdue > 0 ? "text-rose-600 font-semibold" : "text-ash-400"}`}>{a.overdue > 0 ? fmtKES(a.overdue) : "—"}</td>
                  <td className={`py-1 pl-2 text-right tabular-nums ${a.arrearsDays >= 30 ? "text-rose-600 font-semibold" : "text-ash-500"}`}>{a.arrearsDays}d</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {m.reportsPulled.length > 0 && (
        <p className="mt-3 text-[10px] text-ash-400">Metropol pulled: {m.reportsPulled.join(" · ")}{m.trxIds[0] ? ` · ref ${m.trxIds[0].slice(0, 8)}` : ""}</p>
      )}
    </div>
  );
}

function Tile({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-lg border border-ash-900/10 bg-paper/60 px-2.5 py-2">
      <p className="text-[9px] uppercase text-ash-500">{label}</p>
      <p className={`font-bold ${small ? "text-[11px] leading-tight" : "text-sm"}`}>{value}</p>
    </div>
  );
}

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const w = 240, h = 40, pad = 3;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const step = (w - pad * 2) / (points.length - 1);
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${pad + i * step} ${h - pad - ((p - min) / span) * (h - pad * 2)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-1 h-10 w-full max-w-xs" preserveAspectRatio="none">
      <path d={d} fill="none" stroke="var(--brand)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
