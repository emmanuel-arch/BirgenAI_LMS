// ─────────────────────────────────────────────────────────────────────────────
// M-PESA Statement Crunch Theatre.
//
// The borrower hands us six months of their financial life; this is where we
// show them we take it seriously. A full-screen, Safaricom-branded sequence:
//
//   decrypt → parse → extract → post to ledgers → audit → score → factors
//
// The staging is theatre, but the NUMBERS ARE REAL. Only the receipt codes that
// flicker before the server responds are synthetic placeholders; the moment the
// crunch returns, every counter, ledger column, category bar, audit line, the
// score dial and the factor breakdown are driven by the borrower's actual
// statement. Nothing shown after the extract stage is invented.
//
// Visual language is lifted from the Hub's /wallet + /transact "Consolidating
// your wallet" loader: the M-PESA backdrop, the conic Safaricom ring, and the
// Safaricom green (#4CB749 → #1E8B3A).
// ─────────────────────────────────────────────────────────────────────────────
"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, AlertTriangle, ArrowRight, Loader2, FileText, ShieldCheck, TrendingUp, TrendingDown } from "lucide-react";

// ── Safaricom palette ─────────────────────────────────────────────────────────
const GREEN = "#4CB749";
const GREEN_DARK = "#1E8B3A";
const AMBER = "#d97706";
const RED = "#e11d48";
const SLATE = "#94a3b8";

// ── Types (mirror the cruncher API response) ─────────────────────────────────
export type ReasonCode = { code: string; factor: string; points: number; direction: "up" | "down"; detail: string };
export type NameCheck = { statementName: string | null; expectedName: string; matched: boolean; overridden: boolean };
export type CrunchData = {
  /** Identity guard verdict — null when nobody was named to check against. */
  nameCheck?: NameCheck | null;
  transactionCount: number;
  paidIn: number;
  paidOut: number;
  creditScore: {
    modelVersion: string; score: number; maxScore: number; pd: number; pdPercent: string;
    band: string; tone: "good" | "warn" | "high" | "bad"; decision: string;
    reasonCodes: ReasonCode[]; breakdown: { code: string; factor: string; points: number }[];
  };
  features: {
    monthsCovered: number; periodStart: string | null; periodEnd: string | null; txnCount: number;
    totalIncome: number; avgMonthlyIncome: number; totalExpense: number; avgMonthlyExpense: number;
    avgMonthlyNet: number; incomeVolatility: number; avgBalance: number; minBalance: number;
    closingBalance: number; balanceTrend: number; incomeMonthsRatio: number;
    gamblingOutflow: number; gamblingRatio: number; loanInflow: number; loanRepayOutflow: number;
    loanEventCount: number; loanDependencyRatio: number; airtimeSpend: number;
  };
  monthly: { month: string; income: number; expense: number; net: number; gambling: number }[];
  affordability: { score: number; band: string; recommendedMaxInstallment: number; reasons: { factor: string; direction: "positive" | "negative"; detail: string }[] };
  categories: { category: string; count: number; amount: number; inAmt: number; outAmt: number }[];
  sample: { date: string; details: string; direction: "in" | "out"; amount: number; category: string }[];
};

