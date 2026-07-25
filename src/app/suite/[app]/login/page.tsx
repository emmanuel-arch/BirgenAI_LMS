// ─────────────────────────────────────────────────────────────────────────────
// A satellite system's OWN login page — the demo's money shot. Each product keeps
// its own front door; but if a BirgenAI ID session already exists, there is no
// password to type — one click and you're in. This is "different login pages,
// authenticated once" made literal.
// ─────────────────────────────────────────────────────────────────────────────
import { redirect } from "next/navigation";
import Link from "next/link";
import { KeyRound, ArrowRight, ShieldCheck, Lock } from "lucide-react";
import { auth } from "@/lib/auth";
import { suiteApp } from "@/lib/suite/apps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SatelliteLogin({ params }: { params: Promise<{ app: string }> }) {
  const { app: appId } = await params;
  const app = suiteApp(appId);
  if (!app || app.system) redirect("/suite");
  const session = await auth();
  const who = session?.user?.name ?? session?.user?.email ?? null;

  return (
    <main className="grid min-h-screen place-items-center px-5" style={{ background: `radial-gradient(1200px 600px at 50% -10%, ${app.accent}22, #0f0e0c 60%)` }}>
      <div className="w-full max-w-sm">
        {/* The satellite's own brand */}
        <div className="flex flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl ring-1 ring-white/15" style={{ backgroundColor: `${app.accent}2e`, color: app.accent }}>
            <app.icon className="h-7 w-7" />
          </span>
          <h1 className="mt-3 text-xl font-bold text-white">{app.name}</h1>
          <p className="mt-1 text-[13px] text-white/50">{app.tagline}</p>
        </div>

        <div className="mt-6 rounded-2xl bg-white/[0.05] p-5 ring-1 ring-white/10 backdrop-blur">
          {who ? (
            // SSO recognised — no password needed.
            <>
              <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2.5 ring-1 ring-emerald-500/25">
                <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />
                <p className="text-[13px] text-white/85">Signed in as <strong className="text-white">{who}</strong> via BirgenAI ID.</p>
              </div>
              <Link href={`/suite/${app.id}`}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white"
                style={{ backgroundColor: app.accent }}>
                Continue to {app.name} <ArrowRight className="h-4 w-4" />
              </Link>
              <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-[11px] text-white/40">
                <KeyRound className="h-3 w-3" /> No password — single sign-on across the suite.
              </p>
              <Link href="/api/auth/logout" className="mt-3 block text-center text-[11px] text-white/40 hover:text-white/70">Not you? Sign out</Link>
            </>
          ) : (
            // Logged out — this product's own front door, with SSO as the path in.
            <>
              <Link href={`/login?callbackUrl=/suite/${app.id}`}
                className="flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white"
                style={{ backgroundColor: app.accent }}>
                <KeyRound className="h-4 w-4" /> Sign in with BirgenAI ID
              </Link>
              <div className="my-4 flex items-center gap-3 text-[11px] text-white/30">
                <span className="h-px flex-1 bg-white/10" /> or use a {app.short} account <span className="h-px flex-1 bg-white/10" />
              </div>
              <div className="space-y-2 opacity-60">
                <div className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2.5 ring-1 ring-white/10">
                  <Lock className="h-3.5 w-3.5 text-white/40" />
                  <input disabled placeholder="work email" className="w-full bg-transparent text-sm text-white/70 outline-none placeholder:text-white/30" />
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2.5 ring-1 ring-white/10">
                  <Lock className="h-3.5 w-3.5 text-white/40" />
                  <input disabled type="password" placeholder="password" className="w-full bg-transparent text-sm text-white/70 outline-none placeholder:text-white/30" />
                </div>
              </div>
              <p className="mt-3 text-center text-[11px] text-white/40">One identity across Lending, HR, Accounting &amp; Call-Center.</p>
            </>
          )}
        </div>

        <Link href="/suite" className="mt-4 block text-center text-[11px] text-white/40 hover:text-white/70">← Back to the suite</Link>
      </div>
    </main>
  );
}
