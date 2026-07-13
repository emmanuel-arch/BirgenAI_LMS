"use client";

import { useState } from "react";
import Link from "next/link";
import { useLoad } from "@/lib/hooks/useLoad";
import { Loader2, AlertTriangle, CheckCircle2, Banknote, Phone, CreditCard, ArrowRight, Lock } from "lucide-react";
import { useBrand, lenderFromLocation } from "@/lib/lms/useBrand";
import { useLang } from "@/lib/i18n/useLang";
import { fmt } from "@/lib/i18n/portal";
import { LangToggle } from "@/components/portal/LangToggle";
import OtpCard, { type OtpIssue } from "@/components/portal/OtpCard";

// Borrower self-service: check my loan + Pay Now (STK to the REGISTERED phone).
// White-label aware like the funnel (subdomain or ?lender=).
//
// Phone first, then the code, then the ID. Possession (the SMS) plus knowledge
// (the ID) — a SIM swap alone should not open someone's loan book.
type MyLoan = {
  ref: string; product: string; status: string; loanAmount: number; balance: number;
  expectedClearDate: string | null; nextDue: { date: string; amount: number } | null;
};

type Stage = "phone" | "code" | "id";

const fmtKES = (n: number) => `KES ${Math.round(n).toLocaleString()}`;

