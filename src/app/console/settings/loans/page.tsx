"use client";

// ─────────────────────────────────────────────────────────────────────────────
// LOAN SETTINGS — everything that happens to a loan AFTER it books.
//
// Origination already had a home: the credit policy decides who borrows and the
// product decides on what terms. What had none was the other half of a lending
// business — the day a customer cannot pay, wants more, wants longer, or wants out.
//
// The system we are replacing spends seven screens, seven tables and seven MERGE
// statements on this, and between them they hold almost no policy: five of the
// seven store nothing but an approval-workflow id. That is the tell. "Who signs it
// off" is not a restructure policy. A restructure policy is whether it may happen,
// how often, how far into a loan, what may move, what it costs, whether arrears
// must clear first, and what the schedule does afterwards. None of that exists
// there, so it lives in each branch's habits.
//
// Twelve sections, one document, one Publish — the same contract as the credit
// policy and borrower settings, so an admin who has used one already knows this.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Landmark, Loader2, AlertTriangle, CheckCircle2, ArrowLeft, History, RotateCcw, Save,
  Calculator, CalendarClock, TrendingUp, HandCoins, FileX2, RefreshCw, Timer,
  Layers, Scale, Banknote, Receipt, Percent, Plus, Trash2,
} from "lucide-react";
import { useLoad } from "@/lib/hooks/useLoad";
import {
  Toggle, SwitchRow, Choice, RuleBlock, NumberField, TextField, SelectField, Divider, SliderField, INPUT,
} from "@/components/settings/controls";
import {
  mergeLoansConfig, validateLoansConfig, type LoansConfig,
} from "@/lib/config/loans";
import type { ConfigIssue } from "@/lib/config/borrower";

type Revision = { version: number; changed: string[]; createdAt: string };
type Workflow = { id: string; title: string; kind: string };

