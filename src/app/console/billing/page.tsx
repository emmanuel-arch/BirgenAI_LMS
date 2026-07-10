"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Loader2, AlertTriangle, CheckCircle2, Crown, Banknote, RefreshCw, Gauge, FlaskConical, FileText,
} from "lucide-react";

// Billing. The lender sees what they are on, what they have used, and what it will
// cost — then pays through the BirgenAI wallet, which is where every payment on
// this platform settles. This page never touches M-Pesa itself.

type Line = { kind: string; label: string; used: number; included: number; overage: number; unitPriceKes: number; costKes: number };
type Plan = { key: string; name: string; monthlyKes: number; blurb: string; features: string[]; seats: number | null };
type Invoice = {
  id: string; number: string; periodStart: string; periodEnd: string; plan: string;
  planFeeKes: number; overageKes: number; totalKes: number; status: string; paidAt: string | null;
};
type Billing = {
  plan: Plan; features: string[]; status: string; paying: boolean; trialEndsAt: string | null;
  invoices: Invoice[];
  period: { start: string; end: string }; seats: number | null; lines: Line[];
  estimate: { baseKes: number; overageKes: number; totalKes: number };
  catalogue: Plan[]; payment: { via: string; mode: "live" | "simulation" }; canPay: boolean;
};

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

const STATUS_TONE: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-700",
  TRIALING: "bg-sky-100 text-sky-700",
  PAST_DUE: "bg-amber-100 text-amber-700",
  CANCELED: "bg-rose-100 text-rose-700",
};

