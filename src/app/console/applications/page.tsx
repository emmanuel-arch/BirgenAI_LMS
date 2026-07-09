"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, AlertTriangle, CheckCircle2, XCircle, FileText, ChevronDown } from "lucide-react";
import { OfferPanel } from "./OfferPanel";

type App = {
  id: string; createdAt: string; status: string; stageTitle: string | null; currentStageId: string | null;
  borrowerName: string | null; phone: string | null; amountRequested: number;
  productName: string | null; score: number | null; pd: number | null; decision: string | null;
  reasonCodes: { factor?: string; detail?: string; direction?: string }[] | null;
  graduated: boolean; postedToServiceSuite: boolean; serviceSuiteLoanId: string | null;
  loan: { id: string; status: string } | null;
};

const fmtKES = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const STATUS_TONE: Record<string, string> = {
  OFFICER_REVIEW: "bg-amber-100 text-amber-700",
  REFERRED: "bg-orange-100 text-orange-700",
  APPROVED: "bg-emerald-100 text-emerald-700",
  DECLINED: "bg-red-100 text-red-700",
  SUBMITTED: "bg-zinc-900/5 text-zinc-600",
};

export default function ApplicationsQueue() {
  const [scope, setScope] = useState<"live" | "all">("live");
  const [apps, setApps] = useState<App[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [otpFor, setOtpFor] = useState<string | null>(null);
  const [otp, setOtp] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/console/applications?scope=${scope}`);
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not load applications."); return; }
      setApps(data.applications);
    } catch { setError("Could not load applications."); }
  }, [scope]);

  useEffect(() => { setApps(null); load(); }, [load]);

  const act = async (id: string, action: "approve" | "decline", otpCode?: string) => {
    setActing(id + action); setNotice(null); setError(null);
    try {
      const res = await fetch(`/api/console/applications/${id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(otpCode ? { otp: otpCode } : {}) }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Action failed."); return; }
      if (data.otpRequired) {
        // Final approval is OTP-gated — the code just went to the approver's email.
        setOtpFor(id); setOtp("");
        setNotice(data.message);
        return;
      }
      setOtpFor(null); setOtp("");
      setNotice(
        data.booked
          ? `Loan booked: ${fmtKES(data.booked.loanAmount)} over ${data.booked.installments} installments — queued for disbursement.`
          : `Application ${data.status === "DECLINED" ? "declined" : data.stageTitle ? `moved to ${data.stageTitle}` : data.status.toLowerCase()}.`,
      );
      await load();
    } catch { setError("Action failed."); } finally { setActing(null); }
  };

  return (
    <div className="min-h-screen relative text-zinc-900">
      <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />
      <main className="relative z-10 mx-auto max-w-5xl px-4 sm:px-6 py-8">
        <Link href="/console" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800">
          <ArrowLeft className="h-4 w-4" /> Console
        </Link>
        <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-xl font-bold flex items-center gap-2"><FileText className="h-5 w-5" style={{ color: "var(--brand)" }} /> Applications</h1>
          <div className="flex gap-1 rounded-lg border border-zinc-900/10 bg-white/70 p-1 text-xs font-semibold">
            {(["live", "all"] as const).map((s) => (
              <button key={s} onClick={() => setScope(s)}
                className={`rounded-md px-3 py-1.5 ${scope === s ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-white"}`}>
                {s === "live" ? "Needs action" : "All"}
              </button>
            ))}
          </div>
        </div>

        {notice && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50/90 px-3 py-2.5 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> {notice}
          </div>
        )}
        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
          </div>
        )}
        {!apps && !error && <div className="mt-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>}
        {apps?.length === 0 && <p className="mt-10 text-center text-sm text-zinc-500">No applications {scope === "live" ? "waiting for action" : "yet"}.</p>}

        <div className="mt-5 space-y-3">
          {apps?.map((a) => {
            const expanded = open === a.id;
            const live = ["SUBMITTED", "AI_PRESCREEN", "OFFICER_REVIEW", "REFERRED"].includes(a.status);
            return (
              <div key={a.id} className="glass p-4">
                <button className="w-full flex items-center gap-3 text-left" onClick={() => setOpen(expanded ? null : a.id)}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{a.borrowerName || a.phone || "Applicant"} · {fmtKES(a.amountRequested)}</p>
                    <p className="text-xs text-zinc-500 truncate">
                      {a.productName ?? "No product"} · {new Date(a.createdAt).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      {a.score != null && <> · score <span className="font-semibold">{a.score}</span>/900</>}
                    </p>
                  </div>
                  <span className={`rounded-md px-2 py-1 text-[11px] font-semibold shrink-0 ${STATUS_TONE[a.status] ?? "bg-zinc-900/5 text-zinc-600"}`}>
                    {a.stageTitle ?? a.status}
                  </span>
                  <ChevronDown className={`h-4 w-4 text-zinc-400 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
                </button>

                {expanded && (
                  <div className="mt-3 border-t border-zinc-900/10 pt-3">
                    {Array.isArray(a.reasonCodes) && a.reasonCodes.length > 0 && (
                      <ul className="space-y-1">
                        {a.reasonCodes.map((r, i) => (
                          <li key={i} className="text-xs text-zinc-600">
                            <span className={r.direction === "down" ? "text-red-600" : "text-emerald-600"}>{r.direction === "down" ? "▼" : "▲"}</span>{" "}
                            <span className="font-semibold">{r.factor}</span>{r.detail ? ` — ${r.detail}` : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                    {a.loan && <p className="mt-2 text-xs text-zinc-500">Loan {a.loan.id.slice(0, 8)}… · {a.loan.status}</p>}
                    {/* A loan will not book until this says "Signed". */}
                    {!a.loan && <OfferPanel applicationId={a.id} onChanged={load} />}
                    {live && otpFor !== a.id && (
                      <div className="mt-3 flex gap-2">
                        <button disabled={!!acting} onClick={() => act(a.id, "approve")}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
                          {acting === a.id + "approve" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                          {a.currentStageId === "virtual:final" ? "Final approve & book" : "Approve"}
                        </button>
                        <button disabled={!!acting} onClick={() => act(a.id, "decline")}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white/70 px-4 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60">
                          {acting === a.id + "decline" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                          Decline
                        </button>
                      </div>
                    )}
                    {live && otpFor === a.id && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                          inputMode="numeric" placeholder="6-digit code from your email"
                          className="rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2 text-sm outline-none w-52" />
                        <button disabled={otp.length !== 6 || !!acting} onClick={() => act(a.id, "approve", otp)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
                          {acting === a.id + "approve" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Confirm & book
                        </button>
                        <button onClick={() => act(a.id, "approve")} disabled={!!acting}
                          className="text-xs text-zinc-500 underline hover:text-zinc-800">Resend code</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
