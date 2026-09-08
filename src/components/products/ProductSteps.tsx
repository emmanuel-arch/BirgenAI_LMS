"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE PRODUCT BUILDER'S STEPS.
//
// One file, one step per exported component, each editing exactly one block of the
// definition. The shell (ProductBuilder) owns the document, the dirty state and the
// single Publish; a step takes a definition and hands back the next one, so no step
// can save half of itself.
//
// The order follows the decision a lender actually makes, which is NOT the order the
// data happens to sit in: what is it called, what does it cost, when is it repaid,
// how much may they have, what if they run over, who may have it, who signs it off,
// what do they pay in fees, what must they bring, and where is it sold.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo } from "react";
import Link from "next/link";
import { AlertTriangle, Plus, Trash2, ArrowUpRight } from "lucide-react";
import {
  Toggle, SwitchRow, Choice, RuleBlock, NumberField, TextField, SelectField, Divider, INPUT,
} from "@/components/settings/controls";
import { ChecksPicker } from "@/components/settings/ChecksPicker";
import type { ProductDefinition } from "@/lib/products/definition";
import type { AttachmentItem } from "@/lib/config/attachments";
import type { DetailGroup } from "@/lib/config/details";

export type Ctx = {
  workflows: { id: string; title: string; kind: string }[];
  branches: { id: string; name: string }[];
  attachments: AttachmentItem[];
  detailGroups: DetailGroup[];
  /** Vault kinds already configured, so the check picker can warn about the rest. */
  connected: string[];
};

export type StepProps = {
  d: ProductDefinition;
  set: (next: ProductDefinition) => void;
  ctx: Ctx;
  issueFor: (prefix: string) => string | null;
};

/** Patch one block without the caller spreading the whole document. */
function block<K extends keyof ProductDefinition>(
  d: ProductDefinition, set: (n: ProductDefinition) => void, key: K,
) {
  return (patch: Partial<ProductDefinition[K]>) =>
    set({ ...d, [key]: { ...(d[key] as object), ...patch } } as ProductDefinition);
}

function Issue({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11.5px] text-amber-900 ring-1 ring-amber-600/20">
      <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" /> {message}
    </p>
  );
}

const CYCLE_OPTIONS = [
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "fortnight", label: "Fortnightly" },
  { value: "month", label: "Monthly" },
];

// ── 1. Basics ─────────────────────────────────────────────────────────────────

export function BasicsStep({ d, set, issueFor }: StepProps) {
  return (
    <div className="space-y-5">
      <TextField
        label="Product name"
        value={d.name}
        onChange={(v) => set({ ...d, name: v })}
        placeholder="Micro Business Loan"
        help="What a customer and an officer both call it."
      />
      <Issue message={issueFor("name")} />

      <label className="block">
        <span className="t-label">Description</span>
        <textarea
          value={d.description}
          rows={2}
          onChange={(e) => set({ ...d, description: e.target.value })}
          placeholder="Short-term working capital repaid weekly from daily business takings."
          className={INPUT}
        />
        <span className="mt-1 block text-[11px] text-[color:var(--ink-faint)]">
          Borrower-facing. This is what appears on the app and on the offer letter.
        </span>
      </label>

      <Divider label="Repayment shape" />
      <Choice
        label="How the schedule is built"
        value={d.schedule.principalType}
        onChange={(v) => block(d, set, "schedule")({ principalType: v as never })}
        options={[
          { value: "standard", label: "Standard", hint: "Principal and interest in every instalment." },
          { value: "interest_first", label: "Interest-first", hint: "Interest until the final instalment, which clears the principal." },
          { value: "balloon", label: "Balloon", hint: "Most of the principal falls due in the last instalment." },
        ]}
      />
      <Issue message={issueFor("schedule.principalType")} />
    </div>
  );
}

// ── 2. Pricing ────────────────────────────────────────────────────────────────

