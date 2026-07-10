"use client";

// Roles & Rights — where an admin decides which menus and abilities each role
// gets. The checkbox tree and the live menu preview both come from the same
// registry the sidebar renders, so what you tick here is literally what the
// staff member sees after their next page load (≤30s, no re-login needed).
import { useMemo, useState } from "react";
import Link from "next/link";
import { useLoad } from "@/lib/hooks/useLoad";
import { KeyRound, Plus, Loader2, AlertTriangle, CheckCircle2, Trash2, Crown, Eye } from "lucide-react";
import {
  RIGHT_GROUPS, RIGHT_LABELS, ADMIN_ONLY_RIGHTS, RESERVED_RIGHTS, WILDCARD, type Right,
} from "@/lib/rbac/rights";
import { navFor } from "@/lib/nav/registry";
import { AVAILABLE_FEATURES } from "@/lib/billing/plans";

type RoleRow = { id: string; title: string; rights: string[]; staffCount: number };

const ADMIN_SET = new Set<string>(ADMIN_ONLY_RIGHTS);
const RESERVED_SET = new Set<string>(RESERVED_RIGHTS);
const ALL_FEATURES: ReadonlySet<string> = new Set(AVAILABLE_FEATURES);

export default function RolesPage() {
  const [roles, setRoles] = useState<RoleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Editor state. selected === "new" means creating.
  const [selected, setSelected] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [isAdmin, setIsAdmin] = useState(false);

  const load = async () => {
    try {
      const res = await fetch("/api/console/roles");
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not load roles."); return; }
      setRoles(data.roles);
    } catch { setError("Could not load roles."); }
  };
  useLoad(load);

  const openRole = (r: RoleRow) => {
    setSelected(r.id); setNotice(null); setError(null);
    setTitle(r.title);
    const wildcard = r.rights.includes(WILDCARD);
    setIsAdmin(wildcard);
    setDraft(new Set(wildcard ? [] : r.rights));
  };
  const openNew = () => {
    setSelected("new"); setNotice(null); setError(null);
    setTitle("");
    setIsAdmin(false);
    setDraft(new Set(["borrowers.view", "applications.view", "loans.view", "products.view", "reports.view"]));
  };

  const toggle = (right: string) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(right)) next.delete(right); else next.add(right);
      return next;
    });
  };

  const save = async () => {
    setSaving(true); setError(null); setNotice(null);
    const rights = isAdmin ? [WILDCARD] : [...draft];
    try {
      const res = await fetch("/api/console/roles", {
        method: selected === "new" ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selected === "new" ? { title, rights } : { id: selected, title, rights }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not save the role."); return; }
      setNotice(selected === "new" ? "Role created. Assign it to staff in Team." : "Role saved — staff see the change on their next page load.");
      if (selected === "new") setSelected(data.roleId);
      await load();
    } catch { setError("Could not save the role."); } finally { setSaving(false); }
  };

  const remove = async (r: RoleRow) => {
    if (!confirm(`Delete the role "${r.title}"? This cannot be undone.`)) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/console/roles", {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not delete the role."); return; }
      if (selected === r.id) setSelected(null);
      setNotice("Role deleted.");
      await load();
    } catch { setError("Could not delete the role."); } finally { setSaving(false); }
  };

  // Live preview: the sidebar this role would see (on the full feature set —
  // items your package doesn't include stay hidden for everyone regardless).
  const previewRights: ReadonlySet<string> = useMemo(
    () => (isAdmin ? new Set([...draft, ...RIGHT_GROUPS.flatMap((g) => g.rights)]) : draft),
    [isAdmin, draft],
  );
  const preview = useMemo(() => navFor(previewRights, ALL_FEATURES), [previewRights]);
  const selectedRole = roles?.find((r) => r.id === selected) ?? null;

  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <KeyRound className="h-5 w-5" style={{ color: "var(--brand)" }} /> Roles & Rights
          </h1>
          <p className="mt-1 text-sm text-zinc-500 max-w-2xl">
            Create roles and choose exactly which menus and abilities each one gets. Staff on a role see only their
            assigned modules — assign roles in <Link href="/console/team" className="font-semibold hover:underline" style={{ color: "var(--brand)" }}>Team</Link>.
          </p>
        </div>
        <button onClick={openNew} className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800">
          <Plus className="h-3.5 w-3.5" /> New role
        </button>
      </div>

      {notice && <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50/90 px-3 py-2.5 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> {notice}</div>}
      {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}</div>}

      <div className="mt-5 grid gap-4 lg:grid-cols-[260px_1fr]">
        {/* Role list */}
        <div className="space-y-2">
          {roles === null ? (
            <div className="glass p-4 text-sm text-zinc-500 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : roles.length === 0 ? (
            <div className="glass p-4 text-sm text-zinc-500">No roles yet — create the first one.</div>
          ) : (
            roles.map((r) => {
              const admin = r.rights.includes(WILDCARD);
              return (
                <button
                  key={r.id}
                  onClick={() => openRole(r)}
                  className={`glass w-full p-3.5 text-left transition-colors ${selected === r.id ? "ring-2" : "hover:bg-white/80"}`}
                  style={selected === r.id ? ({ ["--tw-ring-color" as never]: "var(--brand)" }) : undefined}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold truncate">{r.title}</p>
                    {admin && <Crown className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-label="Administrator" />}
                  </div>
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    {admin ? "Everything" : `${r.rights.length} permission${r.rights.length === 1 ? "" : "s"}`} · {r.staffCount} staff
                  </p>
                </button>
              );
            })
          )}
        </div>

        {/* Editor */}
        {selected === null ? (
          <div className="glass p-8 text-center text-sm text-zinc-500">Pick a role to edit, or create a new one.</div>
        ) : (
          <div className="space-y-4">
            <div className="glass p-5">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Role name</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Loan Officer"
                className="mt-1.5 w-full rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2.5 text-sm outline-none"
              />
              <label className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-300/60 bg-amber-50/70 p-3">
                <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} className="mt-0.5" />
                <span>
                  <span className="text-sm font-semibold text-amber-800 flex items-center gap-1.5"><Crown className="h-3.5 w-3.5" /> Administrator — everything</span>
                  <span className="block text-[11px] text-amber-700">Every menu and every ability, including ones added in future updates. Use sparingly.</span>
                </span>
              </label>
            </div>

            {!isAdmin && (
              <div className="glass p-5">
                <p className="text-sm font-semibold">Permissions</p>
                <p className="mt-0.5 text-[11px] text-zinc-500">Ticking a permission puts its menu on this role&apos;s sidebar and unlocks the action behind it.</p>
                <div className="mt-4 grid gap-5 sm:grid-cols-2">
                  {RIGHT_GROUPS.map((g) => (
                    <div key={g.key}>
                      <p className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-500">{g.label}</p>
                      <div className="mt-1.5 space-y-1.5">
                        {g.rights.map((right) => (
                          <label key={right} className="flex items-start gap-2 rounded-md px-1 py-0.5 hover:bg-zinc-900/[0.03]">
                            <input type="checkbox" checked={draft.has(right)} onChange={() => toggle(right)} className="mt-1" />
                            <span className="min-w-0">
                              <span className="text-[12.5px] font-medium text-zinc-800 flex items-center gap-1.5 flex-wrap">
                                <code className="text-[10.5px] text-zinc-400">{right}</code>
                                {ADMIN_SET.has(right) && <span className="rounded bg-amber-100 px-1 py-px text-[9px] font-semibold text-amber-700">ADMIN</span>}
                                {RESERVED_SET.has(right) && <span className="rounded bg-zinc-900/5 px-1 py-px text-[9px] font-semibold text-zinc-400">SOON</span>}
                              </span>
                              <span className="block text-[11px] leading-snug text-zinc-500">{RIGHT_LABELS[right as Right]}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Live menu preview */}
            <div className="glass p-5">
              <p className="text-sm font-semibold flex items-center gap-1.5"><Eye className="h-4 w-4 text-zinc-400" /> What this role&apos;s sidebar will show</p>
              <p className="mt-0.5 text-[11px] text-zinc-500">Menus your package doesn&apos;t include stay hidden for everyone, whatever the role says.</p>
              {preview.length === 1 && !isAdmin ? (
                <p className="mt-3 text-sm text-zinc-500">Only the dashboard — tick some permissions above.</p>
              ) : (
                <div className="mt-3 flex flex-wrap gap-3">
                  {preview.map((mod) => (
                    <div key={mod.key} className="rounded-lg border border-zinc-900/10 bg-white/70 px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{mod.label}</p>
                      <p className="mt-0.5 text-[11px] text-zinc-700">{mod.items.map((i) => i.label).join(" · ")}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={save}
                disabled={saving || title.trim().length < 2 || (!isAdmin && draft.size === 0)}
                className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: "var(--brand)" }}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {selected === "new" ? "Create role" : "Save changes"}
              </button>
              {selectedRole && (
                <button
                  onClick={() => remove(selectedRole)}
                  disabled={saving || selectedRole.staffCount > 0}
                  title={selectedRole.staffCount > 0 ? "Reassign its staff first" : undefined}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50/70 px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
