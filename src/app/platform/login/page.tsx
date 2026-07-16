"use client";

// /platform/login — the founder's own door. Separate identity, separate cookie,
// separate audience from every staff session.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck, AlertTriangle, ArrowRight } from "lucide-react";

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

  return (
    <div className="min-h-screen relative text-zinc-900">
      <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />
      <div className="relative z-10 min-h-screen flex items-center justify-center px-4">
        <form onSubmit={submit} className="glass w-full max-w-sm rounded-3xl bg-white/65 p-6 sm:p-8">
          <div className="text-center">
            <ShieldCheck className="mx-auto h-10 w-10 text-zinc-900" />
            <h1 className="mt-3 text-xl font-bold">BirgenAI Platform</h1>
            <p className="mt-1 text-sm text-zinc-500">Infrastructure control. Every action here is audited.</p>
          </div>

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
            </div>
          )}

          <div className="mt-5 space-y-3">
            <input
              className="w-full rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-3 text-sm outline-none placeholder:text-zinc-400"
              inputMode="email" autoComplete="username" placeholder="Email"
              value={email} onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className="w-full rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-3 text-sm outline-none placeholder:text-zinc-400"
              type="password" autoComplete="current-password" placeholder="Password"
              value={password} onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button type="submit" disabled={loading || !email || !password}
            className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Sign in <ArrowRight className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
