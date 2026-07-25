"use client";

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL REPORT — the customer's own money story, on the portal, paid for.
//
// The same CRB-beating read the lender runs in the console, turned into a self-
// serve product: pay once, upload your latest M-Pesa statement, and see your
// Internal Score, where your money actually goes, and what a lender sees when they
// look at you. Pay-before-crunch — the refresh only runs on a confirmed payment,
// and one payment buys exactly one run.
//
// Simulation-aware: where the lender has no M-Pesa yet, the payment confirms
// itself so the experience is whole in a demo; the copy says which it is.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2, Zap, Gauge, ArrowRight, Upload, Lock, AlertTriangle, CheckCircle2,
  TrendingUp, TrendingDown, ShieldCheck, RefreshCw, Smartphone,
} from "lucide-react";
import { useLoad } from "@/lib/hooks/useLoad";
import type { InternalReport, InternalScore } from "@/lib/statement/analyze";

type Phase = "loading" | "unavailable" | "offer" | "paying" | "ready" | "crunching" | "done";

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const prettyCat = (c: string) => c.replace(/[_-]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

const BAND_TONE: Record<InternalScore["band"], { color: string; soft: string }> = {
  Excellent: { color: "#059669", soft: "rgba(5,150,105,0.12)" },
  Good: { color: "#0284c7", soft: "rgba(2,132,199,0.12)" },
  Fair: { color: "#d97706", soft: "rgba(217,119,6,0.14)" },
  Poor: { color: "#dc2626", soft: "rgba(220,38,38,0.12)" },
  "Very Poor": { color: "#b91c1c", soft: "rgba(185,28,28,0.14)" },
};
const CAT_COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];