export function PricingStep({ d, set, issueFor }: StepProps) {
  const p = block(d, set, "pricing");
  const order = d.pricing.repaymentOrder;

  const move = (i: number, dir: -1 | 1) => {
    const next = [...order];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    p({ repaymentOrder: next });
  };

  return (
    <div className="space-y-5">
      <Choice
        label="Interest method"
        value={d.pricing.method}
        onChange={(v) => p({ method: v as never })}
        cols={2}
        options={[
          { value: "flat", label: "Flat rate", hint: "Charged on the original principal for the whole term." },
          { value: "reducing", label: "Reducing balance", hint: "Charged on what is still owed, so it falls as they repay." },
        ]}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField
          label="Rate type"
          value={d.pricing.rateType}
          onChange={(v) => p({ rateType: v as never })}
          options={[
            { value: "fixed", label: "Fixed for the life of the loan" },
            { value: "variable", label: "Variable — repriced on rollover" },
          ]}
        />
        <NumberField label="Rate" value={d.pricing.rate} min={0} max={100} step={0.05} suffix="%" onChange={(v) => p({ rate: v })} />
        <SelectField
          label="Quoted per"
          value={d.pricing.ratePeriod}
          onChange={(v) => p({ ratePeriod: v as never })}
          options={[
            { value: "term", label: "The whole term" },
            { value: "day", label: "Day" },
            { value: "week", label: "Week" },
            { value: "month", label: "Month" },
          ]}
          help="A rate quoted per month on a loan that finishes inside a month prices nothing anyone can explain."
        />
      </div>
      <Issue message={issueFor("pricing.rate") ?? issueFor("pricing.ratePeriod")} />

      <NumberField
        label="Penalty rate on arrears"
        value={d.pricing.penaltyRate}
        min={0} max={100} step={0.5} suffix="%"
        onChange={(v) => p({ penaltyRate: v })}
        help="Per period, on what is overdue. Loan settings decide the grace and the cap."
      />
      <Issue message={issueFor("pricing.penaltyRate")} />

      <Divider label="Payment waterfall" />
      <p className="t-meta text-[12px]">
        When a payment lands, it is applied in this order, most senior first. Putting
        principal above penalty is how a book quietly stops charging for lateness.
      </p>
      <ul className="space-y-1.5">
        {order.map((t, i) => (
          <li key={t} className="flex items-center gap-2 rounded-xl px-3 py-2 ring-1 ring-[color:var(--ink)]/[0.07]">
            <span className="t-label w-4 shrink-0">{i + 1}</span>
            <span className="flex-1 text-[13px] font-semibold capitalize text-[color:var(--ink)]">{t}</span>
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
              className="rounded px-1.5 py-0.5 text-[11px] font-bold text-[color:var(--ink-muted)] disabled:opacity-25">↑</button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === order.length - 1}
              className="rounded px-1.5 py-0.5 text-[11px] font-bold text-[color:var(--ink-muted)] disabled:opacity-25">↓</button>
          </li>
        ))}
      </ul>
      <Issue message={issueFor("pricing.repaymentOrder")} />

      <Divider label="Settling early" />
      <RuleBlock
        title="Early settlement rebate"
        desc="A borrower who clears the loan early gets part of the unearned interest back."
        checked={d.pricing.earlySettlement.enabled}
        onChange={(v) => p({ earlySettlement: { ...d.pricing.earlySettlement, enabled: v } })}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            label="Qualifying window" suffix="days" min={1}
            value={d.pricing.earlySettlement.withinDays}
            onChange={(v) => p({ earlySettlement: { ...d.pricing.earlySettlement, withinDays: v } })}
            help="Settling within this many days of disbursement earns the rebate."
          />
          <NumberField
            label="Rebate" suffix="%" min={1} max={100}
            value={d.pricing.earlySettlement.rebatePct}
            onChange={(v) => p({ earlySettlement: { ...d.pricing.earlySettlement, rebatePct: v } })}
            help="Of the interest not yet earned."
          />
        </div>
        <div className="mt-3">
          <Issue message={issueFor("pricing.earlySettlement")} />
        </div>
      </RuleBlock>
    </div>
  );
}

