"use client";

import { useCallback, useState } from "react";
import { useLoad } from "@/lib/hooks/useLoad";
import { Loader2, AlertTriangle, CheckCircle2, GitBranch, Plus, Trash2 } from "lucide-react";

type Stage = { title: string; accessTier: number; canFinalize: boolean; otpRequired: boolean; maxAmount: string };
type Workflow = { id: string; title: string; stages: { id: string; title: string; order: number; accessTier: number; canFinalize: boolean; otpRequired: boolean; maxAmount: number | null }[] };

const TIER_LABEL: Record<number, string> = { 1: "Initiator", 2: "Authorizer", 3: "Validator" };
const emptyStage = (): Stage => ({ title: "", accessTier: 1, canFinalize: false, otpRequired: true, maxAmount: "" });

export default function WorkflowsPage() {
  const [rows, setRows] = useState<Workflow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [stages, setStages] = useState<Stage[]>([
    { title: "Officer Review", accessTier: 1, canFinalize: false, otpRequired: false, maxAmount: "" },
    { title: "Final Approval", accessTier: 3, canFinalize: true, otpRequired: true, maxAmount: "" },
  ]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/console/workflows");
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not load workflows."); return; }
      setRows(data.workflows);
    } catch { setError("Could not load workflows."); }
  }, []);
  useLoad(load);

  const save = async () => {
    setSaving(true); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/console/workflows", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          stages: stages.map((s) => ({ ...s, maxAmount: s.maxAmount.trim() ? Number(s.maxAmount) : null })),
        }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not save."); return; }
      setNotice(`Workflow "${title}" created — assign it to products.`);
      setShowForm(false); setTitle("");
      await load();
    } catch { setError("Could not save."); } finally { setSaving(false); }
  };

  const setStage = (i: number, patch: Partial<Stage>) =>
    setStages((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <main className="mx-auto max-w-4xl px-4 sm:px-6 py-8">
        <div className="mt-3 flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold flex items-center gap-2"><GitBranch className="h-5 w-5" style={{ color: "var(--brand)" }} /> Approval workflows</h1>
          <button onClick={() => setShowForm((s) => !s)} className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800">
            <Plus className="h-3.5 w-3.5" /> New workflow
          </button>
        </div>
        <p className="mt-1 text-xs text-zinc-500">Stages run in order; the last stage finalizes (books the loan). Without an assigned workflow, products use the default two-tier chain.</p>

        {notice && <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50/90 px-3 py-2.5 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> {notice}</div>}
        {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}</div>}

        {showForm && (
          <div className="glass mt-5 p-5">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Workflow name (e.g. Business Loans 3-Tier)"
              className="w-full rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2.5 text-sm outline-none placeholder:text-zinc-400" />
            <div className="mt-3 space-y-2">
              {stages.map((s, i) => (
                <div key={i} className="rounded-xl border border-zinc-900/10 bg-white/70 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold text-zinc-400 w-5">{i + 1}.</span>
                    <input value={s.title} onChange={(e) => setStage(i, { title: e.target.value })} placeholder="Stage title"
                      className="flex-1 min-w-40 rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2 text-sm outline-none" />
                    <select value={s.accessTier} onChange={(e) => setStage(i, { accessTier: Number(e.target.value) })}
                      className="rounded-lg border border-zinc-900/15 bg-white/80 px-2 py-2 text-sm outline-none">
                      {[1, 2, 3].map((t) => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}
                    </select>
                    <input value={s.maxAmount} onChange={(e) => setStage(i, { maxAmount: e.target.value })} inputMode="numeric"
                      placeholder="Max KES (finalize cap)" className="w-40 rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2 text-sm outline-none" />
                    {stages.length > 1 && (
                      <button onClick={() => setStages((x) => x.filter((_, j) => j !== i))} className="text-zinc-400 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-4 text-xs text-zinc-600">
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={s.canFinalize} onChange={(e) => setStage(i, { canFinalize: e.target.checked })} /> finalizes (books the loan)</label>
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={s.otpRequired} onChange={(e) => setStage(i, { otpRequired: e.target.checked })} /> OTP required</label>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={() => setStages((s) => [...s, emptyStage()])}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-900/15 bg-white/70 px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-white">
                <Plus className="h-3.5 w-3.5" /> Add stage
              </button>
              <button onClick={save} disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-5 py-2 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Create workflow
              </button>
            </div>
          </div>
        )}

        {!rows && !error && <div className="mt-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>}
        {rows?.length === 0 && !showForm && <p className="mt-10 text-center text-sm text-zinc-500">No custom workflows — products use the default two-tier chain.</p>}

        <div className="mt-5 space-y-3">
          {rows?.map((w) => (
            <div key={w.id} className="glass p-4">
              <p className="text-sm font-semibold">{w.title}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {w.stages.map((s, i) => (
                  <span key={s.id} className="flex items-center gap-1.5">
                    <span className={`rounded-md px-2 py-1 text-[11px] font-semibold ${s.canFinalize ? "bg-emerald-100 text-emerald-700" : "bg-zinc-900/5 text-zinc-600"}`}>
                      {s.title} · {TIER_LABEL[s.accessTier]}{s.otpRequired ? " · OTP" : ""}{s.maxAmount ? ` · ≤${Math.round(s.maxAmount / 1000)}k` : ""}
                    </span>
                    {i < w.stages.length - 1 && <span className="text-zinc-300">→</span>}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </main>
  );
}
