// ─────────────────────────────────────────────────────────────────────────────
// FIELD RISK — collections urgency, read from the ledger, for the map's dots.
//
// The Customers-Near-Me map colours every pin by how much attention the account
// needs RIGHT NOW — not by the credit band it was booked at. That signal is the
// arrears, and only the arrears: the oldest unpaid past-due installment sets
// days-past-due (DPD), and the sum of what is short sets the money at stake.
//
//   green  — current. Nothing overdue.
//   amber  — slipping. 1–29 days late.
//   red    — in default. 30+ days late (PAR30 — the number a lender writes to).
//
// A `weight` (money × how long it has been sour) ranks the accounts so the single
// worst pin in view can BLINK — the one door the officer should be at today.
//
// The ETA here is an ESTIMATE off the straight-line distance, because a country
// of pins can't each cost a Directions call. The tap-through Route Planner asks
// Google for the real, traffic-aware time to the one door the officer picks.
// ─────────────────────────────────────────────────────────────────────────────

export type RiskLevel = "green" | "amber" | "red";

type InstallmentLite = { dueDate: Date | string; amountDue: unknown; amountPaid: unknown };
type LoanLite = { status: string; installments: InstallmentLite[] };

const DAY = 86_400_000;
const num = (v: unknown) => Number(v ?? 0);

export type FieldRisk = { level: RiskLevel; dpd: number; overdue: number; weight: number };

/** The one dot colour for a customer, from every ACTIVE loan they carry. */
export function fieldRisk(loans: LoanLite[], now = Date.now()): FieldRisk {
  let dpd = 0;
  let overdue = 0;
  for (const loan of loans) {
    if (loan.status !== "ACTIVE") continue;
    for (const i of loan.installments) {
      const due = new Date(i.dueDate).getTime();
      const short = num(i.amountDue) - num(i.amountPaid);
      if (due < now && short > 0.5) {
        overdue += short;
        const d = Math.floor((now - due) / DAY);
        if (d > dpd) dpd = d;
      }
    }
  }
  const level: RiskLevel = dpd >= 30 ? "red" : dpd >= 1 ? "amber" : "green";
  // Money at stake amplified by how long it has been sour, and defaults sorted
  // ahead of everything so the blink never lands on a merely-late account.
  const weight = Math.round(overdue * (1 + dpd / 30) + (level === "red" ? 1e7 : 0));
  return { level, dpd, overdue: Math.round(overdue), weight };
}

/** Rough drive-time from great-circle distance — town-slow, open-road-quick. */
export function estimateEtaMin(km: number | null | undefined): number | null {
  if (km == null || !Number.isFinite(km)) return null;
  const mins = km <= 10 ? (km / 22) * 60 : (10 / 22 + (km - 10) / 55) * 60;
  return Math.max(1, Math.round(mins));
}

/** "12 min" / "1 h 20 m" — the estimate, spoken the way a rider reads it. */
export function fmtEtaMin(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min)) return "—";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} m` : `${h} h`;
}

export const RISK_TONE: Record<RiskLevel, { dot: string; ring: string; ink: string; soft: string; label: string }> = {
  green: { dot: "#10b981", ring: "#6ee7b7", ink: "#047857", soft: "rgba(16,185,129,0.12)", label: "Current" },
  amber: { dot: "#f59e0b", ring: "#fcd34d", ink: "#b45309", soft: "rgba(245,158,11,0.14)", label: "Slipping" },
  red: { dot: "#ef4444", ring: "#fca5a5", ink: "#b91c1c", soft: "rgba(239,68,68,0.14)", label: "In default" },
};