// ── 3. Schedule ───────────────────────────────────────────────────────────────

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function ScheduleStep({ d, set, issueFor }: StepProps) {
  const s = block(d, set, "schedule");
  const flexible = d.schedule.minInstallments > 0;

  const toggleDay = (i: number) => {
    const on = d.schedule.skipDays.includes(i);
    s({ skipDays: on ? d.schedule.skipDays.filter((x) => x !== i) : [...d.schedule.skipDays, i].sort() });
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField
          label="Instalment cycle"
          value={d.schedule.cycle}
          onChange={(v) => s({ cycle: v as never })}
          options={CYCLE_OPTIONS}
        />
        <NumberField label="Instalments" value={d.schedule.installments} min={1} max={120} onChange={(v) => s({ installments: v })} />
        <NumberField
          label="Grace before the first" suffix="days" min={0}
          value={d.schedule.graceDays} onChange={(v) => s({ graceDays: v })}
          help="Days after disbursement before anything falls due."
        />
      </div>
      <Issue message={issueFor("schedule.installments") ?? issueFor("schedule.graceDays")} />

      <RuleBlock
        title="Flexible term"
        desc="Offer any term from a floor up to the full term, and let the engine pick the one this borrower's cashflow carries."
        checked={flexible}
        onChange={(v) => s({ minInstallments: v ? Math.max(1, Math.floor(d.schedule.installments / 2)) : 0 })}
      >
        <NumberField
          label="Shortest term offered" suffix="instalments" min={1} max={d.schedule.installments}
          value={d.schedule.minInstallments}
          onChange={(v) => s({ minInstallments: v })}
          help="A customer who can only service four weeks of a ten-week product is offered four, not declined for ten. Flat interest, quoted per term, only."
        />
        <div className="mt-3"><Issue message={issueFor("schedule.minInstallments")} /></div>
      </RuleBlock>

      <Divider label="Due dates" />
      <div>
        <p className="t-label mb-2">Never fall due on</p>
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((label, i) => {
            const on = d.schedule.skipDays.includes(i);
            return (
              <button
                key={label} type="button" aria-pressed={on} onClick={() => toggleDay(i)}
                className="rounded-full px-3 py-1.5 text-[12px] font-semibold ring-1 transition-colors"
                style={on
                  ? { backgroundColor: "rgba(220,38,38,0.10)", color: "#991b1b", ["--tw-ring-color" as never]: "rgba(220,38,38,0.45)" }
                  : { color: "var(--ink-muted)", ["--tw-ring-color" as never]: "rgba(15,15,25,0.10)" }}
              >
                {label}
              </button>
            );
          })}
        </div>
        <p className="t-meta mt-1.5 text-[11px]">
          A market day, a day of worship, a day the business is shut. Nothing is due on a skipped day.
        </p>
      </div>
      <Issue message={issueFor("schedule.skipDays")} />

      {d.schedule.skipDays.length > 0 && (
        <Choice
          label="A due date landing on a skipped day moves"
          value={d.schedule.onSkippedDay}
          onChange={(v) => s({ onSkippedDay: v as never })}
          cols={2}
          options={[
            { value: "next_business_day", label: "Forward", hint: "The customer gets a day longer." },
            { value: "previous_business_day", label: "Back", hint: "The instalment is due a day earlier." },
          ]}
        />
      )}
    </div>
  );
}

// ── 4. Limits ─────────────────────────────────────────────────────────────────

