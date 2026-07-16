"use client";

// ─────────────────────────────────────────────────────────────────────────────
// STATEMENT CRUNCHER — step three of onboarding: registered → KYC-verified →
// statement crunched → application. It lives under Borrowers (below KYC
// Verification) because it IS the next thing the onboarding officer does.
//
// Landing here shows the QUEUE: every KYC-verified customer whose file has no
// score yet — the people whose current step is exactly this. Pick one (or
// arrive pre-picked from their Customer-360 via ?borrowerId=…&from=360), crunch
// their 6-month M-Pesa statement through the same cinematic engine the portal
// runs (CrunchTheatre — staging around a real API round-trip), and the verdict
// is SAVED to their file: a ScoreSnapshot in their score history plus the full
// report as a document in their bio. ?from=360 offers the way straight back.
//
// The engine also guards identity: the holder named on the statement must be
// the customer being scored (staff can override a near-miss — audited).
// ─────────────────────────────────────────────────────────────────────────────
import { Suspense, useCallback, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useLoad } from "@/lib/hooks/useLoad";
import {
  Gauge, Upload, FileText, Lock, Loader2, Search, ArrowRight, RefreshCw, AlertTriangle,
  CheckCircle2, HelpCircle, TrendingUp, TrendingDown, ShieldCheck, ArrowLeft,
} from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import { BorrowerAvatar } from "@/components/kyc/BorrowerAvatar";
import CrunchTheatre, { type CrunchData } from "@/components/statement/CrunchTheatre";

type Picked = { id: string; name: string | null; phone: string };
type QueueRow = {
  id: string; name: string | null; phone: string; nationalId: string | null;
  kycStatus: string; creditScore: number | null; portraitUrl: string | null;
};

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;

const TONE: Record<string, string> = { good: "text-emerald-600", warn: "text-amber-600", high: "text-orange-600", bad: "text-rose-600" };
const DECISION_TONE: Record<string, string> = {
  APPROVE: "bg-emerald-100 text-emerald-700",
  REFER: "bg-amber-100 text-amber-700",
  DECLINE: "bg-rose-100 text-rose-700",
};

export default function CrunchPage() {
  return (
    <Suspense fallback={null}>
      <Crunch />
    </Suspense>
  );
}

