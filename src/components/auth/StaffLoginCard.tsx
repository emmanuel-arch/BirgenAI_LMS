"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Mail, ArrowRight, AlertTriangle, CheckCircle2, KeyRound, FlaskConical, ShieldCheck } from "lucide-react";
import type { LenderBrand } from "@/lib/lms/branding";

// Staff sign-in (org-scoped console). Borrowers never need this — the funnel
// at / identifies them by phone inside the wizard.
//
// Brand-aware: lms.birgenai.com/micromart wears Micromart's logo and accent,
// lms.birgenai.com/buysimu wears Buy Simu's — the SAME email can hold a staff
// seat at several lenders, and the org on the URL is what disambiguates which
// book this session opens (orgSlug rides along to /api/auth/login).
//
// Two factors: password, then today's 6-digit code (emailed, reusable until
// midnight — one code each morning, not one per session).
type Mode = "signin" | "otp" | "forgot" | "reset";

export default function StaffLoginCard({ brand }: { brand?: LenderBrand | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [nextPass, setNextPass] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const orgSlug = brand?.slug ?? null;

  const submit = async (withOtp?: string) => {
    setError(null);
    if (!email.trim() || !password) { setError("Enter your email and password."); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, ...(orgSlug ? { orgSlug } : {}), ...(withOtp ? { otp: withOtp } : {}) }),
      });
      // Guard the parse: a cold backend can answer with an HTML error page, and a
      // reachability blip must never read as a wrong password.
      const data = await res.json().catch(() => null);
      if (res.status === 503 || data?.wakingUp) {
        setError(data?.message || "The service is waking up — please try again in a moment."); return;
      }
      if (!data) { setError("Couldn't reach the sign-in service. Please try again in a moment."); return; }
      if (data.otpRequired) {
        setMode("otp");
        setDevCode(data.devCode ?? null);
        if (withOtp) setError(data.message || "That code didn't match.");
        else setNotice(data.message || "We emailed you today's sign-in code.");
        return;
      }
      if (!data.success) { setError(data.message || "Sign-in failed."); return; }
      router.replace("/console");
    } catch { setError("Couldn't reach the sign-in service. Please try again in a moment."); } finally { setLoading(false); }
  };

  const requestCode = async () => {
    setError(null); setNotice(null);
    if (!email.trim()) { setError("Enter your email."); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      setNotice(data.message || "If that email is on a team, a reset code has been sent.");
      setMode("reset");
    } catch { setError("Could not send the code."); } finally { setLoading(false); }
  };

  const confirmReset = async () => {
    setError(null); setNotice(null);
    if (code.length !== 6 || nextPass.length < 10) { setError("Enter the 6-digit code and a new password (10+ chars)."); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code, next: nextPass }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Reset failed."); return; }
      setNotice(data.message || "Password updated — sign in with the new one.");
      setMode("signin"); setPassword(""); setCode(""); setNextPass("");
    } catch { setError("Reset failed."); } finally { setLoading(false); }
  };

  const wrap = "flex items-center gap-2 rounded-lg border border-zinc-900/15 bg-white/80 px-3";
  const input = "flex-1 bg-transparent outline-none text-sm py-3 placeholder:text-zinc-400";
  // The branded accent drives the primary button; the BirgenAI default keeps
  // the original near-black so the generic /login is pixel-stable.
  const accentVars = (brand
    ? { "--brand": brand.accent, "--brand-soft": brand.accentSoft }
    : {}) as CSSProperties;
  const primaryBtn = brand
    ? "mt-5 w-full inline-flex items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
    : "mt-5 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60";
  const primaryStyle: CSSProperties | undefined = brand ? { backgroundColor: "var(--brand)" } : undefined;

  const logoSrc = brand?.logo ?? "/images/logo.png";
  const logoFallback = brand?.fallbackLogo ?? "/images/BirgenAI-logo.png";
  const logoHeight = Math.round(44 * ((brand?.logoScale ?? 100) / 100));

  return (
    <div className="min-h-screen relative text-zinc-900" style={accentVars}>
      <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />
      <div className="relative z-10 min-h-screen flex items-center justify-center px-4">
        <div className="glass w-full max-w-md rounded-3xl bg-white/65 p-6 sm:p-8">
          <div className="text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoSrc} alt={brand?.name ?? "BirgenAI"} style={{ height: logoHeight }} className="mx-auto mb-4 w-auto object-contain"
              onError={(e) => (((e.target as HTMLImageElement).src = logoFallback))} />
            <h1 className="text-2xl font-bold">
              {mode === "signin" ? (brand ? `Sign in to ${brand.name}` : "Staff sign in") : mode === "otp" ? "Enter today's code" : "Reset your password"}
            </h1>
            <p className="mt-1.5 text-sm text-zinc-500">
              {mode === "signin" ? (brand ? `${brand.name} staff console — loan officers, ROs, managers & admins.` : "Loan officers, ROs, managers & admins.")
                : mode === "otp" ? "We emailed you a 6-digit code. It works for the whole day — one code each morning."
                : mode === "forgot" ? "We'll email you a 6-digit code." : "Enter the code from your email and a new password."}
            </p>
          </div>

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
            </div>
          )}
          {notice && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50/90 px-3 py-2.5 text-sm text-emerald-700">
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> {notice}
            </div>
          )}

          {mode === "signin" && (
            <>
              <div className="mt-5 space-y-3">
                <div className={wrap}><Mail className="h-4 w-4 text-zinc-400 shrink-0" /><input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" placeholder="Work email" className={input} /></div>
                <div className={wrap}><Lock className="h-4 w-4 text-zinc-400 shrink-0" /><input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Password" onKeyDown={(e) => e.key === "Enter" && submit()} className={input} /></div>
              </div>
              <button onClick={() => submit()} disabled={loading} className={primaryBtn} style={primaryStyle}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Sign in <ArrowRight className="h-4 w-4" />
              </button>
              <div className="mt-4 flex items-center justify-between text-xs">
                <button onClick={() => { setMode("forgot"); setError(null); setNotice(null); }} className="text-zinc-500 hover:text-zinc-800">Forgot password?</button>
                {!brand && (
                  <Link href="/onboard" className="font-semibold" style={{ color: "var(--brand)" }}>Create your organization</Link>
                )}
              </div>
            </>
          )}

          {mode === "otp" && (
            <>
              {devCode && (
                <p className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-violet-100 px-2 py-1 text-[11px] font-semibold text-violet-700">
                  <FlaskConical className="h-3 w-3" /> Dev code: {devCode}
                </p>
              )}
              <div className="mt-5">
                <div className={wrap}>
                  <ShieldCheck className="h-4 w-4 text-zinc-400 shrink-0" />
                  <input
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="6-digit code"
                    onKeyDown={(e) => e.key === "Enter" && otp.length === 6 && submit(otp)}
                    className={`${input} tracking-[0.4em] font-semibold`}
                  />
                </div>
              </div>
              <button onClick={() => submit(otp)} disabled={loading || otp.length !== 6} className={primaryBtn} style={primaryStyle}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Verify & sign in <ArrowRight className="h-4 w-4" />
              </button>
              <p className="mt-3 text-center text-[11px] text-zinc-400">
                No email? The code from earlier today still works — check your inbox and spam.
              </p>
              <button onClick={() => { setMode("signin"); setOtp(""); setError(null); setNotice(null); }} className="mt-3 w-full text-center text-xs text-zinc-500 hover:text-zinc-800">Back to sign in</button>
            </>
          )}

          {mode === "forgot" && (
            <>
              <div className="mt-5"><div className={wrap}><Mail className="h-4 w-4 text-zinc-400 shrink-0" /><input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" placeholder="Work email" onKeyDown={(e) => e.key === "Enter" && requestCode()} className={input} /></div></div>
              <button onClick={requestCode} disabled={loading} className={primaryBtn} style={primaryStyle}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Send reset code
              </button>
              <button onClick={() => { setMode("signin"); setError(null); setNotice(null); }} className="mt-4 w-full text-center text-xs text-zinc-500 hover:text-zinc-800">Back to sign in</button>
            </>
          )}

          {mode === "reset" && (
            <>
              <div className="mt-5 space-y-3">
                <div className={wrap}><KeyRound className="h-4 w-4 text-zinc-400 shrink-0" /><input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="6-digit code" className={input} /></div>
                <div className={wrap}><Lock className="h-4 w-4 text-zinc-400 shrink-0" /><input value={nextPass} onChange={(e) => setNextPass(e.target.value)} type="password" placeholder="New password (10+ chars)" onKeyDown={(e) => e.key === "Enter" && confirmReset()} className={input} /></div>
              </div>
              <button onClick={confirmReset} disabled={loading} className={primaryBtn} style={primaryStyle}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Update password
              </button>
              <button onClick={() => { setMode("signin"); setError(null); setNotice(null); }} className="mt-4 w-full text-center text-xs text-zinc-500 hover:text-zinc-800">Back to sign in</button>
            </>
          )}

          {brand && (
            <p className="mt-6 text-center text-[11px] text-zinc-400">
              Powered by <span className="font-semibold text-zinc-500">BirgenAI</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
