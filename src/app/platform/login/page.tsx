"use client";

// /platform/login — the apex door for lms.birgenai.com. Two audiences meet here:
//   • the platform operator signs in (separate identity, separate cookie) and is
//     taken to /platform to pick a console;
//   • a prospective lender (Mular, and others) clicks "Create your organization"
//     and self-onboards at /onboard.
// De-branded to "LMS Platform" so a prospect running a demo never sees a vendor
// name they don't recognise — the product is the platform, not us.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, AlertTriangle, ArrowRight, Mail, Lock, Building2, ShieldCheck } from "lucide-react";

export default function PlatformLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setLoading(true);
    try {
      const res = await fetch("/api/platform/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      // A cold backend can answer with an HTML error page, not JSON — guard the parse
      // so a reachability blip never masquerades as a wrong password.
      const data = await res.json().catch(() => null);
      if (res.status === 503 || data?.wakingUp) {
        setError(data?.message || "The service is waking up — please try again in a moment."); return;
      }
      if (!data) { setError("Couldn't reach the sign-in service. Please try again in a moment."); return; }
      if (!data.success) { setError(data.message || "Sign-in failed."); return; }
      router.replace("/platform");
    } catch { setError("Couldn't reach the sign-in service. Please try again in a moment."); } finally { setLoading(false); }
  };

  const wrap = "flex items-center gap-2 rounded-lg border border-zinc-900/15 bg-white/80 px-3";
  const input = "flex-1 bg-transparent outline-none text-sm py-3 placeholder:text-zinc-400";

  return (
    <div className="min-h-screen relative text-zinc-900">
      <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />
      {/* Soft brand aurora so the apex feels considered, not a bare form */}
      <div aria-hidden className="pointer-events-none fixed -top-32 left-1/2 z-0 h-[38rem] w-[38rem] -translate-x-1/2 rounded-full opacity-30 blur-3xl"
        style={{ background: "radial-gradient(closest-side, #fb923c, #f43f5e 55%, transparent)" }} />

      <div className="relative z-10 min-h-screen flex items-center justify-center px-4 py-10">
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="glass w-full max-w-md overflow-hidden rounded-3xl bg-white/70"
        >
          <div aria-hidden className="h-1.5 w-full" style={{ background: "linear-gradient(90deg,#fb923c,#f43f5e)" }} />
          <form onSubmit={submit} className="p-6 sm:p-8">
            <div className="text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/logo.png" alt="LMS Platform" className="mx-auto mb-3 h-11 w-auto object-contain" />
              <h1 className="text-2xl font-bold tracking-tight">LMS Platform</h1>
              <p className="mt-1.5 text-sm text-zinc-500">The lending operating system. Sign in to your platform.</p>
            </div>

            {error && (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
              </div>
            )}

            <div className="mt-5 space-y-3">
              <div className={wrap}><Mail className="h-4 w-4 text-zinc-400 shrink-0" />
                <input className={input} inputMode="email" autoComplete="username" placeholder="Email"
                  value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className={wrap}><Lock className="h-4 w-4 text-zinc-400 shrink-0" />
                <input className={input} type="password" autoComplete="current-password" placeholder="Password"
                  value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            </div>

            <button type="submit" disabled={loading || !email || !password}
              className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Sign in <ArrowRight className="h-4 w-4" />
            </button>

            {/* The prospect's path — a lender like Mular creates their org here */}
            <div className="mt-6 rounded-2xl border border-zinc-900/10 bg-white/60 p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-900/5">
                  <Building2 className="h-4 w-4 text-zinc-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">New lender?</p>
                  <p className="mt-0.5 text-xs text-zinc-500">Stand up your own branded lending platform in minutes.</p>
                  <Link href="/onboard" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-zinc-900 hover:gap-1.5 transition-all">
                    Create your organization <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </div>

            <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-[11px] text-zinc-400">
              <ShieldCheck className="h-3 w-3" /> Infrastructure control · every action is audited
            </p>
          </form>
        </motion.div>
      </div>
    </div>
  );
}
