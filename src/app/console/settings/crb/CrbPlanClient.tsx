"use client";

// ─────────────────────────────────────────────────────────────────────────────
// BUREAU SCRUTINY — choose how hard to look, and see what looking costs.
//
// THE PROBLEM THIS SCREEN SOLVES. Metropol sell fourteen separately-priced
// reports. Until now the platform bought a fixed three of them for every check,
// for every lender, at every loan size. That is simultaneously too much for a
// KES 2,000 mobile top-up and too little for a KES 400,000 check-off — and the
// lender had no way to see either, because nothing on any screen said what a
// pull cost.
//
// So this screen is built around one idea: EVERY CHOICE SHOWS ITS PRICE. Pick a
// tier and the per-check cost moves. Toggle a report and the monthly projection
// moves. Widen the reuse window and the saving moves. The lender is not choosing
// a setting, they are buying something, and the screen behaves like it.
//
// THREE HONESTY RULES ARE ENFORCED IN THE UI, NOT JUST THE COPY:
//
//   1. INDICATIVE PRICES ARE LABELLED AS SUCH, EVERYWHERE. Metropol have not
//      issued Micromart's tariff sheet yet. Every figure derived from a
//      placeholder carries the word "indicative" — not once at the bottom, but
//      on the number itself. A projection quietly built on guesses is how a
//      lender budgets wrong.
//
//   2. REDUNDANCY IS CALLED OUT. Report 12 already contains reports 1, 6 and 8.
//      Selecting them alongside it is money spent twice for the same bytes, so
//      the screen says so at the point of selection.
//
//   3. WHAT YOU LOSE IS SHOWN, NOT JUST WHAT YOU SAVE. Dropping to a cheaper
//      tier removes specific intelligence — income estimation, guarantors, the
//      12-month behaviour trend. The screen names them.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  ShieldCheck, Loader2, Save, ArrowLeft, AlertTriangle, CheckCircle2, Info,
  Layers, Wallet, Clock, Gauge, TrendingDown, Copy, KeyRound, FlaskConical,
} from "lucide-react";
import { useLoad } from "@/lib/hooks/useLoad";
import { PageHeader } from "@/components/shell/PageHeader";
import { NumberField, SelectField, Divider } from "@/components/settings/controls";
import {
  CRB_REPORTS, SCRUTINY_TIERS, DEFAULT_LADDER, resolvePlan, projectSpend, repeatRateFor,
  reportByCode, tierByKey,
  type ScrutinyTierKey, type LadderRung,
} from "@/lib/crb/catalogue";