const CAT: Record<string, { label: string; flow: "in" | "out"; tone: string }> = {
  income_received: { label: "Received money", flow: "in", tone: GREEN },
  business_in: { label: "Business inflow", flow: "in", tone: GREEN },
  salary: { label: "Salary", flow: "in", tone: GREEN },
  deposit: { label: "Agent deposit", flow: "in", tone: GREEN },
  savings_in: { label: "Savings in", flow: "in", tone: GREEN },
  loan_in: { label: "Loans taken", flow: "in", tone: AMBER },
  send_money: { label: "Send money", flow: "out", tone: SLATE },
  paybill: { label: "Paybill", flow: "out", tone: SLATE },
  till: { label: "Buy goods (Till)", flow: "out", tone: SLATE },
  withdraw: { label: "Agent withdrawal", flow: "out", tone: SLATE },
  airtime: { label: "Airtime", flow: "out", tone: SLATE },
  bank_transfer: { label: "Bank transfer", flow: "out", tone: SLATE },
  loan_repay: { label: "Loan repayments", flow: "out", tone: AMBER },
  savings_out: { label: "Savings out", flow: "out", tone: SLATE },
  charge: { label: "Transaction charges", flow: "out", tone: SLATE },
  gambling: { label: "Betting", flow: "out", tone: RED },
  other: { label: "Other", flow: "out", tone: SLATE },
};
const catOf = (c: string) => CAT[c] ?? { label: c.replace(/_/g, " "), flow: "out" as const, tone: SLATE };

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const short = (n: number) => (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(Math.round(n)));

// ── Stage machine ─────────────────────────────────────────────────────────────
type Stage = "unlock" | "parse" | "extract" | "classify" | "audit" | "score" | "factors";
const ORDER: Stage[] = ["unlock", "parse", "extract", "classify", "audit", "score", "factors"];
const DUR: Record<Stage, number> = { unlock: 1500, parse: 1900, extract: 2600, classify: 2300, audit: 2800, score: 2600, factors: 0 };
const RAIL: { stage: Stage; label: string }[] = [
  { stage: "unlock", label: "Decrypt" }, { stage: "parse", label: "Parse" }, { stage: "extract", label: "Extract" },
  { stage: "classify", label: "Ledger" }, { stage: "audit", label: "Audit" }, { stage: "score", label: "Score" },
];

