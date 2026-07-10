"use client";

import { useState } from "react";
import { useLoad } from "@/lib/hooks/useLoad";
import { Loader2, AlertTriangle, CheckCircle2, Package, Plus } from "lucide-react";

type Product = {
  id: string; name: string; description: string | null;
  minPrincipal: string | number; maxPrincipal: string | number; interestRate: string | number;
  interestMethod: string; repaymentPeriod: number; repaymentPeriodUnit: string;
  gracePeriodDays: number; disbursementMode: string; isActive: boolean;
};

const fmtKES = (n: string | number) => `KES ${Math.round(Number(n)).toLocaleString()}`;

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [workflows, setWorkflows] = useState<{ id: string; title: string }[]>([]);
  const [form, setForm] = useState({
    name: "", description: "", minPrincipal: "1000", maxPrincipal: "50000", interestRate: "12",
    interestMethod: "flat", repaymentPeriod: "8", repaymentPeriodUnit: "week", gracePeriodDays: "0",
    disbursementMode: "B2C_MPESA", newWorkflowId: "",
  });

  const load = async () => {
    try {
      const [pRes, wRes] = await Promise.all([fetch("/api/console/products"), fetch("/api/console/workflows")]);
      const data = await pRes.json();
      if (!data.success) { setError(data.message || "Could not load products."); return; }
      setProducts(data.products);
      const wData = await wRes.json();
      if (wData.success) setWorkflows(wData.workflows.map((w: { id: string; title: string }) => ({ id: w.id, title: w.title })));
    } catch { setError("Could not load products."); }
  };
  useLoad(load);

  const save = async () => {
    setSaving(true); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/console/products", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          minPrincipal: Number(form.minPrincipal), maxPrincipal: Number(form.maxPrincipal),
          interestRate: Number(form.interestRate), repaymentPeriod: Number(form.repaymentPeriod),
          gracePeriodDays: Number(form.gracePeriodDays),
          newWorkflowId: form.newWorkflowId || null, repeatWorkflowId: form.newWorkflowId || null,
        }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not save."); return; }
      setNotice(`Product "${data.product.name}" created.`);
      setShowForm(false);
      await load();
    } catch { setError("Could not save."); } finally { setSaving(false); }
  };

  const toggle = async (p: Product) => {
    await fetch("/api/console/products", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: p.id, isActive: !p.isActive }),
    });
    await load();
  };

  const field = "flex items-center gap-2 rounded-lg border border-zinc-900/15 bg-white/80 px-3";
  const input = "flex-1 bg-transparent outline-none text-sm py-2.5 placeholder:text-zinc-400 min-w-0";
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <main className="mx-auto max-w-4xl px-4 sm:px-6 py-8">
        <div className="mt-3 flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold flex items-center gap-2"><Package className="h-5 w-5" style={{ color: "var(--brand)" }} /> Products</h1>
          <button onClick={() => setShowForm((s) => !s)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800">
            <Plus className="h-3.5 w-3.5" /> New product
          </button>
        </div>

        {notice && <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50/90 px-3 py-2.5 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> {notice}</div>}
        {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}</div>}

        {showForm && (
          <div className="glass mt-5 p-5">
            <h2 className="text-sm font-semibold">New loan product</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className={`${field} sm:col-span-2`}><input className={input} placeholder="Product name (e.g. Biashara Boost)" value={form.name} onChange={set("name")} /></div>
              <div className={`${field} sm:col-span-2`}><input className={input} placeholder="Description (borrower-facing)" value={form.description} onChange={set("description")} /></div>
              <div className={field}><span className="text-xs text-zinc-400 shrink-0">Min KES</span><input className={input} inputMode="numeric" value={form.minPrincipal} onChange={set("minPrincipal")} /></div>
              <div className={field}><span className="text-xs text-zinc-400 shrink-0">Max KES</span><input className={input} inputMode="numeric" value={form.maxPrincipal} onChange={set("maxPrincipal")} /></div>
              <div className={field}><span className="text-xs text-zinc-400 shrink-0">Interest %</span><input className={input} inputMode="decimal" value={form.interestRate} onChange={set("interestRate")} /></div>
              <div className={field}>
                <span className="text-xs text-zinc-400 shrink-0">Method</span>
                <select className={`${input} appearance-none`} value={form.interestMethod} onChange={set("interestMethod")}>
                  <option value="flat">Flat (on principal)</option>
                  <option value="reducing">Reducing balance</option>
                </select>
              </div>
              <div className={field}><span className="text-xs text-zinc-400 shrink-0">Installments</span><input className={input} inputMode="numeric" value={form.repaymentPeriod} onChange={set("repaymentPeriod")} /></div>
              <div className={field}>
                <span className="text-xs text-zinc-400 shrink-0">Every</span>
                <select className={`${input} appearance-none`} value={form.repaymentPeriodUnit} onChange={set("repaymentPeriodUnit")}>
                  <option value="day">Day</option><option value="week">Week</option><option value="month">Month</option>
                </select>
              </div>
              <div className={field}><span className="text-xs text-zinc-400 shrink-0">Grace days</span><input className={input} inputMode="numeric" value={form.gracePeriodDays} onChange={set("gracePeriodDays")} /></div>
              <div className={field}>
                <span className="text-xs text-zinc-400 shrink-0">Disburse via</span>
                <select className={`${input} appearance-none`} value={form.disbursementMode} onChange={set("disbursementMode")}>
                  <option value="B2C_MPESA">M-Pesa B2C</option>
                  <option value="MANUAL">Manual (record ref)</option>
                  <option value="TO_THIRD_PARTY">Third party (e.g. school)</option>
                </select>
              </div>
              <div className={`${field} sm:col-span-2`}>
                <span className="text-xs text-zinc-400 shrink-0">Approval workflow</span>
                <select className={`${input} appearance-none`} value={form.newWorkflowId} onChange={set("newWorkflowId")}>
                  <option value="">Default (two-tier: Officer → Final)</option>
                  {workflows.map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}
                </select>
              </div>
            </div>
            <button onClick={save} disabled={saving}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Create product
            </button>
          </div>
        )}

        {!products && !error && <div className="mt-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>}
        {products?.length === 0 && !showForm && <p className="mt-10 text-center text-sm text-zinc-500">No products yet — create your first.</p>}

        <div className="mt-5 space-y-3">
          {products?.map((p) => (
            <div key={p.id} className={`glass p-4 flex items-center justify-between gap-3 ${p.isActive ? "" : "opacity-60"}`}>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{p.name}</p>
                <p className="text-xs text-zinc-500">
                  {fmtKES(p.minPrincipal)}–{fmtKES(p.maxPrincipal)} · {Number(p.interestRate)}% {p.interestMethod} · {p.repaymentPeriod} × {p.repaymentPeriodUnit} · {p.disbursementMode.replace(/_/g, " ")}
                </p>
              </div>
              <button onClick={() => toggle(p)}
                className={`rounded-md px-2 py-1 text-[11px] font-semibold shrink-0 ${p.isActive ? "bg-emerald-100 text-emerald-700" : "bg-zinc-900/5 text-zinc-500"}`}>
                {p.isActive ? "ACTIVE" : "INACTIVE"}
              </button>
            </div>
          ))}
        </div>
      </main>
  );
}