const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;
const kes2 = (n: number) => `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type PlanState = {
  scrutinyTier: ScrutinyTierKey;
  reports: number[];
  ladder: LadderRung[];
  ladderOn: boolean;
  tariff: Record<string, number>;
  reuseHours: number;
  monthlyChecks: number;
  monthlyBudget: number;
  budgetAction: "warn" | "downgrade" | "block";
  environment: "test" | "production" | "";
};

type Credentials = {
  bureau: string | null;
  host: string | null;
  port: string | null;
  apiVersion: string | null;
  publicKey: string | null;
  privateKey: string | null;
  configured: boolean;
};

const BLANK: PlanState = {
  scrutinyTier: "standard",
  reports: [],
  ladder: DEFAULT_LADDER,
  ladderOn: false,
  tariff: {},
  reuseHours: 6,
  monthlyChecks: 500,
  monthlyBudget: 0,
  budgetAction: "warn",
  environment: "",
};

export default function CrbPlanClient() {
  const [state, setState] = useState<PlanState>(BLANK);
  const [creds, setCreds] = useState<Credentials | null>(null);
  const [actual, setActual] = useState<{ checks: number; spend: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [flash, setFlash] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  useLoad(() => {
    void (async () => {
      try {
        const r = await fetch("/api/console/crb/plan");
        const j = await r.json();
        if (j?.success) {
          const p = j.plan ?? {};
          setState({
            scrutinyTier: (p.scrutinyTier as ScrutinyTierKey) ?? "standard",
            reports: Array.isArray(p.reports) ? p.reports : [],
            ladder: Array.isArray(p.ladder) && p.ladder.length ? p.ladder : DEFAULT_LADDER,
            ladderOn: Array.isArray(p.ladder) && p.ladder.length > 0,
            tariff: p.tariff ?? {},
            reuseHours: p.reuseHours ?? 6,
            monthlyChecks: p.monthlyChecks ?? 500,
            monthlyBudget: p.monthlyBudget ?? 0,
            budgetAction: p.budgetAction ?? "warn",
            environment: p.environment ?? "",
          });
          setCreds(j.credentials ?? null);
          setActual(j.actual ?? null);
        }
      } finally {
        setLoading(false);
      }
    })();
  });

  const set = useCallback(<K extends keyof PlanState>(key: K, value: PlanState[K]) => {
    setState((s) => ({ ...s, [key]: value }));
    setDirty(true);
    setFlash(null);
  }, []);

  // ── The live plan and its price ─────────────────────────────────────────────
  const plan = useMemo(
    () => resolvePlan({ tier: state.scrutinyTier, reports: state.reports, tariff: state.tariff }),
    [state.scrutinyTier, state.reports, state.tariff],
  );

  const projection = useMemo(
    () =>
      projectSpend({
        perCheck: plan.perCheck,
        monthlyChecks: state.monthlyChecks,
        reuseHours: state.reuseHours,
        monthlyBudget: state.monthlyBudget || null,
      }),
    [plan.perCheck, state.monthlyChecks, state.reuseHours, state.monthlyBudget],
  );

  // Every tier priced at the lender's own volume — so the comparison is theirs,
  // not a brochure's.
  const tierPrices = useMemo(
    () =>
      SCRUTINY_TIERS.map((t) => {
        const p = resolvePlan({ tier: t.key, tariff: state.tariff });
        return {
          tier: t,
          perCheck: p.perCheck,
          monthly: projectSpend({
            perCheck: p.perCheck,
            monthlyChecks: state.monthlyChecks,
            reuseHours: state.reuseHours,
          }).net,
        };
      }),
    [state.tariff, state.monthlyChecks, state.reuseHours],
  );

  // What a cheaper tier would cost you in intelligence, named explicitly.
  const lostVsForensic = useMemo(() => {
    const have = new Set(plan.reports);
    return CRB_REPORTS.filter((r) => tierByKey("forensic")!.reports.includes(r.code) && !have.has(r.code));
  }, [plan.reports]);

  const toggleReport = (code: number) => {
    const inCustom = state.scrutinyTier === "custom";
    const base = inCustom ? state.reports : (plan.reports as number[]);
    const next = base.includes(code) ? base.filter((c) => c !== code) : [...base, code];
    setState((s) => ({ ...s, scrutinyTier: "custom", reports: next }));
    setDirty(true);
    setFlash(null);
  };

  const save = async () => {
    setSaving(true);
    setFlash(null);
    try {
      const r = await fetch("/api/console/crb/plan", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scrutinyTier: state.scrutinyTier,
          reports: state.reports,
          ladder: state.ladderOn ? state.ladder : null,
          tariff: state.tariff,
          reuseHours: state.reuseHours,
          monthlyChecks: state.monthlyChecks,
          monthlyBudget: state.monthlyBudget || null,
          budgetAction: state.budgetAction,
          environment: state.environment || undefined,
        }),
      });
      const j = await r.json();
      if (j?.success) {
        setDirty(false);
        setFlash({ tone: "ok", text: "Saved. Every check from now on buys this report set." });
      } else {
        setFlash({ tone: "bad", text: j?.message ?? "Could not save." });
      }
    } catch {
      setFlash({ tone: "bad", text: "Could not reach the server." });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-16 text-center sm:px-6">
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-ash-400" />
      </main>
    );
  }

  const indicative = plan.tariffSource !== "metropol";

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        icon={ShieldCheck}
        title="Bureau scrutiny"
        subtitle="How hard to look at a borrower's credit file — and what looking costs. Metropol sell fourteen separately-priced reports; this is which of them you buy."
      >
        <Link
          href="/console/settings"
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-ash-600 hover:bg-ash-900/5"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Settings
        </Link>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-invert px-4 py-2 text-xs font-semibold text-invert-fg hover:bg-invert-2 disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {dirty ? "Save plan" : "Saved"}
        </button>
      </PageHeader>

      {flash && (
        <div
          className={`mt-4 flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-[13px] ring-1 ${
            flash.tone === "ok" ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-rose-50 text-rose-800 ring-rose-200"
          }`}
        >
          {flash.tone === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
          {flash.text}
        </div>
      )}

      {/* ── Connection state: are we even live, and on which keys? ───────────── */}
      <ConnectionStrip creds={creds} environment={state.environment} onEnvironment={(v) => set("environment", v)} />

      {/* ── The headline: what one check costs, and what a month costs ───────── */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={Layers}
          label="Per check"
          value={kes2(plan.perCheck)}
          hint={`${plan.reports.length} report${plan.reports.length === 1 ? "" : "s"} · ${plan.tierName}`}
          indicative={indicative}
        />
        <Stat
          icon={Wallet}
          label="Projected · month"
          value={kes(projection.net)}
          hint={`${projection.billableChecks.toLocaleString()} billable of ${projection.monthlyChecks.toLocaleString()} checks`}
          indicative={indicative}
        />
        <Stat
          icon={TrendingDown}
          label="Saved by reuse"
          value={kes(projection.saved)}
          hint={`${Math.round(projection.repeatRate * 100)}% of checks served from a stored pull`}
          tone="text-emerald-600"
          indicative={indicative}
        />
        <Stat
          icon={Gauge}
          label="Scrutiny reached"
          value={`${plan.scrutiny}%`}
          hint={plan.scrutiny >= 90 ? "The whole file" : plan.scrutiny >= 60 ? "The credit history" : "A screen, not a file"}
        />
      </div>

      {indicative && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800 ring-1 ring-amber-200">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <strong>These prices are indicative.</strong> Metropol&apos;s Developer Guide is a technical specification and
            carries no tariff — the commercial sheet for this account has not been issued yet. The figures above use
            placeholder per-report prices that carry the right shape, not quoted rates. Enter the real tariff below the
            moment it arrives and every projection on this platform re-prices itself.
          </span>
        </p>
      )}

      {/* ── Tier picker ──────────────────────────────────────────────────────── */}
      <Divider label="How hard to look" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tierPrices.map(({ tier, perCheck, monthly }) => {
          const active = state.scrutinyTier === tier.key;
          return (
            <button
              key={tier.key}
              type="button"
              onClick={() => { set("scrutinyTier", tier.key); set("reports", [...tier.reports] as number[]); }}
              className={`rounded-2xl border p-4 text-left transition-all ${
                active ? "border-transparent shadow-lg ring-2" : "border-ash-900/10 bg-paper hover:border-ash-900/20"
              }`}
              style={active ? { backgroundColor: `${tier.accent}0d`, boxShadow: `0 0 0 2px ${tier.accent}` } : undefined}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-bold" style={{ color: tier.accent }}>{tier.name}</p>
                <span className="shrink-0 rounded-md bg-ash-900/[0.06] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-ash-600">
                  {tier.reports.length} rpt
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-ash-600">{tier.purpose}</p>
              <p className="mt-2 text-[10px] uppercase tracking-wide text-ash-400">{tier.suitedTo}</p>
              <div className="mt-2 flex items-baseline justify-between border-t border-ash-900/5 pt-2">
                <span className="text-sm font-bold tabular-nums text-ash-800">{kes2(perCheck)}</span>
                <span className="text-[10px] tabular-nums text-ash-500">{kes(monthly)}/mo</span>
              </div>
            </button>
          );
        })}
        <div
          className={`rounded-2xl border p-4 ${
            state.scrutinyTier === "custom" ? "border-transparent bg-ash-900/[0.04] shadow-lg ring-2 ring-ash-900" : "border-dashed border-ash-900/20"
          }`}
        >
          <p className="text-sm font-bold text-ash-800">Custom</p>
          <p className="mt-1 text-[11px] leading-snug text-ash-600">
            Pick reports individually below. Selecting any report switches you here.
          </p>
          {state.scrutinyTier === "custom" && (
            <div className="mt-2 flex items-baseline justify-between border-t border-ash-900/5 pt-2">
              <span className="text-sm font-bold tabular-nums text-ash-800">{kes2(plan.perCheck)}</span>
              <span className="text-[10px] tabular-nums text-ash-500">{kes(projection.net)}/mo</span>
            </div>
          )}
        </div>
      </div>

      {/* ── What this plan does not buy ──────────────────────────────────────── */}
      {lostVsForensic.length > 0 && (
        <div className="mt-3 rounded-xl bg-ash-900/[0.03] px-3.5 py-3 ring-1 ring-ash-900/[0.06]">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ash-500">Not bought at this level</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {lostVsForensic.map((r) => (
              <span key={r.code} className="rounded-md bg-paper px-2 py-1 text-[11px] text-ash-600 ring-1 ring-ash-900/10" title={r.answers}>
                {r.name}
              </span>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-ash-500">
            Every officer decision made on this plan is made without the above. That is a legitimate trade — it is only a
            problem when nobody chose it.
          </p>
        </div>
      )}

      {/* ── The report catalogue ─────────────────────────────────────────────── */}
      <Divider label="The report catalogue" />
      <p className="-mt-2 mb-3 text-[12px] leading-snug text-ash-500">
        Every report Metropol expose (Developer Guide v3.8 §5.1), what each answers, and its price. Tick to include it in
        your plan; type over the price when Metropol issue your tariff sheet.
      </p>
      <div className="space-y-2">
        {CRB_REPORTS.map((r) => {
          const on = plan.reports.includes(r.code);
          const dup = plan.redundant.find((x) => x.code === r.code);
          const price = state.tariff[String(r.code)] ?? r.indicativeTariff;
          const custom = state.tariff[String(r.code)] != null;
          return (
            <div
              key={r.code}
              className={`rounded-xl border p-3 transition-colors ${
                on ? "border-[color:var(--brand)]/40 bg-[color:var(--brand-soft)]" : "border-ash-900/10 bg-paper"
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggleReport(r.code)}
                  className="mt-1 h-4 w-4 shrink-0 accent-[color:var(--brand)]"
                  aria-label={`Include ${r.name}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded bg-ash-900/[0.07] px-1.5 py-0.5 font-mono text-[10px] font-bold text-ash-600">
                      {r.code}
                    </span>
                    <p className="text-[13px] font-semibold text-ash-800">{r.name}</p>
                    {!r.wired && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-700" title="Callable, but not yet merged into the borrower file">
                        raw only
                      </span>
                    )}
                    {dup && (
                      <span className="inline-flex items-center gap-1 rounded bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-rose-700">
                        <Copy className="h-2.5 w-2.5" /> in report {dup.containedBy}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[12px] italic leading-snug text-ash-600">{r.answers}</p>
                  <p className="mt-1 text-[11px] leading-snug text-ash-500">{r.yields.join(" · ")}</p>
                  <p className="mt-1 font-mono text-[10px] text-ash-400">
                    {r.method} {r.endpoint}
                    {r.needsLoanAmount ? " · loan_amount" : ""}
                    {r.needsReportReason ? " · report_reason" : ""}
                  </p>
                </div>
                <div className="w-28 shrink-0 text-right">
                  <label className="block text-[9px] uppercase tracking-wide text-ash-400">
                    {custom ? "tariff" : "indicative"}
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={price}
                    onChange={(e) => {
                      const v = e.target.value;
                      const next = { ...state.tariff };
                      if (v === "") delete next[String(r.code)];
                      else next[String(r.code)] = Math.max(0, Number(v) || 0);
                      set("tariff", next);
                    }}
                    className={`mt-0.5 w-full rounded-lg border px-2 py-1 text-right text-xs tabular-nums outline-none focus:ring-2 focus:ring-[color:var(--brand)] ${
                      custom ? "border-emerald-300 bg-emerald-50 font-semibold text-emerald-800" : "border-ash-900/10 bg-paper text-ash-600"
                    }`}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {plan.redundant.length > 0 && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-[11px] text-rose-800 ring-1 ring-rose-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            You are paying twice for the same data.{" "}
            {plan.redundant.map((d) => `Report ${d.code} is already inside report ${d.containedBy}`).join("; ")}. Removing
            the smaller report changes nothing in the borrower file and saves{" "}
            {kes2(plan.redundant.reduce((s, d) => s + (state.tariff[String(d.code)] ?? reportByCode(d.code)?.indicativeTariff ?? 0), 0))} per check.
          </span>
        </p>
      )}

      {/* ── Scrutiny proportional to exposure ────────────────────────────────── */}
      <Divider label="Scrutiny proportional to exposure" />
      <div className="rounded-2xl border border-ash-900/10 bg-paper p-4">
        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={state.ladderOn}
            onChange={(e) => set("ladderOn", e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[color:var(--brand)]"
          />
          <span>
            <span className="text-[13px] font-semibold text-ash-800">Vary the tier with the loan amount</span>
            <span className="block text-[11px] leading-snug text-ash-500">
              The single most common way a lender overspends at a bureau is buying the same depth of file for a KES 3,000
              loan as for a KES 300,000 one. With the ladder on, the tier above becomes the fallback for checks that carry
              no amount — an ad-hoc Customer-360 pull.
            </span>
          </span>
        </label>

        {state.ladderOn && (
          <div className="mt-3 space-y-2">
            {state.ladder.map((rung, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-ash-900/[0.03] px-3 py-2">
                <span className="text-[11px] text-ash-500">{i === 0 ? "Up to" : "then up to"}</span>
                {rung.upTo === null ? (
                  <span className="text-[13px] font-semibold text-ash-800">any amount above</span>
                ) : (
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={rung.upTo}
                    onChange={(e) => {
                      const next = [...state.ladder];
                      next[i] = { ...rung, upTo: Math.max(0, Number(e.target.value) || 0) };
                      set("ladder", next);
                    }}
                    className="w-32 rounded-lg border border-ash-900/10 bg-paper px-2 py-1 text-right text-xs tabular-nums outline-none focus:ring-2 focus:ring-[color:var(--brand)]"
                  />
                )}
                <span className="text-[11px] text-ash-500">→</span>
                <select
                  value={rung.tier}
                  onChange={(e) => {
                    const next = [...state.ladder];
                    next[i] = { ...rung, tier: e.target.value as LadderRung["tier"] };
                    set("ladder", next);
                  }}
                  className="rounded-lg border border-ash-900/10 bg-paper px-2 py-1 text-xs font-semibold outline-none focus:ring-2 focus:ring-[color:var(--brand)]"
                >
                  {SCRUTINY_TIERS.map((t) => (
                    <option key={t.key} value={t.key}>{t.name}</option>
                  ))}
                </select>
                <span className="ml-auto text-[11px] tabular-nums text-ash-500">
                  {kes2(resolvePlan({ tier: rung.tier, tariff: state.tariff }).perCheck)} / check
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Volume, reuse and budget ─────────────────────────────────────────── */}
      <Divider label="Volume, freshness and budget" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-2xl border border-ash-900/10 bg-paper p-4">
          <NumberField
            label="Checks per month"
            value={state.monthlyChecks}
            onChange={(v) => set("monthlyChecks", Math.max(0, v))}
            help="Your own expected volume. Drives every projection on this screen."
          />
          <div>
            <label className="t-label">How long a stored pull stays fresh</label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {[
                { h: 1, label: "1 hour" },
                { h: 6, label: "6 hours" },
                { h: 24, label: "1 day" },
                { h: 24 * 7, label: "1 week" },
                { h: 24 * 30, label: "1 month" },
              ].map((o) => (
                <button
                  key={o.h}
                  type="button"
                  onClick={() => set("reuseHours", o.h)}
                  className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                    state.reuseHours === o.h ? "bg-invert text-invert-fg" : "bg-ash-900/[0.06] text-ash-600 hover:bg-ash-900/10"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-snug text-ash-500">
              <Clock className="mt-0.5 h-3 w-3 shrink-0" />
              A repeat pull inside the window is served from the stored file and costs nothing. It is also what keeps you
              clear of Metropol&apos;s <strong>E409</strong> guard, which rejects an identical call inside 60 seconds. At{" "}
              {state.reuseHours >= 24 ? `${Math.round(state.reuseHours / 24)} day${state.reuseHours >= 48 ? "s" : ""}` : `${state.reuseHours} hour${state.reuseHours === 1 ? "" : "s"}`}{" "}
              we model <strong>{Math.round(repeatRateFor(state.reuseHours) * 100)}%</strong> of checks landing on a stored
              file. A longer window is cheaper and staler — on a fast-moving mobile book, a week-old bureau file has
              already missed two new lenders.
            </p>
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border border-ash-900/10 bg-paper p-4">
          <NumberField
            label="Monthly bureau budget (KES)"
            value={state.monthlyBudget}
            onChange={(v) => set("monthlyBudget", Math.max(0, v))}
            help="Zero = uncapped."
          />
          <SelectField
            label="When the budget runs out"
            value={state.budgetAction}
            onChange={(v) => set("budgetAction", v as PlanState["budgetAction"])}
            options={[
              { value: "warn", label: "Warn, keep pulling (recommended)" },
              { value: "downgrade", label: "Drop to the cheapest tier that fits" },
              { value: "block", label: "Stop live pulls, fall back to simulation" },
            ]}
          />
          <p className="text-[11px] leading-snug text-ash-500">
            <strong>Warn</strong> is the default on purpose. Blocking bureau access mid-month does not save money, it
            moves the cost: every decision made after the block is made blind, and one bad KES 200,000 loan costs more
            than a year of reports.
          </p>

          {projection.budget != null && (
            <div className="rounded-xl bg-ash-900/[0.03] p-3">
              <div className="flex items-baseline justify-between text-[11px]">
                <span className="text-ash-500">Projected against budget</span>
                <span className={`font-bold tabular-nums ${projection.overBudget ? "text-rose-600" : "text-emerald-600"}`}>
                  {Math.round(projection.budgetUsedPct ?? 0)}%
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ash-900/[0.08]">
                <div
                  className="h-full rounded-r-full transition-all"
                  style={{
                    width: `${Math.min(100, projection.budgetUsedPct ?? 0)}%`,
                    backgroundColor: projection.overBudget ? "#e11d48" : "#059669",
                  }}
                />
              </div>
              {projection.overBudget && (
                <p className="mt-1.5 text-[11px] font-semibold text-rose-700">
                  Over by {kes(projection.net - projection.budget)}. Drop a tier, shorten the report set, or widen the
                  reuse window.
                </p>
              )}
            </div>
          )}

          {actual && (
            <div className="rounded-xl bg-ash-900/[0.03] p-3">
              <p className="text-[10px] uppercase tracking-wide text-ash-500">Actually billed this month</p>
              <p className="mt-0.5 text-sm font-bold tabular-nums text-ash-800">
                {kes(actual.spend)} <span className="text-[11px] font-normal text-ash-500">over {actual.checks.toLocaleString()} checks</span>
              </p>
              <p className="mt-0.5 text-[11px] leading-snug text-ash-500">
                From the metering ledger — what was really charged, not a projection. If this and the figure above
                disagree by much, the volume estimate is wrong.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── The cost breakdown ───────────────────────────────────────────────── */}
      <Divider label="What one check buys" />
      <div className="overflow-hidden rounded-2xl border border-ash-900/10 bg-paper">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ash-900/[0.07] text-left text-[10px] uppercase tracking-wide text-ash-400">
              <th className="px-4 py-2 font-semibold">Report</th>
              <th className="px-4 py-2 font-semibold">Answers</th>
              <th className="px-4 py-2 text-right font-semibold">Per check</th>
              <th className="px-4 py-2 text-right font-semibold">Per month</th>
            </tr>
          </thead>
          <tbody>
            {plan.lines.map((l) => (
              <tr key={l.code} className="border-b border-ash-900/[0.04] last:border-0">
                <td className="px-4 py-2.5">
                  <span className="mr-1.5 rounded bg-ash-900/[0.07] px-1.5 py-0.5 font-mono text-[10px] font-bold text-ash-600">{l.code}</span>
                  <span className="text-[13px] font-medium text-ash-800">{l.name}</span>
                </td>
                <td className="px-4 py-2.5 text-[11px] italic text-ash-500">{reportByCode(l.code)?.answers}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  <span className={l.source === "metropol" ? "font-semibold text-emerald-700" : "text-ash-600"}>{kes2(l.cost)}</span>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ash-600">
                  {kes(l.cost * projection.billableChecks)}
                </td>
              </tr>
            ))}
            {plan.lines.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-ash-500">
                  This plan buys nothing. Every borrower will read as a thin file.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-ash-900/10 bg-ash-900/[0.03] font-bold">
              <td className="px-4 py-2.5 text-[13px]" colSpan={2}>
                {plan.tierName} · {plan.reports.length} report{plan.reports.length === 1 ? "" : "s"}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">{kes2(plan.perCheck)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{kes(projection.net)}</td>
            </tr>
            <tr className="text-[11px] text-ash-500">
              <td className="px-4 pb-3" colSpan={4}>
                {kes(projection.annual)} a year at this volume. Without the reuse window you would pay{" "}
                {kes(projection.gross)} a month instead of {kes(projection.net)}.
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="mt-6 text-[11px] leading-snug text-ash-400">
        Report definitions, endpoints and parameters are taken from the Metropol MA Kenya API Developer Guide v3.8 (§4.1,
        §4.3, §5.1–§5.8). Reports 1, 2, 3, 11 and 12 plus the health check have been verified live against
        api.metropol.co.ke:5555/v2_1.
      </p>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Stat({
  icon: Icon, label, value, hint, tone, indicative,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint: string;
  tone?: string;
  indicative?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-ash-900/10 bg-paper p-4">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-ash-400" />
        <p className="text-[10px] uppercase tracking-wide text-ash-500">{label}</p>
        {indicative && (
          <span className="ml-auto rounded bg-amber-100 px-1 py-0.5 text-[8px] font-bold uppercase text-amber-700" title="Built on placeholder prices — Metropol's tariff sheet has not been issued">
            est
          </span>
        )}
      </div>
      <p className={`mt-1 text-lg font-bold leading-tight tabular-nums ${tone ?? "text-ash-800"}`}>{value}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-ash-500">{hint}</p>
    </div>
  );
}

/**
 * The connection strip.
 *
 * `environment` is a DECLARATION, not a detection. There is no field in a
 * Metropol response that says "these are test keys" — the only symptom is E018
 * on any ID outside the five sandbox identities, which you discover by failing.
 * Recording which key set is loaded means the platform can label a sandbox pull
 * before it happens rather than after.
 */
function ConnectionStrip({
  creds, environment, onEnvironment,
}: {
  creds: Credentials | null;
  environment: string;
  onEnvironment: (v: "test" | "production" | "") => void;
}) {
  const live = creds?.configured;
  return (
    <div className={`mt-4 rounded-2xl border p-4 ${live ? "border-emerald-200 bg-emerald-50/60" : "border-amber-200 bg-amber-50/60"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-bold text-ash-800">
            <KeyRound className="h-3.5 w-3.5" />
            {live ? "Metropol connected" : "Metropol not connected"}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-ash-600">
            {creds?.host ?? "api.metropol.co.ke"}:{creds?.port ?? "5555"}/{creds?.apiVersion ?? "—"}
            {creds?.publicKey ? ` · key ${creds.publicKey}` : ""}
          </p>
          {!live && (
            <p className="mt-1 text-[11px] leading-snug text-amber-800">
              Keys, host, port and API version are entered in the integrations vault. Until they are there every check runs
              as a labelled simulation and costs nothing.
            </p>
          )}
        </div>
        <div className="shrink-0">
          <label className="block text-[9px] uppercase tracking-wide text-ash-500">Key set loaded</label>
          <div className="mt-1 flex gap-1">
            {([
              { v: "test", label: "Test", icon: FlaskConical },
              { v: "production", label: "Production", icon: ShieldCheck },
            ] as const).map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => onEnvironment(environment === o.v ? "" : o.v)}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                  environment === o.v ? "bg-invert text-invert-fg" : "bg-paper text-ash-600 ring-1 ring-ash-900/10 hover:bg-ash-900/5"
                }`}
              >
                <o.icon className="h-3 w-3" /> {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {environment === "test" && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            A test key pair only answers for five sandbox identities (550000055, 660000066, 770000077, 880000088,
            990000099) and returns <strong>E018</strong> for every real national ID. Pulls on this key set are labelled
            SANDBOX on the borrower file so nobody mistakes sandbox data for their customer&apos;s.
          </span>
        </p>
      )}
    </div>
  );
}
