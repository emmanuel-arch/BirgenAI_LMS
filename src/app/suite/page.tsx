// ─────────────────────────────────────────────────────────────────────────────
// BirgenAI ID — the connected-suite launcher. One identity across Lending, HR,
// Accounting and the Call-Center. Signed in once; every system knows you.
// ─────────────────────────────────────────────────────────────────────────────
import { redirect } from "next/navigation";
import Link from "next/link";
import { KeyRound, ArrowRight, ShieldCheck, Check } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SUITE_APPS } from "@/lib/suite/apps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SuiteLauncher() {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login?callbackUrl=/suite");
  const org = await prisma.org.findUnique({ where: { id: session.user.orgId }, select: { name: true } });
  const who = session.user.name ?? session.user.email ?? "Signed in";

  return (
    <main className="min-h-screen bg-[#0f0e0c] text-white">
      <div className="mx-auto max-w-5xl px-5 py-10 sm:py-14">
        {/* Identity header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15">
              <KeyRound className="h-5 w-5 text-[#c8a24b]" />
            </span>
            <div>
              <p className="text-lg font-bold tracking-tight">BirgenAI ID</p>
              <p className="text-xs text-white/50">Single sign-on across your systems</p>
            </div>
          </div>
          <div className="rounded-xl bg-white/5 px-3.5 py-2 ring-1 ring-white/10">
            <p className="flex items-center gap-1.5 text-xs font-semibold"><ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> {who}</p>
            <p className="text-[11px] text-white/45">{org?.name ?? "Your organisation"} · authenticated once</p>
          </div>
        </div>

        {/* Hero */}
        <div className="mt-10 max-w-2xl">
          <h1 className="text-3xl font-bold leading-tight sm:text-4xl">One login. Every system.</h1>
          <p className="mt-3 text-white/60">
            Your lending platform, HR, accounting and call-centre each keep their own front door —
            but your BirgenAI ID carries across all of them. No second password, no divergent user lists.
            Click any system below and you are already in.
          </p>
        </div>

        {/* App grid */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {SUITE_APPS.map((app) => (
            <Link key={app.id} href={app.href}
              className="group relative overflow-hidden rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/10 transition-all hover:bg-white/[0.07] hover:ring-white/20">
              <span aria-hidden className="absolute -right-8 -top-8 h-28 w-28 rounded-full opacity-20 blur-2xl transition-opacity group-hover:opacity-40" style={{ backgroundColor: app.accent }} />
              <div className="relative flex items-start justify-between gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ backgroundColor: `${app.accent}26`, color: app.accent }}>
                  <app.icon className="h-5 w-5" />
                </span>
                {app.system
                  ? <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white/70">CORE</span>
                  : <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300"><Check className="h-3 w-3" /> SIGNED IN</span>}
              </div>
              <p className="relative mt-3 text-base font-bold">{app.name}</p>
              <p className="relative mt-0.5 text-[13px] leading-snug text-white/55">{app.tagline}</p>
              <div className="relative mt-3 flex flex-wrap gap-1.5">
                {app.modules.map((m) => (
                  <span key={m} className="rounded-md bg-white/5 px-2 py-0.5 text-[10px] text-white/60 ring-1 ring-white/10">{m}</span>
                ))}
              </div>
              <p className="relative mt-4 inline-flex items-center gap-1.5 text-sm font-semibold" style={{ color: app.accent }}>
                {app.system ? "Open" : "Enter — no password"} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </p>
            </Link>
          ))}
        </div>

        <p className="mt-8 flex items-center gap-2 text-[11px] text-white/35">
          <KeyRound className="h-3.5 w-3.5" /> Federated single sign-on. Each system keeps its own login page — your BirgenAI ID is honoured across all of them.
        </p>
      </div>
    </main>
  );
}