const SECTIONS = [
  { key: "calculator", label: "Calculator", icon: Calculator, blurb: "What staff may quote, and what a quote is worth." },
  { key: "restructure", label: "Restructure", icon: CalendarClock, blurb: "Rescheduling a live loan — whether, how often, and at what cost." },
  { key: "topup", label: "Top-up", icon: TrendingUp, blurb: "Lending more on a loan that is already running." },
  { key: "waiver", label: "Waivers", icon: HandCoins, blurb: "Forgiving penalty, interest or fees — and the ceiling on doing so." },
  { key: "writeoff", label: "Write-offs", icon: FileX2, blurb: "Taking a loss, deliberately, and what follows." },
  { key: "redisbursement", label: "Redisbursement", icon: RefreshCw, blurb: "Re-releasing money that came back." },
  { key: "earlySettlement", label: "Early settlement", icon: Timer, blurb: "Paying it off early, and what that earns." },
  { key: "penalty", label: "Penalties", icon: Percent, blurb: "What arrears cost, and when they stop costing." },
  { key: "arrears", label: "Arrears buckets", icon: Layers, blurb: "The ageing every report, queue and provision rate is keyed to." },
  { key: "reconciliation", label: "Reconciliation", icon: Scale, blurb: "What an unmatched payment is allowed to do." },
  { key: "disbursement", label: "Payouts", icon: Banknote, blurb: "The controls on money leaving." },
  { key: "statement", label: "Statements", icon: Receipt, blurb: "What the customer sees." },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

/** Which workflow kind each gated action should offer. */
const FLOW_KIND: Partial<Record<SectionKey, string>> = {
  restructure: "RESTRUCTURE",
  topup: "TOPUP",
  waiver: "WAIVER",
  writeoff: "WRITEOFF",
  redisbursement: "REDISBURSEMENT",
};

export default function LoanSettings() {
  const [cfg, setCfg] = useState<LoansConfig | null>(null);
  const [saved, setSaved] = useState<LoansConfig | null>(null);
  const [version, setVersion] = useState(0);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [section, setSection] = useState<SectionKey>("restructure");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [issues, setIssues] = useState<ConfigIssue[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);

  const load = async () => {
    try {
      const [cRes, wRes] = await Promise.all([
        fetch("/api/config/loans"),
        fetch("/api/console/workflows").catch(() => null),
      ]);
      const data = await cRes.json();
      if (!data.success) { setError(data.message || "Could not load loan settings."); return; }
      const merged = mergeLoansConfig(data.value);
      setCfg(merged); setSaved(merged); setVersion(data.version);
      setRevisions(data.history ?? []); setError(null);

      const w = wRes ? await wRes.json().catch(() => null) : null;
      if (w?.success) {
        setWorkflows(w.workflows
          .filter((x: { isActive?: boolean }) => x.isActive !== false)
          .map((x: Workflow) => ({ id: x.id, title: x.title, kind: x.kind })));
      }
    } catch { setError("Could not load loan settings."); }
  };
  useLoad(load);

  const dirty = useMemo(
    () => Boolean(cfg && saved && JSON.stringify(cfg) !== JSON.stringify(saved)),
    [cfg, saved],
  );
  const liveIssues = useMemo(() => (cfg ? validateLoansConfig(cfg) : []), [cfg]);
  const issueFor = (prefix: string) =>
    [...issues, ...liveIssues].find((i) => i.path === prefix || i.path.startsWith(`${prefix}.`))?.message ?? null;

  const save = async () => {
    if (!cfg) return;
    setBusy(true); setError(null); setNotice(null); setIssues([]);
    try {
      const res = await fetch("/api/config/loans", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: cfg }),
      });
      const data = await res.json();
      if (res.status === 422) { setIssues(data.issues ?? []); setError(data.message); return; }
      if (!data.success) { setError(data.message || "Could not save."); return; }
      const merged = mergeLoansConfig(data.value);
      setCfg(merged); setSaved(merged); setVersion(data.version);
      setNotice(`Published as version ${data.version} — every loan action from here uses it.`);
      const fresh = await fetch("/api/config/loans").then((r) => r.json()).catch(() => null);
      if (fresh?.success) setRevisions(fresh.history ?? []);
    } catch { setError("Could not save."); } finally { setBusy(false); }
  };

  if (error && !cfg) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <p className="flex items-start gap-2 rounded-xl bg-red-500/10 px-3 py-2.5 text-sm text-red-800 ring-1 ring-red-600/20">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      </main>
    );
  }
  if (!cfg) {
    return <main className="flex justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-[color:var(--ink-faint)]" /></main>;
  }

  const Active = SECTIONS.find((s) => s.key === section)!;
  const set = <K extends keyof LoansConfig>(key: K, value: LoansConfig[K]) =>
    setCfg((c) => (c ? { ...c, [key]: value } : c));

  /** The workflow picker for one gated action, narrowed to the right kind. */
  const flowPicker = (key: SectionKey, current: string | null, onChange: (id: string | null) => void) => {
    const kind = FLOW_KIND[key];
    const list = workflows.filter((w) => w.kind === kind);
    return (
      <div>
        <SelectField
          label="Approval workflow"
          value={current ?? ""}
          onChange={(v) => onChange(v || null)}
          options={[
            { value: "", label: list.length ? "No approval — it happens immediately" : `No ${kind?.toLowerCase()} workflows yet` },
            ...list.map((w) => ({ value: w.id, label: w.title })),
          ]}
          help="Who signs this off. Leave empty and it takes effect the moment a person with the right asks for it."
        />
        {list.length === 0 && (
          <p className="t-meta mt-1 text-[11px]">
            <Link href="/console/workflows/new" className="font-semibold underline">Build one</Link> if this needs a second pair of eyes.
          </p>
        )}
      </div>
    );
  };

  return (
    <main className="mx-auto max-w-[92rem] px-4 pb-24 pt-6 sm:px-6 sm:pt-8">
      <Link href="/console/settings" className="t-meta inline-flex items-center gap-1.5 text-[12px] hover:text-[color:var(--ink)]">
        <ArrowLeft className="h-3.5 w-3.5" /> Settings &amp; Vault
      </Link>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="t-display flex items-center gap-2 text-[1.6rem]">
            <Landmark className="h-6 w-6" style={{ color: "var(--brand)" }} /> Loan settings
          </h1>
          <p className="t-meta mt-1 max-w-2xl">
            Everything that happens to a loan after it books — the day a customer cannot
            pay, wants more, wants longer, or wants out. One versioned document; every
            after-book action reads it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowHistory((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-[color:var(--ink-muted)] ring-1 ring-[color:var(--ink)]/10 hover:text-[color:var(--ink)]">
            <History className="h-3.5 w-3.5" /> {version > 0 ? `v${version}` : "Defaults"}
          </button>
          {dirty && (
            <button type="button" onClick={() => { setCfg(saved); setIssues([]); }}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-[color:var(--ink-muted)] hover:text-[color:var(--ink)]">
              <RotateCcw className="h-3.5 w-3.5" /> Discard
            </button>
          )}
          <button type="button" onClick={save} disabled={busy || !dirty || liveIssues.length > 0}
            title={liveIssues.length > 0 ? "Resolve the highlighted problems first." : undefined}
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
            style={{ backgroundColor: "var(--brand)" }}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {dirty ? "Publish changes" : "Saved"}
          </button>
        </div>
      </div>

      {notice && (
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-800 ring-1 ring-emerald-600/20">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {notice}
        </div>
      )}
      {(error || liveIssues.length > 0) && (
        <div className="mt-4 rounded-xl bg-amber-500/10 px-3 py-2.5 text-sm text-amber-900 ring-1 ring-amber-600/20">
          <p className="flex items-start gap-2 font-semibold">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error ?? "These settings would not hold together."}
          </p>
          <ul className="mt-1.5 space-y-0.5 pl-6 text-[12px]">
            {[...new Map([...issues, ...liveIssues].map((i) => [i.path + i.message, i])).values()].map((i) => (
              <li key={i.path + i.message} className="list-disc">{i.message}</li>
            ))}
          </ul>
        </div>
      )}

      {showHistory && (
        <div className="glass mt-4 p-4">
          <p className="t-label">Published versions</p>
          {revisions.length === 0 ? (
            <p className="t-meta mt-2 text-[12px]">Nothing published — you are looking at the platform defaults.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {revisions.map((r) => (
                <li key={r.version} className="flex items-center justify-between gap-3 text-[12px]">
                  <span className="font-semibold text-[color:var(--ink)]">v{r.version}</span>
                  <span className="t-meta flex-1 truncate text-[11px]">
                    {(r.changed ?? []).length ? `changed: ${r.changed.join(", ")}` : "initial"}
                  </span>
                  <span className="t-meta shrink-0 text-[11px]">
                    {new Date(r.createdAt).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
          {SECTIONS.map((s) => {
            const on = s.key === section;
            const problem = Boolean(issueFor(s.key));
            // An action switched off is worth showing as such — a lender scanning the
            // rail should see what their business does and does not permit.
            const block = cfg[s.key] as { enabled?: boolean };
            const off = typeof block?.enabled === "boolean" && !block.enabled;
            return (
              <button key={s.key} type="button" onClick={() => setSection(s.key)}
                className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-colors lg:w-full ${
                  on ? "text-white" : "text-[color:var(--ink-body)] hover:bg-[color:var(--ink)]/[0.04]"
                }`}
                style={on ? { backgroundColor: "var(--brand)" } : undefined}>
                <s.icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold">{s.label}</span>
                  {off && (
                    <span className={`hidden truncate text-[10.5px] lg:block ${on ? "text-white/70" : "text-[color:var(--ink-faint)]"}`}>
                      Not permitted
                    </span>
                  )}
                </span>
                {problem && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: on ? "rgba(255,255,255,0.9)" : "#d97706" }} aria-label="Needs attention" />
                )}
              </button>
            );
          })}
        </nav>

        <section className="glass p-4 sm:p-5">
          <div className="mb-4 border-b border-[color:var(--ink)]/[0.07] pb-3">
            <h2 className="t-display text-[1.05rem]">{Active.label}</h2>
            <p className="t-meta mt-0.5 text-[12px]">{Active.blurb}</p>
          </div>

          {/* ── Calculator ── */}
          {section === "calculator" && (
            <div className="space-y-4">
              <SwitchRow title="Quote without an applicant" desc="Staff may price a loan for somebody standing at the counter before any application exists."
                checked={cfg.calculator.enabled} onChange={(v) => set("calculator", { ...cfg.calculator, enabled: v })} />
              <SwitchRow title="Show the total cost" desc="Not just the instalment — what the loan costs in full."
                checked={cfg.calculator.showTotalCost} onChange={(v) => set("calculator", { ...cfg.calculator, showTotalCost: v })} />
              <SwitchRow title="Show the effective annual rate" desc="Cost of credit against what the customer actually receives, annualised. The figure a regulator asks for."
                checked={cfg.calculator.showEffectiveRate} onChange={(v) => set("calculator", { ...cfg.calculator, showEffectiveRate: v })} />
              <SwitchRow title="Include charges in the quote" desc="Off means the customer is surprised at disbursement."
                checked={cfg.calculator.includeCharges} onChange={(v) => set("calculator", { ...cfg.calculator, includeCharges: v })} />
              <SwitchRow title="Any term inside the product's range" desc="A quote may pick a shorter term than the product's default, where the product allows it."
                checked={cfg.calculator.allowCustomTerm} onChange={(v) => set("calculator", { ...cfg.calculator, allowCustomTerm: v })} />
              <RuleBlock title="Quotes can be saved and sent" desc="A quote becomes a document the customer can accept, rather than a number said out loud."
                checked={cfg.calculator.allowSaveQuote} onChange={(v) => set("calculator", { ...cfg.calculator, allowSaveQuote: v })}>
                <NumberField label="Quote expires after" suffix="days" min={0} max={365}
                  value={cfg.calculator.quoteExpiryDays}
                  onChange={(v) => set("calculator", { ...cfg.calculator, quoteExpiryDays: v })}
                  help="After this the price has to be re-derived. 0 = never expires, which is how a customer arrives holding last quarter's rate." />
              </RuleBlock>
            </div>
          )}

          {/* ── Restructure ── */}
          {section === "restructure" && (
            <RuleBlock title="Allow restructuring" desc="A live loan's schedule may be rebuilt around what the customer can actually pay."
              checked={cfg.restructure.enabled} onChange={(v) => set("restructure", { ...cfg.restructure, enabled: v })}>
              <div className="space-y-4">
                <div>
                  <p className="t-label mb-2">What may change</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {([
                      ["term", "The term", "More instalments, smaller each."],
                      ["instalment", "The instalment", "A different amount per period."],
                      ["startDate", "The start date", "Shift the whole schedule."],
                      ["rate", "The rate", "Reprice it. The most consequential, and rarely right."],
                    ] as const).map(([k, label, hint]) => (
                      <label key={k} className="flex items-start justify-between gap-3 rounded-xl px-3 py-2.5 ring-1 ring-[color:var(--ink)]/[0.07]">
                        <span className="min-w-0">
                          <span className="text-[13px] font-semibold text-[color:var(--ink)]">{label}</span>
                          <span className="t-meta block text-[11px] leading-snug">{hint}</span>
                        </span>
                        <Toggle label={label} checked={cfg.restructure.allow[k]}
                          onChange={(v) => set("restructure", { ...cfg.restructure, allow: { ...cfg.restructure.allow, [k]: v } })} />
                      </label>
                    ))}
                  </div>
                </div>

                <Divider label="What it costs" />
                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectField label="Fee type" value={cfg.restructure.fee.type}
                    onChange={(v) => set("restructure", { ...cfg.restructure, fee: { ...cfg.restructure.fee, type: v as "percent" | "fixed" } })}
                    options={[{ value: "fixed", label: "Fixed amount" }, { value: "percent", label: "Percentage of the balance" }]} />
                  <NumberField label={cfg.restructure.fee.type === "percent" ? "Fee" : "Fee (KES)"}
                    suffix={cfg.restructure.fee.type === "percent" ? "%" : undefined} min={0}
                    value={cfg.restructure.fee.value}
                    onChange={(v) => set("restructure", { ...cfg.restructure, fee: { ...cfg.restructure.fee, value: v } })} />
                </div>

                <Divider label="When it is allowed" />
                <div className="grid gap-4 sm:grid-cols-3">
                  <NumberField label="Times per loan" min={0} max={20} value={cfg.restructure.maxTimes}
                    onChange={(v) => set("restructure", { ...cfg.restructure, maxTimes: v })}
                    help="0 = no limit. A loan restructured four times is a loss nobody has recognised yet." />
                  <NumberField label="Not before" suffix="days" min={0}
                    value={cfg.restructure.minDaysIntoLoan}
                    onChange={(v) => set("restructure", { ...cfg.restructure, minDaysIntoLoan: v })}
                    help="Days into the loan." />
                  <NumberField label="Extend by at most" suffix="days" min={0}
                    value={cfg.restructure.maxExtensionDays}
                    onChange={(v) => set("restructure", { ...cfg.restructure, maxExtensionDays: v })}
                    help="Past the original maturity." />
                </div>

                <SwitchRow title="Arrears must be cleared first" desc="The customer settles what is overdue before the schedule is rebuilt."
                  checked={cfg.restructure.requireArrearsCleared}
                  onChange={(v) => set("restructure", { ...cfg.restructure, requireArrearsCleared: v })} />
                <SwitchRow title="Drop accrued penalties" desc="Restructuring wipes the penalties that built up. Generous, and often the only way a customer comes back."
                  checked={cfg.restructure.waivePenaltyOnRestructure}
                  onChange={(v) => set("restructure", { ...cfg.restructure, waivePenaltyOnRestructure: v })} />
                <SwitchRow title="A reason is required" desc="Whoever asks has to say why. This is the field an audit reads first."
                  checked={cfg.restructure.requireReason}
                  onChange={(v) => set("restructure", { ...cfg.restructure, requireReason: v })} />

                <Divider label="Approval" />
                {flowPicker("restructure", cfg.restructure.workflowId, (id) => set("restructure", { ...cfg.restructure, workflowId: id }))}
                {issueFor("restructure") && (
                  <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11.5px] text-amber-900 ring-1 ring-amber-600/20">
                    <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" /> {issueFor("restructure")}
                  </p>
                )}
              </div>
            </RuleBlock>
          )}

          {/* ── Top-up ── */}
          {section === "topup" && (
            <RuleBlock title="Allow top-ups" desc="A customer part-way through a loan may borrow more without clearing it first."
              checked={cfg.topup.enabled} onChange={(v) => set("topup", { ...cfg.topup, enabled: v })}>
              <div className="space-y-4">
                <SliderField label="Must have repaid at least" value={cfg.topup.minPercentPaid}
                  min={0} max={95} step={5} format={(v) => `${v}%`}
                  onChange={(v) => set("topup", { ...cfg.topup, minPercentPaid: v })}
                  help="Of the running loan. Below this they are asking to borrow against nothing they have proved." />

                <div className="grid gap-4 sm:grid-cols-2">
                  <NumberField label="Most they may add" money min={0} value={cfg.topup.maxTopUpAmount}
                    onChange={(v) => set("topup", { ...cfg.topup, maxTopUpAmount: v })}
                    help="0 = their borrower limit is the only ceiling." />
                  <NumberField label="Quote expires after" suffix="days" min={0} max={365}
                    value={cfg.topup.quoteExpiryDays}
                    onChange={(v) => set("topup", { ...cfg.topup, quoteExpiryDays: v })} />
                </div>

                <Choice label="How the two loans meet" value={cfg.topup.settlementMode}
                  onChange={(v) => set("topup", { ...cfg.topup, settlementMode: v as LoansConfig["topup"]["settlementMode"] })}
                  cols={2}
                  options={[
                    { value: "settle_and_reissue", label: "Settle and reissue", hint: "The running loan is cleared from the new principal and one clean loan replaces it." },
                    { value: "parallel", label: "Side by side", hint: "Two live loans. Simpler to book, and twice as much to collect." },
                  ]} />

                <SwitchRow title="Stay inside the borrower's limit" desc="Total exposure after the top-up must still fit their ceiling."
                  checked={cfg.topup.respectBorrowerLimit}
                  onChange={(v) => set("topup", { ...cfg.topup, respectBorrowerLimit: v })} />
                <SwitchRow title="Not while in arrears" desc="A customer who is late does not get more money."
                  checked={cfg.topup.blockIfInArrears}
                  onChange={(v) => set("topup", { ...cfg.topup, blockIfInArrears: v })} />

                <Divider label="Approval" />
                {flowPicker("topup", cfg.topup.workflowId, (id) => set("topup", { ...cfg.topup, workflowId: id }))}
                {issueFor("topup") && (
                  <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11.5px] text-amber-900 ring-1 ring-amber-600/20">
                    <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" /> {issueFor("topup")}
                  </p>
                )}
              </div>
            </RuleBlock>
          )}

          {/* ── Waivers ── */}
          {section === "waiver" && (
            <RuleBlock title="Allow waivers" desc="Staff may forgive part of what is owed."
              checked={cfg.waiver.enabled} onChange={(v) => set("waiver", { ...cfg.waiver, enabled: v })}>
              <div className="space-y-4">
                <div>
                  <p className="t-label mb-2">What may be forgiven</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {([
                      ["penalty", "Penalties", "What lateness cost. The usual waiver, and the cheapest."],
                      ["interest", "Interest", "The price of the loan. Forgiving it is forgiving your margin."],
                      ["fees", "Fees", "Processing, CRB, whatever else was charged."],
                      ["principal", "Principal", "The money itself. This is a write-off wearing a smaller word."],
                    ] as const).map(([k, label, hint]) => (
                      <label key={k} className="flex items-start justify-between gap-3 rounded-xl px-3 py-2.5 ring-1 ring-[color:var(--ink)]/[0.07]">
                        <span className="min-w-0">
                          <span className="text-[13px] font-semibold text-[color:var(--ink)]">{label}</span>
                          <span className="t-meta block text-[11px] leading-snug">{hint}</span>
                        </span>
                        <Toggle label={label} checked={cfg.waiver.allow[k]}
                          onChange={(v) => set("waiver", { ...cfg.waiver, allow: { ...cfg.waiver.allow, [k]: v } })} />
                      </label>
                    ))}
                  </div>
                </div>

                <Divider label="The ceiling" />
                <div className="grid gap-4 sm:grid-cols-3">
                  <NumberField label="Most one waiver may forgive" money min={0} value={cfg.waiver.maxAmount}
                    onChange={(v) => set("waiver", { ...cfg.waiver, maxAmount: v })} help="0 = no cap." />
                  <NumberField label="…or this share of the balance" suffix="%" min={0} max={100}
                    value={cfg.waiver.maxPercent}
                    onChange={(v) => set("waiver", { ...cfg.waiver, maxPercent: v })} help="0 = no cap." />
                  <NumberField label="Second approver above" money min={0} value={cfg.waiver.dualApprovalAbove}
                    onChange={(v) => set("waiver", { ...cfg.waiver, dualApprovalAbove: v })}
                    help="Whatever the workflow says, above this it takes two. 0 = never." />
                </div>

                <SwitchRow title="A reason is required" desc="Every waiver says why, in words, on the record."
                  checked={cfg.waiver.requireReason} onChange={(v) => set("waiver", { ...cfg.waiver, requireReason: v })} />

                <Divider label="Approval" />
                {flowPicker("waiver", cfg.waiver.workflowId, (id) => set("waiver", { ...cfg.waiver, workflowId: id }))}
                {issueFor("waiver") && (
                  <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11.5px] text-amber-900 ring-1 ring-amber-600/20">
                    <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" /> {issueFor("waiver")}
                  </p>
                )}
              </div>
            </RuleBlock>
          )}

          {/* ── Write-offs ── */}
          {section === "writeoff" && (
            <RuleBlock title="Allow write-offs" desc="A loan may be recognised as a loss and taken off the performing book."
              checked={cfg.writeoff.enabled} onChange={(v) => set("writeoff", { ...cfg.writeoff, enabled: v })}>
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <NumberField label="Not before" suffix="days in arrears" min={0} max={3650}
                    value={cfg.writeoff.afterArrearsDays}
                    onChange={(v) => set("writeoff", { ...cfg.writeoff, afterArrearsDays: v })}
                    help="A loan written off before it is even non-performing is a decision nobody has justified." />
                  <NumberField label="Up to" money min={0} value={cfg.writeoff.maxAmount}
                    onChange={(v) => set("writeoff", { ...cfg.writeoff, maxAmount: v })}
                    help="0 = any exposure." />
                </div>

                <SwitchRow title="Bar the customer from new lending" desc="A written-off borrower goes on the internal blacklist."
                  checked={cfg.writeoff.blacklistBorrower}
                  onChange={(v) => set("writeoff", { ...cfg.writeoff, blacklistBorrower: v })} />
                <SwitchRow title="Still post recoveries" desc="Money that arrives after a write-off is credited against the loan rather than refused. Almost always right."
                  checked={cfg.writeoff.allowRecovery}
                  onChange={(v) => set("writeoff", { ...cfg.writeoff, allowRecovery: v })} />
                <SwitchRow title="A reason is required" desc="What was tried, and why it stopped."
                  checked={cfg.writeoff.requireReason}
                  onChange={(v) => set("writeoff", { ...cfg.writeoff, requireReason: v })} />

                <Divider label="Approval" />
                {flowPicker("writeoff", cfg.writeoff.workflowId, (id) => set("writeoff", { ...cfg.writeoff, workflowId: id }))}
                {issueFor("writeoff") && (
                  <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11.5px] text-amber-900 ring-1 ring-amber-600/20">
                    <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" /> {issueFor("writeoff")}
                  </p>
                )}
              </div>
            </RuleBlock>
          )}

          {/* ── Redisbursement ── */}
          {section === "redisbursement" && (
            <RuleBlock title="Allow redisbursement" desc="Money that bounced back — a wrong number, a closed till, a reversal — may be released again without a new application."
              checked={cfg.redisbursement.enabled} onChange={(v) => set("redisbursement", { ...cfg.redisbursement, enabled: v })}>
              <div className="space-y-4">
                <NumberField label="Within" suffix="days" min={0} max={365}
                  value={cfg.redisbursement.withinDays}
                  onChange={(v) => set("redisbursement", { ...cfg.redisbursement, withinDays: v })}
                  help="After this the customer applies again — their circumstances have had time to change." />
                <SwitchRow title="Same product, same terms" desc="Off would let a returned payout be re-released on different terms, which is a new loan wearing an old reference."
                  checked={cfg.redisbursement.sameTermsOnly}
                  onChange={(v) => set("redisbursement", { ...cfg.redisbursement, sameTermsOnly: v })} />
                <Divider label="Approval" />
                {flowPicker("redisbursement", cfg.redisbursement.workflowId, (id) => set("redisbursement", { ...cfg.redisbursement, workflowId: id }))}
              </div>
            </RuleBlock>
          )}

          {/* ── Early settlement ── */}
          {section === "earlySettlement" && (
            <RuleBlock title="Reward settling early" desc="A borrower who clears the loan ahead of time gets part of the unearned interest back."
              checked={cfg.earlySettlement.enabled} onChange={(v) => set("earlySettlement", { ...cfg.earlySettlement, enabled: v })}>
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <NumberField label="Qualifying window" suffix="days" min={0}
                    value={cfg.earlySettlement.withinDays}
                    onChange={(v) => set("earlySettlement", { ...cfg.earlySettlement, withinDays: v })}
                    help="From disbursement. 0 = any time before maturity." />
                  <SliderField label="Rebate" value={cfg.earlySettlement.rebatePct} min={0} max={100} step={5}
                    format={(v) => `${v}%`}
                    onChange={(v) => set("earlySettlement", { ...cfg.earlySettlement, rebatePct: v })}
                    help="Of the interest not yet earned." />
                </div>
                <SwitchRow title="Drop accrued penalties too" desc="Somebody clearing a late loan in full is doing the thing you want."
                  checked={cfg.earlySettlement.waivePenalty}
                  onChange={(v) => set("earlySettlement", { ...cfg.earlySettlement, waivePenalty: v })} />
                <SwitchRow title="Outstanding fees still fall due" desc="A processing fee was earned when the loan was made, not when it was repaid."
                  checked={cfg.earlySettlement.chargeOutstandingFees}
                  onChange={(v) => set("earlySettlement", { ...cfg.earlySettlement, chargeOutstandingFees: v })} />
                <SwitchRow title="A product may set its own" desc="Off makes this document the only word on early settlement, whatever a product says."
                  checked={cfg.earlySettlement.allowProductOverride}
                  onChange={(v) => set("earlySettlement", { ...cfg.earlySettlement, allowProductOverride: v })} />
              </div>
            </RuleBlock>
          )}

          {/* ── Penalties ── */}
          {section === "penalty" && (
            <RuleBlock title="Charge for arrears" desc="What being late costs a borrower."
              checked={cfg.penalty.enabled} onChange={(v) => set("penalty", { ...cfg.penalty, enabled: v })}>
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <NumberField label="Grace" suffix="days" min={0} max={365} value={cfg.penalty.graceDays}
                    onChange={(v) => set("penalty", { ...cfg.penalty, graceDays: v })}
                    help="Late by less than this costs nothing." />
                  <NumberField label="Rate" suffix="%" min={0} max={100} step={0.5} value={cfg.penalty.rate}
                    onChange={(v) => set("penalty", { ...cfg.penalty, rate: v })} />
                  <SelectField label="Accrues" value={cfg.penalty.accrual}
                    onChange={(v) => set("penalty", { ...cfg.penalty, accrual: v as LoansConfig["penalty"]["accrual"] })}
                    options={[
                      { value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" },
                    ]} />
                </div>

                <SelectField label="Charged on" value={cfg.penalty.base}
                  onChange={(v) => set("penalty", { ...cfg.penalty, base: v as LoansConfig["penalty"]["base"] })}
                  options={[
                    { value: "instalment", label: "The overdue instalment" },
                    { value: "unpaid_principal", label: "Unpaid principal" },
                    { value: "unpaid_interest", label: "Unpaid interest" },
                    { value: "unpaid_principal_interest", label: "Unpaid principal + interest" },
                    { value: "total_balance", label: "The whole outstanding balance" },
                  ]}
                  help="Charging on the total balance when one instalment is late is the setting customers take to a regulator." />

                <Choice label="How often" value={cfg.penalty.recurrence}
                  onChange={(v) => set("penalty", { ...cfg.penalty, recurrence: v as LoansConfig["penalty"]["recurrence"] })}
                  cols={2}
                  options={[
                    { value: "once", label: "One time", hint: "Charged once when they fall late, and never again." },
                    { value: "recurring", label: "Continuous", hint: "Charged every accrual period until they catch up." },
                  ]} />

                <NumberField label="Stop once penalties reach" suffix="% of principal" min={0} max={1000}
                  value={cfg.penalty.capPercentOfPrincipal}
                  onChange={(v) => set("penalty", { ...cfg.penalty, capPercentOfPrincipal: v })}
                  help="0 = no cap, which on a continuous penalty grows without limit. 100% means penalties can never exceed the amount borrowed." />

                <SwitchRow title="Stop at write-off" desc="A loan recognised as a loss stops accruing charges nobody expects to collect."
                  checked={cfg.penalty.stopOnWriteOff}
                  onChange={(v) => set("penalty", { ...cfg.penalty, stopOnWriteOff: v })} />
                <SwitchRow title="A product may set its own" desc="A product's penalty terms win over this default."
                  checked={cfg.penalty.allowProductOverride}
                  onChange={(v) => set("penalty", { ...cfg.penalty, allowProductOverride: v })} />

                {issueFor("penalty") && (
                  <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11.5px] text-amber-900 ring-1 ring-amber-600/20">
                    <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" /> {issueFor("penalty")}
                  </p>
                )}
              </div>
            </RuleBlock>
          )}

          {/* ── Arrears buckets ── */}
          {section === "arrears" && (
            <div className="space-y-4">
              <p className="t-meta text-[12px]">
                Every report, collections queue and provision rate in the business is keyed
                to these. They must tile the number line with no gaps and no overlaps —
                a loan 45 days late has to fall in exactly one bucket.
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <NumberField label="Delinquent after" suffix="days" min={0} max={365}
                  value={cfg.arrears.delinquentAfterDays}
                  onChange={(v) => set("arrears", { ...cfg.arrears, delinquentAfterDays: v })}
                  help="Past due by this much and the loan is in arrears." />
                <NumberField label="Non-performing after" suffix="days" min={1} max={3650}
                  value={cfg.arrears.nplAfterDays}
                  onChange={(v) => set("arrears", { ...cfg.arrears, nplAfterDays: v })}
                  help="Drives the NPL ratio on every dashboard and every board pack." />
              </div>

              <Divider label="The ladder" />
              <div className="mb-1 hidden grid-cols-[minmax(0,1fr)_5rem_5rem_5rem_2rem] gap-2 px-1 sm:grid">
                <span className="t-label">Bucket</span>
                <span className="t-label text-center">From</span>
                <span className="t-label text-center">To</span>
                <span className="t-label text-center">Provision</span>
                <span />
              </div>
              <div className="space-y-1.5">
                {cfg.arrears.buckets.map((b, i) => (
                  <div key={i} className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_5rem_5rem_5rem_2rem]">
                    <input className={INPUT} value={b.label} placeholder="Label"
                      onChange={(e) => set("arrears", {
                        ...cfg.arrears,
                        buckets: cfg.arrears.buckets.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                      })} />
                    <input className={INPUT} inputMode="numeric" value={b.fromDays}
                      onChange={(e) => set("arrears", {
                        ...cfg.arrears,
                        buckets: cfg.arrears.buckets.map((x, j) => (j === i ? { ...x, fromDays: Number(e.target.value) || 0 } : x)),
                      })} />
                    <input className={INPUT} inputMode="numeric" placeholder="∞"
                      value={b.toDays === null ? "" : b.toDays}
                      onChange={(e) => set("arrears", {
                        ...cfg.arrears,
                        buckets: cfg.arrears.buckets.map((x, j) =>
                          (j === i ? { ...x, toDays: e.target.value === "" ? null : Number(e.target.value) || 0 } : x)),
                      })} />
                    <input className={INPUT} inputMode="decimal" value={b.provisionPct}
                      onChange={(e) => set("arrears", {
                        ...cfg.arrears,
                        buckets: cfg.arrears.buckets.map((x, j) => (j === i ? { ...x, provisionPct: Number(e.target.value) || 0 } : x)),
                      })} />
                    <button type="button" onClick={() => set("arrears", { ...cfg.arrears, buckets: cfg.arrears.buckets.filter((_, j) => j !== i) })}
                      className="justify-self-center text-[color:var(--ink-faint)] hover:text-red-500" aria-label={`Remove ${b.label}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
              <button type="button"
                onClick={() => {
                  const last = cfg.arrears.buckets[cfg.arrears.buckets.length - 1];
                  const from = last ? (last.toDays ?? last.fromDays) + 1 : 0;
                  set("arrears", { ...cfg.arrears, buckets: [...cfg.arrears.buckets, { label: `${from}+ days`, fromDays: from, toDays: null, provisionPct: 100 }] });
                }}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ring-1 ring-[color:var(--ink)]/10">
                <Plus className="h-3.5 w-3.5" /> Add a bucket
              </button>

              {issueFor("arrears") && (
                <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11.5px] text-amber-900 ring-1 ring-amber-600/20">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" /> {issueFor("arrears")}
                </p>
              )}
            </div>
          )}

          {/* ── Reconciliation ── */}
          {section === "reconciliation" && (
            <div className="space-y-4">
              <SwitchRow title="Match payments automatically" desc="On account reference, then phone, then name. Off means every payment waits for a person."
                checked={cfg.reconciliation.autoMatch}
                onChange={(v) => set("reconciliation", { ...cfg.reconciliation, autoMatch: v })} />
              <SwitchRow title="Use a suspense account" desc="A payment that cannot be matched lands there rather than being rejected. The customer's money is never turned away."
                checked={cfg.reconciliation.useSuspenseAccount}
                onChange={(v) => set("reconciliation", { ...cfg.reconciliation, useSuspenseAccount: v })} />

              <div className="grid gap-4 sm:grid-cols-3">
                <NumberField label="Match tolerance" money min={0} value={cfg.reconciliation.toleranceAmount}
                  onChange={(v) => set("reconciliation", { ...cfg.reconciliation, toleranceAmount: v })}
                  help="An amount within this of a due instalment is treated as that instalment." />
                <NumberField label="Escalate after" suffix="days" min={0} max={90}
                  value={cfg.reconciliation.escalateAfterDays}
                  onChange={(v) => set("reconciliation", { ...cfg.reconciliation, escalateAfterDays: v })}
                  help="Unmatched for this long raises an exception somebody must clear." />
                <NumberField label="Second approver above" money min={0}
                  value={cfg.reconciliation.dualApprovalAbove}
                  onChange={(v) => set("reconciliation", { ...cfg.reconciliation, dualApprovalAbove: v })}
                  help="Releasing more than this from suspense takes two people. 0 = never." />
              </div>

              <p className="t-meta text-[11px]">
                Who may release a suspended payment is a role right —{" "}
                <Link href="/console/roles" className="font-semibold underline">set it on the role</Link> rather than here,
                so it follows the person when they change job.
              </p>
            </div>
          )}

          {/* ── Payouts ── */}
          {section === "disbursement" && (
            <div className="space-y-4">
              <SwitchRow title="Maker-checker" desc="Whoever prepared a payout may not be the one who releases it. The single most effective control in a lending business."
                checked={cfg.disbursement.makerChecker}
                onChange={(v) => set("disbursement", { ...cfg.disbursement, makerChecker: v })} />

              <div className="grid gap-4 sm:grid-cols-2">
                <NumberField label="Second authoriser above" money min={0}
                  value={cfg.disbursement.dualApprovalAbove}
                  onChange={(v) => set("disbursement", { ...cfg.disbursement, dualApprovalAbove: v })}
                  help="0 = never." />
                <NumberField label="Retry a failed payout" suffix="times" min={0} max={10}
                  value={cfg.disbursement.autoRetries}
                  onChange={(v) => set("disbursement", { ...cfg.disbursement, autoRetries: v })}
                  help="Before a person is asked to look at it." />
              </div>

              <SwitchRow title="Hold until upfront charges are settled" desc="No money leaves while a before-disbursement fee is unpaid."
                checked={cfg.disbursement.requireChargesSettled}
                onChange={(v) => set("disbursement", { ...cfg.disbursement, requireChargesSettled: v })} />

              <Divider label="When money may leave" />
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="t-label">Payouts from</span>
                  <input type="time" className={INPUT} value={cfg.disbursement.cutoffFrom}
                    onChange={(e) => set("disbursement", { ...cfg.disbursement, cutoffFrom: e.target.value })} />
                  <span className="mt-1 block text-[11px] text-[color:var(--ink-faint)]">Empty = any time.</span>
                </label>
                <label className="block">
                  <span className="t-label">Until</span>
                  <input type="time" className={INPUT} value={cfg.disbursement.cutoffTo}
                    onChange={(e) => set("disbursement", { ...cfg.disbursement, cutoffTo: e.target.value })} />
                  <span className="mt-1 block text-[11px] text-[color:var(--ink-faint)]">
                    A window keeps payouts inside the hours your float is watched.
                  </span>
                </label>
              </div>

              <div>
                <p className="t-label mb-2">Days money may leave</p>
                <div className="flex flex-wrap gap-1.5">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, i) => {
                    const on = cfg.disbursement.payoutDays.includes(i);
                    return (
                      <button key={label} type="button" aria-pressed={on}
                        onClick={() => set("disbursement", {
                          ...cfg.disbursement,
                          payoutDays: on
                            ? cfg.disbursement.payoutDays.filter((d) => d !== i)
                            : [...cfg.disbursement.payoutDays, i].sort(),
                        })}
                        className="rounded-full px-3 py-1.5 text-[12px] font-semibold ring-1 transition-colors"
                        style={on
                          ? { backgroundColor: "var(--brand-soft)", color: "var(--ink)", ["--tw-ring-color" as never]: "var(--brand)" }
                          : { color: "var(--ink-muted)", ["--tw-ring-color" as never]: "rgba(15,15,25,0.10)" }}>
                        {label}
                      </button>
                    );
                  })}
                </div>
                <p className="t-meta mt-1.5 text-[11px]">
                  {cfg.disbursement.payoutDays.length === 0
                    ? "None selected — money may leave any day."
                    : "Only on these days."}
                </p>
              </div>

              {issueFor("disbursement") && (
                <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11.5px] text-amber-900 ring-1 ring-amber-600/20">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" /> {issueFor("disbursement")}
                </p>
              )}
            </div>
          )}

          {/* ── Statements ── */}
          {section === "statement" && (
            <div className="space-y-4">
              <SwitchRow title="Show charges" desc="Every fee, itemised, on the customer's own statement."
                checked={cfg.statement.showCharges} onChange={(v) => set("statement", { ...cfg.statement, showCharges: v })} />
              <SwitchRow title="Show penalties" desc="What lateness cost them, separately from interest."
                checked={cfg.statement.showPenalties} onChange={(v) => set("statement", { ...cfg.statement, showPenalties: v })} />
              <SwitchRow title="Show a running balance" desc="A column that answers 'what do I still owe?' on every line."
                checked={cfg.statement.showRunningBalance} onChange={(v) => set("statement", { ...cfg.statement, showRunningBalance: v })} />
              <SwitchRow title="Include closed loans" desc="Their whole history with you, not only what is running."
                checked={cfg.statement.includeClosedLoans} onChange={(v) => set("statement", { ...cfg.statement, includeClosedLoans: v })} />
              <TextField label="Footer" value={cfg.statement.footer}
                onChange={(v) => set("statement", { ...cfg.statement, footer: v })}
                placeholder="Queries: 0709 000 000 · care@lender.co.ke"
                help="Printed at the foot of every statement. Your words." />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