export function InternalReportCard({ lender, nationalId }: { lender: string; nationalId: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [price, setPrice] = useState(0);
  const [name, setName] = useState("Internal Report");
  const [simulated, setSimulated] = useState(false);
  const [mpesaConfigured, setMpesaConfigured] = useState(false);
  const [intentId, setIntentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [needPassword, setNeedPassword] = useState(false);
  const [report, setReport] = useState<InternalReport | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const post = useCallback((action: string, extra?: Record<string, unknown>) =>
    fetch("/api/portal/recrunch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lenderSlug: lender, nationalId, action, ...extra }),
    }).then((r) => r.json()), [lender, nationalId]);

  // Load the offer once the card mounts (the borrower is already verified above it).
  const load = useCallback(async () => {
    try {
      const d = await post("offer");
      if (!d.success || !d.available) { setPhase("unavailable"); return; }
      setPrice(d.price); setName(d.name || "Internal Report"); setMpesaConfigured(!!d.mpesaConfigured);
      if (d.credit) { setIntentId(d.credit); setPhase("ready"); }
      else setPhase("offer");
    } catch { setPhase("unavailable"); }
  }, [post]);
  useLoad(load);

  const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };

  const pay = async () => {
    setError(null);
    setPhase("paying");
    try {
      const d = await post("pay");
      if (!d.success) { setError(d.message || "Could not start the payment."); setPhase("offer"); return; }
      if (d.alreadyPaid) { setIntentId(d.intentId); setPhase("ready"); return; }
      setIntentId(d.intentId); setSimulated(!!d.simulated);
      // Poll until the money lands (a simulated push confirms on the first check).
      let ticks = 0;
      stopPoll();
      pollRef.current = setInterval(async () => {
        ticks++;
        try {
          const s = await post("status", { intentId: d.intentId });
          if (s.state === "SUCCESS") { stopPoll(); setPhase("ready"); }
          else if (s.state === "FAILED" || s.state === "TIMEOUT" || ticks > 36) {
            stopPoll(); setError("The payment didn't go through. Try again."); setPhase("offer");
          }
        } catch { /* keep polling */ }
      }, 2500);
    } catch { setError("Could not start the payment."); setPhase("offer"); }
  };

  const run = async () => {
    if (!file || !intentId) { setError("Attach your M-Pesa statement first."); return; }
    setError(null); setNeedPassword(false); setPhase("crunching");
    try {
      const fd = new FormData();
      fd.append("lenderSlug", lender); fd.append("nationalId", nationalId);
      fd.append("intentId", intentId); fd.append("file", file);
      if (password) fd.append("password", password);
      const res = await fetch("/api/portal/recrunch/run", { method: "POST", body: fd });
      const d = await res.json();
      if (!d.success) {
        if (d.needPassword) { setNeedPassword(true); setError(d.message || "This statement is password-protected."); }
        else setError(d.message || "We couldn't read that statement.");
        setPhase("ready");
        return;
      }
      setReport(d.report); setPhase("done");
    } catch { setError("Something went wrong. Try again."); setPhase("ready"); }
  };

  const restart = () => {
    setReport(null); setFile(null); setPassword(""); setNeedPassword(false);
    setIntentId(null); setError(null); setPhase("offer");
  };

  if (phase === "loading" || phase === "unavailable") return null;

  return (
    <div className="mt-4 rounded-xl border border-zinc-900/10 bg-white/70 p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: "var(--brand-soft)" }}>
          <Gauge className="h-4 w-4" style={{ color: "var(--brand)" }} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">Your Internal Report</p>
          <p className="text-[11px] text-zinc-500 leading-tight">See your score, and what a lender sees.</p>
        </div>
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50/90 px-3 py-2 text-[12px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      )}

      <AnimatePresence mode="wait">
        {/* OFFER */}
        {phase === "offer" && (
          <motion.div key="offer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-3">
            <p className="text-[12px] text-zinc-600">
              A full read of your M-Pesa: your <strong>Internal Score</strong>, where your money goes, and your borrowing habits — refreshed from your latest statement.
            </p>
            <button onClick={pay}
              className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold text-white"
              style={{ backgroundColor: "var(--brand)" }}>
              <Zap className="h-4 w-4" /> Refresh my report · {kes(price)}
            </button>
            <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-[11px] text-zinc-400">
              <Smartphone className="h-3 w-3" /> {mpesaConfigured ? "Paid by M-Pesa to your registered number." : "Demo — payment is simulated on this lender."}
            </p>
          </motion.div>
        )}

        {/* PAYING */}
        {phase === "paying" && (
          <motion.div key="paying" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-4 text-center">
            <Loader2 className="mx-auto h-6 w-6 animate-spin" style={{ color: "var(--brand)" }} />
            <p className="mt-2 text-[13px] font-semibold">{simulated ? "Confirming your payment…" : "Check your phone"}</p>
            <p className="mt-0.5 text-[11px] text-zinc-500">{simulated ? "Just a moment." : `Enter your M-Pesa PIN to pay ${kes(price)}.`}</p>
          </motion.div>
        )}

        {/* READY — upload the statement */}
        {phase === "ready" && (
          <motion.div key="ready" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-3">
            <div className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> Paid — upload your statement to run it.
            </div>
            <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-zinc-900/20 bg-white/60 px-3 py-3 text-[12px] hover:bg-white">
              <Upload className="h-4 w-4 shrink-0 text-zinc-400" />
              <span className="min-w-0 flex-1 truncate text-zinc-600">{file ? file.name : "Attach your M-Pesa statement (PDF)"}</span>
              <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); }} />
            </label>
            {needPassword && (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-zinc-900/15 bg-white/80 px-3">
                <Lock className="h-4 w-4 shrink-0 text-zinc-400" />
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="Statement password" className="flex-1 bg-transparent py-2.5 text-sm outline-none placeholder:text-zinc-400" />
              </div>
            )}
            <button onClick={run} disabled={!file}
              className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: "var(--brand)" }}>
              <ArrowRight className="h-4 w-4" /> Run my report
            </button>
            <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-[11px] text-zinc-400">
              <Lock className="h-3 w-3" /> Read once to build your report — never stored.
            </p>
          </motion.div>
        )}

        {/* CRUNCHING */}
        {phase === "crunching" && (
          <motion.div key="crunching" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-4 text-center">
            <Loader2 className="mx-auto h-6 w-6 animate-spin" style={{ color: "var(--brand)" }} />
            <p className="mt-2 text-[13px] font-semibold">Reading your statement…</p>
            <p className="mt-0.5 text-[11px] text-zinc-500">Clustering merchants, scoring your habits.</p>
          </motion.div>
        )}

        {/* DONE */}
        {phase === "done" && report && (
          <motion.div key="done" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-3">
            <ReportView report={report} />
            <button onClick={restart}
              className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-900/15 bg-white/70 px-5 py-2.5 text-[12px] font-semibold text-zinc-700 hover:bg-white">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh again later
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ReportView({ report }: { report: InternalReport }) {
  const tone = BAND_TONE[report.score.band];
  const topCats = report.spendByCategory.slice(0, 5);
  const maxShare = Math.max(0.01, ...topCats.map((c) => c.share));
  const drivers = report.score.drivers.slice(0, 3);

  return (
    <div className="space-y-3">
      {/* Score */}
      <div className="rounded-xl p-4 text-center" style={{ background: `linear-gradient(135deg, ${tone.soft}, transparent)` }}>
        <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Internal Score</p>
        <p className="text-4xl font-black tabular-nums" style={{ color: tone.color }}>{report.score.value}</p>
        <p className="text-[11px] text-zinc-500">of 900</p>
        <span className="mt-1 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold" style={{ backgroundColor: tone.color, color: "#fff" }}>{report.score.band}</span>
      </div>

      {/* Drivers */}
      {drivers.length > 0 && (
        <div className="space-y-1">
          {drivers.map((d, i) => (
            <div key={i} className="flex items-start gap-2 text-[11px]">
              {d.direction === "up" ? <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" /> : <TrendingDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />}
              <span className="text-zinc-600"><strong className="text-zinc-800">{d.factor}</strong> — {d.detail}</span>
            </div>
          ))}
        </div>
      )}

      {/* Where the money goes */}
      {topCats.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400">Where your money goes</p>
          <div className="space-y-1.5">
            {topCats.map((c, i) => (
              <div key={c.category}>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-zinc-600">{prettyCat(c.category)}</span>
                  <span className="font-semibold tabular-nums text-zinc-700">{kes(c.amount)}</span>
                </div>
                <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-900/[0.06]">
                  <div className="h-full rounded-full" style={{ width: `${(c.share / maxShare) * 100}%`, backgroundColor: CAT_COLORS[i % CAT_COLORS.length] }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lifestyle */}
      {report.lifestyle.narrative && (
        <div className="rounded-lg bg-zinc-900/[0.03] p-3">
          <p className="text-[12px] leading-snug text-zinc-600">{report.lifestyle.narrative}</p>
          {report.lifestyle.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {report.lifestyle.tags.slice(0, 6).map((t) => (
                <span key={t} className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-zinc-500 ring-1 ring-zinc-900/5">{t}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Existing lenders */}
      {report.loanBehaviour.lenders.length > 0 && (
        <div>
          <p className="mb-1.5 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
            <ShieldCheck className="h-3 w-3" /> Your borrowing
            {report.loanBehaviour.fulizaReliant && <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">Fuliza-reliant</span>}
          </p>
          <div className="space-y-1">
            {report.loanBehaviour.lenders.slice(0, 4).map((l) => (
              <div key={l.name} className="flex items-center justify-between rounded-lg bg-white/60 px-2.5 py-1.5 text-[11px] ring-1 ring-zinc-900/5">
                <span className="font-medium text-zinc-700">{l.name}</span>
                <span className="tabular-nums text-zinc-500">borrowed {kes(l.borrowed)} · repaid {kes(l.repaid)}</span>
              </div>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-zinc-400">Repayment cadence: {report.loanBehaviour.repaymentCadence}.</p>
        </div>
      )}

      {/* Highlights */}
      {report.highlights.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {report.highlights.slice(0, 4).map((h, i) => (
            <span key={i} className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={{
                backgroundColor: h.tone === "positive" ? "rgba(5,150,105,0.12)" : h.tone === "watch" ? "rgba(217,119,6,0.14)" : "rgba(220,38,38,0.12)",
                color: h.tone === "positive" ? "#047857" : h.tone === "watch" ? "#b45309" : "#b91c1c",
              }}>
              {h.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
