"use client";

// ─────────────────────────────────────────────────────────────────────────────
// ONE PRODUCT — what it is, what it costs, and what is riding on it.
//
// The screen a lender opens when somebody asks "what are the terms on Micro Eazy?"
// It is deliberately read-only: every change goes through the builder, which
// publishes a version. A page that could edit one field would be a way for a
// product's past to become unknowable.
//
// Three tabs, because these are three different questions and cramming them into
// one column makes all of them harder to answer: the fee sheet, what happens past
// maturity, and what the borrower must bring.
// ─────────────────────────────────────────────────────────────────────────────
import { use, useCallback, useState } from "react";
import Link from "next/link";
import { useLoad } from "@/lib/hooks/useLoad";
import {
  Loader2, AlertTriangle, ArrowLeft, Pencil, Package, Coins, RotateCw,
  Paperclip, History, Wallet, Users, TrendingUp,
} from "lucide-react";
import type { ProductDefinition } from "@/lib/products/definition";
import { describeCharge, CHARGE_APPLY_AT, type ChargeShape } from "@/lib/products/charges";
import { CHECK_BY_ID } from "@/lib/workflow/checks";

type Charge = ChargeShape & { summary: string; locked: boolean; ownedByProduct: boolean };
type Version = { version: number; changed: string[]; note: string | null; createdAt: string; loanCount: number };

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;

