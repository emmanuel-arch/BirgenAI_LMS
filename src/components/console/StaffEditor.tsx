"use client";

// ─────────────────────────────────────────────────────────────────────────────
// ONE PERSON, EVERYTHING ABOUT THEM.
//
// The team page used to offer five toggles — INIT, AUTH, VALID, FIELD, ACTIVE —
// and nothing else. Everything an administrator actually gets asked to change
// ("she's changed her number", "that's the wrong email, the codes are bouncing")
// required a developer. So this panel carries the record AND the access, because
// they are the same conversation: you open a person to fix something about them.
//
// ── THE ACCESS GRID READS AS PERMISSION, NOT AS CONFIGURATION ────────────────
// A ticked box means CAN SEE. That is the direction people expect, and it is the
// opposite of what is stored — the column holds a DENY list, so an untick is
// what gets written. Storing it that way is what makes a new module appear for
// everybody automatically instead of being invisible until somebody grants it
// twenty times; showing it that way is what makes the screen legible. The
// translation happens here, once, at the boundary.
//
// Systems can be turned off whole. When they are, the modules underneath grey
// out rather than vanishing — an administrator narrowing someone's access wants
// to see what they are taking away.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import { Loader2, Save, X, ShieldCheck, UserCog, LayoutGrid } from "lucide-react";

export type CatalogSystem = {
  id: string;
  name: string;
  accent: string;
  blurb: string;
  modules: { key: string; label: string; icon: string; items: { key: string; label: string }[] }[];
};

export type Staff = {
  id: string; email: string; phone: string | null; firstName: string; otherName: string | null; status: string;
  isInitiator: boolean; isAuthorizer: boolean; isValidator: boolean; isFieldAgent: boolean;
  title: string | null; dob: string | null; lat: number | null; lng: number | null; lastLoginAt: string | null;
  access?: { deny?: string[]; grant?: string[] } | null;
  role: { id: string; title: string } | null; branch: { id: string; name: string } | null;
};

type Props = {
  staff: Staff;
  catalog: CatalogSystem[];
  roles: { id: string; title: string; assignable: boolean }[];
  branches: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
};

const asDateInput = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");