export function LimitsStep({ d, set, issueFor }: StepProps) {
  const l = block(d, set, "limit");
  const bands = d.limit.bands;

  return (
    <div className="space-y-5">
      <Choice
        label="Where the amount comes from"
        value={d.limit.basis}
        onChange={(v) => l({ basis: v as never })}
        cols={3}
        options={[
          { value: "fixed", label: "Fixed amount", hint: "One amount. Take it or leave it." },
          { value: "range", label: "Amount range", hint: "Anything between a minimum and a maximum." },
          { value: "bands", label: "Principal bands", hint: "A ladder of discrete amounts." },
          { value: "scored", label: "Calculated", hint: "The limit engine decides, inside the range below." },
          { value: "security", label: "From security", hint: "A percentage of verified collateral value." },
        ]}
      />

      {d.limit.basis === "fixed" && (
        <NumberField label="The amount" money min={1} value={d.limit.fixedAmount} onChange={(v) => l({ fixedAmount: v })} />
      )}

      {(d.limit.basis === "range" || d.limit.basis === "scored") && (
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField label="Minimum principal" money min={0} value={d.limit.min} onChange={(v) => l({ min: v })} />
          <NumberField label="Maximum principal" money min={0} value={d.limit.max} onChange={(v) => l({ max: v })} />
        </div>
      )}

      {d.limit.basis === "security" && (
        <NumberField
          label="Loan to value" suffix="%" min={1} max={100}
          value={d.limit.securityLtvPct} onChange={(v) => l({ securityLtvPct: v })}
          help="The share of the verified collateral value this product will advance."
        />
      )}

      {d.limit.basis === "bands" && (
        <div>
          <p className="t-label mb-2">The ladder</p>
          <div className="space-y-2">
            {bands.map((b, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="t-label w-6 shrink-0">{i + 1}</span>
                <input
                  type="number" inputMode="numeric" value={b}
                  onChange={(e) => l({ bands: bands.map((x, j) => (j === i ? Number(e.target.value) : x)) })}
                  className={INPUT}
                />
                <button type="button" onClick={() => l({ bands: bands.filter((_, j) => j !== i) })}
                  className="shrink-0 text-[color:var(--ink-faint)] hover:text-red-500">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => l({ bands: [...bands, bands.length ? Math.round(bands[bands.length - 1] * 1.5) : 5000] })}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ring-1 ring-[color:var(--ink)]/10"
          >
            <Plus className="h-3.5 w-3.5" /> Add a band
          </button>
        </div>
      )}
      <Issue message={issueFor("limit.min") ?? issueFor("limit.max") ?? issueFor("limit.bands") ?? issueFor("limit.fixedAmount") ?? issueFor("limit.securityLtvPct") ?? issueFor("limit.basis")} />

      <NumberField
        label="Minimum loan limit — the floor" money min={0}
        value={d.limit.floor} onChange={(v) => l({ floor: v })}
        help="The engine will not book below this even when a thin cashflow supports less. Below it, there is no loan."
      />
      <Issue message={issueFor("limit.floor")} />

      <Divider label="What an approver may do" />
      <SwitchRow
        title="Increase the amount"
        desc="Applicants may ask for more than the derived limit, and approvers may raise what was applied for."
        checked={d.limit.allowIncrease}
        onChange={(v) => l({ allowIncrease: v })}
      />
      <SwitchRow
        title="Decrease the amount"
        desc="Approvers may book less than was applied for."
        checked={d.limit.allowDecrease}
        onChange={(v) => l({ allowDecrease: v })}
      />
    </div>
  );
}

// ── 5. Rollover ───────────────────────────────────────────────────────────────

export function RolloverStep({ d, set, issueFor }: StepProps) {
  const r = block(d, set, "rollover");
  return (
    <div className="space-y-5">
      <RuleBlock
        title="Apply a rollover penalty"
        desc="What happens to a loan that runs past its maturity date."
        checked={d.rollover.enabled}
        onChange={(v) => r({ enabled: v })}
      >
        <div className="space-y-5">
          <Choice
            label="When the penalty applies"
            value={d.rollover.applyAt}
            onChange={(v) => r({ applyAt: v as never })}
            cols={2}
            options={[
              { value: "maturity", label: "On loan maturity", hint: "Once, when the whole loan runs over." },
              { value: "installment", label: "On each instalment", hint: "Every instalment that is missed earns its own." },
            ]}
          />
          <Issue message={issueFor("rollover.applyAt")} />

          <Choice
            label="Charged on"
            value={d.rollover.penaltyBase}
            onChange={(v) => r({ penaltyBase: v as never })}
            cols={4}
            options={[
              { value: "unpaid_principal", label: "Unpaid principal", hint: "The capital still outstanding." },
              { value: "unpaid_interest", label: "Unpaid interest", hint: "Interest accrued and unpaid." },
              { value: "unpaid_principal_interest", label: "Principal + interest", hint: "Both, together." },
              { value: "total_balance", label: "Total balance", hint: "Everything owed, fees included." },
            ]}
          />

          <div className="grid gap-4 sm:grid-cols-3">
            <NumberField label="Grace period" suffix="days" min={0} value={d.rollover.graceDays} onChange={(v) => r({ graceDays: v })} />
            <SelectField
              label="Penalty type" value={d.rollover.valueType}
              onChange={(v) => r({ valueType: v as never })}
              options={[{ value: "percent", label: "Percentage" }, { value: "fixed", label: "Fixed amount" }]}
            />
            <NumberField
              label={d.rollover.valueType === "percent" ? "Penalty" : "Penalty (KES)"}
              suffix={d.rollover.valueType === "percent" ? "%" : undefined}
              min={0} value={d.rollover.value} onChange={(v) => r({ value: v })}
            />
          </div>
          <Issue message={issueFor("rollover.value")} />

          <Choice
            label="How often"
            value={d.rollover.recurrence}
            onChange={(v) => r({ recurrence: v as never })}
            cols={2}
            options={[
              { value: "once", label: "One time", hint: "Charged once and never again." },
              { value: "recurring", label: "Recurring", hint: "Charged every cycle until the loan clears." },
            ]}
          />

          {d.rollover.recurrence === "recurring" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField label="Charged every" suffix="days" min={1} value={d.rollover.everyDays} onChange={(v) => r({ everyDays: v })} />
              <NumberField
                label="Stop once penalties reach" money min={0}
                value={d.rollover.cap} onChange={(v) => r({ cap: v })}
                help="0 means no limit — which is how a KES 5,000 loan becomes a KES 90,000 debt."
              />
            </div>
          )}
          <Issue message={issueFor("rollover.everyDays") ?? issueFor("rollover.cap")} />
        </div>
      </RuleBlock>
    </div>
  );
}

// ── 6. Eligibility ────────────────────────────────────────────────────────────

export function EligibilityStep({ d, set, issueFor }: StepProps) {
  const e = block(d, set, "eligibility");
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <NumberField
          label="Minimum credit score" min={0} max={1000}
          value={d.eligibility.minCreditScore} onChange={(v) => e({ minCreditScore: v })}
          help="0 = inherit the credit policy."
        />
        <NumberField
          label="Minimum age" suffix="yrs" min={0} max={100}
          value={d.eligibility.minAge} onChange={(v) => e({ minAge: v })}
          help="0 = inherit borrower settings."
        />
        <NumberField
          label="Maximum age" suffix="yrs" min={0} max={100}
          value={d.eligibility.maxAge} onChange={(v) => e({ maxAge: v })}
          help="0 = inherit borrower settings."
        />
      </div>
      <Issue message={issueFor("eligibility.minCreditScore") ?? issueFor("eligibility.maxAge")} />

      <NumberField
        label="Loans already cleared" min={0} max={50}
        value={d.eligibility.minClearedLoans} onChange={(v) => e({ minClearedLoans: v })}
        help="A graduation gate — the borrower must have finished this many loans before this product is offered at all."
      />

      <Divider label="Guarantors" />
      <RuleBlock
        title="Guarantor required"
        desc="Somebody must stand surety before this product may book."
        checked={d.eligibility.guarantor.required}
        onChange={(v) => e({ guarantor: { ...d.eligibility.guarantor, required: v } })}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            label="How many" min={1} max={5}
            value={d.eligibility.guarantor.count}
            onChange={(v) => e({ guarantor: { ...d.eligibility.guarantor, count: v } })}
          />
          <label className="flex items-start justify-between gap-2 rounded-xl px-3 py-2.5 ring-1 ring-[color:var(--ink)]/[0.07]">
            <span className="min-w-0">
              <span className="text-[13px] font-semibold text-[color:var(--ink)]">A guarantor may still borrow</span>
              <span className="t-meta block text-[11px] leading-snug">
                Off freezes a guarantor&apos;s own borrowing while their exposure is live.
              </span>
            </span>
            <Toggle
              label="A guarantor may still borrow"
              checked={d.eligibility.guarantor.canReborrow}
              onChange={(v) => e({ guarantor: { ...d.eligibility.guarantor, canReborrow: v } })}
            />
          </label>
        </div>
        <div className="mt-3"><Issue message={issueFor("eligibility.guarantor")} /></div>
      </RuleBlock>

      <Divider label="Security" />
      <RuleBlock
        title="Security required"
        desc="Verified collateral must be on file before money moves."
        checked={d.eligibility.security.required}
        onChange={(v) => e({ security: { ...d.eligibility.security, required: v } })}
      >
        <NumberField
          label="Cover" suffix="%" min={1} max={500}
          value={d.eligibility.security.coverPct}
          onChange={(v) => e({ security: { ...d.eligibility.security, coverPct: v } })}
          help="The share of the principal the verified collateral must cover. 150% means KES 15,000 of security for a KES 10,000 loan."
        />
        <div className="mt-3"><Issue message={issueFor("eligibility.security")} /></div>
      </RuleBlock>

      <SwitchRow
        title="One at a time"
        desc="A borrower may not hold two live loans on this product at once."
        checked={d.eligibility.oneAtATime}
        onChange={(v) => e({ oneAtATime: v })}
      />
    </div>
  );
}

