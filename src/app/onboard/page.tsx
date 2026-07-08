"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Building2, ArrowRight, AlertTriangle, CheckCircle2 } from "lucide-react";

// Self-onboarding for a new lending organization (ServiceSuite NewEntity,
// reimagined as self-service). Creates the org PENDING + its admin account.
const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);

export default function OnboardOrg() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [slug, setSlug] = useState("");
  const [accent, setAccent] = useState("#F97316");
  const [blurb, setBlurb] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPhone, setAdminPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ slug: string } | null>(null);

  const effectiveSlug = useMemo(() => (slugTouched ? slug : slugify(name)), [slugTouched, slug, name]);

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/orgs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug: effectiveSlug, accent, blurb, adminName, adminEmail, adminPhone, password }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not create the organization."); return; }
      setCreated({ slug: data.slug });
    } catch { setError("Could not create the organization."); } finally { setLoading(false); }
  };

  const field = "flex items-center gap-2 rounded-lg border border-zinc-900/15 bg-white/80 px-3";
  const input = "flex-1 bg-transparent outline-none text-sm py-3 placeholder:text-zinc-400";

  return (
    <div className="min-h-screen relative text-zinc-900">
      <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />
      <div className="relative z-10 min-h-screen flex items-center justify-center px-4 py-8">
        <div className="glass w-full max-w-lg rounded-3xl bg-white/65 p-6 sm:p-8">
          {created ? (
            <div className="text-center py-6">
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
              <h1 className="mt-4 text-2xl font-bold">Organization created</h1>
              <p className="mt-2 text-sm text-zinc-600">
                <span className="font-semibold">{created.slug}.birgenai.com</span> is reserved. Sign in to
                configure branding, products and integrations — BirgenAI will review and activate live lending.
              </p>
              <Link href="/login" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800">
                Go to sign in <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ) : (
            <>
              <div className="text-center">
                <Building2 className="mx-auto h-10 w-10" style={{ color: "var(--brand)" }} />
                <h1 className="mt-3 text-2xl font-bold">Create your lending organization</h1>
                <p className="mt-1.5 text-sm text-zinc-500">Your own branded portal, products, workflows and team — powered by BirgenAI.</p>
              </div>

              {error && (
                <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
                </div>
              )}

              <div className="mt-5 space-y-3">
                <div className={field}><input className={input} placeholder="Organization name (e.g. Umoja Capital)" value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div className={field}>
                  <input className={input} placeholder="subdomain" value={effectiveSlug}
                    onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)); }} />
                  <span className="text-xs text-zinc-400 shrink-0">.birgenai.com</span>
                </div>
                <div className={field}><input className={input} placeholder="One-line description (shown to borrowers)" value={blurb} onChange={(e) => setBlurb(e.target.value)} /></div>
                <div className="flex items-center gap-3 rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2">
                  <span className="text-sm text-zinc-500">Brand color</span>
                  <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} className="h-8 w-12 cursor-pointer rounded border-0 bg-transparent" />
                  <span className="text-xs font-mono text-zinc-400">{accent}</span>
                </div>
                <div className={field}><input className={input} placeholder="Admin full name" value={adminName} onChange={(e) => setAdminName(e.target.value)} /></div>
                <div className={field}><input className={input} inputMode="email" placeholder="Admin email (sign-in)" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} /></div>
                <div className={field}><input className={input} inputMode="tel" placeholder="Admin phone (07XX XXX XXX)" value={adminPhone} onChange={(e) => setAdminPhone(e.target.value)} /></div>
                <div className={field}><input className={input} type="password" placeholder="Password (10+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
              </div>

              <button onClick={submit} disabled={loading}
                className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Create organization <ArrowRight className="h-4 w-4" />
              </button>

              <p className="mt-4 text-center text-xs text-zinc-400">
                Already onboarded? <Link href="/login" className="font-semibold" style={{ color: "var(--brand)" }}>Sign in</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
