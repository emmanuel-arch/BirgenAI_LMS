"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Mail, ArrowRight, AlertTriangle, CheckCircle2, KeyRound } from "lucide-react";

// Staff sign-in (org-scoped console). Borrowers never need this — the funnel
// at / identifies them by phone inside the wizard.
type Mode = "signin" | "forgot" | "reset";

export default function StaffLogin() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [nextPass, setNextPass] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!email.trim() || !password) { setError("Enter your email and password."); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Sign-in failed."); return; }
      router.replace("/console");
    } catch { setError("Sign-in failed. Try again."); } finally { setLoading(false); }
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

  return (
    <div className="min-h-screen relative text-zinc-900">
      <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />
      <div className="relative z-10 min-h-screen flex items-center justify-center px-4">
        <div className="glass w-full max-w-md rounded-3xl bg-white/65 p-6 sm:p-8">
          <div className="text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/logo.png" alt="BirgenAI" className="mx-auto mb-4 h-11 w-auto object-contain"
              onError={(e) => (((e.target as HTMLImageElement).src = "/images/BirgenAI-logo.png"))} />
            <h1 className="text-2xl font-bold">
              {mode === "signin" ? "Staff sign in" : "Reset your password"}
            </h1>
            <p className="mt-1.5 text-sm text-zinc-500">
              {mode === "signin" ? "Loan officers, ROs, managers & admins." : mode === "forgot" ? "We'll email you a 6-digit code." : "Enter the code from your email and a new password."}
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
              <button onClick={submit} disabled={loading} className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Sign in <ArrowRight className="h-4 w-4" />
              </button>
              <div className="mt-4 flex items-center justify-between text-xs">
                <button onClick={() => { setMode("forgot"); setError(null); setNotice(null); }} className="text-zinc-500 hover:text-zinc-800">Forgot password?</button>
                <Link href="/onboard" className="font-semibold" style={{ color: "var(--brand)" }}>Create your organization</Link>
              </div>
            </>
          )}

          {mode === "forgot" && (
            <>
              <div className="mt-5"><div className={wrap}><Mail className="h-4 w-4 text-zinc-400 shrink-0" /><input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" placeholder="Work email" onKeyDown={(e) => e.key === "Enter" && requestCode()} className={input} /></div></div>
              <button onClick={requestCode} disabled={loading} className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
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
              <button onClick={confirmReset} disabled={loading} className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Update password
              </button>
              <button onClick={() => { setMode("signin"); setError(null); setNotice(null); }} className="mt-4 w-full text-center text-xs text-zinc-500 hover:text-zinc-800">Back to sign in</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