// ── 7. Process ────────────────────────────────────────────────────────────────

export function ProcessStep({ d, set, ctx, issueFor }: StepProps) {
  const p = block(d, set, "process");
  const loanFlows = useMemo(
    () => ctx.workflows.filter((w) => w.kind === "LOAN"),
    [ctx.workflows],
  );
  const flowOptions = [
    { value: "", label: loanFlows.length ? "Select a workflow…" : "No loan workflows yet" },
    ...loanFlows.map((w) => ({ value: w.id, label: w.title })),
  ];

  return (
    <div className="space-y-5">
      {loanFlows.length === 0 && (
        <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2.5 text-[12px] text-amber-900 ring-1 ring-amber-600/20">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            You have no loan approval workflows yet. Build one first, or set both paths to direct funding.{" "}
            <Link href="/console/workflows" className="inline-flex items-center gap-0.5 font-semibold underline">
              Workflows <ArrowUpRight className="h-3 w-3" />
            </Link>
          </span>
        </p>
      )}

      <Divider label="A borrower's first loan on this product" />
      <Choice
        label="New loans"
        value={d.process.newLoan}
        onChange={(v) => p({ newLoan: v as never })}
        cols={2}
        options={[
          { value: "approval", label: "Approval required", hint: "It runs a workflow before anyone is paid." },
          { value: "direct", label: "Direct funding", hint: "It pays out unreviewed, up to a ceiling." },
        ]}
      />
      {d.process.newLoan === "approval" ? (
        <SelectField label="New loan workflow" value={d.process.newWorkflowId ?? ""} options={flowOptions}
          onChange={(v) => p({ newWorkflowId: v || null })} />
      ) : (
        <NumberField label="Direct funding ceiling" money min={1} value={d.process.newDirectCeiling}
          onChange={(v) => p({ newDirectCeiling: v })}
          help="Above this the loan falls back to an approval chain. Without a ceiling, any amount pays out unreviewed." />
      )}
      <Issue message={issueFor("process.newWorkflowId") ?? issueFor("process.newDirectCeiling")} />

      <Divider label="Every loan after that" />
      <Choice
        label="Repeat loans"
        value={d.process.repeatLoan}
        onChange={(v) => p({ repeatLoan: v as never })}
        cols={2}
        options={[
          { value: "approval", label: "Approval required", hint: "Same treatment as a stranger." },
          { value: "direct", label: "Direct funding", hint: "A proven customer is paid without a queue." },
        ]}
      />
      {d.process.repeatLoan === "approval" ? (
        <SelectField label="Repeat loan workflow" value={d.process.repeatWorkflowId ?? ""} options={flowOptions}
          onChange={(v) => p({ repeatWorkflowId: v || null })} />
      ) : (
        <NumberField label="Direct funding ceiling" money min={1} value={d.process.repeatDirectCeiling}
          onChange={(v) => p({ repeatDirectCeiling: v })} />
      )}
      <Issue message={issueFor("process.repeatWorkflowId") ?? issueFor("process.repeatDirectCeiling")} />

      <Divider label="How the money leaves" />
      <Choice
        label="Mode of disbursement"
        value={d.process.disbursementMode}
        onChange={(v) => p({ disbursementMode: v as never })}
        cols={2}
        options={[
          { value: "B2C_MPESA", label: "M-Pesa B2C", hint: "Paid straight to the borrower's phone from your shortcode." },
          { value: "MANUAL", label: "Manual / cash / bank", hint: "You pay outside the system and record the reference here." },
          { value: "TO_THIRD_PARTY", label: "To a third party", hint: "School fees, a supplier, an institution's paybill — never the borrower." },
          {
            value: "LENDER_SIDE",
            label: "Lender side",
            hint: "Your own existing disbursement process pays it. We keep the application, the score and the audit trail; you keep the float.",
          },
        ]}
      />

      <Divider label="Dating" />
      <SwitchRow
        title="Post-date the start"
        desc="An approver may set the loan to begin on a future date."
        checked={d.process.allowPostDate}
        onChange={(v) => p({ allowPostDate: v })}
      />
      <SwitchRow
        title="Back-date the start"
        desc="An approver may set the loan to have begun in the past. Powerful, and worth auditing."
        checked={d.process.allowBackDate}
        onChange={(v) => p({ allowBackDate: v })}
      />
    </div>
  );
}

