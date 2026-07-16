"use client";

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCTS — the shelf, and the setup wizard behind it.
//
// A loan product is the single most consequential thing an admin configures: it
// decides how interest is charged, how the schedule is shaped, what a borrower must
// bring (a guarantor, security), and — the part the founder asked us to bring over
// from ServiceSuite — WHICH APPROVAL WORKFLOW a new loan versus a repeat loan runs.
// So the form is not a flat grid of inputs; it is a stepped setup an admin walks
// through, the way ServiceSuite does it, one decision at a time.
//
// The same wizard creates AND edits: "New product" opens it empty, the pencil on any
// card opens it pre-filled and PUTs by id. One code path, so an edited product can
// never drift from a created one.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { useLoad } from "@/lib/hooks/useLoad";
import {
  Loader2, AlertTriangle, CheckCircle2, Package, Plus, Pencil, X, ArrowLeft, ArrowRight,
  Percent, Calendar, ShieldCheck, GitBranch, Coins, ChevronRight,
} from "lucide-react";

type Product = {
  id: string; name: string; description: string | null;
  minPrincipal: string | number; maxPrincipal: string | number; minLoanLimit: string | number | null;
  interestRate: string | number; interestMethod: string; interestType: string; interestPeriodUnit: string;
  principalType: string; repaymentPeriod: number; repaymentPeriodUnit: string;
  gracePeriodDays: number; penaltyRate: string | number | null; repaymentOrder: string;
  earlySettlementEnabled: boolean; earlySettlementDays: number | null; earlySettlementRate: string | number | null;
  minCreditScore: number | null;
  guarantorRequired: boolean; guarantorReborrow: boolean; securityRequired: boolean; securityCoverPct: number;
  disbursementMode: string; isActive: boolean;
  newWorkflowId: string | null; repeatWorkflowId: string | null;
};

const fmtKES = (n: string | number) => `KES ${Math.round(Number(n)).toLocaleString()}`;

// The wizard's own form shape — everything a string so inputs stay controlled.
type Form = {
  id: string;
  name: string; description: string;
  principalType: string; minPrincipal: string; maxPrincipal: string; minLoanLimit: string;
  interestType: string; interestMethod: string; interestRate: string; interestPeriodUnit: string;
  earlySettlementEnabled: boolean; earlySettlementDays: string; earlySettlementRate: string;
  repaymentPeriod: string; repaymentPeriodUnit: string; gracePeriodDays: string; penaltyRate: string; repaymentOrder: string;
  minCreditScore: string; guarantorRequired: boolean; guarantorReborrow: boolean; securityRequired: boolean; securityCoverPct: string;
  disbursementMode: string; newWorkflowId: string; repeatWorkflowId: string;
};

const EMPTY: Form = {
  id: "", name: "", description: "",
  principalType: "standard", minPrincipal: "1000", maxPrincipal: "50000", minLoanLimit: "",
  interestType: "fixed", interestMethod: "flat", interestRate: "12", interestPeriodUnit: "term",
  earlySettlementEnabled: false, earlySettlementDays: "", earlySettlementRate: "",
  repaymentPeriod: "8", repaymentPeriodUnit: "week", gracePeriodDays: "0", penaltyRate: "5", repaymentOrder: "penalty,interest,principal,fees",
  minCreditScore: "", guarantorRequired: false, guarantorReborrow: false, securityRequired: false, securityCoverPct: "100",
  disbursementMode: "B2C_MPESA", newWorkflowId: "", repeatWorkflowId: "",
};

