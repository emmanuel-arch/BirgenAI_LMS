// ─────────────────────────────────────────────────────────────────────────────
// A satellite system (HR / Accounting / Call-Center) — its own look, its own
// modules, but entered with the same BirgenAI ID. The chrome makes the SSO point
// explicit: "Signed in via BirgenAI ID" sits in the top bar of a DIFFERENT product.
// The figures are a demo set; the identity is real (the live session).
// ─────────────────────────────────────────────────────────────────────────────
import { redirect } from "next/navigation";
import Link from "next/link";
import { KeyRound, Grip, ShieldCheck } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { suiteApp } from "@/lib/suite/apps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SatelliteApp({ params }: { params: Promise<{ app: string }> }) {
  const { app: appId } = await params;
  const app = suiteApp(appId);
  if (!app || app.system) redirect("/suite");

  const session = await auth();
  if (!session?.user?.orgId) redirect(`/suite/${appId}/login`);
  const org = await prisma.org.findUnique({ where: { id: session.user.orgId }, select: { name: true } });
  const who = session.user.name ?? session.user.email ?? "Signed in";
  const demo = app.demo!;

  return (
    <main className="min-h-screen bg-zinc-50">
      {/* Satellite top bar — its own brand, the shared identity on the right */}
      <header className="sticky top-0 z-10 border-b border-zinc-900/10 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: `${app.accent}1f`, color: app.accent }}>
              <app.icon className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-bold leading-tight">{app.name}</p>
              <p className="text-[10px] text-zinc-400">a connected system · demo</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200 sm:inline-flex">
              <ShieldCheck className="h-3.5 w-3.5" /> {who} · via BirgenAI ID
            </span>
            <Link href="/suite" className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-zinc-800">
              <Grip className="h-3.5 w-3.5" /> Switch app
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-5 py-8">
        {/* SSO banner — the whole point, stated */}
        <div className="flex items-start gap-2.5 rounded-xl border px-4 py-3" style={{ borderColor: `${app.accent}40`, backgroundColor: `${app.accent}0d` }}>
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0" style={{ color: app.accent }} />
          <p className="text-[13px] text-zinc-700">
            You reached <strong>{app.name}</strong> without signing in again. Your <strong>BirgenAI ID</strong> from the
            lending console authenticated you here — one identity, {org?.name ?? "your organisation"} across every system.
          </p>
        </div>

        <h1 className="mt-6 text-xl font-bold tracking-tight" style={{ color: app.accent }}>{app.short} overview</h1>
        <p className="text-sm text-zinc-500">{app.tagline}</p>

        {/* KPI tiles */}
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {demo.kpis.map((k) => (
            <div key={k.label} className="rounded-2xl border border-zinc-900/10 bg-white p-4">
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">{k.label}</p>
              <p className="mt-1 text-lg font-bold" style={{ color: app.accent }}>{k.value}</p>
            </div>
          ))}
        </div>

        {/* Modules */}
        <div className="mt-4 flex flex-wrap gap-2">
          {app.modules.map((m, i) => (
            <span key={m} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${i === 0 ? "text-white" : "bg-white text-zinc-600 ring-1 ring-zinc-900/10"}`}
              style={i === 0 ? { backgroundColor: app.accent } : undefined}>{m}</span>
          ))}
        </div>

        {/* A representative screen */}
        <div className="mt-4 rounded-2xl border border-zinc-900/10 bg-white p-5">
          <h2 className="text-sm font-semibold">{demo.table.title}</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-400">
                  {demo.table.cols.map((c, i) => <th key={c} className={`pb-2 font-semibold ${i > 0 ? "text-right" : ""}`}>{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {demo.table.rows.map((r, ri) => (
                  <tr key={ri} className="border-t border-zinc-900/5">
                    {r.map((cell, ci) => <td key={ci} className={`py-2.5 ${ci > 0 ? "text-right tabular-nums text-zinc-600" : "font-medium text-zinc-800"}`}>{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="mt-6 text-[11px] text-zinc-400">
          This is a connected-system demo. In production {app.name} is its own deployment; BirgenAI ID federates the login so staff move between it and the lending console without a second sign-in.
        </p>
      </div>
    </main>
  );
}
