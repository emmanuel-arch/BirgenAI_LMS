"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE APPLICATION DOSSIER — one loan, one decision, one serious page.
//
// Everything an officer weighs, in the order they weigh it: the FACE and the ID
// (is this the person?), the MODEL (what's the risk?), the RECOMMENDATION (is the
// amount right, and what still blocks it?), the SCHEDULE (what would they repay?),
// and then — and only then — the three buttons that move it: approve to the next
// stage, send it back to be fixed, or reject it.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useLoad } from "@/lib/hooks/useLoad";
import {
  ArrowLeft, Loader2, AlertTriangle, CheckCircle2, XCircle, Undo2, ShieldAlert, MapPin,
  ScanFace, Gauge, TrendingUp, TrendingDown, Minus, Users, BadgeCheck, Landmark, IdCard,
} from "lucide-react";
import { OfferPanel } from "../OfferPanel";
import { SecurityPanel } from "../SecurityPanel";

const fmtKES = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const dfmt = (v: string) => new Date(v).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

type Detail = {
  application: {
    id: string; status: string; stageTitle: string | null; currentStageId: string | null;
    amountRequested: number; createdAt: string; fusionEngine: string | null;
    score: number | null; pd: number | null; decision: string | null;
    reasonCodes: { factor?: string; detail?: string; direction?: string }[]; graduated: boolean;
    approvedLimitAtApply: number | null; loan: { id: string; status: string } | null;
  };
  borrower: {
    id: string; name: string; phone: string; nationalId: string | null; kycStatus: string; verified: boolean;
    creditScore: number | null; behaviouralScore: number | null; riskBand: string | null;
    portraitUrl: string | null; idFrontUrl: string | null; locationPinned: boolean;
  };
  product: { name: string; interestRate: number; interestMethod: string; repaymentPeriod: number; repaymentPeriodUnit: string; guarantorRequired: boolean; securityRequired: boolean; minPrincipal: number; maxPrincipal: number } | null;
  guarantor: { fullName: string; phone: string; relationship: string | null; status: string } | null;
  kyc: { livenessScore: number | null; livenessPassed: boolean | null; faceMatchScore: number | null; iprsMatched: boolean | null; idQualityScore: number | null; status: string } | null;
  recommendation: { verdict: "increase" | "reduce" | "ok" | "declined"; approvedLimit: number; affordableInstallment: number | null; installmentCount: number | null; installmentUnit: string | null; reasons: { factor?: string; detail?: string; direction?: string }[]; hasStatement: boolean };
  schedule: { seq: number; dueDate: string; amountDue: number }[];
  interest: number; loanAmount: number;
};

const LIVE = ["SUBMITTED", "AI_PRESCREEN", "OFFICER_REVIEW", "REFERRED"];