function fromProduct(p: Product): Form {
  return {
    id: p.id, name: p.name, description: p.description ?? "",
    principalType: p.principalType || "standard",
    minPrincipal: String(Math.round(Number(p.minPrincipal))), maxPrincipal: String(Math.round(Number(p.maxPrincipal))),
    minLoanLimit: p.minLoanLimit != null ? String(Math.round(Number(p.minLoanLimit))) : "",
    interestType: p.interestType || "fixed", interestMethod: p.interestMethod || "flat",
    interestRate: String(Number(p.interestRate)), interestPeriodUnit: p.interestPeriodUnit || "term",
    earlySettlementEnabled: !!p.earlySettlementEnabled,
    earlySettlementDays: p.earlySettlementDays != null ? String(p.earlySettlementDays) : "",
    earlySettlementRate: p.earlySettlementRate != null ? String(Number(p.earlySettlementRate)) : "",
    repaymentPeriod: String(p.repaymentPeriod), repaymentPeriodUnit: p.repaymentPeriodUnit || "week",
    gracePeriodDays: String(p.gracePeriodDays ?? 0), penaltyRate: p.penaltyRate != null ? String(Number(p.penaltyRate)) : "",
    repaymentOrder: p.repaymentOrder || "penalty,interest,principal,fees",
    minCreditScore: p.minCreditScore != null ? String(p.minCreditScore) : "",
    guarantorRequired: !!p.guarantorRequired, guarantorReborrow: !!p.guarantorReborrow,
    securityRequired: !!p.securityRequired, securityCoverPct: String(p.securityCoverPct ?? 100),
    disbursementMode: p.disbursementMode || "B2C_MPESA",
    newWorkflowId: p.newWorkflowId ?? "", repeatWorkflowId: p.repeatWorkflowId ?? "",
  };
}

