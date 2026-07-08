"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, AlertTriangle, CheckCircle2, Users, Plus } from "lucide-react";

type Staff = {
  id: string; email: string; phone: string | null; firstName: string; otherName: string | null; status: string;
  isInitiator: boolean; isAuthorizer: boolean; isValidator: boolean; lastLoginAt: string | null;
  role: { id: string; title: string } | null; branch: { id: string; name: string } | null;
};

export default function TeamPage() {
  const [staff, setStaff] = useState<Staff[] | null>(null);
  const [roles, setRoles] = useState<{ id: string; title: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", roleId: "", initiator: true, authorizer: false, validator: false });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/console/team");
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not load the team."); return; }
      setStaff(data.staff); setRoles(data.roles);
    } catch { setError("Could not load the team."); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const invite = async () => {
    setSaving(true); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/console/team", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name, email: form.email, phone: form.phone, roleId: form.roleId || undefined,
          tiers: { initiator: form.initiator, authorizer: form.authorizer, validator: form.validator },
        }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Invite failed."); return; }
      setNotice(data.emailed ? "Teammate added — credentials emailed." : "Teammate added — email delivery failed, share credentials manually (reset coming).");
      setShowForm(false); setForm({ name: "", email: "", phone: "", roleId: "", initiator: true, authorizer: false, validator: false });
      await load();
    } catch { setError("Invite failed."); } finally { setSaving(false); }
  };

  const toggleTier = async (s: Staff, tier: "initiator" | "authorizer" | "validator") => {
    await fetch("/api/console/team", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: s.id, tiers: { initiator: s.isInitiator, authorizer: s.isAuthorizer, validator: s.isValidator, [tier]: !s[tier === "initiator" ? "isInitiator" : tier === "authorizer" ? "isAuthorizer" : "isValidator"] } }),
    });
    await load();
  };

  const toggleStatus = async (s: Staff) => {
    await fetch("/api/console/team", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: s.id, status: s.status === "ACTIVE" ? "DISABLED" : "ACTIVE" }),
    });
    await load();
  };

  const field = "flex items-center gap-2 rounded-lg border border-zinc-900/15 bg-white/80 px-3";
  const input = "flex-1 bg-transparent outline-none text-sm py-2.5 placeholder:text-zinc-400 min-w-0";
  const Tier = ({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) => (
    <button onClick={onClick} className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${on ? "bg-zinc-900 text-white" : "bg-zinc-900/5 text-zinc-500"}`}>{label}</button>
  );

  return (
    <div className="min-h-screen relative text-zinc-900">
      <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />
      <main className="relative z-10 mx-auto max-w-4xl px-4 sm:px-6 py-8">
        <Link href="/console" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800"><ArrowLeft className="h-4 w-4" /> Console</Link>
        <div className="mt-3 flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold flex items-center gap-2"><Users className="h-5 w-5" style={{ color: "var(--brand)" }} /> Team & roles</h1>
          <button onClick={() => setShowForm((s) => !s)} className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800">
            <Plus className="h-3.5 w-3.5" /> Add teammate
          </button>
        </div>
        <p className="mt-1 text-xs text-zinc-500">Tiers drive approvals: INIT reviews, AUTH seconds, VALID finalizes (with an OTP) and checks disbursements.</p>

        {notice && <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50/90 px-3 py-2.5 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> {notice}</div>}
        {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}</div>}

        {showForm && (
          <div className="glass mt-5 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className={field}><input className={input} placeholder="Full name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
              <div className={field}><input className={input} inputMode="email" placeholder="Work email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></div>
              <div className={field}><input className={input} inputMode="tel" placeholder="Phone (07XX…)" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></div>
              <div className={field}>
                <select className={`${input} appearance-none`} value={form.roleId} onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}>
                  <option value="">Role…</option>
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
                </select>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-4 text-xs">
              {(["initiator", "authorizer", "validator"] as const).map((t) => (
                <label key={t} className="flex items-center gap-1.5">
                  <input type="checkbox" checked={form[t]} onChange={(e) => setForm((f) => ({ ...f, [t]: e.target.checked }))} /> {t}
                </label>
              ))}
            </div>
            <button onClick={invite} disabled={saving}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Add & email credentials
            </button>
          </div>
        )}

        {!staff && !error && <div className="mt-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>}
        <div className="mt-5 space-y-2">
          {staff?.map((s) => (
            <div key={s.id} className={`glass p-4 flex items-center justify-between gap-3 flex-wrap ${s.status !== "ACTIVE" ? "opacity-60" : ""}`}>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{s.firstName} {s.otherName ?? ""} <span className="text-zinc-400 font-normal">· {s.email}</span></p>
                <p className="text-xs text-zinc-500">{s.role?.title ?? "No role"}{s.branch ? ` · ${s.branch.name}` : ""}{s.lastLoginAt ? ` · last seen ${new Date(s.lastLoginAt).toLocaleDateString("en-KE")}` : " · never signed in"}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Tier on={s.isInitiator} label="INIT" onClick={() => toggleTier(s, "initiator")} />
                <Tier on={s.isAuthorizer} label="AUTH" onClick={() => toggleTier(s, "authorizer")} />
                <Tier on={s.isValidator} label="VALID" onClick={() => toggleTier(s, "validator")} />
                <button onClick={() => toggleStatus(s)}
                  className={`ml-1 rounded-md px-2 py-1 text-[11px] font-semibold ${s.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                  {s.status}
                </button>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
