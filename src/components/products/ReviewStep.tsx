"use client";

// ─────────────────────────────────────────────────────────────────────────────
// REVIEW — the product priced, not the form repeated.
//
// A review step that lists back the fields the admin just typed is theatre: they
// typed them, they remember. The question they cannot answer from the form is the
// only one that matters — WHAT WILL A CUSTOMER BE QUOTED? So this step builds a real
// schedule off the definition and the live fee sheet, and shows the instalment, the
// total cost, and what actually lands in the borrower's hand after deductions.
//
// It also shows the blast radius. Publishing over a live product is not an edit; it
// is an event, and the number of loans still held to the current version is the
// figure a credit manager wants in front of them when they press the button.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useState } from "react";
import { AlertTriangle, TrendingUp, Users, Wallet } from "lucide-react";
import { useLoad } from "@/lib/hooks/useLoad";
import { INPUT } from "@/components/settings/controls";
import { ChecksSummary } from "@/components/settings/ChecksPicker";
import type { ProductDefinition } from "@/lib/products/definition";
import { priceCharge, describeCharge, type ChargeShape } from "@/lib/products/charges";
import type { Ctx } from "./ProductSteps";

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;

const CYCLE_WORD: Record<ProductDefinition["schedule"]["cycle"], string> = {
  day: "daily", week: "weekly", fortnight: "fortnightly", month: "monthly",
};