// ── 9. Evidence ───────────────────────────────────────────────────────────────

export function EvidenceStep({ d, set, ctx, issueFor }: StepProps) {
  const e = block(d, set, "evidence");
  const loanGroups = ctx.detailGroups.filter((g) => g.scope === "loan");

  const toggleDoc = (code: string) =>
    e({
      documents: d.evidence.documents.includes(code)
        ? d.evidence.documents.filter((c) => c !== code)
        : [...d.evidence.documents, code],
    });

  const toggleGroup = (code: string) =>
    e({
      detailGroups: d.evidence.detailGroups.includes(code)
        ? d.evidence.detailGroups.filter((c) => c !== code)
        : [...d.evidence.detailGroups, code],
    });

  return (
    <div className="space-y-5">
      <Divider label="Attachments" />
      <p className="t-meta text-[12px]">
        What the borrower must bring on an application for this product. The list comes
        from your own catalogue —{" "}
        <Link href="/console/settings/attachments" className="font-semibold underline">manage it here</Link>.
      </p>

      {ctx.attachments.length === 0 ? (
        <p className="t-meta text-[12px]">No attachments are switched on for loan applications.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {ctx.attachments.map((a) => {
            const on = d.evidence.documents.includes(a.code);
            return (
              <button
                key={a.code} type="button" onClick={() => toggleDoc(a.code)}
                className="flex items-start justify-between gap-3 rounded-xl px-3 py-2.5 text-left ring-1 transition-colors"
                style={on
                  ? { backgroundColor: "var(--brand-soft)", ["--tw-ring-color" as never]: "var(--brand)" }
                  : { ["--tw-ring-color" as never]: "rgba(15,15,25,0.08)" }}
              >
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-[color:var(--ink)]">{a.name}</span>
                  <span className="t-meta block text-[11px] leading-snug">{a.description}</span>
                  <span className="mt-0.5 block text-[10.5px] text-[color:var(--ink-faint)]">
                    {a.fileTypes.join(" ")}{a.allowMultiple ? " · several allowed" : ""}
                  </span>
                </span>
                <Toggle label={a.name} checked={on} onChange={() => toggleDoc(a.code)} />
              </button>
            );
          })}
        </div>
      )}
      <Issue message={issueFor("evidence.documents")} />

      <Divider label="Extra fields on the application" />
      {loanGroups.length === 0 ? (
        <p className="t-meta text-[12px]">
          You have not defined any loan-scoped additional details.{" "}
          <Link href="/console/settings/details" className="font-semibold underline">Add some</Link> to ask a
          school-fees applicant for the school, or a boda applicant for the route.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {loanGroups.map((g) => {
            const on = d.evidence.detailGroups.includes(g.code);
            return (
              <button
                key={g.code} type="button" onClick={() => toggleGroup(g.code)}
                className="flex items-start justify-between gap-3 rounded-xl px-3 py-2.5 text-left ring-1 transition-colors"
                style={on
                  ? { backgroundColor: "var(--brand-soft)", ["--tw-ring-color" as never]: "var(--brand)" }
                  : { ["--tw-ring-color" as never]: "rgba(15,15,25,0.08)" }}
              >
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-[color:var(--ink)]">{g.title}</span>
                  <span className="t-meta block text-[11px] leading-snug">
                    {g.items.length} field{g.items.length === 1 ? "" : "s"}
                    {g.description ? ` · ${g.description}` : ""}
                  </span>
                </span>
                <Toggle label={g.title} checked={on} onChange={() => toggleGroup(g.code)} />
              </button>
            );
          })}
        </div>
      )}

      <Divider label="On the ground" />
      <SwitchRow
        title="Location on file"
        desc="The borrower's business or home pin must exist before money moves."
        checked={d.evidence.requireGeoPin}
        onChange={(v) => e({ requireGeoPin: v })}
      />
      <SwitchRow
        title="Field verification visit"
        desc="An officer must physically verify before this product disburses."
        checked={d.evidence.requireFieldVisit}
        onChange={(v) => e({ requireFieldVisit: v })}
      />
      <Issue message={issueFor("evidence.requireGeoPin")} />

      <Divider label="Automated checks" />
      <p className="t-meta text-[12px]">
        Run on every application for this product, on top of whatever its workflow runs.
        A pay-day product may want a bureau pull on every application while the asset-finance
        product beside it does not.
      </p>
      <ChecksPicker
        surface="application"
        value={d.evidence.checks}
        onChange={(v) => e({ checks: v })}
        connected={ctx.connected}
        emptyHint="Nothing runs automatically — every application on this product is judged by a person and by whatever its workflow stages check."
      />
      <Issue message={issueFor("evidence.checks")} />
    </div>
  );
}

