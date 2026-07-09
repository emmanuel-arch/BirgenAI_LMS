"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, AlertTriangle, CheckCircle2, Banknote, Phone, CreditCard, ArrowRight } from "lucide-react";
import { getBrand, BRANDED_LENDERS } from "@/lib/lms/branding";

// Borrower self-service: check my loan + Pay Now (STK to the REGISTERED phone).
// White-label aware like the funnel (subdomain or ?lender=).
type MyLoan = {
  ref: string; product: string; status: string; loanAmount: number; balance: number;
  expectedClearDate: string | null; nextDue: { date: string; amount: number } | null;
};

const fmtKES = (n: number) => `KES ${Math.round(n).toLocaleString()}`;

function lenderFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  const label = window.location.hostname.split(".")[0]?.toLowerCase() ?? "";
  if (BRANDED_LENDERS.some((l) => l.slug === label)) return label;
  const q = new URLSearchParams(window.location.search).get("lender");
  return q || null;
}

export default function MyLoanPage() {
  const [lender, setLender] = useState<string>("");
  const [phone, setPhone] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<{ found: boolean; firstName?: string | null; lender?: string; clearedLoans?: number; activeLoan?: MyLoan | null; message?: string } | null>(null);
  const [payAmount, setPayAmount] = useState("");

  useEffect(() => { setLender(lenderFromLocation() ?? "hub"); }, []);
  const brand = getBrand(lender);

  const lookup = async () => {
    setError(null); setNotice(null); setResult(null);
    if (!phone.trim() || !nationalId.trim()) { setError("Enter your phone number and national ID."); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/portal/my-loan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lenderSlug: lender, phone, nationalId }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Lookup failed."); return; }
      setResult(data);
      if (data.activeLoan?.nextDue) setPayAmount(String(Math.round(data.activeLoan.nextDue.amount)));
    } catch { setError("Lookup failed."); } finally { setLoading(false); }
  };

  const pay = async () => {
    setError(null); setNotice(null); setPaying(true);
    try {
      const res = await fetch("/api/portal/pay", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lenderSlug: lender, phone, nationalId, amount: Number(payAmount) || undefined }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not start the payment."); return; }
      setNotice(`${data.message} (KES ${Math.round(data.amount).toLocaleString()} to your registered number)`);
    } catch { setError("Could not start the payment."); } finally { setPaying(false); }
  };

  const field = "flex items-center gap-2 rounded-lg border border-zinc-900/15 bg-white/80 px-3";
  const input = "flex-1 bg-transparent outline-none text-sm py-3 placeholder:text-zinc-400";

  return (
    <div className="min-h-screen relative text-zinc-900" style={{ ["--brand" as never]: brand.accent }}>
      <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />
      <div className="relative z-10 min-h-screen flex items-center justify-center px-4 py-8">
        <div className="glass w-full max-w-md rounded-3xl bg-white/65 p-6 sm:p-8">
          <div className="text-center">
            <CreditCard className="mx-auto h-10 w-10" style={{ color: "var(--brand)" }} />
            <h1 className="mt-3 text-2xl font-bold">My loan</h1>
            <p className="mt-1.5 text-sm text-zinc-500">Check your balance and pay from your phone.</p>
          </div>

          {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}</div>}
          {notice && <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50/90 px-3 py-2.5 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> {notice}</div>}

          {!result?.found && (
            <>
              <div className="mt-5 space-y-3">
                <div className={field}><Phone className="h-4 w-4 text-zinc-400 shrink-0" /><input className={input} inputMode="tel" placeholder="Phone number (07XX XXX XXX)" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
                <div className={field}><input className={input} inputMode="numeric" placeholder="National ID number" value={nationalId} onChange={(e) => setNationalId(e.target.value)} /></div>
              </div>
              <button onClick={lookup} disabled={loading}
                className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Find my loan <ArrowRight className="h-4 w-4" />
              </button>
              {result && !result.found && (
                <p className="mt-4 text-center text-sm text-zinc-500">{result.message ?? "We couldn't match those details. New here?"} <Link href="/" className="font-semibold" style={{ color: "var(--brand)" }}>Apply for a loan</Link></p>
              )}
            </>
          )}

          {result?.found && (
            <div className="mt-5">
              <p className="text-sm text-zinc-600">Hi <span className="font-semibold">{result.firstName ?? "there"}</span> 👋 {result.clearedLoans ? `· ${result.clearedLoans} loan${result.clearedLoans > 1 ? "s" : ""} cleared` : ""}</p>
              {!result.activeLoan ? (
                <div className="mt-4 rounded-xl border border-zinc-900/10 bg-white/70 p-4 text-center">
                  <p className="text-sm font-semibold">No active loan 🎉</p>
                  <Link href="/" className="mt-3 inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800">
                    Apply again <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-zinc-900/10 bg-white/70 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">{result.activeLoan.product}</p>
                    <span className="rounded-md bg-zinc-900/5 px-2 py-0.5 text-[11px] font-semibold text-zinc-600">REF {result.activeLoan.ref}</span>
                  </div>
                  <p className="mt-3 text-[11px] uppercase tracking-wide text-zinc-500">Balance</p>
                  <p className="text-2xl font-bold" style={{ color: "var(--brand)" }}>{fmtKES(result.activeLoan.balance)}</p>
                  {result.activeLoan.nextDue && (
                    <p className="mt-1 text-xs text-zinc-500">Next: {fmtKES(result.activeLoan.nextDue.amount)} due {result.activeLoan.nextDue.date}</p>
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
                        {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />} Pay now (M-PESA)
                      </button>
                      <p className="mt-2 text-center text-[11px] text-zinc-400">A prompt is sent to your registered number — enter your M-PESA PIN.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