const STEPS = [
  { key: "basics", label: "Basics", icon: Package },
  { key: "interest", label: "Interest", icon: Percent },
  { key: "repayment", label: "Repayment", icon: Calendar },
  { key: "requirements", label: "Requirements", icon: ShieldCheck },
  { key: "workflow", label: "Workflow", icon: GitBranch },
  { key: "review", label: "Review", icon: CheckCircle2 },
] as const;

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [workflows, setWorkflows] = useState<{ id: string; title: string }[]>([]);
  const [editing, setEditing] = useState<Form | null>(null); // non-null = wizard open

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

  const toggle = async (p: Product) => {
    await fetch("/api/console/products", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: p.id, isActive: !p.isActive }),
    });
    await load();
  };

  return (
    <main className="mx-auto max-w-4xl px-4 sm:px-6 py-8">
      <div className="mt-3 flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold flex items-center gap-2"><Package className="h-5 w-5" style={{ color: "var(--brand)" }} /> Products</h1>
        <button onClick={() => { setEditing(EMPTY); setNotice(null); setError(null); }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800">
          <Plus className="h-3.5 w-3.5" /> New product
        </button>
      </div>

      {notice && <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50/90 px-3 py-2.5 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> {notice}</div>}
      {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}</div>}

      {!products && !error && <div className="mt-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>}
      {products?.length === 0 && !editing && <p className="mt-10 text-center text-sm text-zinc-500">No products yet — create your first.</p>}

      <div className="mt-5 space-y-3">
        {products?.map((p) => (
          <div key={p.id} className={`glass p-4 flex items-center justify-between gap-3 ${p.isActive ? "" : "opacity-60"}`}>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate flex items-center gap-2">
                {p.name}
                {p.guarantorRequired && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">GUARANTOR</span>}
                {p.securityRequired && <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold text-sky-700">SECURED</span>}
              </p>
              <p className="text-xs text-zinc-500">
                {fmtKES(p.minPrincipal)}–{fmtKES(p.maxPrincipal)} · {Number(p.interestRate)}% {p.interestMethod} · {p.repaymentPeriod} × {p.repaymentPeriodUnit} · {p.disbursementMode.replace(/_/g, " ")}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button onClick={() => { setEditing(fromProduct(p)); setNotice(null); setError(null); }}
                className="rounded-md border border-zinc-900/10 bg-white/70 p-1.5 text-zinc-500 hover:text-zinc-800" aria-label={`Edit ${p.name}`}>
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => toggle(p)}
                className={`rounded-md px-2 py-1 text-[11px] font-semibold ${p.isActive ? "bg-emerald-100 text-emerald-700" : "bg-zinc-900/5 text-zinc-500"}`}>
                {p.isActive ? "ACTIVE" : "INACTIVE"}
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <ProductWizard
          initial={editing}
          workflows={workflows}
          onClose={() => setEditing(null)}
          onSaved={(name, isEdit) => { setEditing(null); setNotice(`Product "${name}" ${isEdit ? "updated" : "created"}.`); load(); }}
        />
      )}
    </main>
  );
}

// ── The wizard ───────────────────────────────────────────────────────────────

const FIELD = "w-full rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2.5 text-sm outline-none placeholder:text-zinc-400";
const LABEL = "text-xs font-semibold text-zinc-600";

function ProductWizard({ initial, workflows, onClose, onSaved }: {
  initial: Form; workflows: { id: string; title: string }[]; onClose: () => void; onSaved: (name: string, isEdit: boolean) => void;
}) {
  const [f, setF] = useState<Form>(initial);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEdit = !!initial.id;
  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => setF((s) => ({ ...s, [k]: v }));
  const stepKey = STEPS[step].key;

  // Per-step gate — you can't advance past a step with a fatal gap.
  const stepValid = (): string | null => {
    if (stepKey === "basics") {
      if (f.name.trim().length < 3) return "Give the product a name.";
      if (Number(f.maxPrincipal) < Number(f.minPrincipal)) return "Maximum principal must be at least the minimum.";
    }
    if (stepKey === "interest") {
      const r = Number(f.interestRate);
      if (!Number.isFinite(r) || r < 0 || r > 100) return "Enter an interest rate between 0 and 100%.";
    }
    if (stepKey === "repayment") {
      const n = Number(f.repaymentPeriod);
      if (!Number.isInteger(n) || n < 1 || n > 120) return "Installments must be a whole number, 1–120.";
    }
    return null;
  };

  const next = () => {
    const gap = stepValid();
    if (gap) { setError(gap); return; }
    setError(null);
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };
  const back = () => { setError(null); setStep((s) => Math.max(0, s - 1)); };

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const payload = {
        ...(isEdit ? { id: f.id } : {}),
        name: f.name.trim(), description: f.description.trim() || undefined,
        principalType: f.principalType,
        minPrincipal: Number(f.minPrincipal), maxPrincipal: Number(f.maxPrincipal),
        minLoanLimit: f.minLoanLimit ? Number(f.minLoanLimit) : null,
        interestType: f.interestType, interestMethod: f.interestMethod, interestRate: Number(f.interestRate),
        interestPeriodUnit: f.interestPeriodUnit,
        earlySettlementEnabled: f.earlySettlementEnabled,
        earlySettlementDays: f.earlySettlementEnabled && f.earlySettlementDays ? Number(f.earlySettlementDays) : null,
        earlySettlementRate: f.earlySettlementEnabled && f.earlySettlementRate ? Number(f.earlySettlementRate) : null,
        repaymentPeriod: Number(f.repaymentPeriod), repaymentPeriodUnit: f.repaymentPeriodUnit,
        gracePeriodDays: Number(f.gracePeriodDays) || 0, penaltyRate: f.penaltyRate ? Number(f.penaltyRate) : undefined,
        repaymentOrder: f.repaymentOrder,
        minCreditScore: f.minCreditScore ? Number(f.minCreditScore) : undefined,
        guarantorRequired: f.guarantorRequired, guarantorReborrow: f.guarantorReborrow,
        securityRequired: f.securityRequired, securityCoverPct: Number(f.securityCoverPct) || 100,
        disbursementMode: f.disbursementMode,
        newWorkflowId: f.newWorkflowId || null,
        repeatWorkflowId: (f.repeatWorkflowId || f.newWorkflowId) || null,
      };
      const res = await fetch("/api/console/products", {
        method: isEdit ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not save."); return; }
      onSaved(data.product?.name ?? f.name, isEdit);
    } catch { setError("Could not save."); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 backdrop-blur-sm sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-3xl border border-zinc-900/10 bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold">{isEdit ? "Edit product" : "New loan product"}</h2>
            <p className="mt-0.5 text-xs text-zinc-500">{f.name || "Set it up one step at a time."}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-900/5 hover:text-zinc-700"><X className="h-4 w-4" /></button>
        </div>

        {/* Stepper */}
        <div className="mt-4 flex items-center gap-0 overflow-x-auto pb-1">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const active = i === step; const done = i < step;
            return (
              <div key={s.key} className="flex items-center">
                {i > 0 && <span className={`mx-1.5 h-px w-4 ${done ? "bg-emerald-400" : "bg-zinc-900/15"}`} />}
                <button onClick={() => i < step && setStep(i)} disabled={i > step}
                  className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap ${active ? "text-white" : done ? "text-emerald-700" : "text-zinc-400"}`}
                  style={active ? { backgroundColor: "var(--brand)" } : done ? { backgroundColor: "rgb(209 250 229)" } : undefined}>
                  <Icon className="h-3 w-3" /> {s.label}
                </button>
              </div>
            );
          })}
        </div>

        {error && <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2 text-xs text-red-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}</p>}

        <div className="mt-4 space-y-3">
          {stepKey === "basics" && <BasicsStep f={f} set={set} />}
          {stepKey === "interest" && <InterestStep f={f} set={set} />}
          {stepKey === "repayment" && <RepaymentStep f={f} set={set} />}
          {stepKey === "requirements" && <RequirementsStep f={f} set={set} />}
          {stepKey === "workflow" && <WorkflowStep f={f} set={set} workflows={workflows} />}
          {stepKey === "review" && <ReviewStep f={f} workflows={workflows} />}
        </div>

        <div className="mt-5 flex items-center justify-between gap-2 border-t border-zinc-900/10 pt-4">
          <button onClick={step === 0 ? onClose : back} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-900/15 bg-white/70 px-4 py-2.5 text-sm text-zinc-600">
            {step === 0 ? "Cancel" : <><ArrowLeft className="h-4 w-4" /> Back</>}
          </button>
          {stepKey !== "review" ? (
            <button onClick={next} className="inline-flex items-center gap-1.5 rounded-lg px-5 py-2.5 text-sm font-semibold text-white" style={{ backgroundColor: "var(--brand)" }}>
              Next <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} {isEdit ? "Save changes" : "Create product"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Step bodies ──────────────────────────────────────────────────────────────

type SetFn = <K extends keyof Form>(k: K) => (v: Form[K]) => void;

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      {hint && <span className="ml-1 text-[10px] text-zinc-400">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!value)}
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2.5 text-left">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-zinc-800">{label}</span>
        {hint && <span className="block text-[11px] text-zinc-500">{hint}</span>}
      </span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${value ? "" : "bg-zinc-300"}`} style={value ? { backgroundColor: "var(--brand)" } : undefined}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${value ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

const Pills = <T extends string>({ options, value, onChange }: { options: { v: T; label: string; sub?: string }[]; value: T; onChange: (v: T) => void }) => (
  <div className="grid gap-2 sm:grid-cols-2">
    {options.map((o) => (
      <button key={o.v} type="button" onClick={() => onChange(o.v)}
        className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${value === o.v ? "border-transparent text-white" : "border-zinc-900/15 bg-white/80 text-zinc-700 hover:bg-white"}`}
        style={value === o.v ? { backgroundColor: "var(--brand)" } : undefined}>
        <span className="block font-semibold">{o.label}</span>
        {o.sub && <span className={`block text-[11px] ${value === o.v ? "text-white/80" : "text-zinc-500"}`}>{o.sub}</span>}
      </button>
    ))}
  </div>
);

function BasicsStep({ f, set }: { f: Form; set: SetFn }) {
  return (
    <>
      <Row label="Product name"><input className={FIELD} placeholder="e.g. Biashara Boost" value={f.name} onChange={(e) => set("name")(e.target.value)} /></Row>
      <Row label="Description" hint="borrower-facing"><input className={FIELD} placeholder="What this loan is for" value={f.description} onChange={(e) => set("description")(e.target.value)} /></Row>
      <Row label="Product type" hint="how the schedule is shaped">
        <Pills value={f.principalType} onChange={set("principalType")}
          options={[
            { v: "standard", label: "Standard", sub: "Principal + interest every installment" },
            { v: "interest_first", label: "Interest-first", sub: "Interest until the final installment" },
            { v: "balloon", label: "Balloon", sub: "Most principal in the last installment" },
          ]} />
      </Row>
      <div className="grid gap-3 sm:grid-cols-3">
        <Row label="Min principal"><div className="flex items-center gap-1.5 rounded-lg border border-zinc-900/15 bg-white/80 px-3"><span className="text-xs text-zinc-400">KES</span><input className="w-full bg-transparent py-2.5 text-sm outline-none" inputMode="numeric" value={f.minPrincipal} onChange={(e) => set("minPrincipal")(e.target.value.replace(/\D/g, ""))} /></div></Row>
        <Row label="Max principal"><div className="flex items-center gap-1.5 rounded-lg border border-zinc-900/15 bg-white/80 px-3"><span className="text-xs text-zinc-400">KES</span><input className="w-full bg-transparent py-2.5 text-sm outline-none" inputMode="numeric" value={f.maxPrincipal} onChange={(e) => set("maxPrincipal")(e.target.value.replace(/\D/g, ""))} /></div></Row>
        <Row label="Min loan limit" hint="floor"><div className="flex items-center gap-1.5 rounded-lg border border-zinc-900/15 bg-white/80 px-3"><span className="text-xs text-zinc-400">KES</span><input className="w-full bg-transparent py-2.5 text-sm outline-none" inputMode="numeric" placeholder="none" value={f.minLoanLimit} onChange={(e) => set("minLoanLimit")(e.target.value.replace(/\D/g, ""))} /></div></Row>
      </div>
      <p className="text-[11px] text-zinc-400">The limit engine will not book below the minimum loan limit even when a thin cashflow supports less — below it, there is no loan.</p>
    </>
  );
}

function InterestStep({ f, set }: { f: Form; set: SetFn }) {
  return (
    <>
      <Row label="Interest type">
        <Pills value={f.interestType} onChange={set("interestType")}
          options={[
            { v: "fixed", label: "Fixed", sub: "The rate never moves" },
            { v: "variable", label: "Variable", sub: "Repriced on rollover / reschedule" },
          ]} />
      </Row>
      <Row label="Interest method">
        <Pills value={f.interestMethod} onChange={set("interestMethod")}
          options={[
            { v: "flat", label: "Flat", sub: "On the original principal — equal installments" },
            { v: "reducing", label: "Reducing balance", sub: "On the declining balance" },
          ]} />
      </Row>
      <div className="grid gap-3 sm:grid-cols-2">
        <Row label="Interest rate" hint="% for the whole term"><div className="flex items-center gap-1.5 rounded-lg border border-zinc-900/15 bg-white/80 px-3"><input className="w-full bg-transparent py-2.5 text-sm outline-none" inputMode="decimal" value={f.interestRate} onChange={(e) => set("interestRate")(e.target.value.replace(/[^0-9.]/g, ""))} /><span className="text-xs text-zinc-400">%</span></div></Row>
        <Row label="Rate is quoted per">
          <select className={`${FIELD} appearance-none`} value={f.interestPeriodUnit} onChange={(e) => set("interestPeriodUnit")(e.target.value)}>
            <option value="term">Whole term</option><option value="month">Month</option><option value="week">Week</option><option value="day">Day</option>
          </select>
        </Row>
      </div>
      <Toggle label="Early-settlement rebate" hint="Reward a borrower who clears early" value={f.earlySettlementEnabled} onChange={set("earlySettlementEnabled")} />
      {f.earlySettlementEnabled && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Row label="Within (days of disbursement)"><input className={FIELD} inputMode="numeric" placeholder="e.g. 30" value={f.earlySettlementDays} onChange={(e) => set("earlySettlementDays")(e.target.value.replace(/\D/g, ""))} /></Row>
          <Row label="Interest waived" hint="% of outstanding interest"><div className="flex items-center gap-1.5 rounded-lg border border-zinc-900/15 bg-white/80 px-3"><input className="w-full bg-transparent py-2.5 text-sm outline-none" inputMode="decimal" placeholder="e.g. 50" value={f.earlySettlementRate} onChange={(e) => set("earlySettlementRate")(e.target.value.replace(/[^0-9.]/g, ""))} /><span className="text-xs text-zinc-400">%</span></div></Row>
        </div>
      )}
    </>
  );
}

function RepaymentStep({ f, set }: { f: Form; set: SetFn }) {
  const orders = [
    { v: "penalty,interest,principal,fees", label: "Penalty → Interest → Principal → Fees" },
    { v: "fees,penalty,interest,principal", label: "Fees → Penalty → Interest → Principal" },
    { v: "interest,principal,penalty,fees", label: "Interest → Principal → Penalty → Fees" },
    { v: "principal,interest,penalty,fees", label: "Principal → Interest → Penalty → Fees" },
  ];
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Row label="Installments"><input className={FIELD} inputMode="numeric" value={f.repaymentPeriod} onChange={(e) => set("repaymentPeriod")(e.target.value.replace(/\D/g, ""))} /></Row>
        <Row label="Every">
          <select className={`${FIELD} appearance-none`} value={f.repaymentPeriodUnit} onChange={(e) => set("repaymentPeriodUnit")(e.target.value)}>
            <option value="day">Day</option><option value="week">Week</option><option value="month">Month</option>
          </select>
        </Row>
        <Row label="Grace days"><input className={FIELD} inputMode="numeric" value={f.gracePeriodDays} onChange={(e) => set("gracePeriodDays")(e.target.value.replace(/\D/g, ""))} /></Row>
      </div>
      <Row label="Penalty rate" hint="% on an overdue installment"><div className="flex items-center gap-1.5 rounded-lg border border-zinc-900/15 bg-white/80 px-3"><input className="w-full bg-transparent py-2.5 text-sm outline-none" inputMode="decimal" placeholder="e.g. 5" value={f.penaltyRate} onChange={(e) => set("penaltyRate")(e.target.value.replace(/[^0-9.]/g, ""))} /><span className="text-xs text-zinc-400">%</span></div></Row>
      <Row label="Repayment order" hint="how a payment is applied, most-senior first">
        <select className={`${FIELD} appearance-none`} value={f.repaymentOrder} onChange={(e) => set("repaymentOrder")(e.target.value)}>
          {orders.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
        </select>
      </Row>
    </>
  );
}

function RequirementsStep({ f, set }: { f: Form; set: SetFn }) {
  return (
    <>
      <Row label="Minimum credit score" hint="optional — leave empty for none"><input className={FIELD} inputMode="numeric" placeholder="e.g. 500" value={f.minCreditScore} onChange={(e) => set("minCreditScore")(e.target.value.replace(/\D/g, "").slice(0, 3))} /></Row>
      <Toggle label="Guarantor required" hint="A loan on this product cannot book without a guarantor" value={f.guarantorRequired} onChange={set("guarantorRequired")} />
      {f.guarantorRequired && (
        <Toggle label="Guarantor may re-borrow" hint="May someone standing as a guarantor also take their own loan here?" value={f.guarantorReborrow} onChange={set("guarantorReborrow")} />
      )}
      <Toggle label="Security required" hint="Collateral must be pledged and verified before booking" value={f.securityRequired} onChange={set("securityRequired")} />
      {f.securityRequired && (
        <Row label="Security cover" hint="% of principal the collateral must cover"><div className="flex items-center gap-1.5 rounded-lg border border-zinc-900/15 bg-white/80 px-3"><input className="w-full bg-transparent py-2.5 text-sm outline-none" inputMode="numeric" value={f.securityCoverPct} onChange={(e) => set("securityCoverPct")(e.target.value.replace(/\D/g, ""))} /><span className="text-xs text-zinc-400">%</span></div></Row>
      )}
    </>
  );
}

function WorkflowStep({ f, set, workflows }: { f: Form; set: SetFn; workflows: { id: string; title: string }[] }) {
  return (
    <>
      <Row label="Disburse via">
        <select className={`${FIELD} appearance-none`} value={f.disbursementMode} onChange={(e) => set("disbursementMode")(e.target.value)}>
          <option value="B2C_MPESA">M-Pesa B2C</option>
          <option value="MANUAL">Manual (record reference)</option>
          <option value="TO_THIRD_PARTY">Third party (e.g. school)</option>
        </select>
      </Row>
      <Row label="New-loan approval workflow" hint="first loan on this product">
        <select className={`${FIELD} appearance-none`} value={f.newWorkflowId} onChange={(e) => set("newWorkflowId")(e.target.value)}>
          <option value="">Default (two-tier: Officer → Final)</option>
          {workflows.map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}
        </select>
      </Row>
      <Row label="Repeat-loan approval workflow" hint="returning borrowers">
        <select className={`${FIELD} appearance-none`} value={f.repeatWorkflowId} onChange={(e) => set("repeatWorkflowId")(e.target.value)}>
          <option value="">Same as new-loan workflow</option>
          {workflows.map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}
        </select>
      </Row>
      <p className="text-[11px] text-zinc-400">Choosing the workflow here — per product, not per organisation — is what lets a small top-up run a light approval while a large secured loan runs the full chain.</p>
    </>
  );
}

function ReviewStep({ f, workflows }: { f: Form; workflows: { id: string; title: string }[] }) {
  const wf = (id: string) => workflows.find((w) => w.id === id)?.title ?? "Default two-tier";
  const line = (label: string, value: string) => (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <span className="text-zinc-500">{label}</span>
      <span className="text-right font-medium text-zinc-800">{value}</span>
    </div>
  );
  return (
    <div className="rounded-xl border border-zinc-900/10 bg-white/60 px-4 divide-y divide-zinc-900/5">
      {line("Name", f.name || "—")}
      {line("Amount", `${fmtKES(f.minPrincipal)} – ${fmtKES(f.maxPrincipal)}${f.minLoanLimit ? ` · floor ${fmtKES(f.minLoanLimit)}` : ""}`)}
      {line("Interest", `${f.interestRate}% ${f.interestMethod} · ${f.interestType} · per ${f.interestPeriodUnit}`)}
      {line("Repayment", `${f.repaymentPeriod} × ${f.repaymentPeriodUnit} · ${f.gracePeriodDays} grace day(s)${f.penaltyRate ? ` · ${f.penaltyRate}% penalty` : ""}`)}
      {f.earlySettlementEnabled && line("Early settlement", `${f.earlySettlementRate || 0}% waived within ${f.earlySettlementDays || 0} days`)}
      {line("Requirements", [f.guarantorRequired && "Guarantor", f.securityRequired && `Security ${f.securityCoverPct}%`, f.minCreditScore && `Score ≥ ${f.minCreditScore}`].filter(Boolean).join(" · ") || "None")}
      {line("Disbursement", f.disbursementMode.replace(/_/g, " "))}
      <div className="py-1.5 text-sm">
        <div className="flex items-center gap-1.5 text-zinc-500"><GitBranch className="h-3.5 w-3.5" /> Workflows</div>
        <div className="mt-1 flex items-center gap-1.5 text-[13px] text-zinc-700"><span className="rounded bg-zinc-900/5 px-1.5 py-0.5 text-[10px] font-semibold">NEW</span> {wf(f.newWorkflowId)} <ChevronRight className="h-3 w-3 text-zinc-300" /> <Coins className="h-3 w-3 text-zinc-400" /></div>
        <div className="mt-1 flex items-center gap-1.5 text-[13px] text-zinc-700"><span className="rounded bg-zinc-900/5 px-1.5 py-0.5 text-[10px] font-semibold">REPEAT</span> {f.repeatWorkflowId ? wf(f.repeatWorkflowId) : wf(f.newWorkflowId)}</div>
      </div>
    </div>
  );
}
