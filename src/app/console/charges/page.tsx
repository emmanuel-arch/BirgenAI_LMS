"use client";

// ─────────────────────────────────────────────────────────────────────────────
// CHARGES — the lender's own fees, in the lender's own hands.
//
// A registration fee, a processing fee, whatever else this lender charges for. Set
// them here once and they appear on the "Request payment" button everywhere: the
// Customer-360, the collections queue, the counter, a field agent's phone.
//
// A BirgenAI platform fee is shown too, and is read-only — a lender may see what we
// charge and where it settles, but it is not theirs to set.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useState } from "react";
import { useLoad } from "@/lib/hooks/useLoad";
import { Coins, Plus, Loader2, AlertTriangle, CheckCircle2, Trash2, Lock, Percent } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";

type Charge = {
  id: string; name: string; code: string; description: string | null;
  amount: number; isPercent: boolean; trigger: string; beneficiary: "LENDER" | "PLATFORM";
  isActive: boolean; locked: boolean;
};

const TRIGGER_LABEL: Record<string, string> = {
  MANUAL: "Whenever staff ask for it",
  ON_REGISTRATION: "When a customer is registered",
  ON_APPLICATION: "When they apply for a loan",
};

const field = "w-full rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2.5 text-sm outline-none placeholder:text-zinc-400";

export default function ChargesPage() {
  const [charges, setCharges] = useState<Charge[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", amount: "", isPercent: false, trigger: "MANUAL", description: "" });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/console/charges");
      const d = await res.json();
      if (!d.success) { setError(d.message ?? "Could not load charges."); return; }
      setCharges(d.charges ?? []);
    } catch { setError("Could not reach the server."); }
  }, []);
  useLoad(load);

  const create = async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/console/charges", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, amount: Number(form.amount) }),
      });
      const d = await res.json();
      if (!d.success) { setError(d.message ?? "Could not create the charge."); return; }
      setNotice(`${form.name} added — it is now on the Request payment button everywhere.`);
      setForm({ name: "", code: "", amount: "", isPercent: false, trigger: "MANUAL", description: "" });
      setAdding(false);
      await load();
    } catch { setError("Could not reach the server."); } finally { setBusy(false); }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/console/charges", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      const d = await res.json();
      if (!d.success) { setError(d.message ?? "Could not save."); return; }
      await load();
    } catch { setError("Could not reach the server."); } finally { setBusy(false); }
  };

  const remove = async (c: Charge) => {
    if (!window.confirm(`Delete "${c.name}"?`)) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch(`/api/console/charges?id=${c.id}`, { method: "DELETE" });
      const d = await res.json();
      if (!d.success) { setError(d.message ?? "Could not delete."); return; }
      if (d.message) setNotice(d.message);
      await load();
    } catch { setError("Could not reach the server."); } finally { setBusy(false); }
  };

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
      <PageHeader
        icon={Coins}
        title="Charges"
        subtitle="What you charge, and when. Every fee here appears on the Request payment button — at the counter, on a collections call, or out in the field."
      >
        <button onClick={() => setAdding((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800">
          <Plus className="h-3.5 w-3.5" /> New charge
        </button>
      </PageHeader>

      {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}</div>}
      {notice && <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50/90 px-3 py-2.5 text-sm text-emerald-700"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {notice}</div>}

      {adding && (
        <div className="glass mt-4 p-5">
          <p className="text-sm font-semibold">A new charge</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <input className={field} placeholder="Name — e.g. Registration fee" value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            <input className={field} placeholder="Short code — e.g. REGFEE" value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) }))} />
            <div className="flex gap-2">
              <input className={field} inputMode="numeric" placeholder={form.isPercent ? "Percent of principal" : "Amount (KES)"}
                value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value.replace(/[^\d.]/g, "") }))} />
              <button
                onClick={() => setForm((f) => ({ ...f, isPercent: !f.isPercent }))}
                title="Charge a percentage of the loan principal instead of a flat amount"
                className={`shrink-0 rounded-lg border px-3 text-xs font-semibold ${form.isPercent ? "border-transparent bg-zinc-900 text-white" : "border-zinc-900/15 bg-white/70 text-zinc-600"}`}
              >
                <Percent className="h-3.5 w-3.5" />
              </button>
            </div>
            <select className={field} value={form.trigger} onChange={(e) => setForm((f) => ({ ...f, trigger: e.target.value }))}>
              {Object.entries(TRIGGER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input className={`${field} sm:col-span-2`} placeholder="What is it for? (shown to your staff)" value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <p className="mt-2 text-[11px] text-zinc-400">
            The short code is what the customer sees on their M-Pesa prompt — keep it recognisable.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button onClick={create} disabled={busy || !form.name.trim() || !form.code || !(Number(form.amount) > 0)}
              className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand)" }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add it
            </button>
            <button onClick={() => setAdding(false)} className="rounded-lg border border-zinc-900/15 bg-white/70 px-4 py-2.5 text-sm text-zinc-600">Cancel</button>
          </div>
        </div>
      )}

      <div className="mt-4 space-y-2">
        {charges?.length === 0 && !adding && (
          <div className="glass p-8 text-center text-sm text-zinc-500">
            No charges yet. Add one and it appears on the Request payment button everywhere in the console.
          </div>
        )}

        {charges?.map((c) => (
          <div key={c.id} className={`glass p-4 ${!c.isActive ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-bold text-zinc-800">
                  {c.name}
                  <span className="rounded bg-zinc-900/5 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">{c.code}</span>
                  {c.locked && (
                    <span className="inline-flex items-center gap-1 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-violet-700">
                      <Lock className="h-2.5 w-2.5" /> BirgenAI fee
                    </span>
                  )}
                  {!c.isActive && <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-600">OFF</span>}
                </p>
                <p className="mt-0.5 text-[12px] text-zinc-500">{c.description || TRIGGER_LABEL[c.trigger]}</p>
                {c.locked && (
                  <p className="mt-1 text-[11px] text-violet-700">Settles to BirgenAI, not to your paybill.</p>
                )}
              </div>

              <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
                <p className="text-lg font-bold tabular-nums text-zinc-800">
                  {c.isPercent ? `${c.amount}%` : `KES ${c.amount.toLocaleString()}`}
                </p>
                {!c.locked && (
                  <>
                    <button
                      onClick={() => patch(c.id, { isActive: !c.isActive })}
                      disabled={busy}
                      className="rounded-lg border border-zinc-900/15 bg-white/70 px-3 py-2 text-xs font-medium text-zinc-600 hover:bg-white disabled:opacity-50"
                    >
                      {c.isActive ? "Switch off" : "Switch on"}
                    </button>
                    <button
                      onClick={() => remove(c)}
                      disabled={busy}
                      className="rounded-lg p-2 text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      aria-label={`Delete ${c.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
