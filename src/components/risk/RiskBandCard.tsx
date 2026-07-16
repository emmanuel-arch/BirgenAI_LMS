"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE RISK BAND CARD — what this customer is, in one look.
//
// The Customer-360 used to carry a bare "Internal score: 747" tile. A number on a
// scale nobody has memorised is not information; an officer still has to know that
// 747 is good, that it is Prime, that Prime means roughly a 1-in-50 chance of
// default, and that Prime graduates at 30%. This card says all four.
//
// HONEST GAUGE. The arc is the probability of DEFAULT, not the score — because that
// is the number a lending decision actually turns on, and because a rising score arc
// and a rising risk arc pointing the same way would be a trap. It fills clockwise
// with risk: a Prime customer's arc is nearly empty, and that is the shape an officer
// should learn to want.
//
// AND IT SAYS WHERE THE NUMBER CAME FROM. `source: "model"` is a probability computed
// from this person's own statement features. `source: "band"` is the midpoint of the
// band they fall in — a stand-in, and labelled as one. Rendering a made-up figure to
// two decimal places as though it were measured is how a model gets trusted for
// things it never said.
// ─────────────────────────────────────────────────────────────────────────────
import { ShieldCheck, TrendingUp, AlertTriangle, OctagonAlert, Circle, type LucideIcon } from "lucide-react";
import type { RiskBandKey } from "@/lib/risk/bands";

const ICONS: Record<string, LucideIcon> = { ShieldCheck, TrendingUp, AlertTriangle, OctagonAlert };

export type RiskView = {
  band: {
    key: RiskBandKey;
    label: string;
    meaning: string;
    from: string;
    to: string;
    ink: string;
    soft: string;
    icon: string;
    graduationPercent: number;
  } | null;
  /** 300–900, from the cruncher. */
  score: number | null;
  /** 0–100, from repayment behaviour. Null until they have cleared a loan. */
  behavioural: number | null;
  pd: { pd: number; source: "model" | "band" } | null;
};

/** A semicircular gauge. 0% risk is an empty arc; 100% fills it. */
function PdGauge({ pd, from, to, ink }: { pd: number; from: string; to: string; ink: string }) {
  const R = 52;
  const C = Math.PI * R; // half circumference
  // A 0.4% risk would be an invisible sliver; floor the DRAWN arc so the gauge always
  // reads as a gauge, while the number beside it stays exactly what it is.
  const drawn = Math.max(0.02, Math.min(1, pd));
  const dash = C * drawn;

  return (
    <div className="relative shrink-0" style={{ width: 128, height: 76 }}>
      <svg viewBox="0 0 128 72" width={128} height={72} aria-hidden>
        <defs>
          <linearGradient id={`pd-${ink.replace("#", "")}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={from} />
            <stop offset="100%" stopColor={to} />
          </linearGradient>
        </defs>
        <path d="M 12 64 A 52 52 0 0 1 116 64" fill="none" stroke="rgba(0,0,0,0.07)" strokeWidth="10" strokeLinecap="round" />
        <path
          d="M 12 64 A 52 52 0 0 1 116 64"
          fill="none"
          stroke={`url(#pd-${ink.replace("#", "")})`}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${C}`}
          style={{ transition: "stroke-dasharray 900ms cubic-bezier(0.22,1,0.36,1)" }}
        />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <p className="text-xl font-bold leading-none tabular-nums" style={{ color: ink }}>
          {(pd * 100).toFixed(pd < 0.1 ? 1 : 0)}%
        </p>
        <p className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400">default risk</p>
      </div>
    </div>
  );
}

export function RiskBandCard({ view, graduation }: {
  view: RiskView;
  /** One line about where they are on the ladder, if we know. */
  graduation?: { eligible: boolean; reason: string; newLimit: number | null } | null;
}) {
  const b = view.band;

  if (!b) {
    return (
      <div className="glass p-4">
        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-zinc-400">
          <Circle className="h-3 w-3" /> Risk band
        </p>
        <p className="mt-2 text-sm text-zinc-500">
          Not scored yet. Crunch their M-Pesa statement and they will be placed in a band.
        </p>
      </div>
    );
  }

  const Icon = ICONS[b.icon] ?? Circle;

  return (
    <div className="glass overflow-hidden p-0">
      {/* The band's own colour, as a header — so the card is recognisable across the
          room before a single word is read. */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5" style={{ background: `linear-gradient(90deg, ${b.from}, ${b.to})` }}>
        <p className="flex items-center gap-1.5 text-sm font-bold text-white">
          <Icon className="h-4 w-4" /> {b.label}
        </p>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-white/80">Risk band</p>
      </div>

      <div className="flex flex-wrap items-center gap-4 p-4">
        {view.pd && <PdGauge pd={view.pd.pd} from={b.from} to={b.to} ink={b.ink} />}

        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-relaxed text-zinc-700">{b.meaning}</p>

          <div className="mt-2.5 flex flex-wrap gap-2">
            {view.score != null && (
              <Chip label="Statement score" value={`${view.score} / 900`} soft={b.soft} ink={b.ink} />
            )}
            {view.behavioural != null && (
              <Chip label="Repayment record" value={`${view.behavioural} / 100`} soft={b.soft} ink={b.ink} />
            )}
            <Chip label="Graduates at" value={b.graduationPercent > 0 ? `+${b.graduationPercent}%` : "—"} soft={b.soft} ink={b.ink} />
          </div>

          {view.pd && (
            <p className="mt-2 text-[10px] text-zinc-400">
              {view.pd.source === "model"
                ? "Probability computed from their own statement — not an average of people like them."
                : "Estimated from their band — no model has scored this customer yet."}
            </p>
          )}
        </div>
      </div>

      {/* The ladder: what has to happen for their limit to move. This is the part a
          customer actually asks about, and the officer should not have to guess. */}
      {graduation && (
        <div
          className="border-t px-4 py-2.5 text-[12px] leading-relaxed"
          style={{ borderColor: "rgba(0,0,0,0.06)", backgroundColor: graduation.eligible ? "rgba(5,150,105,0.06)" : "rgba(0,0,0,0.02)" }}
        >
          {graduation.eligible && graduation.newLimit != null ? (
            <span className="font-semibold text-emerald-700">
              Due to graduate — their limit rises to KES {graduation.newLimit.toLocaleString()} on the next run. {graduation.reason}
            </span>
          ) : (
            <span className="text-zinc-600">{graduation.reason}</span>
          )}
        </div>
      )}
    </div>
  );
}

function Chip({ label, value, soft, ink }: { label: string; value: string; soft: string; ink: string }) {
  return (
    <span className="rounded-lg px-2 py-1" style={{ backgroundColor: soft }}>
      <span className="block text-[9px] font-semibold uppercase tracking-wide" style={{ color: ink, opacity: 0.75 }}>{label}</span>
      <span className="block text-[13px] font-bold tabular-nums" style={{ color: ink }}>{value}</span>
    </span>
  );
}