export default function MyLoanPage() {
  const { lang, t } = useLang();
  const [lender, setLender] = useState<string>("");
  const [stage, setStage] = useState<Stage>("phone");
  const [phone, setPhone] = useState("");
  const [otpIssue, setOtpIssue] = useState<OtpIssue | null>(null);
  const [nationalId, setNationalId] = useState("");
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<{ found: boolean; firstName?: string | null; lender?: string; clearedLoans?: number; activeLoan?: MyLoan | null; message?: string } | null>(null);
  const [payAmount, setPayAmount] = useState("");

  useLoad(() => { setLender(lenderFromLocation() ?? "hub"); });
  const brand = useBrand(lender);

  /** The session expired mid-flow — send them back to the phone step. */
  const expired = () => { setStage("phone"); setOtpIssue(null); setError(t.errors.sessionExpired); };

  const requestOtp = async () => {
    setError(null); setNotice(null);
    if (!phone.trim()) { setError(t.errors.enterPhone); return; }
    setLoading(true);
    try {
      // Skip the SMS if this number is already verified with this lender.
      try {
        const s = await fetch(`/api/portal/session?phone=${encodeURIComponent(phone.trim())}`).then((r) => r.json());
        if (s?.authenticated && s.lenderSlug === lender && s.matchesPhone) { setStage("id"); return; }
      } catch { /* no session — issue a code as normal */ }

      const res = await fetch("/api/portal/otp", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lenderSlug: lender, phone: phone.trim(), lang }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || t.errors.couldNotSendCode); return; }
      setOtpIssue({ delivered: !!data.delivered, devCode: data.devCode });
      setStage("code");
    } catch { setError(t.errors.couldNotSendCode); } finally { setLoading(false); }
  };

  const lookup = async () => {
    setError(null); setNotice(null); setResult(null);
    if (!nationalId.trim()) { setError(t.myloan.enterId); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/portal/my-loan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lenderSlug: lender, nationalId }),
      });
      const data = await res.json();
      if (data.needsOtp) { expired(); return; }
      if (!data.success) { setError(data.message || t.myloan.lookupFailed); return; }
      setResult(data);
      if (data.activeLoan?.nextDue) setPayAmount(String(Math.round(data.activeLoan.nextDue.amount)));
    } catch { setError(t.myloan.lookupFailed); } finally { setLoading(false); }
  };

  const pay = async () => {
    setError(null); setNotice(null); setPaying(true);
    try {
      const res = await fetch("/api/portal/pay", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lenderSlug: lender, nationalId, amount: Number(payAmount) || undefined }),
      });
      const data = await res.json();
      if (data.needsOtp) { expired(); return; }
      if (!data.success) { setError(data.message || t.myloan.couldNotStartPayment); return; }
      setNotice(`${data.message} ${fmt(t.myloan.toRegistered, { amount: Math.round(data.amount).toLocaleString() })}`);
    } catch { setError(t.myloan.couldNotStartPayment); } finally { setPaying(false); }
  };

  const field = "flex items-center gap-2 rounded-lg border border-zinc-900/15 bg-white/80 px-3";
  const input = "flex-1 bg-transparent outline-none text-sm py-3 placeholder:text-zinc-400";

  return (
    <div className="min-h-screen relative text-zinc-900" style={{ ["--brand" as never]: brand.accent, ["--brand-soft" as never]: brand.accentSoft }}>
      <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />
      <div className="relative z-10 min-h-screen flex items-center justify-center px-4 py-8">
        {/* The code screen is its own full card — no header above it. */}
        {stage === "code" && otpIssue && !result?.found ? (
          <div className="w-full max-w-md">
            {error && <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}</div>}
            <OtpCard
              lenderSlug={lender}
              phone={phone.trim()}
              issue={otpIssue}
              onVerified={() => { setError(null); setStage("id"); }}
              onChangeNumber={() => { setOtpIssue(null); setError(null); setStage("phone"); }}
            />
          </div>
        ) : (
        <div className="glass w-full max-w-md rounded-3xl bg-white/65 p-6 sm:p-8">
          <div className="flex justify-end"><LangToggle /></div>
          <div className="text-center">
            <CreditCard className="mx-auto h-10 w-10" style={{ color: "var(--brand)" }} />
            <h1 className="mt-3 text-2xl font-bold">{t.myloan.title}</h1>
            <p className="mt-1.5 text-sm text-zinc-500">{t.myloan.sub}</p>
          </div>

          {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}</div>}
          {notice && <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50/90 px-3 py-2.5 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> {notice}</div>}

          {!result?.found && stage === "phone" && (
            <>
              <div className={`mt-5 ${field}`}>
                <Phone className="h-4 w-4 text-zinc-400 shrink-0" />
                <input className={input} inputMode="tel" placeholder={t.landing.phonePlaceholderOpen} value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <button onClick={requestOtp} disabled={loading}
                className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {t.common.continue} <ArrowRight className="h-4 w-4" />
              </button>
              <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-zinc-400">
                <Lock className="h-3 w-3" /> {t.landing.smsNote}
              </p>
            </>
          )}

          {!result?.found && stage === "id" && (
            <>
              <div className={`mt-5 ${field}`}>
                <input className={input} inputMode="numeric" placeholder={t.myloan.idPlaceholder} value={nationalId} onChange={(e) => setNationalId(e.target.value)} />
              </div>
              <button onClick={lookup} disabled={loading}
                className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {t.myloan.findMyLoan} <ArrowRight className="h-4 w-4" />
              </button>
              {result && !result.found && (
                <p className="mt-4 text-center text-sm text-zinc-500">{result.message ?? t.myloan.noMatch} <Link href="/" className="font-semibold" style={{ color: "var(--brand)" }}>{t.myloan.applyForLoan}</Link></p>
              )}
            </>
          )}

          {result?.found && (
            <div className="mt-5">
              <p className="text-sm text-zinc-600">{t.myloan.hi} <span className="font-semibold">{result.firstName ?? ""}</span> 👋 {result.clearedLoans ? fmt(t.myloan.loansCleared, { n: result.clearedLoans }) : ""}</p>
              {!result.activeLoan ? (
                <div className="mt-4 rounded-xl border border-zinc-900/10 bg-white/70 p-4 text-center">
                  <p className="text-sm font-semibold">{t.myloan.noActiveLoan}</p>
                  <Link href="/" className="mt-3 inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800">
                    {t.myloan.applyAgain} <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-zinc-900/10 bg-white/70 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">{result.activeLoan.product}</p>
                    <span className="rounded-md bg-zinc-900/5 px-2 py-0.5 text-[11px] font-semibold text-zinc-600">{fmt(t.myloan.ref, { ref: result.activeLoan.ref })}</span>
                  </div>
                  <p className="mt-3 text-[11px] uppercase tracking-wide text-zinc-500">{t.myloan.balance}</p>
                  <p className="text-2xl font-bold" style={{ color: "var(--brand)" }}>{fmtKES(result.activeLoan.balance)}</p>
                  {result.activeLoan.nextDue && (
                    <p className="mt-1 text-xs text-zinc-500">{fmt(t.myloan.nextDue, { kes: fmtKES(result.activeLoan.nextDue.amount), date: result.activeLoan.nextDue.date })}</p>
                  )}
                  {result.activeLoan.status === "ACTIVE" && (
                    <div className="mt-4">
                      <div className={field}>
                        <span className="text-xs text-zinc-400 shrink-0">KES</span>
                        <input className={input} inputMode="numeric" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
                      </div>
                      <button onClick={pay} disabled={paying}
                        className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
                        style={{ backgroundColor: "var(--brand)" }}>
                        {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />} {t.myloan.payNow}
                      </button>
                      <p className="mt-2 text-center text-[11px] text-zinc-400">{t.myloan.stkNote}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
