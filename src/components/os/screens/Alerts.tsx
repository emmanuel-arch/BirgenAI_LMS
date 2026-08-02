"use client";

// ─────────────────────────────────────────────────────────────────────────────
// ALERTS — what it would have told you if you hadn't asked.
//
// The founder asked for "notifications which are recommendations maybe from the
// AI". The word "maybe" is the whole design problem, and this screen resolves it
// one way: EVERY ROW HERE IS A COUNTED FACT.
//
// A tray is the one surface where a lender acts without checking the working. They
// see a badge, they read six words, they pick up the phone. So nothing on it is
// generated, inferred, or phrased by a model — each row is a query with a
// threshold (lib/riri/signals.ts), the number in the title is a real count, and
// tapping it lands on the screen where the work gets done. The intelligence is in
// WHICH facts surface and in what order, which is genuinely useful and is the only
// part that cannot be wrong about reality.
//
// It is also deliberately not only bad news. A tray that brings nothing but
// arrears is a tray people stop opening, so the opportunity band — verified
// customers carrying a limit and no loan — sits in the same list, in green, below
// the things that are on fire.
// ─────────────────────────────────────────────────────────────────────────────
import { motion } from "framer-motion";
import {
  AlertTriangle, ArrowRight, BellRing, Loader2, ShieldCheck, TrendingUp, Info, RefreshCw,
} from "lucide-react";
import { Screen, SectionLabel, EmptyState } from "../kit";
import type { Signal, SignalSeverity } from "@/lib/riri/signals";

const BANDS: { key: SignalSeverity; label: string; icon: typeof AlertTriangle; tint: string; ring: string }[] = [
  { key: "critical", label: "Needs you now", icon: AlertTriangle, tint: "text-rose-600", ring: "border-rose-200 bg-rose-50/60" },
  { key: "attention", label: "Worth your morning", icon: BellRing, tint: "text-amber-600", ring: "border-amber-200 bg-amber-50/50" },
  { key: "opportunity", label: "Money on the table", icon: TrendingUp, tint: "text-emerald-600", ring: "border-emerald-200 bg-emerald-50/50" },
  { key: "info", label: "Housekeeping", icon: Info, tint: "text-sky-600", ring: "border-sky-200 bg-sky-50/40" },
];

const SCOPE_NOTE: Record<string, string> = {
  OWN: "Everything here is about customers you registered.",
  BRANCH: "Everything here is about your branch.",
  BRANCH_TREE: "Everything here is about your branch and the ones under it.",
  ORG: "Everything here is about the whole book.",
};

export function AlertsScreen({
  signals, loading, scope, at, onOpen, onRefresh,
}: {
  signals: Signal[];
  loading: boolean;
  scope: string | null;
  at: string | null;
  onOpen: (s: Signal) => void;
  onRefresh: () => void;
}) {
  if (loading && !signals.length) {
    return (
      <Screen>
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-300" />
        </div>
      </Screen>
    );
  }

  if (!signals.length) {
    return (
      <Screen>
        <EmptyState
          icon={<ShieldCheck className="h-6 w-6 text-emerald-500" />}
          title="Nothing needs you"
          detail={`No arrears spike, no unmatched money, no queue backing up. ${scope ? SCOPE_NOTE[scope] ?? "" : ""}`}
          action={
            <button onClick={onRefresh} className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-900/10 bg-white px-3 py-1.5 text-[11.5px] font-semibold text-zinc-600 hover:text-zinc-900">
              <RefreshCw className="h-3 w-3" /> Check again
            </button>
          }
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-3 pt-1">
        {BANDS.map((band) => {
          const rows = signals.filter((s) => s.severity === band.key);
          if (!rows.length) return null;
          const BandIcon = band.icon;
          return (
            <div key={band.key}>
              <SectionLabel className="flex items-center gap-1.5">
                <BandIcon className={`h-3 w-3 ${band.tint}`} /> {band.label}
              </SectionLabel>
              <div className="mt-1.5 space-y-1.5">
                {rows.map((s, i) => (
                  <motion.button
                    key={s.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i, 6) * 0.03 }}
                    onClick={() => onOpen(s)}
                    className={`group flex w-full items-start gap-2.5 rounded-2xl border px-3 py-2.5 text-left transition-all hover:shadow-sm active:scale-[0.985] ${band.ring}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start gap-1.5">
                        <span className="min-w-0 flex-1 text-[12.5px] font-semibold leading-tight text-zinc-900">{s.title}</span>
                        {s.amount && (
                          <span className={`shrink-0 text-[11px] font-bold tabular-nums ${band.tint}`}>{s.amount}</span>
                        )}
                      </span>
                      <span className="mt-1 block text-[10.5px] leading-snug text-zinc-600">{s.body}</span>
                      <span className={`mt-1.5 inline-flex items-center gap-1 text-[10.5px] font-semibold ${band.tint}`}>
                        {s.actionLabel} <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                      </span>
                    </span>
                  </motion.button>
                ))}
              </div>
            </div>
          );
        })}

        {/* The provenance line. It matters that a lender knows this is arithmetic
            over their own rows and not an opinion — it is the difference between
            acting on it and wondering about it. */}
        <div className="rounded-xl border border-zinc-900/[0.06] bg-white/60 px-3 py-2">
          <p className="text-[9.5px] leading-snug text-zinc-500">
            Every line above is a count off your live book, not a prediction.
            {scope && ` ${SCOPE_NOTE[scope] ?? ""}`}
          </p>
          <button
            onClick={onRefresh}
            className="mt-1 inline-flex items-center gap-1 text-[9.5px] font-semibold text-zinc-400 hover:text-zinc-700"
          >
            <RefreshCw className={`h-2.5 w-2.5 ${loading ? "animate-spin" : ""}`} />
            {at ? `Read ${new Date(at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", hour12: false })} — check again` : "Check again"}
          </button>
        </div>
      </div>
    </Screen>
  );
}