const MODE_LABEL: Record<string, string> = {
  B2C_MPESA: "M-Pesa B2C to the borrower",
  MANUAL: "Recorded manually",
  TO_THIRD_PARTY: "Paid to a third party",
  LENDER_SIDE: "Your own disbursement process",
};

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [d, setD] = useState<ProductDefinition | null>(null);
  const [name, setName] = useState("");
  const [version, setVersion] = useState(0);
  const [isActive, setIsActive] = useState(true);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [book, setBook] = useState({ loanCount: 0, activeCount: 0, outstanding: 0 });
  const [workflows, setWorkflows] = useState<{ id: string; title: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"charges" | "rollover" | "evidence" | "history">("charges");

  const load = useCallback(async () => {
    try {
      const [pRes, wRes] = await Promise.all([
        fetch(`/api/console/products/${id}`),
        fetch("/api/console/workflows").catch(() => null),
      ]);
      const data = await pRes.json();
      if (!data.success) { setError(data.message || "Could not load the product."); return; }
      setD(data.definition);
      setName(data.product.name);
      setVersion(data.product.version);
      setIsActive(data.product.isActive);
      setCharges(data.charges ?? []);
      setVersions(data.versions ?? []);
      setBook(data.book);
      const w = wRes ? await wRes.json().catch(() => null) : null;
      if (w?.success) setWorkflows(w.workflows.map((x: { id: string; title: string }) => ({ id: x.id, title: x.title })));
      setError(null);
    } catch { setError("Could not load the product."); }
  }, [id]);
  useLoad(load);

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <p className="flex items-start gap-2 rounded-xl bg-red-500/10 px-3 py-2.5 text-sm text-red-800 ring-1 ring-red-600/20">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      </main>
    );
  }
  if (!d) {
    return <main className="flex justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-[color:var(--ink-faint)]" /></main>;
  }

  const flow = (wid: string | null) => workflows.find((w) => w.id === wid)?.title ?? "—";
  const amount = d.limit.basis === "fixed"
    ? kes(d.limit.fixedAmount)
    : d.limit.basis === "bands" && d.limit.bands.length
      ? `${kes(Math.min(...d.limit.bands))} – ${kes(Math.max(...d.limit.bands))}`
      : `${kes(d.limit.min)} – ${kes(d.limit.max)}`;

  const TABS = [
    { key: "charges", label: "Charges", icon: Coins, count: charges.length },
    { key: "rollover", label: "Rollover penalty", icon: RotateCw, count: null },
    { key: "evidence", label: "Attachments & checks", icon: Paperclip, count: d.evidence.documents.length + d.evidence.checks.length },
    { key: "history", label: "Versions", icon: History, count: versions.length },
  ] as const;

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
      <Link href="/console/products" className="t-meta inline-flex items-center gap-1.5 text-[12px] hover:text-[color:var(--ink)]">
        <ArrowLeft className="h-3.5 w-3.5" /> Products
      </Link>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="t-display flex flex-wrap items-center gap-2 text-[1.6rem]">
            <Package className="h-6 w-6" style={{ color: "var(--brand)" }} /> {name}
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
              style={isActive
                ? { backgroundColor: "rgba(16,185,129,0.14)", color: "#047857" }
                : { backgroundColor: "rgba(15,15,25,0.06)", color: "var(--ink-muted)" }}
            >
              {isActive ? "On the shelf" : "Off the shelf"}
            </span>
          </h1>
          {d.description && <p className="t-meta mt-1 max-w-2xl">{d.description}</p>}
        </div>
        <Link
          href={`/console/products/${id}/edit`}
          className="inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-[11px] font-bold text-white"
          style={{ backgroundColor: "var(--brand)" }}
        >
          <Pencil className="h-3.5 w-3.5" /> Edit product
        </Link>
      </div>

      {/* ── The terms, in three columns, the way the credit committee reads them ── */}
      <div className="glass mt-5 grid gap-6 p-5 sm:grid-cols-3">
        <Column title="Terms">
          <Fact k="Principal" v={amount} />
          <Fact k="Interest" v={`${d.pricing.rate}% ${d.pricing.method === "flat" ? "flat" : "reducing"}, per ${d.pricing.ratePeriod}`} />
          <Fact k="Repayment" v={`${d.schedule.installments} × ${d.schedule.cycle}${d.schedule.minInstallments > 0 ? ` (min ${d.schedule.minInstallments})` : ""}`} />
          <Fact k="Grace" v={d.schedule.graceDays > 0 ? `${d.schedule.graceDays} days` : "None"} />
          <Fact k="Penalty on arrears" v={`${d.pricing.penaltyRate}%`} />
          <Fact k="Settling early" v={d.pricing.earlySettlement.enabled ? `${d.pricing.earlySettlement.rebatePct}% rebate within ${d.pricing.earlySettlement.withinDays} days` : "No rebate"} />
        </Column>

        <Column title="Process">
          <Fact k="New loans" v={d.process.newLoan === "approval" ? "Approval required" : `Direct up to ${kes(d.process.newDirectCeiling)}`} />
          <Fact k="New loan workflow" v={d.process.newLoan === "approval" ? flow(d.process.newWorkflowId) : "—"} />
          <Fact k="Repeat loans" v={d.process.repeatLoan === "approval" ? "Approval required" : `Direct up to ${kes(d.process.repeatDirectCeiling)}`} />
          <Fact k="Repeat loan workflow" v={d.process.repeatLoan === "approval" ? flow(d.process.repeatWorkflowId) : "—"} />
          <Fact k="Disbursement" v={MODE_LABEL[d.process.disbursementMode] ?? d.process.disbursementMode} />
          <Fact k="Dating" v={[d.process.allowPostDate && "post-date", d.process.allowBackDate && "back-date"].filter(Boolean).join(", ") || "Neither"} />
        </Column>

        <Column title="Rules">
          <Fact k="Guarantor" v={d.eligibility.guarantor.required ? `${d.eligibility.guarantor.count} required` : "Not required"} />
          <Fact k="Guarantor may borrow" v={d.eligibility.guarantor.canReborrow ? "Yes" : "No — exposure is frozen"} />
          <Fact k="Security" v={d.eligibility.security.required ? `Required, ${d.eligibility.security.coverPct}% cover` : "Not required"} />
          <Fact k="Minimum credit score" v={d.eligibility.minCreditScore > 0 ? String(d.eligibility.minCreditScore) : "Inherits the credit policy"} />
          <Fact k="Minimum loan limit" v={d.limit.floor > 0 ? kes(d.limit.floor) : "No floor"} />
          <Fact k="Sold through" v={d.availability.channels.join(", ") || "nowhere"} />
        </Column>
      </div>

      {/* ── The book ── */}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Stat icon={Wallet} label="Outstanding" value={kes(book.outstanding)} />
        <Stat icon={Users} label="Live loans" value={String(book.activeCount)} />
        <Stat icon={TrendingUp} label="Loans ever booked" value={String(book.loanCount)} />
      </div>

      {/* ── Tabs ── */}
      <div className="mt-6 flex gap-1.5 overflow-x-auto pb-1">
        {TABS.map((t) => {
          const on = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-[12px] font-semibold transition-colors ${
                on ? "text-white" : "text-[color:var(--ink-body)] hover:bg-[color:var(--ink)]/[0.04]"
              }`}
              style={on ? { backgroundColor: "var(--brand)" } : undefined}
            >
              <t.icon className="h-3.5 w-3.5" /> {t.label}
              {t.count !== null && t.count > 0 && (
                <span className={`rounded-full px-1.5 text-[10px] font-bold ${on ? "bg-white/20" : "bg-[color:var(--ink)]/[0.07]"}`}>
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <section className="glass mt-3 p-4 sm:p-5">
        {tab === "charges" && (
          charges.length === 0 ? (
            <p className="t-meta text-[12.5px]">
              No fees. The product costs what its interest rate says and nothing more.
            </p>
          ) : (
            <ul className="divide-y divide-[color:var(--ink)]/[0.06]">
              {charges.map((c) => (
                <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                  style={c.isActive ? undefined : { opacity: 0.5 }}>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-[color:var(--ink)]">
                      {c.name}
                      <span className="rounded bg-[color:var(--ink)]/[0.06] px-1.5 py-0.5 font-mono text-[10px]">{c.code}</span>
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide"
                        style={c.isMandatory
                          ? { backgroundColor: "var(--brand-soft)", color: "var(--ink)" }
                          : { backgroundColor: "rgba(15,15,25,0.06)", color: "var(--ink-muted)" }}
                      >
                        {c.isMandatory ? "Mandatory" : "Optional"}
                      </span>
                      {!c.ownedByProduct && (
                        <span className="rounded-full bg-[color:var(--ink)]/[0.06] px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-[color:var(--ink-muted)]">
                          Every product
                        </span>
                      )}
                    </p>
                    <p className="t-meta mt-0.5 text-[11px]">
                      {CHARGE_APPLY_AT.find((a) => a.key === c.applyAt)?.label}
                      {c.minPrincipal !== null || c.maxPrincipal !== null
                        ? ` · loans ${c.minPrincipal ? kes(c.minPrincipal) : "any"} – ${c.maxPrincipal ? kes(c.maxPrincipal) : "any"}`
                        : ""}
                      {c.glAccount ? ` · posts to ${c.glAccount}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-[12.5px] font-bold tabular-nums text-[color:var(--ink)]">
                    {describeCharge(c)}
                  </span>
                </li>
              ))}
            </ul>
          )
        )}

        {tab === "rollover" && (
          !d.rollover.enabled ? (
            <p className="t-meta text-[12.5px]">
              No rollover penalty. A loan that runs past maturity accrues the arrears
              penalty of {d.pricing.penaltyRate}% and nothing else.
            </p>
          ) : (
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              <Fact k="Applied" v={d.rollover.applyAt === "maturity" ? "Once, at loan maturity" : "At every missed instalment"} />
              <Fact k="Charged on" v={d.rollover.penaltyBase.replace(/_/g, " ")} />
              <Fact k="Grace" v={`${d.rollover.graceDays} days`} />
              <Fact k="Penalty" v={d.rollover.valueType === "percent" ? `${d.rollover.value}%` : kes(d.rollover.value)} />
              <Fact k="Frequency" v={d.rollover.recurrence === "once" ? "One time" : `Every ${d.rollover.everyDays} days`} />
              <Fact k="Cap" v={d.rollover.cap > 0 ? kes(d.rollover.cap) : "No limit"} />
            </dl>
          )
        )}

        {tab === "evidence" && (
          <div className="space-y-4">
            <div>
              <p className="t-label">Attachments required</p>
              {d.evidence.documents.length === 0 ? (
                <p className="t-meta mt-1 text-[12.5px]">None.</p>
              ) : (
                <p className="t-meta mt-1 text-[12.5px]">{d.evidence.documents.join(" · ")}</p>
              )}
            </div>
            <div>
              <p className="t-label">Automated checks</p>
              {d.evidence.checks.length === 0 ? (
                <p className="t-meta mt-1 text-[12.5px]">
                  None on the product itself — whatever its workflow stages run still applies.
                </p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {d.evidence.checks.map((c) => (
                    <li key={c.id} className="text-[12.5px] text-[color:var(--ink-body)]">
                      <span className="font-semibold text-[color:var(--ink)]">{CHECK_BY_ID[c.id]?.label ?? c.id}</span>
                      <span className="t-meta"> — {c.blocking ? "must pass" : "advisory"}
                        {c.threshold ? `, minimum ${c.threshold}` : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="t-label">On the ground</p>
              <p className="t-meta mt-1 text-[12.5px]">
                {[
                  d.evidence.requireGeoPin ? "A location must be on file" : null,
                  d.evidence.requireFieldVisit ? "a field officer must verify in person" : null,
                ].filter(Boolean).join(", ") || "Nothing required."}
              </p>
            </div>
          </div>
        )}

        {tab === "history" && (
          versions.length === 0 ? (
            <p className="t-meta text-[12.5px]">
              This product predates versioning. The next publish records v1 and every loan
              from then on can say what it agreed to.
            </p>
          ) : (
            <ul className="divide-y divide-[color:var(--ink)]/[0.06]">
              {versions.map((v) => (
                <li key={v.version} className="flex flex-wrap items-baseline justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-[color:var(--ink)]">
                      v{v.version}{v.version === version ? " · live" : ""}
                    </p>
                    <p className="t-meta text-[11px]">
                      {v.note || (v.changed.length ? `changed: ${v.changed.join(", ")}` : "initial")}
                    </p>
                  </div>
                  <span className="t-meta shrink-0 text-[11px]">
                    {v.loanCount} loan{v.loanCount === 1 ? "" : "s"} held to it ·{" "}
                    {new Date(v.createdAt).toLocaleDateString("en-KE", { dateStyle: "medium" })}
                  </span>
                </li>
              ))}
            </ul>
          )
        )}
      </section>
    </main>
  );
}

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="t-label border-b border-[color:var(--ink)]/[0.07] pb-1.5">{title}</p>
      <dl className="mt-2 space-y-1.5">{children}</dl>
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="t-meta shrink-0 text-[11px]">{k}</dt>
      <dd className="text-right text-[12px] font-semibold text-[color:var(--ink)]">{v}</dd>
    </div>
  );
}

function Stat({
  icon: Icon, label, value,
}: {
  icon: React.ComponentType<{ className?: string }>; label: string; value: string;
}) {
  return (
    <div className="glass flex items-center justify-between gap-3 px-4 py-3">
      <div>
        <p className="t-label">{label}</p>
        <p className="mt-0.5 text-[1.15rem] font-bold tabular-nums text-[color:var(--ink)]">{value}</p>
      </div>
      <Icon className="h-5 w-5 shrink-0 text-[color:var(--ink-faint)]" />
    </div>
  );
}
