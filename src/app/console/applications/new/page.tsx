"use client";

// ─────────────────────────────────────────────────────────────────────────────
// APPLY FOR A BORROWER — the assisted origination flow.
//
// This is not only a walk-in at a counter: it is just as often a relationship
// officer in the field who convinced a trader to take a loan and is booking it on
// their behalf. Either way the application enters the SAME queue and the SAME
// approval chain as one from the funnel, and booking still needs a signed offer.
//
// The page earns the loan the way KYC earns an identity: you find the customer,
// and the platform WORKS — it checks they carry no running loan, reads their
// statement score and default probability, confirms their liveness, and sizes what
// they qualify for — before it lets you pick a product and an amount. No invented
// score: a statement crunched at /console/crunch rides in, but the server rescores it.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useLoad } from "@/lib/hooks/useLoad";
import {
  Loader2, AlertTriangle, CheckCircle2, FilePlus2, Search, Gauge, X, ArrowRight,
  ShieldCheck, ScanFace, Landmark, TrendingUp, Users, CircleDollarSign, Receipt,
  Building2, UserPlus,
} from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";

type CrunchHandoff = {
  borrower: { id: string; name: string | null; phone: string } | null;
  features: Record<string, unknown>;
  score: { score: number; band: string; decision: string };
};
type Hit = { id: string; name: string | null; phone: string; activeLoans: number };
type PoolHit = {
  sourceBorrowerId: string; sourceOrg: { name: string; slug: string };
  name: string; phone: string; nationalId: string | null;
  kycVerified: boolean; activeLoansThere: number; alreadyLocal: boolean;
};
type Elsewhere = { lender: string; legalBasis?: string; message: string };
type LimitRow = {
  productId: string; productName: string; interestRate: number; interestMethod: string;
  guarantorRequired: boolean; securityRequired: boolean;
  approvedLimit: number; affordableInstallment: number | null; installmentCount: number | null; installmentUnit: string | null;
};
type Preview = {
  profile: { name: string; verified: boolean; kyc: { status: string; livenessPassed?: boolean | null; faceMatchScore?: number | null; iprsMatched?: boolean | null }; creditScore: number | null; riskBand: string | null };
  basis: { hasStatement: boolean; avgMonthlyNet: number | null; statementScore: number | null; pd: number; borrowerClass: string; graduated: boolean };
  products: LimitRow[];
};

const field = "w-full rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2.5 text-sm outline-none placeholder:text-zinc-400";
const fmtKES = (n: number) => `KES ${Math.round(n).toLocaleString()}`;

