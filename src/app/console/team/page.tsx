"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useLoad } from "@/lib/hooks/useLoad";
import { Loader2, AlertTriangle, CheckCircle2, Users, Plus, ShieldCheck, SlidersHorizontal } from "lucide-react";
import StaffEditor, { type Staff, type CatalogSystem } from "@/components/console/StaffEditor";


export default function TeamPage() {
  const [staff, setStaff] = useState<Staff[] | null>(null);
  const [roles, setRoles] = useState<{ id: string; title: string; assignable: boolean }[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [catalog, setCatalog] = useState<CatalogSystem[]>([]);
  // Which person's panel is open. One at a time: two open editors invite an
  // administrator to fill in both and lose one.
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", roleId: "", initiator: true, authorizer: false, validator: false });
  // Step-up: inviting into an access-managing role asks the actor for a fresh code.
  const [otpStep, setOtpStep] = useState(false);
  const [otpCode, setOtpCode] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/console/team");
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not load the team."); return; }
      setStaff(data.staff); setRoles(data.roles);
      setBranches(data.branches ?? []); setCatalog(data.catalog ?? []);
    } catch { setError("Could not load the team."); }
  }, []);
  useLoad(load);

  const invite = async () => {
    setSaving(true); setError(null); if (!otpStep) setNotice(null);
    try {
      const res = await fetch("/api/console/team", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name, email: form.email, phone: form.phone, roleId: form.roleId || undefined,
          tiers: { initiator: form.initiator, authorizer: form.authorizer, validator: form.validator },
          ...(otpStep && otpCode ? { otp: otpCode } : {}),
        }),
      });
      const data = await res.json();
      // Privileged role → the server asks the actor for a fresh code first.
      if (data.otpRequired) { setOtpStep(true); setOtpCode(""); setNotice(data.message || "Enter the code we sent you to confirm."); setError(null); return; }
      if (!data.success) { setError(data.message || "Invite failed."); return; }
      setNotice(data.emailed ? "Teammate added — credentials emailed." : "Teammate added — email delivery failed, share credentials manually (reset coming).");
      setShowForm(false); setOtpStep(false); setOtpCode(""); setForm({ name: "", email: "", phone: "", roleId: "", initiator: true, authorizer: false, validator: false });
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

  const toggleField = async (s: Staff) => {
    await fetch("/api/console/team", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: s.id, isFieldAgent: !s.isFieldAgent }),
    });
    await load();
  };

  const field = "flex items-center gap-2 rounded-lg border border-ash-900/15 bg-paper/80 px-3";
  const input = "flex-1 bg-transparent outline-none text-sm py-2.5 placeholder:text-ash-400 min-w-0";
  const Tier = ({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) => (
    <button onClick={onClick} className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${on ? "bg-invert text-invert-fg" : "bg-ash-900/5 text-ash-500"}`}>{label}</button>
  );

  return (
    <main className="mx-auto max-w-4xl px-4 sm:px-6 py-8">
        <div className="mt-3 flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold flex items-center gap-2"><Users className="h-5 w-5" style={{ color: "var(--brand)" }} /> Team</h1>
          <div className="flex items-center gap-2">
            <Link href="/console/roles" className="inline-flex items-center gap-1.5 rounded-lg border border-ash-900/15 bg-paper/70 px-3 py-2 text-xs font-semibold text-ash-700 hover:bg-paper">
              Manage roles →
            </Link>
            <button onClick={() => setShowForm((s) => !s)} className="inline-flex items-center gap-1.5 rounded-lg bg-invert px-4 py-2 text-xs font-semibold text-invert-fg hover:bg-invert-2">
              <Plus className="h-3.5 w-3.5" /> Add teammate
            </button>
          </div>
        </div>
        <p className="mt-1 text-xs text-ash-500">Roles decide which menus and abilities each person gets. Tiers drive approvals: INIT reviews, AUTH seconds, VALID finalizes (with an OTP) and checks disbursements.</p>

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
                  {/* Anti-escalation: a role granting more than you hold is shown but
                      disabled — you can't promote anyone (including yourself) above you. */}
                  {roles.map((r) => <option key={r.id} value={r.id} disabled={!r.assignable}>{r.title}{r.assignable ? "" : " — above your access"}</option>)}
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
            {otpStep && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50/70 px-3 py-2">
                <ShieldCheck className="h-4 w-4 shrink-0 text-amber-600" />
                <input value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoFocus
                  placeholder="6-digit code from your inbox" className="flex-1 bg-transparent text-sm tracking-[0.3em] outline-none placeholder:tracking-normal" />
              </div>
            )}
            <button onClick={invite} disabled={saving || (otpStep && otpCode.length < 6)}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-invert px-5 py-2.5 text-sm font-semibold text-invert-fg hover:bg-invert-2 disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : otpStep ? <ShieldCheck className="h-4 w-4" /> : null} {otpStep ? "Confirm with code" : "Add & email credentials"}
            </button>
          </div>
        )}

        {!staff && !error && <div className="mt-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-ash-400" /></div>}
        <div className="mt-5 space-y-2">
          {staff?.map((s) => (
            <div key={s.id} className={`glass p-4 ${s.status !== "ACTIVE" ? "opacity-60" : ""}`}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{s.firstName} {s.otherName ?? ""} <span className="text-ash-400 font-normal">· {s.email}</span></p>
                <p className="text-xs text-ash-500">{s.role?.title ?? "No role"}{s.branch ? ` · ${s.branch.name}` : ""}{s.lastLoginAt ? ` · last seen ${new Date(s.lastLoginAt).toLocaleDateString("en-KE")}` : " · never signed in"}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Tier on={s.isInitiator} label="INIT" onClick={() => toggleTier(s, "initiator")} />
                <Tier on={s.isAuthorizer} label="AUTH" onClick={() => toggleTier(s, "authorizer")} />
                <Tier on={s.isValidator} label="VALID" onClick={() => toggleTier(s, "validator")} />
                <Tier on={s.isFieldAgent} label="FIELD" onClick={() => toggleField(s)} />
                <button onClick={() => toggleStatus(s)}
                  className={`ml-1 rounded-md px-2 py-1 text-[11px] font-semibold ${s.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                  {s.status}
                </button>
                <button onClick={() => setEditing(editing === s.id ? null : s.id)}
                  className={`ml-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${editing === s.id ? "bg-invert text-invert-fg" : "bg-ash-900/[0.06] text-ash-600 hover:bg-ash-900/[0.1]"}`}>
                  <SlidersHorizontal className="h-3 w-3" /> Manage
                </button>
              </div>
            </div>
            {editing === s.id && (
              <StaffEditor
                staff={s}
                catalog={catalog}
                roles={roles}
                branches={branches}
                onClose={() => setEditing(null)}
                onSaved={async () => { setNotice(`Saved ${s.firstName}.`); setEditing(null); await load(); }}
              />
            )}
            </div>
          ))}
        </div>
      </main>
  );
}