// ── 10. Availability ──────────────────────────────────────────────────────────

export function AvailabilityStep({ d, set, ctx, issueFor }: StepProps) {
  const a = block(d, set, "availability");

  const toggleChannel = (c: "console" | "portal" | "ussd" | "api") =>
    a({
      channels: d.availability.channels.includes(c)
        ? d.availability.channels.filter((x) => x !== c)
        : [...d.availability.channels, c],
    });

  const toggleBranch = (id: string) =>
    a({
      branchIds: d.availability.branchIds.includes(id)
        ? d.availability.branchIds.filter((x) => x !== id)
        : [...d.availability.branchIds, id],
    });

  const CHANNELS = [
    { key: "console", label: "Console", hint: "Your staff, at the counter." },
    { key: "portal", label: "Customer app", hint: "The borrower applies themselves." },
    { key: "ussd", label: "USSD", hint: "Feature phones, no data." },
    { key: "api", label: "API", hint: "A partner's own front end." },
  ] as const;

  return (
    <div className="space-y-5">
      <div>
        <p className="t-label mb-2">Where a borrower can reach it</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {CHANNELS.map((c) => {
            const on = d.availability.channels.includes(c.key);
            return (
              <button
                key={c.key} type="button" onClick={() => toggleChannel(c.key)}
                className="flex items-start justify-between gap-3 rounded-xl px-3 py-2.5 text-left ring-1 transition-colors"
                style={on
                  ? { backgroundColor: "var(--brand-soft)", ["--tw-ring-color" as never]: "var(--brand)" }
                  : { ["--tw-ring-color" as never]: "rgba(15,15,25,0.08)" }}
              >
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-[color:var(--ink)]">{c.label}</span>
                  <span className="t-meta block text-[11px] leading-snug">{c.hint}</span>
                </span>
                <Toggle label={c.label} checked={on} onChange={() => toggleChannel(c.key)} />
              </button>
            );
          })}
        </div>
      </div>
      <Issue message={issueFor("availability.channels")} />

      <Divider label="Branches" />
      <p className="t-meta text-[12px]">
        {d.availability.branchIds.length === 0
          ? "Sold everywhere. Pick branches to restrict it."
          : `Sold at ${d.availability.branchIds.length} of your ${ctx.branches.length} branches.`}
      </p>
      {ctx.branches.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {ctx.branches.map((b) => {
            const on = d.availability.branchIds.includes(b.id);
            return (
              <button
                key={b.id} type="button" aria-pressed={on} onClick={() => toggleBranch(b.id)}
                className="rounded-full px-3 py-1.5 text-[12px] font-semibold ring-1 transition-colors"
                style={on
                  ? { backgroundColor: "var(--brand-soft)", color: "var(--ink)", ["--tw-ring-color" as never]: "var(--brand)" }
                  : { color: "var(--ink-muted)", ["--tw-ring-color" as never]: "rgba(15,15,25,0.10)" }}
              >
                {b.name}
              </button>
            );
          })}
        </div>
      )}

      <Divider label="Availability window" />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="t-label">On sale from</span>
          <input type="date" value={d.availability.activeFrom ?? ""} className={INPUT}
            onChange={(e) => a({ activeFrom: e.target.value || null })} />
          <span className="mt-1 block text-[11px] text-[color:var(--ink-faint)]">Leave empty for no start bound.</span>
        </label>
        <label className="block">
          <span className="t-label">Until</span>
          <input type="date" value={d.availability.activeTo ?? ""} className={INPUT}
            onChange={(e) => a({ activeTo: e.target.value || null })} />
          <span className="mt-1 block text-[11px] text-[color:var(--ink-faint)]">A seasonal product — school fees in January, harvest in October.</span>
        </label>
      </div>
      <Issue message={issueFor("availability.activeTo")} />
    </div>
  );
}
