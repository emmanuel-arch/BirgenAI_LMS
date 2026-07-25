"use client";

// ─────────────────────────────────────────────────────────────────────────────
// AUTOMATIC REPAYMENTS — M-Pesa Ratiba on the borrower portal.
//
// Instead of remembering to pay every week, the customer sets a standing order
// once: "collect my installment from M-Pesa automatically until the loan clears."
// The plan is the loan's own — the installment is the amount, the repayment cycle
// the frequency — so there is nothing to fill in. Where the lender has M-Pesa, the
// customer approves it on their handset; in a demo it just turns on.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, CalendarClock, CheckCircle2, AlertTriangle, Power, Smartphone, RefreshCw } from "lucide-react";
import { useLoad } from "@/lib/hooks/useLoad";

type Existing = { id: string; status: "PENDING" | "ACTIVE" | "CANCELLED" | "FAILED"; amount: number; frequency: string; simulated: boolean };
type Offer = {
  available: boolean; amount: number; frequency: string; frequencyLabel: string;
  startDate: string; endDate: string | null; mpesaConfigured: boolean; existing: Existing | null;
};
type Phase = "loading" | "unavailable" | "offer" | "working" | "pending" | "active";

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short" }) : "");

export function AutoRepayCard({ lender, nationalId }: { lender: string; nationalId: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [offer, setOffer] = useState<Offer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [soId, setSoId] = useState<string | null>(null);

  const post = useCallback((action: string, extra?: Record<string, unknown>) =>
    fetch("/api/portal/standing-order", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lenderSlug: lender, nationalId, action, ...extra }),
    }).then((r) => r.json()), [lender, nationalId]);

  const load = useCallback(async () => {
    try {
      const d: Offer & { success: boolean } = await post("offer");
      if (!d.success || !d.available) { setPhase("unavailable"); return; }
      setOffer(d);
      if (d.existing?.status === "ACTIVE") { setSoId(d.existing.id); setPhase("active"); }
      else if (d.existing?.status === "PENDING") { setSoId(d.existing.id); setPhase("pending"); }
      else setPhase("offer");
    } catch { setPhase("unavailable"); }
  }, [post]);
  useLoad(load);

  const setup = async () => {
    setError(null); setPhase("working");
    try {
      const d = await post("setup");
      if (!d.success) { setError(d.message || "Couldn't set that up."); setPhase("offer"); return; }
      setSoId(d.standingOrderId);
      setPhase(d.status === "ACTIVE" ? "active" : "pending");
    } catch { setError("Couldn't set that up."); setPhase("offer"); }
  };

  const cancel = async () => {
    if (!soId) return;
    setError(null); setPhase("working");
    try {
      const d = await post("cancel", { standingOrderId: soId });
      if (!d.success) { setError(d.message || "Couldn't turn it off."); }
      setSoId(null); setPhase("offer");
    } catch { setError("Couldn't turn it off."); setPhase("active"); }
  };

  if (phase === "loading" || phase === "unavailable" || !offer) return null;

  return (
    <div className="mt-3 rounded-xl border border-zinc-900/10 bg-white/70 p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: "var(--brand-soft)" }}>
          <CalendarClock className="h-4 w-4" style={{ color: "var(--brand)" }} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">Automatic repayments</p>
          <p className="text-[11px] text-zinc-500 leading-tight">Never miss an installment.</p>
        </div>
        {phase === "active" && <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">ON</span>}
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50/90 px-3 py-2 text-[12px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      )}

      <AnimatePresence mode="wait">
        {phase === "offer" && (
          <motion.div key="offer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-3">
            <p className="text-[12px] text-zinc-600">
              We&apos;ll collect <strong>{kes(offer.amount)}</strong> {offer.frequencyLabel} from your M-Pesa, starting <strong>{fmtDate(offer.startDate)}</strong>{offer.endDate ? <>, until your loan clears around <strong>{fmtDate(offer.endDate)}</strong></> : ""}.
            </p>
            <button onClick={setup}
              className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold text-white"
              style={{ backgroundColor: "var(--brand)" }}>
              <CalendarClock className="h-4 w-4" /> Turn on automatic repayments
            </button>
            <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-[11px] text-zinc-400">
              <Smartphone className="h-3 w-3" /> {offer.mpesaConfigured ? "You'll approve it once on your phone. Cancel anytime." : "Demo — the standing order is simulated on this lender."}
            </p>
          </motion.div>
        )}

        {phase === "working" && (
          <motion.div key="working" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-4 text-center">
            <Loader2 className="mx-auto h-6 w-6 animate-spin" style={{ color: "var(--brand)" }} />
            <p className="mt-2 text-[12px] text-zinc-500">Just a moment…</p>
          </motion.div>
        )}

        {phase === "pending" && (
          <motion.div key="pending" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-3">
            <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-[12px] font-semibold text-amber-700">
              <Smartphone className="h-4 w-4 shrink-0" /> Approve the standing order on your phone.
            </div>
            <button onClick={load}
              className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-900/15 bg-white/70 px-5 py-2.5 text-[12px] font-semibold text-zinc-700 hover:bg-white">
              <RefreshCw className="h-3.5 w-3.5" /> I&apos;ve approved it — check again
            </button>
          </motion.div>
        )}

        {phase === "active" && (
          <motion.div key="active" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-3">
            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-[12px] font-semibold text-emerald-700">
              <CheckCircle2 className="h-4 w-4 shrink-0" /> {kes(offer.existing?.amount ?? offer.amount)} will be collected {offer.frequencyLabel}.
            </div>
            <button onClick={cancel}
              className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-900/15 bg-white/70 px-5 py-2.5 text-[12px] font-semibold text-zinc-600 hover:bg-white">
              <Power className="h-3.5 w-3.5" /> Turn off automatic repayments
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