export default function BillingPage() {
  const [data, setData] = useState<Billing | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/console/billing");
      const d = await res.json();
      if (!d.success) { setError(d.message || "Could not load billing."); return; }
      setData(d);
    } catch { setError("Could not load billing."); }
  };
  useEffect(() => { void load(); }, []);

  const pay = async (planKey: string) => {
    setBusy(planKey); setError(null);
    try {
      const res = await fetch("/api/console/billing", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "checkout", plan: planKey, returnTo: window.location.href }),
      });
      const d = await res.json();
      if (!d.success) { setError(d.message || "Could not start the payment."); return; }
      // Hand off to the Hub's centralised checkout — it owns the Till and the receipt.
      window.location.href = d.url;
    } catch { setError("Could not start the payment."); } finally { setBusy(null); }
  };

  const sync = async () => {
    setBusy("sync"); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/console/billing", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync" }),
      });
      const d = await res.json();
      setNotice(d.message);
      await load();
    } catch { setError("Could not reach the wallet."); } finally { setBusy(null); }
  };

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center text-zinc-500">
        {error ? <span className="text-red-600">{error}</span> : <Loader2 className="h-5 w-5 animate-spin" />}
      </div>
    );
  }

  const usedPct = (l: Line) => (l.included > 0 ? Math.min(100, (l.used / l.included) * 100) : l.used > 0 ? 100 : 0);

  return (
    <div className="min-h-screen relative text-zinc-900">
      <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />
      <main className="relative z-10 mx-auto max-w-5xl px-4 sm:px-6 py-8">
        <Link href="/console" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800">
          <ArrowLeft className="h-4 w-4" /> Console
        </Link>

        {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}</div>}
        {notice && <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50/90 px-3 py-2.5 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> {notice}</div>}

        {/* Current package + this month's estimate */}
        <div className="mt-3 glass p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Crown className="h-5 w-5" style={{ color: "var(--brand)" }} />
                <h1 className="text-xl font-bold">{data.plan.name}</h1>
                <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[data.status] ?? "bg-zinc-900/5 text-zinc-500"}`}>
                  {data.status.replace("_", " ")}
                </span>
              </div>
              <p className="mt-1.5 text-sm text-zinc-500">{data.plan.blurb}</p>
              <p className="mt-1 text-xs text-zinc-400">
                Billing period {day(data.period.start)} – {day(data.period.end)} ·{" "}
                {data.seats === null ? "Unlimited seats" : `${data.seats} seats`}
                {data.status === "TRIALING" && data.trialEndsAt ? ` · trial ends ${day(data.trialEndsAt)}` : ""}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-wide text-zinc-500">Estimated this month</p>
              <p className="text-3xl font-bold">{kes(data.estimate.totalKes)}</p>
              <p className="text-xs text-zinc-400">
                {kes(data.estimate.baseKes)} package
                {data.estimate.overageKes > 0 ? ` + ${kes(data.estimate.overageKes)} usage` : ""}
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {data.canPay && (
              <button onClick={() => pay(data.plan.key)} disabled={busy !== null}
                className="inline-flex items-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: "#1E8B3A" }}>
                {busy === data.plan.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />}
                Pay with M-PESA
              </button>
            )}
            <button onClick={sync} disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-900/15 bg-white/70 px-4 py-3 text-sm text-zinc-700 hover:bg-white disabled:opacity-60">
              {busy === "sync" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh from wallet
            </button>
            {data.payment.mode === "simulation" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-700">
                <FlaskConical className="h-3 w-3" /> WALLET NOT CONNECTED
              </span>
            )}
          </div>
          <p className="mt-2.5 text-[11px] text-zinc-400">
            Payments settle in the BirgenAI wallet — the same Till and receipt as every other BirgenAI service.
            The final amount is confirmed there.
          </p>
        </div>

        {/* Usage this period */}
        <div className="mt-5 glass p-5 sm:p-6">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Gauge className="h-4 w-4" style={{ color: "var(--brand)" }} /> Usage this period
          </h2>
          {data.lines.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">Nothing metered yet this month.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {data.lines.map((l) => (
                <div key={l.kind}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium">{l.label}</span>
                    <span className="tabular-nums text-zinc-600">
                      {l.used.toLocaleString()}
                      <span className="text-zinc-400"> / {l.included.toLocaleString()} included</span>
                      {l.overage > 0 && <span className="ml-2 font-semibold text-amber-700">+{l.overage.toLocaleString()} × {kes(l.unitPriceKes)} = {kes(l.costKes)}</span>}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-900/5">
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${usedPct(l)}%`, backgroundColor: l.overage > 0 ? "#d97706" : "var(--brand)" }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Closed months. These never recompute — they are what was owed. */}
        {data.invoices?.length > 0 && (
          <div className="mt-5 glass p-5 sm:p-6">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <FileText className="h-4 w-4" style={{ color: "var(--brand)" }} /> Invoices
            </h2>
            <p className="mt-1 text-[11px] text-zinc-400">
              Each closed month, priced as it was charged. These do not change when our prices do.
            </p>
            <div className="mt-3 space-y-1.5">
              {data.invoices.map((inv) => (
                <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/70 px-3 py-2">
                  <div>
                    <p className="text-xs font-semibold">{inv.number}</p>
                    <p className="text-[11px] text-zinc-400">
                      {new Date(inv.periodStart).toLocaleDateString("en-GB", { month: "long", year: "numeric" })} · {inv.plan.toLowerCase()}
                      {inv.overageKes > 0 ? ` · ${kes(inv.planFeeKes)} + ${kes(inv.overageKes)} usage` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold tabular-nums">{kes(inv.totalKes)}</span>
                    <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${inv.status === "PAID" ? "bg-emerald-100 text-emerald-700" : inv.status === "VOID" ? "bg-zinc-900/5 text-zinc-500" : "bg-amber-100 text-amber-700"}`}>
                      {inv.status.toLowerCase()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* The four packages */}
        <h2 className="mt-8 text-sm font-semibold">Packages</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {data.catalogue.map((p) => {
            const current = p.key === data.plan.key;
            return (
              <div key={p.key}
                className={`glass p-4 flex flex-col ${current ? "ring-2" : ""}`}
                style={current ? { boxShadow: "0 0 0 2px var(--brand)" } : undefined}>
                <p className="text-sm font-bold">{p.name}</p>
                <p className="mt-1 text-2xl font-bold">
                  {(p.monthlyKes / 1000).toLocaleString()}K
                  <span className="text-xs font-normal text-zinc-400"> KES/mo</span>
                </p>
                <p className="mt-1.5 text-xs text-zinc-500 flex-1">{p.blurb}</p>
                <p className="mt-2 text-[11px] text-zinc-400">{p.seats === null ? "Unlimited seats" : `${p.seats} seats`}</p>
                {current ? (
                  <span className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg bg-zinc-900/5 px-3 py-2 text-xs font-semibold text-zinc-500">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Current
                  </span>
                ) : data.canPay ? (
                  <button onClick={() => pay(p.key)} disabled={busy !== null}
                    className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
                    {busy === p.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    {p.monthlyKes > data.plan.monthlyKes ? "Upgrade" : "Switch"}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