export default function ApplicationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [otpFor, setOtpFor] = useState(false);
  const [otp, setOtp] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/console/applications/${id}`);
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not load the application."); return; }
      setD(data);
    } catch { setError("Could not load the application."); }
  }, [id]);
  useLoad(load);

  const act = async (action: "approve" | "decline" | "send-back", otpCode?: string) => {
    setActing(action); setNotice(null); setError(null);
    try {
      const res = await fetch(`/api/console/applications/${id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(otpCode ? { otp: otpCode } : {}) }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Action failed."); return; }
      if (data.otpRequired) { setOtpFor(true); setOtp(""); setNotice(data.message); return; }
      setOtpFor(false); setOtp("");
      setNotice(
        data.booked ? `Loan booked: ${fmtKES(data.booked.loanAmount)} over ${data.booked.installments} installments — queued for disbursement.`
          : data.status === "DECLINED" ? "Application declined."
          : data.status === "REFERRED" ? "Sent back for review."
          : `Moved to ${data.stageTitle ?? data.status}.`,
      );
      await load();
    } catch { setError("Action failed."); } finally { setActing(null); }
  };

  if (!d && !error) return <main className="mx-auto max-w-5xl px-4 py-16 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></main>;
  if (error && !d) return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
      <Link href="/console/applications" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800"><ArrowLeft className="h-4 w-4" /> Applications</Link>
      <div className="mt-6 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}</div>
    </main>
  );
  if (!d) return null;

  const { application: a, borrower: b, product: p, recommendation: rec, kyc } = d;
  const live = LIVE.includes(a.status);
  const isFinal = a.currentStageId === "virtual:final";

  // The gates still open — an officer should see these before they press approve.
  const alerts: { tone: "red" | "amber"; icon: React.ReactNode; text: string }[] = [];
  if (!b.verified) alerts.push({ tone: "red", icon: <ScanFace className="h-4 w-4" />, text: "Identity not verified — no money can be disbursed to this borrower yet." });
  if (!b.locationPinned) alerts.push({ tone: "amber", icon: <MapPin className="h-4 w-4" />, text: "No home/business location pinned — they won't appear on field routes, and the disbursement location gate is open." });
  if (p?.guarantorRequired && !d.guarantor) alerts.push({ tone: "amber", icon: <Users className="h-4 w-4" />, text: "This product requires a guarantor — none is attached yet." });
  if (p?.securityRequired) alerts.push({ tone: "amber", icon: <ShieldAlert className="h-4 w-4" />, text: "This product requires security — verify the collateral below before booking." });

  const pdPct = a.pd != null ? Math.round(a.pd * 100) : null;

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between gap-3">
        <Link href="/console/applications" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800"><ArrowLeft className="h-4 w-4" /> Applications</Link>
        <span className={`rounded-md px-2 py-1 text-[11px] font-semibold ${a.status === "APPROVED" ? "bg-emerald-100 text-emerald-700" : a.status === "DECLINED" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{a.stageTitle ?? a.status}</span>
      </div>

      {notice && <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50/90 px-3 py-2.5 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> {notice}</div>}
      {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}</div>}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* ── Identity column ── */}
        <div className="space-y-4">
          <div className="glass p-4">
            <div className="flex items-center gap-3">
              {b.portraitUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={b.portraitUrl} alt={b.name} className="h-16 w-16 rounded-2xl object-cover" />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-900/5 text-lg font-bold text-zinc-400">{b.name.slice(0, 1)}</div>
              )}
              <div className="min-w-0">
                <Link href={`/console/borrowers/${b.id}`} className="text-base font-bold hover:underline truncate block">{b.name}</Link>
                <p className="text-xs text-zinc-500 truncate">{b.phone}{b.nationalId ? ` · ID ${b.nationalId}` : ""}</p>
                <p className={`mt-0.5 flex items-center gap-1 text-[11px] font-semibold ${b.verified ? "text-emerald-700" : "text-amber-700"}`}>
                  {b.verified ? <><BadgeCheck className="h-3 w-3" /> Verified</> : <>KYC {b.kycStatus}</>}
                </p>
              </div>
            </div>

            {b.idFrontUrl && (
              <div className="mt-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400 flex items-center gap-1"><IdCard className="h-3 w-3" /> ID (front)</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={b.idFrontUrl} alt="ID front" className="mt-1 w-full rounded-lg border border-zinc-900/10 object-cover" />
              </div>
            )}

            {kyc && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {[
                  { l: "Liveness", v: kyc.livenessScore != null ? `${kyc.livenessScore}` : "—", ok: kyc.livenessPassed },
                  { l: "Face match", v: kyc.faceMatchScore != null ? `${kyc.faceMatchScore}` : "—" },
                  { l: "IPRS", v: kyc.iprsMatched ? "Matched" : "—", ok: kyc.iprsMatched },
                  { l: "ID quality", v: kyc.idQualityScore != null ? `${kyc.idQualityScore}` : "—" },
                ].map((s) => (
                  <div key={s.l} className="rounded-lg border border-zinc-900/10 bg-white/60 px-2.5 py-1.5">
                    <p className="text-[9px] uppercase tracking-wide text-zinc-500">{s.l}</p>
                    <p className={`text-sm font-bold ${s.ok ? "text-emerald-600" : "text-zinc-800"}`}>{s.v}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Decision column ── */}
        <div className="space-y-4 lg:col-span-2">
          {/* Alerts */}
          {alerts.length > 0 && (
            <div className="space-y-2">
              {alerts.map((al, i) => (
                <div key={i} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px] ${al.tone === "red" ? "border-rose-300 bg-rose-50 text-rose-700" : "border-amber-300 bg-amber-50 text-amber-700"}`}>
                  <span className="mt-0.5 shrink-0">{al.icon}</span> {al.text}
                </div>
              ))}
            </div>
          )}

          {/* The ask + the model */}
          <div className="glass p-5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-zinc-500">Requested</p>
                <p className="text-2xl font-bold" style={{ color: "var(--brand)" }}>{fmtKES(a.amountRequested)}</p>
                <p className="text-xs text-zinc-500">{p ? `${p.name} · ${p.interestRate}% ${p.interestMethod} · ${p.repaymentPeriod} × ${p.repaymentPeriodUnit}` : "No product"}</p>
              </div>
              <div className="flex gap-2">
                <div className="rounded-lg border border-zinc-900/10 bg-white/60 px-3 py-2 text-center">
                  <p className="text-[9px] uppercase tracking-wide text-zinc-500">Score</p>
                  <p className="text-lg font-bold">{a.score ?? "—"}</p>
                </div>
                <div className="rounded-lg border border-zinc-900/10 bg-white/60 px-3 py-2 text-center">
                  <p className="text-[9px] uppercase tracking-wide text-zinc-500">Default prob.</p>
                  <p className={`text-lg font-bold ${pdPct != null && pdPct > 25 ? "text-rose-600" : pdPct != null && pdPct > 12 ? "text-amber-600" : "text-emerald-600"}`}>{pdPct != null ? `${pdPct}%` : "—"}</p>
                </div>
                <div className="rounded-lg border border-zinc-900/10 bg-white/60 px-3 py-2 text-center">
                  <p className="text-[9px] uppercase tracking-wide text-zinc-500">Decision</p>
                  <p className="text-lg font-bold">{a.decision ?? "—"}</p>
                </div>
              </div>
            </div>

            {a.reasonCodes.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-zinc-900/10 pt-3">
                {a.reasonCodes.map((r, i) => (
                  <li key={i} className="text-xs text-zinc-600">
                    <span className={r.direction === "down" ? "text-rose-600" : "text-emerald-600"}>{r.direction === "down" ? "▼" : "▲"}</span>{" "}
                    <span className="font-semibold">{r.factor}</span>{r.detail ? ` — ${r.detail}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Recommendation on the amount */}
          <div className="glass p-5">
            <h2 className="text-sm font-semibold flex items-center gap-2"><Gauge className="h-4 w-4" style={{ color: "var(--brand)" }} /> Recommendation</h2>
            {rec.verdict === "declined" || rec.approvedLimit === 0 ? (
              <p className="mt-2 flex items-center gap-2 text-sm text-rose-700"><TrendingDown className="h-4 w-4" /> Based on the statement and history, this product cannot responsibly be offered — the qualifying limit is zero.</p>
            ) : (
              <>
                <div className="mt-2 flex items-center gap-2 text-sm">
                  {rec.verdict === "reduce" && <span className="flex items-center gap-1.5 font-semibold text-amber-700"><TrendingDown className="h-4 w-4" /> Reduce the amount</span>}
                  {rec.verdict === "increase" && <span className="flex items-center gap-1.5 font-semibold text-emerald-700"><TrendingUp className="h-4 w-4" /> Room to increase</span>}
                  {rec.verdict === "ok" && <span className="flex items-center gap-1.5 font-semibold text-zinc-700"><Minus className="h-4 w-4" /> The amount sits within their limit</span>}
                </div>
                <p className="mt-1 text-[13px] text-zinc-600">
                  Qualifies for up to <span className="font-bold" style={{ color: "var(--brand)" }}>{fmtKES(rec.approvedLimit)}</span>
                  {rec.affordableInstallment != null && <> — about <span className="font-semibold">{fmtKES(rec.affordableInstallment)}</span>/{(rec.installmentUnit ?? "month").replace(/s$/, "")} × {rec.installmentCount}</>}.
                  {rec.verdict === "reduce" && <> They asked for {fmtKES(a.amountRequested)} — <span className="font-semibold text-amber-700">{fmtKES(rec.approvedLimit)}</span> is the responsible ceiling.</>}
                  {rec.verdict === "increase" && <> They asked for {fmtKES(a.amountRequested)} — there is headroom to {fmtKES(rec.approvedLimit)}.</>}
                </p>
                {!rec.hasStatement && <p className="mt-1 text-[11px] text-amber-700">No crunched statement — the limit rests on history alone. Crunch one for a sharper number.</p>}
              </>
            )}
          </div>

          {/* The schedule they'd repay */}
          {d.schedule.length > 0 && (
            <div className="glass p-5">
              <h2 className="text-sm font-semibold flex items-center gap-2"><Landmark className="h-4 w-4" style={{ color: "var(--brand)" }} /> If booked at {fmtKES(a.amountRequested)}</h2>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border border-zinc-900/10 px-2 py-1.5"><p className="text-[9px] uppercase text-zinc-500">Principal</p><p className="text-sm font-bold">{fmtKES(a.amountRequested)}</p></div>
                <div className="rounded-lg border border-zinc-900/10 px-2 py-1.5"><p className="text-[9px] uppercase text-zinc-500">Interest</p><p className="text-sm font-bold">{fmtKES(d.interest)}</p></div>
                <div className="rounded-lg border border-zinc-900/10 px-2 py-1.5"><p className="text-[9px] uppercase text-zinc-500">Total</p><p className="text-sm font-bold">{fmtKES(d.loanAmount)}</p></div>
              </div>
              <div className="mt-3 max-h-56 overflow-y-auto">
                <table className="w-full text-[11px]">
                  <thead><tr className="border-y border-zinc-900/10 text-zinc-500"><th className="py-1.5 text-left font-medium">#</th><th className="py-1.5 text-left font-medium">Due</th><th className="py-1.5 text-right font-medium">Amount</th></tr></thead>
                  <tbody>
                    {d.schedule.map((r) => (
                      <tr key={r.seq} className="border-b border-zinc-900/5"><td className="py-1.5 text-zinc-500">{r.seq}</td><td className="py-1.5">{dfmt(r.dueDate)}</td><td className="py-1.5 text-right tabular-nums">{fmtKES(r.amountDue)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Offer + security — booking checks both. */}
          {!a.loan && live && (
            <div className="glass p-5">
              <OfferPanel applicationId={a.id} onChanged={load} />
              <SecurityPanel applicationId={a.id} onChanged={load} />
            </div>
          )}
          {a.loan && <p className="text-xs text-zinc-500">Loan {a.loan.id.slice(0, 8)}… · {a.loan.status}</p>}

          {/* The three buttons */}
          {live && (
            <div className="glass p-4">
              {!otpFor ? (
                <div className="flex flex-wrap gap-2">
                  <button disabled={!!acting} onClick={() => act("approve")}
                    className="inline-flex items-center gap-1.5 rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60" style={{ backgroundColor: "var(--brand)" }}>
                    {acting === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    {isFinal ? "Final approve & book" : "Approve → next stage"}
                  </button>
                  <button disabled={!!acting} onClick={() => act("send-back")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white/70 px-4 py-2.5 text-sm font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-60">
                    {acting === "send-back" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />} Send back
                  </button>
                  <button disabled={!!acting} onClick={() => act("decline")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white/70 px-4 py-2.5 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-60">
                    {acting === "decline" ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Reject
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric"
                    placeholder="6-digit code from your email" className="w-56 rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2 text-sm outline-none" />
                  <button disabled={otp.length !== 6 || !!acting} onClick={() => act("approve", otp)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ backgroundColor: "var(--brand)" }}>
                    {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Confirm & book
                  </button>
                  <button onClick={() => act("approve")} disabled={!!acting} className="text-xs text-zinc-500 underline hover:text-zinc-800">Resend code</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