export default function NewApplicationPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Hit[]>([]);
  const [poolHits, setPoolHits] = useState<PoolHit[]>([]);
  const [poolMeta, setPoolMeta] = useState<{ name: string; legalBasis: string } | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [elsewhere, setElsewhere] = useState<Elsewhere | null>(null);
  const [borrower, setBorrower] = useState<Hit | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reveal, setReveal] = useState(0); // staged-reveal step
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [productId, setProductId] = useState("");
  const [amount, setAmount] = useState("");
  const [payee, setPayee] = useState({ name: "", paybill: "", account: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chargesDue, setChargesDue] = useState<{ unpaidCharges: { name: string; amount: number }[]; total: number } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [crunch, setCrunch] = useState<CrunchHandoff | null>(null);
  const [productsMeta, setProductsMeta] = useState<{ id: string; disbursementMode?: string; minPrincipal: number; maxPrincipal: number }[]>([]);

  useLoad(async () => {
    try {
      const raw = sessionStorage.getItem("lms_crunch");
      if (raw) {
        const h = JSON.parse(raw) as CrunchHandoff;
        if (h?.features && h?.score) { setCrunch(h); if (h.borrower) selectBorrower({ id: h.borrower.id, name: h.borrower.name, phone: h.borrower.phone, activeLoans: 0 }); }
      }
    } catch { /* stale handoff is not an error */ }
    const res = await fetch("/api/console/products");
    const data = await res.json().catch(() => ({}));
    if (data.success) setProductsMeta((data.products ?? []).map((p: { id: string; disbursementMode?: string; minPrincipal: number; maxPrincipal: number }) => ({ id: p.id, disbursementMode: p.disbursementMode, minPrincipal: Number(p.minPrincipal), maxPrincipal: Number(p.maxPrincipal) })));
  });

  // The book first, then the GROUP: sibling entities in the sharing pool are
  // searched in the same breath, so a Micromart customer walking into Axe is
  // one tap from being served rather than re-registered.
  const searchBorrowers = async () => {
    if (!q.trim()) return;
    const needle = encodeURIComponent(q.trim());
    const [own, pool] = await Promise.all([
      fetch(`/api/console/borrowers?q=${needle}`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/console/pool?q=${needle}`).then((r) => r.json()).catch(() => ({})),
    ]);
    if (own.success) setResults((own.borrowers ?? []).slice(0, 6));
    if (pool.success && pool.inPool) {
      setPoolMeta(pool.pool);
      setPoolHits((pool.customers ?? []).filter((c: PoolHit) => !c.alreadyLocal));
    }
  };

  // Bring a sibling's customer onto this book, then continue as if they had
  // always been here. The server re-reads everything; nothing rides on the row
  // the search displayed.
  const importAndSelect = async (h: PoolHit) => {
    setImporting(h.sourceBorrowerId); setError(null);
    try {
      const res = await fetch("/api/console/pool", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceBorrowerId: h.sourceBorrowerId }),
      });
      const d = await res.json();
      if (!d.success) { setError(d.message || "Could not bring the customer across."); return; }
      await selectBorrower({ id: d.borrowerId, name: h.name, phone: h.phone, activeLoans: 0 });
    } catch { setError("Could not bring the customer across."); }
    finally { setImporting(null); }
  };

  // Selecting a customer kicks off the reveal: fetch their profile + what they
  // qualify for, then step the checks in one at a time. Declared as a hoisted
  // function so the crunch-handoff in useLoad above can call it.
  async function selectBorrower(b: Hit) {
    setBorrower(b); setPreview(null); setReveal(0); setError(null); setElsewhere(null); setProductId(""); setAmount("");
    if (b.activeLoans > 0) return; // running-loan gate handled in render
    setLoadingPreview(true);
    try {
      const [pRes, lRes] = await Promise.all([
        fetch(`/api/console/borrowers/${b.id}/profile`).then((r) => r.json()),
        fetch(`/api/console/borrowers/${b.id}/limit-check`).then((r) => r.json()),
      ]);
      if (pRes.success && lRes.success) {
        setPreview({ profile: pRes.profile, basis: lRes.basis, products: lRes.products });
      } else {
        setError(pRes.message || lRes.message || "Could not read this customer.");
      }
    } catch { setError("Could not reach the server."); } finally { setLoadingPreview(false); }
  }

  // Advance the staged reveal once the data is in.
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!preview) return;
    timer.current = setInterval(() => setReveal((s) => (s >= 4 ? (clearInterval(timer.current!), s) : s + 1)), 600);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [preview]);

  const selectedLimit = preview?.products.find((p) => p.productId === productId) ?? null;
  const meta = productsMeta.find((p) => p.id === productId) ?? null;
  const toSchool = meta?.disbursementMode === "TO_THIRD_PARTY";
  const overLimit = selectedLimit != null && Number(amount) > selectedLimit.approvedLimit;

  const submit = async () => {
    if (!borrower || !productId) return;
    if (toSchool && !/^\d{5,8}$/.test(payee.paybill)) { setError("Enter the school's paybill — this product pays the institution directly."); return; }
    setBusy(true); setError(null); setChargesDue(null);
    try {
      const res = await fetch("/api/console/applications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          borrowerId: borrower.id, productId, amount: Number(amount),
          ...(crunch ? { features: crunch.features } : {}),
          ...(toSchool ? { payee: { name: payee.name.trim() || undefined, paybill: payee.paybill, account: payee.account.trim() || undefined } } : {}),
        }),
      });
      const data = await res.json();
      if (!data.success) {
        if (data.chargesDue) { setChargesDue({ unpaidCharges: data.unpaidCharges ?? [], total: data.total ?? 0 }); setError(null); return; }
        if (data.code === "ACTIVE_LOAN_ELSEWHERE") { setElsewhere({ lender: data.lender, legalBasis: data.legalBasis, message: data.message }); setError(null); return; }
        setError(data.message || "Could not create the application."); return;
      }
      sessionStorage.removeItem("lms_crunch");
      const needsGuarantor = selectedLimit?.guarantorRequired || selectedLimit?.securityRequired;
      if (data.applicationId && needsGuarantor) {
        router.push(`/console/applications/${data.applicationId}`);
        return;
      }
      setDone(`Application created for ${borrower.name ?? borrower.phone} — it enters your approval workflow at stage 1.`);
    } catch { setError("Could not create the application."); } finally { setBusy(false); }
  };

  const reset = () => {
    setBorrower(null); setPreview(null); setReveal(0); setProductId(""); setAmount(""); setPayee({ name: "", paybill: "", account: "" });
    setQ(""); setResults([]); setPoolHits([]); setElsewhere(null); setImporting(null); setCrunch(null); setDone(null); setError(null); setChargesDue(null);
  };

  const CHECKS = preview ? [
    { icon: <CircleDollarSign className="h-4 w-4" />, label: "No running loan", value: "Clear to apply", ok: true },
    { icon: <Gauge className="h-4 w-4" />, label: "Statement score", value: preview.basis.statementScore != null ? `${preview.basis.statementScore} / 900` : preview.profile.creditScore != null ? `${preview.profile.creditScore} / 900` : "No score yet", ok: (preview.basis.statementScore ?? preview.profile.creditScore) != null },
    { icon: <TrendingUp className="h-4 w-4" />, label: "Default probability", value: `${Math.round(preview.basis.pd * 100)}%`, ok: preview.basis.pd <= 0.25 },
    { icon: <ScanFace className="h-4 w-4" />, label: "Liveness & KYC", value: preview.profile.verified ? "Verified" : `KYC ${preview.profile.kyc.status}`, ok: preview.profile.verified },
    { icon: <ShieldCheck className="h-4 w-4" />, label: "Qualifies for", value: `${preview.products.filter((p) => p.approvedLimit > 0).length} product(s)`, ok: preview.products.some((p) => p.approvedLimit > 0) },
  ] : [];

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
      <PageHeader
        icon={FilePlus2}
        title="Apply for a Borrower"
        subtitle="For a customer you're helping apply — at the counter, or one an officer signed up in the field. It joins the same queue and approval workflow; booking still needs their signed offer."
      >
        <Link href="/console/applications" className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-900/15 bg-white/70 px-3 py-2 text-xs font-medium text-zinc-600 hover:bg-white">
          Applications queue <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </PageHeader>

      {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}</div>}

      <div className="mx-auto mt-5 max-w-2xl">
        {done ? (
          <div className="glass p-6 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100"><CheckCircle2 className="h-6 w-6 text-emerald-600" /></div>
            <p className="mt-3 text-base font-bold">{done}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button onClick={() => router.push("/console/applications")} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-white" style={{ backgroundColor: "var(--brand)" }}>Open the queue <ArrowRight className="h-3.5 w-3.5" /></button>
              <button onClick={reset} className="rounded-lg border border-zinc-900/15 bg-white/70 px-4 py-2.5 text-sm font-medium text-zinc-600">+ Another application</button>
            </div>
          </div>
        ) : (
          <div className="glass p-5 sm:p-6">
            {crunch && (
              <div className="mb-4 flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-2">
                <span className="flex items-center gap-2 text-xs text-emerald-800"><Gauge className="h-4 w-4 shrink-0" /> Statement attached — <span className="font-bold">{crunch.score.score} / 900</span> · {crunch.score.band}. The server rescores it and enforces the limit.</span>
                <button onClick={() => { setCrunch(null); sessionStorage.removeItem("lms_crunch"); }} className="shrink-0 rounded p-1 text-emerald-700 hover:bg-emerald-100" aria-label="Detach the statement"><X className="h-3.5 w-3.5" /></button>
              </div>
            )}

            {!borrower ? (
              <>
                <p className="text-sm font-semibold">Search for the customer</p>
                <p className="text-[11px] text-zinc-500">By phone number, national ID, or full name.</p>
                <div className="mt-2 flex gap-2">
                  <input className={field} placeholder="e.g. 0712…, 12345678, or their name" value={q}
                    onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && searchBorrowers()} autoFocus />
                  <button onClick={searchBorrowers} className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white"><Search className="h-4 w-4" /></button>
                </div>
                <div className="mt-2 space-y-1">
                  {results.map((b) => (
                    <button key={b.id} onClick={() => selectBorrower(b)}
                      className="flex w-full items-center justify-between rounded-lg border border-zinc-900/10 bg-white/70 px-3 py-2 text-left text-sm hover:bg-white">
                      <span className="font-medium">{b.name ?? "Borrower"}</span>
                      <span className="text-xs text-zinc-500">{b.phone}{b.activeLoans > 0 ? ` · ${b.activeLoans} active` : ""}</span>
                    </button>
                  ))}
                </div>
                {/* The GROUP's customers at sibling entities — one tap from being
                    served here instead of re-registered. The legal basis rides
                    under the list: a pool signal never appears without it. */}
                {poolHits.length > 0 && (
                  <div className="mt-4">
                    <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                      <Building2 className="h-3 w-3" /> Across the group{poolMeta ? ` — ${poolMeta.name}` : ""}
                    </p>
                    <div className="mt-1.5 space-y-1">
                      {poolHits.map((h) => (
                        <div key={h.sourceBorrowerId}
                          className="flex items-center justify-between gap-3 rounded-lg border border-zinc-900/10 bg-white/70 px-3 py-2 text-sm">
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5 font-medium">
                              <span className="truncate">{h.name}</span>
                              {h.kycVerified && <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
                              <span className="shrink-0 rounded bg-zinc-900/5 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500">{h.sourceOrg.name}</span>
                            </span>
                            <span className="block text-xs text-zinc-500">{h.phone}</span>
                          </span>
                          {h.activeLoansThere > 0 ? (
                            <span className="shrink-0 rounded-md bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-700">
                              Running loan at {h.sourceOrg.name}
                            </span>
                          ) : (
                            <button onClick={() => importAndSelect(h)} disabled={importing != null}
                              className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
                              style={{ backgroundColor: "var(--brand)" }}>
                              {importing === h.sourceBorrowerId ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3 w-3" />} Bring across
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    {poolMeta && <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-400">{poolMeta.legalBasis}</p>}
                  </div>
                )}
                <p className="mt-2 text-[11px] text-zinc-400">Not registered yet? <Link href="/console/borrowers/new" className="underline hover:text-zinc-600">Add them first</Link>.</p>
              </>
            ) : elsewhere ? (
              <div className="text-center py-4">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100"><Building2 className="h-5 w-5 text-amber-600" /></div>
                <p className="mt-3 text-sm font-bold">{borrower.name ?? borrower.phone} has a running loan at {elsewhere.lender}.</p>
                <p className="mt-1 text-xs text-zinc-500">{elsewhere.message}</p>
                {elsewhere.legalBasis && <p className="mx-auto mt-2 max-w-md text-[10px] leading-relaxed text-zinc-400">{elsewhere.legalBasis}</p>}
                <button onClick={() => { setBorrower(null); setElsewhere(null); }} className="mt-3 text-xs underline text-zinc-500 hover:text-zinc-800">Search another customer</button>
              </div>
            ) : borrower.activeLoans > 0 ? (
              <div className="text-center py-4">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100"><Landmark className="h-5 w-5 text-amber-600" /></div>
                <p className="mt-3 text-sm font-bold">{borrower.name ?? borrower.phone} has a running loan.</p>
                <p className="mt-1 text-xs text-zinc-500">A new application waits until the current loan clears.</p>
                <button onClick={() => setBorrower(null)} className="mt-3 text-xs underline text-zinc-500 hover:text-zinc-800">Search another customer</button>
              </div>
            ) : (
              <>
                <p className="text-xs text-zinc-500">For <span className="font-semibold text-zinc-800">{borrower.name ?? borrower.phone}</span> <button className="underline" onClick={() => setBorrower(null)}>change</button></p>

                {/* The reveal */}
                {loadingPreview && !preview && <div className="mt-4 flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Reading their file…</div>}
                {preview && (
                  <div className="mt-3 space-y-1.5">
                    {CHECKS.map((c, i) => (
                      <div key={i} className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 transition-all duration-500 ${i <= reveal ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"} ${c.ok ? "border-emerald-200 bg-emerald-50/50" : "border-amber-200 bg-amber-50/50"}`}>
                        <span className="flex items-center gap-2 text-[13px] font-medium text-zinc-700">
                          <span className={c.ok ? "text-emerald-600" : "text-amber-600"}>{c.icon}</span> {c.label}
                        </span>
                        <span className={`text-[13px] font-semibold ${c.ok ? "text-emerald-700" : "text-amber-700"}`}>{c.value}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* The loan form — appears once the reveal has run */}
                {preview && reveal >= 4 && (
                  <div className="mt-4 border-t border-zinc-900/10 pt-4">
                    {chargesDue ? (
                      <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
                        <p className="flex items-center gap-2 text-sm font-bold text-amber-800"><Receipt className="h-4 w-4" /> Pay all upfront charges first</p>
                        <p className="mt-1 text-[12px] text-amber-700">We deduct upfront fees before disbursement, not after. Collect these, then create the application:</p>
                        <ul className="mt-2 space-y-1">
                          {chargesDue.unpaidCharges.map((c, i) => (
                            <li key={i} className="flex justify-between text-[13px]"><span className="text-zinc-700">{c.name}</span><span className="font-semibold">{fmtKES(c.amount)}</span></li>
                          ))}
                          <li className="flex justify-between border-t border-amber-300 pt-1 text-[13px] font-bold"><span>Total</span><span>{fmtKES(chargesDue.total)}</span></li>
                        </ul>
                        <p className="mt-2 text-[11px] text-amber-600">Collect via the borrower&apos;s 360 (Request payment), then retry.</p>
                        <button onClick={() => setChargesDue(null)} className="mt-2 text-xs underline text-amber-700">Back to the application</button>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm font-semibold">Continue with the loan</p>
                        <div className="mt-2 grid gap-3 sm:grid-cols-2">
                          <select className={field} value={productId} onChange={(e) => { setProductId(e.target.value); setAmount(""); }}>
                            <option value="">Choose a product…</option>
                            {preview.products.map((p) => (
                              <option key={p.productId} value={p.productId} disabled={p.approvedLimit === 0}>
                                {p.productName} — {p.approvedLimit > 0 ? `up to ${fmtKES(p.approvedLimit)}` : "does not qualify"}
                              </option>
                            ))}
                          </select>
                          <div className="flex items-center gap-2 rounded-lg border border-zinc-900/15 bg-white/80 px-3">
                            <span className="text-xs text-zinc-400">KES</span>
                            <input className="flex-1 bg-transparent py-2.5 text-sm outline-none" inputMode="numeric" placeholder="Amount"
                              value={amount ? Number(amount).toLocaleString() : ""} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
                          </div>
                        </div>
                        {selectedLimit && (
                          <p className={`mt-1.5 text-[11px] ${overLimit ? "text-rose-600" : "text-zinc-500"}`}>
                            {overLimit
                              ? `They qualify for up to ${fmtKES(selectedLimit.approvedLimit)} — lower the amount.`
                              : <>Qualifies up to <span className="font-semibold">{fmtKES(selectedLimit.approvedLimit)}</span>{selectedLimit.affordableInstallment != null && <> · about {fmtKES(selectedLimit.affordableInstallment)}/{(selectedLimit.installmentUnit ?? "month").replace(/s$/, "")} × {selectedLimit.installmentCount}</>}.</>}
                            {(selectedLimit.guarantorRequired || selectedLimit.securityRequired) && (
                              <span className="ml-1 inline-flex items-center gap-1 text-amber-700"><Users className="h-3 w-3" /> {selectedLimit.guarantorRequired ? "guarantor" : "security"} required — attach it after creating.</span>
                            )}
                          </p>
                        )}
                        {toSchool && (
                          <div className="mt-3 rounded-lg border border-zinc-900/10 bg-white/60 p-3">
                            <p className="text-[12px] font-medium">Pays the institution directly (not the borrower&apos;s phone)</p>
                            <div className="mt-2 grid gap-2 sm:grid-cols-3">
                              <input className={field} placeholder="School name" value={payee.name} onChange={(e) => setPayee((p) => ({ ...p, name: e.target.value }))} />
                              <input className={field} inputMode="numeric" placeholder="Paybill" value={payee.paybill} onChange={(e) => setPayee((p) => ({ ...p, paybill: e.target.value.replace(/\D/g, "") }))} />
                              <input className={field} placeholder="Account / adm. no." value={payee.account} onChange={(e) => setPayee((p) => ({ ...p, account: e.target.value }))} />
                            </div>
                          </div>
                        )}
                        <div className="mt-4 flex items-center gap-2">
                          <button onClick={submit} disabled={busy || !productId || !(Number(amount) > 0) || overLimit}
                            className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand)" }}>
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />} Create application
                          </button>
                          <Link href="/console/applications" className="rounded-lg border border-zinc-900/15 bg-white/70 px-4 py-2.5 text-sm font-medium text-zinc-600">Cancel</Link>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
