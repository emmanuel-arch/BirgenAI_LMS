"use client";

import { useState } from "react";
import { Loader2, AlertTriangle, ShieldCheck, Building2, CheckCircle2 } from "lucide-react";

// BirgenAI platform board — org activation. Gated by PLATFORM_ADMIN_SECRET
// (entered here, held in memory only, sent as a bearer on each call).
type OrgRow = {
  id: string; slug: string; name: string; mode: string; status: string; plan: string; createdAt: string;
  _count: { staff: number; borrowers: number; loans: number; applications: number };
};

const TONE: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-700",
  PENDING: "bg-amber-100 text-amber-700",
  SUSPENDED: "bg-red-100 text-red-700",
};

export default function PlatformBoard() {
  const [secret, setSecret] = useState("");
  const [orgs, setOrgs] = useState<OrgRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const load = async (s = secret) => {
    setError(null);
    try {
      const res = await fetch("/api/platform/orgs", { headers: { Authorization: `Bearer ${s}` } });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Unauthorized."); setOrgs(null); return; }
      setOrgs(data.orgs);
    } catch { setError("Could not load."); }
  };

  const act = async (orgId: string, action: "activate" | "suspend" | "pend") => {
    setActing(orgId + action); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/platform/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
        body: JSON.stringify({ orgId, action }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Action failed."); return; }
      setNotice(`${data.slug} → ${data.status}`);
      await load();
    } catch { setError("Action failed."); } finally { setActing(null); }
  };

  return (
    <div className="min-h-screen relative text-zinc-900">
      <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />
      <main className="relative z-10 mx-auto max-w-4xl px-4 sm:px-6 py-10">
        <h1 className="text-xl font-bold flex items-center gap-2"><ShieldCheck className="h-5 w-5" style={{ color: "var(--brand)" }} /> BirgenAI Platform — Organizations</h1>

        {!orgs && (
          <div className="glass mt-5 p-5 max-w-md">
            <p className="text-sm text-zinc-600">Enter the platform admin secret.</p>
            <div className="mt-3 flex gap-2">
              <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && load()}
                className="flex-1 rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2.5 text-sm outline-none" placeholder="PLATFORM_ADMIN_SECRET" />
              <button onClick={() => load()} className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800">Open</button>
            </div>
          </div>
        )}

        {notice && <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50/90 px-3 py-2.5 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> {notice}</div>}
        {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}</div>}

        {orgs && (
          <div className="mt-5 space-y-3">
            {orgs.map((o) => (
              <div key={o.id} className="glass p-4 flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex items-center gap-3">
                  <Building2 className="h-5 w-5 text-zinc-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{o.name} <span className="text-zinc-400 font-normal">· {o.slug}.birgenai.com</span></p>
                    <p className="text-xs text-zinc-500">{o.mode} · {o.plan} · {o._count.staff} staff · {o._count.borrowers} borrowers · {o._count.loans} loans · {o._count.applications} apps</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`rounded-md px-2 py-1 text-[11px] font-semibold ${TONE[o.status] ?? TONE.PENDING}`}>{o.status}</span>
                  {o.status !== "ACTIVE" && (
                    <button disabled={!!acting} onClick={() => act(o.id, "activate")}
                      className="rounded-lg bg-zinc-900 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
                      {acting === o.id + "activate" ? <Loader2 className="inline h-3 w-3 animate-spin" /> : "Activate"}
                    </button>
                  )}
                  {o.status === "ACTIVE" && (
                    <button disabled={!!acting} onClick={() => act(o.id, "suspend")}
                      className="rounded-lg border border-red-200 bg-white/70 px-3 py-1.5 text-[11px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60">
                      Suspend
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