export function ReviewStep({
  d, ctx, productId, version, book, note, onNote, termDays,
}: {
  d: ProductDefinition;
  ctx: Ctx;
  productId: string | null;
  version: number;
  book: { loanCount: number; activeCount: number; outstanding: number };
  note: string;
  onNote: (v: string) => void;
  termDays: number;
}) {
  const [charges, setCharges] = useState<ChargeShape[]>([]);

  const load = useCallback(async () => {
    if (!productId) return;
    try {
      const res = await fetch(`/api/console/charges?productId=${productId}`);
      const data = await res.json();
      if (data.success) setCharges((data.charges ?? []).filter((c: ChargeShape) => c.isActive));
    } catch { /* the quote simply shows no fees */ }
  }, [productId]);
  useLoad(load);

  // ── The worked example ──
  // Deliberately the MIDDLE of the range, not the maximum: the extreme is the case a
  // lender already thinks about, and the typical one is the case they will actually book.
  const principal = d.limit.basis === "fixed"
    ? d.limit.fixedAmount
    : d.limit.basis === "bands" && d.limit.bands.length
      ? d.limit.bands[Math.floor(d.limit.bands.length / 2)]
      : Math.round((d.limit.min + d.limit.max) / 2);

  const periods = Math.max(1, d.schedule.installments);
  // A term rate is charged once over the whole loan; a periodic rate is charged per
  // instalment. Flat and reducing differ in the base, not in that shape.
  const interest = d.pricing.method === "flat"
    ? d.pricing.ratePeriod === "term"
      ? (principal * d.pricing.rate) / 100
      : (principal * d.pricing.rate * periods) / 100
    // Reducing balance on a level schedule: interest accrues on the average balance,
    // which for a straight-line amortisation is a shade over half the principal.
    : ((principal * d.pricing.rate) / 100) * ((periods + 1) / (2 * periods)) * (d.pricing.ratePeriod === "term" ? 1 : periods);

  const totalRepayable = principal + interest;
  const instalment = totalRepayable / periods;
  const sample = { principal, totalRepayable, instalment };

  const priced = charges
    .map((c) => ({ c, amount: priceCharge(c, sample) }))
    .filter((r): r is { c: ChargeShape; amount: number } => r.amount !== null);

  const upfront = priced.filter((r) => r.c.applyAt === "BEFORE_DISBURSEMENT").reduce((s, r) => s + r.amount, 0);
  const deducted = priced.filter((r) => r.c.applyAt === "DEDUCT_FROM_PRINCIPAL").reduce((s, r) => s + r.amount, 0);
  const spread = priced.filter((r) => r.c.applyAt === "ON_INSTALLMENTS").reduce((s, r) => s + r.amount, 0);

  const received = principal - deducted;
  const totalCost = interest + upfront + deducted + spread;
  // Cost of credit expressed against what the customer actually RECEIVES, annualised
  // on the real term. This is the number a regulator asks for and a form never shows.
  const effective = received > 0 && termDays > 0
    ? (totalCost / received) * (365 / termDays) * 100
    : 0;

  const workflowName = (id: string | null) => ctx.workflows.find((w) => w.id === id)?.title ?? "—";

  return (
    <div className="space-y-6">
      {/* ── The quote ── */}
      <div>
        <p className="t-label">What a customer would be quoted</p>
        <p className="t-meta mt-0.5 text-[11px]">
          A typical loan on this product: {kes(principal)} over {periods} {CYCLE_WORD[d.schedule.cycle]} instalment{periods === 1 ? "" : "s"}
          {d.schedule.graceDays > 0 ? `, after ${d.schedule.graceDays} days' grace` : ""}.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Stat label="Each instalment" value={kes(instalment + spread / periods)} tone="brand" />
          <Stat label="Total repayable" value={kes(totalRepayable + spread)} />
          <Stat
            label="They receive"
            value={kes(received)}
            hint={deducted > 0 ? `${kes(deducted)} netted off at payout` : undefined}
          />
        </div>

        <dl className="mt-3 space-y-1.5 rounded-xl px-3 py-3 ring-1 ring-[color:var(--ink)]/[0.07]">
          <Line label="Principal" value={kes(principal)} />
          <Line
            label={`Interest (${d.pricing.rate}% ${d.pricing.method === "flat" ? "flat" : "reducing"}, per ${d.pricing.ratePeriod})`}
            value={kes(interest)}
          />
          {upfront > 0 && <Line label="Fees paid before disbursement" value={kes(upfront)} />}
          {deducted > 0 && <Line label="Fees netted off the payout" value={kes(deducted)} />}
          {spread > 0 && <Line label="Fees spread across instalments" value={kes(spread)} />}
          <div className="border-t border-[color:var(--ink)]/[0.07] pt-1.5">
            <Line label="Total cost of credit" value={kes(totalCost)} bold />
            <Line label="Effective annual rate" value={`${effective.toFixed(1)}%`} bold />
          </div>
        </dl>

        {upfront > 0 && (
          <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11.5px] text-amber-900 ring-1 ring-amber-600/20">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
            {kes(upfront)} must be paid before the loan is released. A borrower who needs
            the money is being asked to find cash first — check that is what you meant.
          </p>
        )}

        {priced.length > 0 && (
          <ul className="mt-2 space-y-1">
            {priced.map(({ c, amount }) => (
              <li key={c.code} className="flex items-center justify-between gap-3 text-[11.5px]">
                <span className="t-meta truncate">
                  {c.name} · {describeCharge(c)}
                  {c.isMandatory ? "" : " · optional"}
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-[color:var(--ink)]">{kes(amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── The blast radius ── */}
      {productId && (
        <div>
          <p className="t-label">What is riding on this product</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <Stat label="Live loans" value={String(book.activeCount)} icon={Users} />
            <Stat label="Loans ever booked" value={String(book.loanCount)} icon={TrendingUp} />
            <Stat label="Outstanding" value={kes(book.outstanding)} icon={Wallet} />
          </div>
          {book.activeCount > 0 && (
            <p className="t-meta mt-2 text-[11.5px]">
              Publishing writes version {version + 1}. Those {book.activeCount} live loan
              {book.activeCount === 1 ? "" : "s"} stay on the version {version > 0 ? `v${version}` : "they were booked under"} — nobody&apos;s
              agreed terms change.
            </p>
          )}
        </div>
      )}

      {/* ── The shape, in a sentence each ── */}
      <div>
        <p className="t-label">The product, in short</p>
        <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <Fact k="Amount" v={
            d.limit.basis === "fixed" ? kes(d.limit.fixedAmount)
              : d.limit.basis === "bands" ? `${d.limit.bands.length} bands, ${kes(Math.min(...(d.limit.bands.length ? d.limit.bands : [0])))}–${kes(Math.max(...(d.limit.bands.length ? d.limit.bands : [0])))}`
                : d.limit.basis === "security" ? `${d.limit.securityLtvPct}% of verified security`
                  : `${kes(d.limit.min)} – ${kes(d.limit.max)}${d.limit.basis === "scored" ? ", decided by the limit engine" : ""}`
          } />
          <Fact k="Term" v={`${periods} × ${CYCLE_WORD[d.schedule.cycle]}${d.schedule.minInstallments > 0 ? ` (as few as ${d.schedule.minInstallments})` : ""} — about ${termDays} days`} />
          <Fact k="New loans" v={d.process.newLoan === "approval" ? `Approval — ${workflowName(d.process.newWorkflowId)}` : `Direct funding up to ${kes(d.process.newDirectCeiling)}`} />
          <Fact k="Repeat loans" v={d.process.repeatLoan === "approval" ? `Approval — ${workflowName(d.process.repeatWorkflowId)}` : `Direct funding up to ${kes(d.process.repeatDirectCeiling)}`} />
          <Fact k="Disbursement" v={{
            B2C_MPESA: "M-Pesa B2C to the borrower",
            MANUAL: "Recorded manually",
            TO_THIRD_PARTY: "Paid to a third party",
            LENDER_SIDE: "Your own disbursement process",
          }[d.process.disbursementMode]} />
          <Fact k="Guarantor" v={d.eligibility.guarantor.required ? `${d.eligibility.guarantor.count} required` : "Not required"} />
          <Fact k="Security" v={d.eligibility.security.required ? `Required, ${d.eligibility.security.coverPct}% cover` : "Not required"} />
          <Fact k="Rollover" v={d.rollover.enabled
            ? `${d.rollover.valueType === "percent" ? `${d.rollover.value}%` : kes(d.rollover.value)} on ${d.rollover.penaltyBase.replace(/_/g, " ")}, after ${d.rollover.graceDays} days`
            : "No rollover penalty"} />
          <Fact k="Sold through" v={d.availability.channels.join(", ") || "nowhere"} />
          <Fact k="Branches" v={d.availability.branchIds.length === 0 ? "Everywhere" : `${d.availability.branchIds.length} branch${d.availability.branchIds.length === 1 ? "" : "es"}`} />
        </dl>
      </div>

      {/* ── What the borrower must bring ── */}
      <div>
        <p className="t-label">Required on an application</p>
        {d.evidence.documents.length === 0 ? (
          <p className="t-meta mt-1 text-[12px]">No attachments — the application is judged on what is already on file.</p>
        ) : (
          <p className="t-meta mt-1 text-[12px]">
            {d.evidence.documents
              .map((c) => ctx.attachments.find((a) => a.code === c)?.name ?? c)
              .join(" · ")}
          </p>
        )}
        <div className="mt-2">
          <ChecksSummary value={d.evidence.checks} />
        </div>
      </div>

      {/* ── The note ── */}
      <div>
        <label className="block">
          <span className="t-label">Why are you publishing this?</span>
          <input
            value={note}
            onChange={(e) => onNote(e.target.value)}
            placeholder={productId ? "Rate cut agreed at the credit committee, 8 Sept." : "Initial launch."}
            className={INPUT}
          />
          <span className="mt-1 block text-[11px] text-[color:var(--ink-faint)]">
            Optional, and it is what the version history will show in six months when
            somebody asks why the rate moved.
          </span>
        </label>
      </div>
    </div>
  );
}

function Stat({
  label, value, hint, tone, icon: Icon,
}: {
  label: string; value: string; hint?: string; tone?: "brand";
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-xl px-3 py-3 ring-1 ring-[color:var(--ink)]/[0.07]">
      <p className="t-label flex items-center gap-1.5">
        {Icon && <Icon className="h-3 w-3" />} {label}
      </p>
      <p
        className="mt-0.5 text-[1.25rem] font-bold tabular-nums"
        style={tone === "brand" ? { color: "var(--brand)" } : { color: "var(--ink)" }}
      >
        {value}
      </p>
      {hint && <p className="t-meta text-[10.5px]">{hint}</p>}
    </div>
  );
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={`text-[12px] ${bold ? "font-semibold text-[color:var(--ink)]" : "text-[color:var(--ink-muted)]"}`}>{label}</dt>
      <dd className={`shrink-0 text-[12.5px] tabular-nums ${bold ? "font-bold text-[color:var(--ink)]" : "text-[color:var(--ink-body)]"}`}>{value}</dd>
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[color:var(--ink)]/[0.05] pb-1.5">
      <dt className="t-label shrink-0">{k}</dt>
      <dd className="text-right text-[12px] font-medium text-[color:var(--ink-body)]">{v}</dd>
    </div>
  );
}
