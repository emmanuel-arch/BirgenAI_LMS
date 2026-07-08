"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Mail, ArrowRight, AlertTriangle } from "lucide-react";

// Staff sign-in (org-scoped console). Borrowers never need this — the funnel
// at / identifies them by phone inside the wizard.
export default function StaffLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="min-h-screen relative text-zinc-900">
      <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />
      <div className="relative z-10 min-h-screen flex items-center justify-center px-4">
        <div className="glass w-full max-w-md rounded-3xl bg-white/65 p-6 sm:p-8">
          <div className="text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/logo.png" alt="BirgenAI" className="mx-auto mb-4 h-11 w-auto object-contain"
              onError={(e) => (((e.target as HTMLImageElement).src = "/images/BirgenAI-logo.png"))} />
            <h1 className="text-2xl font-bold">Staff sign in</h1>
            <p className="mt-1.5 text-sm text-zinc-500">Loan officers, ROs, managers & admins.</p>
          </div>

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
            </div>
          )}

          <div className="mt-5 space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-zinc-900/15 bg-white/80 px-3">
              <Mail className="h-4 w-4 text-zinc-400 shrink-0" />
              <input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" placeholder="Work email"
                className="flex-1 bg-transparent outline-none text-sm py-3 placeholder:text-zinc-400" />
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-zinc-900/15 bg-white/80 px-3">
              <Lock className="h-4 w-4 text-zinc-400 shrink-0" />
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Password"
                onKeyDown={(e) => e.key === "Enter" && submit()}
                className="flex-1 bg-transparent outline-none text-sm py-3 placeholder:text-zinc-400" />
            </div>
          </div>

          <button onClick={submit} disabled={loading}
            className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Sign in <ArrowRight className="h-4 w-4" />
          </button>

          <p className="mt-5 text-center text-xs text-zinc-500">
            New lender? <Link href="/onboard" className="font-semibold" style={{ color: "var(--brand)" }}>Create your organization</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