export default function StaffEditor({ staff, catalog, roles, branches, onClose, onSaved }: Props) {
  const [tab, setTab] = useState<"details" | "access">("details");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [d, setD] = useState({
    firstName: staff.firstName ?? "",
    otherName: staff.otherName ?? "",
    email: staff.email ?? "",
    phone: staff.phone ?? "",
    dob: asDateInput(staff.dob),
    title: staff.title ?? "",
    roleId: staff.role?.id ?? "",
    branchId: staff.branch?.id ?? "",
  });

  // Stored as deny; edited as "can see". Everything not denied starts ticked.
  const [deny, setDeny] = useState<Set<string>>(() => new Set(staff.access?.deny ?? []));

  const systemOn = (sysId: string) => !deny.has(sysId);
  const moduleOn = (sysId: string, modKey: string) => !deny.has(sysId) && !deny.has(`${sysId}:${modKey}`);

  const setSystem = (sysId: string, on: boolean) => {
    setDeny((prev) => {
      const next = new Set(prev);
      if (on) {
        // Turning a system back on clears the system flag AND every module flag
        // under it — otherwise the door reopens onto a menu that is still empty,
        // which reads as a bug rather than as a setting.
        next.delete(sysId);
        for (const k of [...next]) if (k.startsWith(`${sysId}:`)) next.delete(k);
      } else {
        next.add(sysId);
      }
      return next;
    });
  };

  const setModule = (sysId: string, modKey: string, on: boolean) => {
    setDeny((prev) => {
      const next = new Set(prev);
      const key = `${sysId}:${modKey}`;
      if (on) {
        next.delete(key);
        next.delete(sysId); // ticking any module implies the system is on
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const setAllModules = (sys: CatalogSystem, on: boolean) => {
    setDeny((prev) => {
      const next = new Set(prev);
      for (const m of sys.modules) {
        const key = `${sys.id}:${m.key}`;
        if (on) next.delete(key);
        else next.add(key);
      }
      if (on) next.delete(sys.id);
      return next;
    });
  };

  const counts = useMemo(() => {
    const total = catalog.reduce((n, s) => n + s.modules.length, 0);
    const on = catalog.reduce((n, s) => n + s.modules.filter((m) => moduleOn(s.id, m.key)).length, 0);
    return { on, total, systems: catalog.filter((s) => systemOn(s.id)).length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, deny]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/console/team", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: staff.id,
          firstName: d.firstName.trim(),
          otherName: d.otherName.trim() || null,
          email: d.email.trim(),
          phone: d.phone.trim() || null,
          dob: d.dob || null,
          title: d.title.trim(),
          roleId: d.roleId || null,
          branchId: d.branchId || null,
          access: { deny: [...deny] },
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.message || "Could not save.");
        return;
      }
      onSaved();
    } catch {
      setError("Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const field = "flex items-center gap-2 rounded-lg border border-ash-900/15 bg-paper/80 px-3";
  const input = "flex-1 bg-transparent outline-none text-sm py-2.5 placeholder:text-ash-400 min-w-0";
  const label = "text-[10px] font-bold uppercase tracking-[0.12em] text-ash-400 mb-1 block";

  return (
    <div className="mt-2 rounded-xl border border-ash-900/10 bg-paper/70 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {(
            [
              ["details", "Details", UserCog],
              ["access", "Systems & modules", LayoutGrid],
            ] as const
          ).map(([k, text, Icon]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                tab === k ? "bg-invert text-invert-fg" : "text-ash-500 hover:bg-ash-900/[0.05]"
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {text}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-ash-400 hover:bg-ash-900/[0.05] hover:text-ash-700" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2 text-[12.5px] text-red-700">{error}</div>
      )}

      {tab === "details" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <span className={label}>First name</span>
            <div className={field}><input className={input} value={d.firstName} onChange={(e) => setD({ ...d, firstName: e.target.value })} /></div>
          </div>
          <div>
            <span className={label}>Other names</span>
            <div className={field}><input className={input} value={d.otherName} onChange={(e) => setD({ ...d, otherName: e.target.value })} /></div>
          </div>
          <div>
            <span className={label}>Work email</span>
            <div className={field}><input className={input} inputMode="email" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} /></div>
            <p className="mt-1 text-[10.5px] text-ash-400">This is their sign-in and where the daily code is sent.</p>
          </div>
          <div>
            <span className={label}>Phone</span>
            <div className={field}><input className={input} inputMode="tel" placeholder="2547…" value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} /></div>
          </div>
          <div>
            <span className={label}>Date of birth</span>
            <div className={field}><input className={input} type="date" value={d.dob} onChange={(e) => setD({ ...d, dob: e.target.value })} /></div>
          </div>
          <div>
            <span className={label}>Job title</span>
            <div className={field}><input className={input} placeholder="Relationship Officer" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} /></div>
          </div>
          <div>
            <span className={label}>Role</span>
            <div className={field}>
              <select className={`${input} appearance-none`} value={d.roleId} onChange={(e) => setD({ ...d, roleId: e.target.value })}>
                <option value="">No role</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id} disabled={!r.assignable}>
                    {r.title}{r.assignable ? "" : " — above your access"}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <span className={label}>Branch</span>
            <div className={field}>
              <select className={`${input} appearance-none`} value={d.branchId} onChange={(e) => setD({ ...d, branchId: e.target.value })}>
                <option value="">Unassigned</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[11.5px] leading-relaxed text-ash-500">
            A ticked box is something this person <strong className="font-semibold text-ash-700">can see</strong>. Their role still
            decides what they may <em>do</em> — this decides which doors and menus are on their screen at all, so two people with the
            same role can work different halves of a system.
            <span className="ml-1 text-ash-400">
              {counts.systems} of {catalog.length} systems · {counts.on} of {counts.total} modules.
            </span>
          </p>

          {catalog.map((sys) => {
            const on = systemOn(sys.id);
            const allOn = sys.modules.length > 0 && sys.modules.every((m) => moduleOn(sys.id, m.key));
            const noneOn = sys.modules.every((m) => !moduleOn(sys.id, m.key));
            return (
              <div key={sys.id} className="rounded-xl border border-ash-900/[0.08] bg-paper/60">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ash-900/[0.06] px-3 py-2.5">
                  <label className="flex min-w-0 cursor-pointer items-center gap-2.5">
                    <input type="checkbox" checked={on} onChange={(e) => setSystem(sys.id, e.target.checked)} className="h-4 w-4 shrink-0" />
                    <span aria-hidden className="h-6 w-1 shrink-0 rounded-full" style={{ backgroundColor: sys.accent }} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold text-ash-800">{sys.name}</span>
                      <span className="block truncate text-[10.5px] text-ash-400">{sys.blurb}</span>
                    </span>
                  </label>
                  {sys.modules.length > 0 && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={!on || allOn}
                        onClick={() => setAllModules(sys, true)}
                        className="rounded-md px-2 py-1 text-[11px] font-semibold text-ash-500 transition-colors hover:bg-ash-900/[0.05] disabled:opacity-35 disabled:hover:bg-transparent"
                      >
                        All
                      </button>
                      <button
                        type="button"
                        disabled={!on || noneOn}
                        onClick={() => setAllModules(sys, false)}
                        className="rounded-md px-2 py-1 text-[11px] font-semibold text-ash-500 transition-colors hover:bg-ash-900/[0.05] disabled:opacity-35 disabled:hover:bg-transparent"
                      >
                        None
                      </button>
                    </div>
                  )}
                </div>

                {sys.modules.length === 0 ? (
                  <p className="px-3 py-2.5 text-[11.5px] text-ash-400">No staff modules — this is a customer-facing surface.</p>
                ) : (
                  <div className={`grid gap-x-4 gap-y-1.5 px-3 py-2.5 sm:grid-cols-2 lg:grid-cols-3 ${on ? "" : "pointer-events-none opacity-40"}`}>
                    {sys.modules.map((m) => (
                      <label key={m.key} className="flex cursor-pointer items-start gap-2">
                        <input
                          type="checkbox"
                          checked={moduleOn(sys.id, m.key)}
                          onChange={(e) => setModule(sys.id, m.key, e.target.checked)}
                          className="mt-0.5 h-3.5 w-3.5 shrink-0"
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-[12px] font-medium text-ash-700">{m.label}</span>
                          <span className="block truncate text-[10px] text-ash-400">
                            {m.items.length} screen{m.items.length === 1 ? "" : "s"}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 border-t border-ash-900/[0.07] pt-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-invert px-4 py-2 text-[12.5px] font-semibold text-invert-fg hover:bg-invert-2 disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save changes
        </button>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-ash-400">
          <ShieldCheck className="h-3.5 w-3.5" /> Takes effect within 30 seconds — no sign-out needed.
        </span>
      </div>
    </div>
  );
}