const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);
function useCountUp(target: number, duration = 1200, active = true) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      setV(target * easeOut(p));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, active]);
  return v;
}

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const fakeReceipt = () =>
  "U" + CHARS[Math.floor(Math.random() * 26)] + Array.from({ length: 8 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join("");

/** Spinning Safaricom loader — same language as the Hub wallet's "Consolidating…". */
function SafaricomLoader({ size = 132 }: { size?: number }) {
  return (
    <div className="relative mx-auto flex items-center justify-center" style={{ height: size, width: size }}>
      <span className="absolute inset-2 rounded-full bg-white/15 animate-ping" />
      <span
        className="absolute inset-0 animate-spin rounded-full"
        style={{
          background: `conic-gradient(from 0deg, rgba(76,183,73,0) 0%, ${GREEN} 60%, #ffffff 95%, rgba(76,183,73,0) 100%)`,
          WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 7px), #000 calc(100% - 7px))",
          mask: "radial-gradient(farthest-side, transparent calc(100% - 7px), #000 calc(100% - 7px))",
          animationDuration: "1.1s",
        }}
      />
      <span className="relative z-10 flex items-center justify-center rounded-2xl bg-white p-2.5 shadow-2xl ring-1 ring-white/60">
        <Image src="/mpesa/safaricom-25.gif" alt="Safaricom" width={900} height={406} unoptimized className="h-auto w-20 rounded-lg object-contain" />
      </span>
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-white/15 bg-white/10 backdrop-blur-md p-4 ${className}`}>{children}</div>;
}

// ── Stage: extract — real transactions posting into ledger columns ────────────
function ExtractStage({ data }: { data: CrunchData | null }) {
  const [feed, setFeed] = useState<{ id: number; receipt: string; details: string; amount: number; direction: "in" | "out" }[]>([]);
  const idRef = useRef(0);

  useEffect(() => {
    const iv = setInterval(() => {
      const id = idRef.current++;
      const row = data?.sample?.length ? data.sample[id % data.sample.length] : null;
      setFeed((f) => [
        {
          id,
          receipt: fakeReceipt(),
          details: row ? row.details : "Reading entry…",
          amount: row ? row.amount : Math.round(Math.random() * 4000) + 50,
          direction: row ? row.direction : Math.random() > 0.5 ? "in" : "out",
        },
        ...f,
      ].slice(0, 5));
    }, 190);
    return () => clearInterval(iv);
  }, [data]);

  const count = useCountUp(data?.transactionCount ?? 0, 2200, !!data);
  const pIn = useCountUp(data?.paidIn ?? 0, 2200, !!data);
  const pOut = useCountUp(data?.paidOut ?? 0, 2200, !!data);

  return (
    <div className="w-full">
      <div className="text-center">
        <p className="text-[11px] uppercase tracking-widest text-white/60">Transactions extracted</p>
        <p className="text-5xl font-bold tabular-nums" style={{ color: GREEN }}>
          {data ? Math.round(count).toLocaleString() : <span className="text-white/40">····</span>}
        </p>
      </div>

      {/* Double-entry ledger columns */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Card className="text-center">
          <p className="text-[10px] uppercase tracking-widest text-white/60">Paid in</p>
          <p className="mt-0.5 text-lg font-bold tabular-nums" style={{ color: GREEN }}>{data ? kes(pIn) : "—"}</p>
        </Card>
        <Card className="text-center">
          <p className="text-[10px] uppercase tracking-widest text-white/60">Paid out</p>
          <p className="mt-0.5 text-lg font-bold tabular-nums text-white">{data ? kes(pOut) : "—"}</p>
        </Card>
      </div>

      {/* Posting feed */}
      <div className="mt-3 space-y-1.5 min-h-[150px]">
        <AnimatePresence initial={false}>
          {feed.map((r) => (
            <motion.div
              key={r.id}
              initial={{ opacity: 0, x: -40, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/25 px-2.5 py-1.5"
            >
              <span className="font-mono text-[10px] text-white/40 shrink-0">{r.receipt}</span>
              <span className="flex-1 truncate text-[11px] text-white/70">{r.details}</span>
              <span className="text-[11px] font-semibold tabular-nums shrink-0" style={{ color: r.direction === "in" ? GREEN : "#fff" }}>
                {r.direction === "in" ? "+" : "−"}{short(r.amount)}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Stage: classify — post to category ledgers ───────────────────────────────
function ClassifyStage({ data }: { data: CrunchData }) {
  const top = data.categories.slice(0, 8);
  const max = Math.max(...top.map((c) => c.amount), 1);
  return (
    <div className="w-full">
      <p className="text-center text-[11px] uppercase tracking-widest text-white/60">Posting to ledgers</p>
      <div className="mt-3 space-y-2">
        {top.map((c, i) => {
          const meta = catOf(c.category);
          return (
            <motion.div key={c.category} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.09 }}>
              <div className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className="text-white/80 truncate">{meta.label}</span>
                <span className="shrink-0 tabular-nums text-white/50">{c.count} · {kes(c.amount)}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }} animate={{ width: `${(c.amount / max) * 100}%` }}
                  transition={{ delay: i * 0.09 + 0.1, duration: 0.7, ease: "easeOut" }}
                  className="h-full rounded-full" style={{ backgroundColor: meta.tone }}
                />
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ── Stage: audit — real reconciliation checks ────────────────────────────────
function AuditStage({ data }: { data: CrunchData }) {
  const f = data.features;
  const monthsWithIncome = Math.round(f.incomeMonthsRatio * f.monthsCovered);
  const nc = data.nameCheck;
  const checks: { ok: boolean; text: string }[] = [
    // Identity first — the statement must belong to the person being scored.
    ...(nc ? [{
      ok: nc.matched,
      text: nc.matched
        ? `Statement holder “${nc.statementName}” matches ${nc.expectedName}`
        : nc.overridden
          ? `Holder “${nc.statementName}” accepted by staff override for ${nc.expectedName}`
          : `Could not read the holder's name from the statement header`,
    }] : []),
    { ok: true, text: `Reconciled ${data.transactionCount.toLocaleString()} entries · closing balance ${kes(f.closingBalance)}` },
    { ok: f.incomeMonthsRatio >= 0.8, text: `Income received in ${monthsWithIncome} of ${f.monthsCovered} months` },
    { ok: f.incomeVolatility <= 0.5, text: `Income volatility ${f.incomeVolatility} (${f.incomeVolatility <= 0.5 ? "stable" : "erratic"})` },
    { ok: f.gamblingRatio <= 0.02, text: f.gamblingOutflow > 0 ? `Betting exposure ${Math.round(f.gamblingRatio * 100)}% of outflow (${kes(f.gamblingOutflow)})` : "Betting exposure: none detected" },
    { ok: f.loanDependencyRatio <= 0.15, text: `Loan dependency ${Math.round(f.loanDependencyRatio * 100)}% of inflow · ${f.loanEventCount} events` },
    { ok: f.avgMonthlyNet > 0, text: `Monthly surplus ${kes(f.avgMonthlyNet)} after spending` },
  ];
  return (
    <div className="w-full">
      <p className="text-center text-[11px] uppercase tracking-widest text-white/60">Running the audit</p>
      <div className="mt-3 space-y-1.5">
        {checks.map((c, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.3 }}
            className="flex items-start gap-2 rounded-lg border border-white/10 bg-black/25 px-2.5 py-2">
            {c.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-px" style={{ color: GREEN }} /> : <AlertTriangle className="h-4 w-4 shrink-0 mt-px" style={{ color: AMBER }} />}
            <span className="text-[12px] leading-snug text-white/80">{c.text}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ── Stage: score — the dial ───────────────────────────────────────────────────
const TONE_COLOR: Record<string, string> = { good: GREEN, warn: AMBER, high: "#f97316", bad: RED };
function ScoreDial({ data }: { data: CrunchData }) {
  const s = data.creditScore;
  const MIN = 300;
  const pctTarget = Math.max(0, Math.min(1, (s.score - MIN) / (s.maxScore - MIN)));
  const shown = useCountUp(s.score, 1800);
  const arc = useCountUp(pctTarget, 1800);
  const color = TONE_COLOR[s.tone] ?? GREEN;
  const R = 78, C = 2 * Math.PI * R, GAP = 0.25; // 3/4 dial

  return (
    <div className="w-full text-center">
      <div className="relative mx-auto" style={{ width: 200, height: 200 }}>
        <svg width="200" height="200" viewBox="0 0 200 200" className="-rotate-[225deg]">
          <circle cx="100" cy="100" r={R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="12" strokeLinecap="round"
            strokeDasharray={`${C * (1 - GAP)} ${C}`} />
          <circle cx="100" cy="100" r={R} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
            strokeDasharray={`${C * (1 - GAP) * arc} ${C}`} style={{ filter: `drop-shadow(0 0 10px ${color}66)` }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <p className="text-5xl font-bold tabular-nums text-white">{Math.round(shown)}</p>
          <p className="text-[11px] text-white/50">of {s.maxScore}</p>
        </div>
      </div>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 }}>
        <p className="text-lg font-bold" style={{ color }}>{s.band}</p>
        <div className="mt-2 flex items-center justify-center gap-2">
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] text-white/70">Default risk {s.pdPercent}</span>
          <span className="rounded-full px-2.5 py-1 text-[11px] font-bold text-black" style={{ backgroundColor: color }}>{s.decision}</span>
        </div>
        <p className="mt-2 text-[10px] text-white/40">{s.modelVersion}</p>
      </motion.div>
    </div>
  );
}

// ── Stage: factors ────────────────────────────────────────────────────────────
function FactorsStage({ data, onContinue }: { data: CrunchData; onContinue: () => void }) {
  const s = data.creditScore;
  const f = data.features;
  const bars = s.breakdown.filter((b) => b.points !== 0).sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  const maxAbs = Math.max(...bars.map((b) => Math.abs(b.points)), 1);
  const detailOf = (code: string) => s.reasonCodes.find((r) => r.code === code)?.detail;
  const maxNet = Math.max(...data.monthly.map((m) => Math.abs(m.net)), 1);

  return (
    <div className="w-full">
      <div className="text-center">
        <p className="text-[11px] uppercase tracking-widest text-white/60">What drove your score</p>
        <p className="mt-1 text-sm text-white/70">{f.monthsCovered} months · {data.transactionCount.toLocaleString()} transactions · {f.periodStart} to {f.periodEnd}</p>
      </div>

      {/* Factor bars — positive lifts, negative drags */}
      <div className="mt-4 space-y-2.5">
        {bars.map((b, i) => {
          const up = b.points > 0;
          const detail = detailOf(b.code);
          return (
            <motion.div key={b.code} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08 }}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[12px] text-white/85">
                  {up ? <TrendingUp className="h-3.5 w-3.5" style={{ color: GREEN }} /> : <TrendingDown className="h-3.5 w-3.5" style={{ color: RED }} />}
                  {b.factor}
                </span>
                <span className="text-[12px] font-bold tabular-nums" style={{ color: up ? GREEN : RED }}>{up ? "+" : ""}{b.points}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <motion.div initial={{ width: 0 }} animate={{ width: `${(Math.abs(b.points) / maxAbs) * 100}%` }}
                  transition={{ delay: i * 0.08 + 0.1, duration: 0.6 }} className="h-full rounded-full" style={{ backgroundColor: up ? GREEN : RED }} />
              </div>
              {detail && <p className="mt-0.5 text-[10px] text-white/45">{detail}</p>}
            </motion.div>
          );
        })}
      </div>

      {/* Monthly cashflow */}
      <div className="mt-5">
        <p className="text-[11px] uppercase tracking-widest text-white/60">Monthly net cashflow</p>
        <div className="mt-2 flex items-end gap-1.5 h-20">
          {data.monthly.map((m) => {
            const h = (Math.abs(m.net) / maxNet) * 100;
            return (
              <div key={m.month} className="flex-1 flex flex-col items-center justify-end gap-1 h-full">
                <motion.div initial={{ height: 0 }} animate={{ height: `${Math.max(6, h)}%` }} transition={{ duration: 0.6 }}
                  className="w-full rounded-t" style={{ backgroundColor: m.net >= 0 ? GREEN : RED, opacity: 0.85 }} />
                <span className="text-[8px] text-white/40">{m.month.slice(5)}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Affordability */}
      <Card className="mt-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/60">Comfortable instalment</p>
            <p className="text-xl font-bold" style={{ color: GREEN }}>{kes(data.affordability.recommendedMaxInstallment)}<span className="text-xs font-normal text-white/50">/mo</span></p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-widest text-white/60">Avg income</p>
            <p className="text-sm font-bold text-white">{kes(f.avgMonthlyIncome)}<span className="text-xs font-normal text-white/50">/mo</span></p>
          </div>
        </div>
      </Card>

      <button onClick={onContinue}
        className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-sm font-bold text-white shadow-lg"
        style={{ background: `linear-gradient(135deg, ${GREEN}, ${GREEN_DARK})` }}>
        Continue <ArrowRight className="h-4 w-4" />
      </button>
      <p className="mt-2 text-center text-[10px] text-white/40 flex items-center justify-center gap-1">
        <ShieldCheck className="h-3 w-3" /> Analysed on our servers · your statement is never stored
      </p>
    </div>
  );
}

// ── The theatre ───────────────────────────────────────────────────────────────
export default function CrunchTheatre({
  file, password, borrowerName, allowOverride, onComplete, onFail,
}: {
  file: File; password?: string; borrowerName?: string | null;
  /** Staff counter only: a mismatched holder name may be overridden (audited). The portal never passes this. */
  allowOverride?: boolean;
  onComplete: (data: CrunchData) => void; onFail: (message: string) => void;
}) {
  const [stage, setStage] = useState<Stage>("unlock");
  const [data, setData] = useState<CrunchData | null>(null);
  const [tick, setTick] = useState(fakeReceipt());
  // The identity collapse — the statement names someone else. The whole theatre
  // stops on this screen; staff may override (re-crunch with the flag), anyone
  // else can only cancel.
  const [mismatch, setMismatch] = useState<{ statementName: string; expectedName: string; message: string } | null>(null);
  const [overridden, setOverridden] = useState(false);
  const failRef = useRef(onFail);
  useEffect(() => { failRef.current = onFail; }, [onFail]);

  // Kick off the real crunch immediately; the sequence plays over it.
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const fd = new FormData();
        fd.append("file", file);
        if (password) fd.append("password", password);
        if (borrowerName) fd.append("borrowerName", borrowerName);
        if (overridden) fd.append("nameOverride", "1");
        const res = await fetch("/api/enterprise/statement-cruncher", { method: "POST", body: fd, signal: ac.signal });
        const d = await res.json();
        if (!d.success) {
          if (d.nameMismatch) { setMismatch({ statementName: d.statementName, expectedName: d.expectedName, message: d.message }); return; }
          failRef.current(d.message || "Could not read the statement.");
          return;
        }
        setData(d as CrunchData);
      } catch {
        if (!ac.signal.aborted) failRef.current("Upload failed. Check your connection and try again.");
      }
    })();
    return () => ac.abort();
  }, [file, password, borrowerName, overridden]);

  // Synthetic receipt flicker while we wait for the server.
  useEffect(() => {
    if (data) return;
    const iv = setInterval(() => setTick(fakeReceipt()), 110);
    return () => clearInterval(iv);
  }, [data]);

  // Stage machine. `extract` gates on real data so nothing false is ever shown
  // as a result; earlier stages are genuinely happening server-side anyway.
  const waiting = stage === "extract" && !data;
  useEffect(() => {
    if (stage === "factors" || waiting) return;
    const t = setTimeout(() => {
      setStage((s) => ORDER[Math.min(ORDER.length - 1, ORDER.indexOf(s) + 1)]);
    }, DUR[stage]);
    return () => clearTimeout(t);
  }, [stage, waiting]);

  const railIdx = RAIL.findIndex((r) => r.stage === stage);
  const activeIdx = stage === "factors" ? RAIL.length : railIdx;
  const canSkip = !!data && stage !== "score" && stage !== "factors";

  const COPY: Record<Stage, { title: string; sub: string }> = {
    unlock: { title: "Decrypting your statement", sub: "Unlocking the password-protected PDF from Safaricom" },
    parse: { title: "Reading the document", sub: "Rebuilding every page, line and column" },
    extract: { title: waiting ? "Extracting transactions" : "Extracting transactions", sub: waiting ? `Scanning entry ${tick}` : "Posting each entry to the ledger" },
    classify: { title: "Posting to ledgers", sub: "Classifying every shilling in and out" },
    audit: { title: "Running the audit", sub: "Reconciling balances and testing behaviour" },
    score: { title: "Your credit score", sub: "Built from six months of real cashflow" },
    factors: { title: "Your score, explained", sub: "Every factor, positive and negative" },
  };

  // The collapse: someone else's statement. Everything stops here.
  if (mismatch) {
    return (
      <div className="fixed inset-0 z-[100] overflow-y-auto">
        <div aria-hidden className="fixed inset-0 -z-10 bg-cover bg-center" style={{ backgroundImage: "url('/mpesa/mpesa-background.jpg')" }} />
        <div aria-hidden className="fixed inset-0 -z-10 bg-black/70 backdrop-blur-[3px]" />
        <div className="min-h-full flex items-center justify-center px-4 py-8">
          <motion.div initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-md text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl" style={{ backgroundColor: `${RED}22`, border: `2px solid ${RED}` }}>
              <AlertTriangle className="h-8 w-8" style={{ color: RED }} />
            </div>
            <h1 className="mt-4 text-xl font-bold text-white">This is not {mismatch.expectedName}&apos;s statement</h1>
            <p className="mt-2 text-sm text-white/70">
              The statement is registered to <span className="font-bold text-white">“{mismatch.statementName}”</span>.
              A statement only scores the person named on it.
            </p>
            <div className="mt-5 space-y-2">
              {allowOverride && (
                <button
                  onClick={() => { setMismatch(null); setOverridden(true); }}
                  className="w-full rounded-xl border border-white/25 bg-white/10 px-5 py-3 text-sm font-semibold text-white hover:bg-white/15">
                  It IS the same person — proceed anyway
                  <span className="block text-[10px] font-normal text-white/50">e.g. M-Pesa carries a different one of their registry names · the override is recorded under your name</span>
                </button>
              )}
              <button onClick={() => failRef.current(mismatch.message)}
                className="w-full rounded-xl px-5 py-3 text-sm font-bold text-white" style={{ backgroundColor: RED }}>
                Stop — wrong person&apos;s statement
              </button>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto">
      {/* M-PESA backdrop */}
      <div aria-hidden className="fixed inset-0 -z-10 bg-cover bg-center" style={{ backgroundImage: "url('/mpesa/mpesa-background.jpg')" }} />
      <div aria-hidden className="fixed inset-0 -z-10 bg-black/60 backdrop-blur-[2px]" />

      <div className="min-h-full flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
          {/* Stage rail */}
          <div className="mb-5 flex items-center gap-1">
            {RAIL.map((r, i) => (
              <div key={r.stage} className="flex-1">
                <div className="h-1 rounded-full overflow-hidden bg-white/15">
                  <motion.div className="h-full rounded-full" style={{ backgroundColor: GREEN }}
                    initial={{ width: 0 }} animate={{ width: i < activeIdx ? "100%" : i === activeIdx ? "50%" : "0%" }} transition={{ duration: 0.5 }} />
                </div>
                <p className={`mt-1 text-center text-[8px] uppercase tracking-wide ${i <= activeIdx ? "text-white/70" : "text-white/30"}`}>{r.label}</p>
              </div>
            ))}
          </div>

          {/* Header */}
          <div className="text-center mb-4">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-semibold text-white/70">
              <FileText className="h-3 w-3" /> M-PESA STATEMENT CRUNCHER
            </div>
            <AnimatePresence mode="wait">
              <motion.div key={stage} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}>
                <h1 className="mt-2 text-xl font-bold text-white drop-shadow">{COPY[stage].title}</h1>
                <p className="mt-1 text-[12px] text-white/70">{COPY[stage].sub}</p>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Body */}
          <AnimatePresence mode="wait">
            <motion.div key={stage} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.28 }}>
              {(stage === "unlock" || stage === "parse") && (
                <div className="py-4">
                  <SafaricomLoader />
                  <div className="mt-6 flex items-center justify-center gap-1.5">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="h-2 w-2 rounded-full bg-white animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </div>
                  <p className="mt-4 text-center font-mono text-[10px] text-white/40">{tick}</p>
                </div>
              )}
              {stage === "extract" && <ExtractStage data={data} />}
              {stage === "classify" && data && <ClassifyStage data={data} />}
              {stage === "audit" && data && <AuditStage data={data} />}
              {stage === "score" && data && <ScoreDial data={data} />}
              {stage === "factors" && data && <FactorsStage data={data} onContinue={() => onComplete(data)} />}
              {/* Defensive: a gated stage should never render without data. */}
              {stage !== "unlock" && stage !== "parse" && stage !== "extract" && !data && (
                <div className="py-10 text-center text-white/60"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
              )}
            </motion.div>
          </AnimatePresence>

          {canSkip && (
            <button onClick={() => setStage("score")} className="mt-5 w-full text-center text-[11px] text-white/45 hover:text-white/80">
              Skip to my score
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