function Crunch() {
  const router = useRouter();
  const search = useSearchParams();
  const from360 = search.get("from") === "360";
  const wantedId = search.get("borrowerId");
  const fileRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [queue, setQueue] = useState<QueueRow[] | null>(null);
  const [results, setResults] = useState<Picked[]>([]);
  const [borrower, setBorrower] = useState<Picked | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [crunching, setCrunching] = useState(false);
  const [data, setData] = useState<CrunchData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<"saving" | "saved" | "failed" | null>(null);

  // The queue: KYC-verified customers with no score — their current step is here.
  // The same call resolves a ?borrowerId= deep link (from the 360's kebab).
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/console/borrowers");
      const d = await res.json();
      if (!d.success) return;
      const rows = (d.borrowers ?? []) as QueueRow[];
      setQueue(rows.filter((b) => b.kycStatus === "VERIFIED" && b.creditScore == null));
      if (wantedId) {
        const hit = rows.find((b) => b.id === wantedId);
        if (hit) setBorrower({ id: hit.id, name: hit.name, phone: hit.phone });
      }
    } catch { /* queue is best-effort; search still works */ }
  }, [wantedId]);
  useLoad(load);

  const searchBorrowers = async () => {
    if (!q.trim()) return;
    try {
      const res = await fetch(`/api/console/borrowers?q=${encodeURIComponent(q.trim())}`);
      const d = await res.json();
      if (d.success) setResults((d.borrowers ?? []).slice(0, 5));
    } catch { /* search is best-effort */ }
  };

  // The verdict lands on their file the moment the theatre completes — the
  // snapshot is their score history, the document is the report in their bio.
  const persist = useCallback(async (d: CrunchData, who: Picked) => {
    setSaved("saving");
    try {
      const res = await fetch(`/api/console/borrowers/${who.id}/crunch-report`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creditScore: d.creditScore, features: d.features, affordability: d.affordability,
          monthly: d.monthly, transactionCount: d.transactionCount, nameCheck: d.nameCheck ?? null,
        }),
      });
      const out = await res.json();
      setSaved(out.success ? "saved" : "failed");
    } catch { setSaved("failed"); }
  }, []);

  const startApplication = () => {
    if (!data) return;
    // The features ride sessionStorage into the assisted-apply panel — the
    // server rescores them itself; this is a handoff, not a trusted score.
    sessionStorage.setItem("lms_crunch", JSON.stringify({
      borrower,
      features: data.features,
      score: { score: data.creditScore.score, band: data.creditScore.band, decision: data.creditScore.decision },
    }));
    router.push("/console/applications/new?crunch=1");
  };

  const reset = () => { setData(null); setFile(null); setPassword(""); setError(null); setSaved(null); };

  const field = "flex items-center gap-2 rounded-lg border border-zinc-900/15 bg-white/80 px-3";
  const input = "flex-1 bg-transparent outline-none text-sm py-2.5 placeholder:text-zinc-400";

  return (
    <main className="mx-auto max-w-4xl px-4 sm:px-6 py-8">
      {from360 && borrower && (
        <Link href={`/console/borrowers/${borrower.id}`} className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800">
          <ArrowLeft className="h-4 w-4" /> Back to {borrower.name ?? "Customer 360"}
        </Link>
      )}
      <PageHeader
        icon={Gauge}
        title="Statement Cruncher"
        subtitle="After KYC comes the statement: six months of M-Pesa becomes a score out of 900 — saved to the customer's file."
      />

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {!data ? (
        <>
          {/* The queue — verified, unscored, waiting on exactly this step. */}
          {!borrower && (
            <div className="glass mt-4 p-5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" /> Passed KYC — awaiting their first crunch
                </p>
                {queue && <span className="rounded-md bg-zinc-900/5 px-2 py-0.5 text-[11px] font-semibold text-zinc-600">{queue.length}</span>}
              </div>
              {!queue && <div className="mt-4 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-zinc-400" /></div>}
              {queue?.length === 0 && (
                <p className="mt-2 text-xs text-zinc-500">Nobody is waiting — every verified customer has a score. Use search below for a re-crunch.</p>
              )}
              <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                {queue?.slice(0, 8).map((b) => (
                  <button key={b.id} onClick={() => setBorrower({ id: b.id, name: b.name, phone: b.phone })}
                    className="flex items-center gap-2.5 rounded-xl border border-zinc-900/10 bg-white/70 px-3 py-2 text-left hover:bg-white">
                    <BorrowerAvatar name={b.name ?? b.phone} portraitUrl={b.portraitUrl} verified size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{b.name ?? b.phone}</span>
                      <span className="block text-[11px] text-zinc-500">{b.phone}</span>
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="glass mt-4 p-5 sm:p-6">
            {/* Who this statement belongs to. */}
            <p className="text-sm font-semibold">Whose statement is this?</p>
            {!borrower ? (
              <>
                <div className="mt-2 flex max-w-md gap-2">
                  <div className={`${field} flex-1`}>
                    <Search className="h-4 w-4 shrink-0 text-zinc-400" />
                    <input className={input} placeholder="Find any borrower — name, phone or ID"
                      value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && searchBorrowers()} />
                  </div>
                  <button onClick={searchBorrowers} className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white">Search</button>
                </div>
                <div className="mt-2 max-w-md space-y-1">
                  {results.map((b) => (
                    <button key={b.id} onClick={() => { setBorrower(b); setResults([]); }}
                      className="flex w-full items-center justify-between rounded-lg border border-zinc-900/10 bg-white/70 px-3 py-2 text-left text-sm hover:bg-white">
                      <span className="font-medium">{b.name ?? "Borrower"}</span>
                      <span className="text-xs text-zinc-500">{b.phone}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-zinc-400">You can crunch without picking anyone — the score just won&apos;t attach to a record.</p>
              </>
            ) : (
              <p className="mt-2 text-xs text-zinc-500">
                For <span className="font-semibold text-zinc-800">{borrower.name ?? borrower.phone}</span>{" "}
                <button className="underline" onClick={() => setBorrower(null)}>change</button>
                <span className="ml-2 text-zinc-400">· the statement must be in their name — the engine checks.</span>
              </p>
            )}

            {/* The statement + the code that opens it. */}
            <div className="mt-5 border-t border-zinc-900/10 pt-4">
              <p className="flex items-center gap-1.5 text-xs text-zinc-500">
                <HelpCircle className="h-3.5 w-3.5 text-emerald-600" />
                The customer gets it free: dial *334# → M-PESA Statement → Full Statement → 6 Months. Safaricom emails a
                password-protected PDF; the SMS access code (or their ID number) opens it.
              </p>

              <div onClick={() => fileRef.current?.click()}
                className="mt-3 cursor-pointer rounded-xl border border-dashed border-zinc-900/20 bg-white/70 px-4 py-8 text-center hover:border-[var(--brand)]">
                <Upload className="mx-auto mb-2 h-6 w-6" style={{ color: "var(--brand)" }} />
                {file
                  ? <p className="flex items-center justify-center gap-2 text-sm"><FileText className="h-4 w-4" /> {file.name}</p>
                  : <p className="text-sm text-zinc-600">Tap to choose the statement PDF</p>}
                <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </div>

              <div className={`${field} mt-3 max-w-md`}>
                <Lock className="h-4 w-4 shrink-0 text-zinc-400" />
                <input className={input} placeholder="Statement password (SMS code or ID number)"
                  value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>

              <button onClick={() => { setError(null); if (file) setCrunching(true); else setError("Choose the statement PDF first."); }}
                disabled={crunching}
                className="mt-4 inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: "var(--brand)" }}>
                {crunching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gauge className="h-4 w-4" />} Crunch the statement
              </button>
            </div>
          </div>
        </>
      ) : (
        <ResultPanel data={data} borrower={borrower} saved={saved} from360={from360}
          onStartApplication={startApplication} onReset={reset} />
      )}

      {/* The same cinematic sequence the borrower sees — decrypt → parse →
          extract → ledgers → audit → score. Staging around a real round-trip. */}
      {crunching && file && (
        <CrunchTheatre
          file={file}
          password={password || undefined}
          borrowerName={borrower?.name ?? null}
          allowOverride
          onComplete={(d) => {
            setData(d); setCrunching(false);
            if (borrower) void persist(d, borrower);
          }}
          onFail={(message) => { setCrunching(false); setError(message); }}
        />
      )}
    </main>
  );
}

// ── The verdict, and what to do with it ───────────────────────────────────────

function ResultPanel({ data, borrower, saved, from360, onStartApplication, onReset }: {
  data: CrunchData;
  borrower: Picked | null;
  saved: "saving" | "saved" | "failed" | null;
  from360: boolean;
  onStartApplication: () => void;
  onReset: () => void;
}) {
  const cs = data.creditScore;
  const monthly = data.monthly.slice(-6);
  const maxAbs = Math.max(1, ...monthly.map((m) => Math.max(m.income, m.expense)));

  return (
    <div className="mt-4 space-y-4">
      {/* The verdict card — the three things a lending decision needs. */}
      <div className="glass p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <ScoreDial score={cs.score} tone={cs.tone} />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">
                {borrower ? `${borrower.name ?? borrower.phone} — statement score` : "Statement score"}
              </p>
              <p className={`text-lg font-bold ${TONE[cs.tone] ?? ""}`}>{cs.band}</p>
              <p className="text-xs text-zinc-500">PD {cs.pdPercent} · {cs.modelVersion}</p>
              {borrower && (
                <p className={`mt-1 inline-flex items-center gap-1 text-[11px] font-medium ${saved === "saved" ? "text-emerald-600" : saved === "failed" ? "text-rose-600" : "text-zinc-500"}`}>
                  {saved === "saving" && <><Loader2 className="h-3 w-3 animate-spin" /> Saving to their file…</>}
                  {saved === "saved" && <><CheckCircle2 className="h-3 w-3" /> Saved — score history + report document on their 360</>}
                  {saved === "failed" && <><AlertTriangle className="h-3 w-3" /> Could not save the report to their file</>}
                </p>
              )}
            </div>
          </div>
          <div className="text-right">
            <span className={`inline-block rounded-lg px-3 py-1.5 text-sm font-bold ${DECISION_TONE[cs.decision] ?? "bg-zinc-900/5 text-zinc-600"}`}>
              {cs.decision}
            </span>
            <p className="mt-1.5 text-xs text-zinc-500">
              Affordable installment ≈ <span className="font-semibold text-zinc-700">{kes(data.affordability.recommendedMaxInstallment)}</span>
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile label="Months covered" value={String(data.features.monthsCovered)} />
          <Tile label="Avg monthly income" value={kes(data.features.avgMonthlyIncome)} />
          <Tile label="Avg monthly net" value={kes(data.features.avgMonthlyNet)} />
          <Tile label="Transactions" value={data.transactionCount.toLocaleString()} />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {borrower ? (
            <>
              <button onClick={onStartApplication}
                className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white"
                style={{ backgroundColor: "var(--brand)" }}>
                <CheckCircle2 className="h-4 w-4" /> Start application with this statement <ArrowRight className="h-4 w-4" />
              </button>
              {from360 && (
                <Link href={`/console/borrowers/${borrower.id}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-900/15 bg-white/70 px-4 py-2.5 text-sm font-medium text-zinc-700">
                  <ArrowLeft className="h-4 w-4" /> Back to their 360
                </Link>
              )}
            </>
          ) : (
            <p className="text-xs text-zinc-500">Pick a borrower before crunching to turn this score into an application.</p>
          )}
          <button onClick={onReset} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-900/15 bg-white/70 px-4 py-2.5 text-sm text-zinc-600">
            <RefreshCw className="h-4 w-4" /> Crunch another
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Why — the reasons, signed */}
        <div className="glass p-5">
          <h2 className="text-sm font-semibold">Why this score</h2>
          <div className="mt-3 space-y-1.5">
            {cs.reasonCodes.slice(0, 6).map((r) => (
              <div key={r.code} className="flex items-start gap-2 text-xs">
                {r.direction === "up"
                  ? <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  : <TrendingDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />}
                <span className="text-zinc-600">{r.detail}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Cashflow — six months of income vs spend */}
        <div className="glass p-5">
          <h2 className="text-sm font-semibold">Monthly cashflow</h2>
          <div className="mt-3 flex items-end gap-2" style={{ height: 96 }}>
            {monthly.map((m) => (
              <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex w-full flex-1 items-end justify-center gap-0.5">
                  <div className="w-2.5 rounded-t bg-emerald-400" style={{ height: `${(m.income / maxAbs) * 100}%` }} title={`In ${kes(m.income)}`} />
                  <div className="w-2.5 rounded-t bg-zinc-300" style={{ height: `${(m.expense / maxAbs) * 100}%` }} title={`Out ${kes(m.expense)}`} />
                </div>
                <span className="text-[9px] text-zinc-400">{m.month.slice(-2)}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-zinc-400">
            <span className="mr-3 inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-emerald-400" /> money in</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-zinc-300" /> money out</span>
          </p>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-900/10 bg-white/60 px-2.5 py-2">
      <p className="text-[9px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="text-sm font-bold text-zinc-800">{value}</p>
    </div>
  );
}

/** 300–900 score dial — the arc fills with the score, in the band's tone. */
function ScoreDial({ score, tone }: { score: number; tone: string }) {
  const pct = Math.max(0, Math.min(1, (score - 300) / 600));
  const R = 30, C = 2 * Math.PI * R;
  const color = tone === "good" ? "#059669" : tone === "warn" ? "#d97706" : tone === "high" ? "#ea580c" : "#e11d48";
  return (
    <div className="relative h-20 w-20 shrink-0">
      <svg viewBox="0 0 72 72" className="h-full w-full -rotate-90">
        <circle cx="36" cy="36" r={R} fill="none" stroke="rgba(24,24,27,0.08)" strokeWidth="7" />
        <circle cx="36" cy="36" r={R} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${C * pct} ${C}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold tabular-nums" style={{ color }}>{score}</span>
        <span className="text-[8px] text-zinc-400">/ 900</span>
      </div>
    </div>
  );
}
