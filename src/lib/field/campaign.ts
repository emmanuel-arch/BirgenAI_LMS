// ─────────────────────────────────────────────────────────────────────────────
// LOCATION CAMPAIGN — what it actually takes to pin a book.
//
// A lender who has just been told "17,017 of your 17,017 customers have no
// location on file" needs the next sentence to be an answer, not a bigger number.
// This module is that sentence: given the backlog, how many officers are on it,
// and how many pins one officer captures in a day, when is the book covered?
//
// Two things make the arithmetic honest rather than decorative:
//
//   1. THE BACKLOG IS A STOCK, NOT A FLOW. It stopped growing the moment new
//      applications began capturing a pin at source. So this is a finite piece of
//      work with an end date, and saying so is the whole point.
//
//   2. SOME OF IT DRAINS FOR FREE. Every customer who comes back to borrow gets
//      pinned at application, at no marginal cost. `organicPerMonth` is that rate
//      — measured from the lender's own history, never assumed — and it is
//      subtracted from the work, not added to the pitch. On Micromart's book it is
//      small (2,211 customers returned in twelve months), which is exactly why the
//      deliberate sweep is worth costing.
//
// Everything here is pure and unit-free of any lender: no live reads, no rates
// invented, nothing that cannot be traced to an input the caller measured.
// ─────────────────────────────────────────────────────────────────────────────

export type CampaignInput = {
  /** Customers with no pin. The stock to clear. */
  backlog: number;
  /** Officers working the list. Defaults to the queues the book already shards into. */
  officers: number;
  /** Pins one officer captures per working day. */
  pinsPerOfficerPerDay: number;
  /** Working days in a week — 5 or 6 in Kenyan field practice. */
  daysPerWeek?: number;
  /**
   * Customers pinned per month WITHOUT a visit, because they came back to borrow
   * and the funnel captured it. Measured from the lender's history; 0 if unknown.
   */
  organicPerMonth?: number;
  /** Where the clock starts. Injected so the result is testable. */
  from?: Date;
};

export type CampaignPlan = {
  /** Pins captured per working day across the whole team. */
  perDay: number;
  /** Working days to clear the backlog. */
  workingDays: number;
  /** Calendar weeks those working days span. */
  weeks: number;
  /** Calendar date the last pin lands on. */
  finishesOn: Date;
  /** Average customers each officer carries. */
  perOfficer: number;
  /** Share of the backlog that drains on its own over the campaign's length. */
  organicShare: number;
  /** Working days if nobody visits and only returning borrowers get pinned. */
  organicOnlyMonths: number | null;
  /** Coverage after 1 / 2 / 4 / 8 / 12 weeks — the curve, for a sparkline. */
  curve: { week: number; pinned: number; pct: number }[];
};

/** Sane bounds. A slider that can be dragged to 0 officers must not divide by zero. */
const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(Number.isFinite(n) ? n : lo, lo), hi);

export function planCampaign(input: CampaignInput): CampaignPlan {
  const backlog = Math.max(Math.round(input.backlog), 0);
  const officers = clamp(Math.round(input.officers), 1, 5000);
  const rate = clamp(input.pinsPerOfficerPerDay, 0.5, 200);
  const daysPerWeek = clamp(Math.round(input.daysPerWeek ?? 6), 1, 7);
  const organicPerMonth = Math.max(input.organicPerMonth ?? 0, 0);
  const from = input.from ?? new Date();

  const perDay = officers * rate;
  const workingDays = perDay > 0 ? Math.ceil(backlog / perDay) : 0;
  const weeks = Math.ceil(workingDays / daysPerWeek);

  // Working days are not calendar days: a six-day week still skips a day. Walk the
  // calendar rather than multiplying, so the finish date lands on a real date.
  const finishesOn = addWorkingDays(from, workingDays, daysPerWeek);

  // Organic capture over the campaign's own length — how much of the work would
  // have disappeared anyway. Honest framing: it makes the sweep smaller, and on a
  // quiet book it is nearly nothing.
  const months = workingDays / (daysPerWeek * 4.333);
  const organicShare = backlog > 0 ? Math.min((organicPerMonth * months) / backlog, 1) : 0;

  // How long the do-nothing option takes. Null when the book is not lending at all,
  // because "never" is the truthful answer and ∞ is not a number to render.
  const organicOnlyMonths = organicPerMonth > 0 ? Math.ceil(backlog / organicPerMonth) : null;

  const curve = [1, 2, 4, 8, 12].map((week) => {
    const pinned = Math.min(Math.round(perDay * daysPerWeek * week), backlog);
    return { week, pinned, pct: backlog > 0 ? (pinned / backlog) * 100 : 100 };
  });

  return { perDay, workingDays, weeks, finishesOn, perOfficer: Math.ceil(backlog / officers), organicShare, organicOnlyMonths, curve };
}

/**
 * Advance `days` WORKING days from a date. A 6-day week rests on Sunday; a 5-day
 * week rests Saturday and Sunday; 7 runs straight through.
 */
export function addWorkingDays(from: Date, days: number, daysPerWeek: number): Date {
  const d = new Date(from.getTime());
  if (days <= 0) return d;
  const rests = (dow: number) => (daysPerWeek >= 7 ? false : daysPerWeek === 6 ? dow === 0 : dow === 0 || dow === 6);
  let left = days;
  // Bounded so a pathological input cannot spin: ~20 years of calendar.
  for (let guard = 0; left > 0 && guard < 7500; guard++) {
    d.setDate(d.getDate() + 1);
    if (!rests(d.getDay())) left--;
  }
  return d;
}

/** "3 weeks" · "4 months" · "2 years" — a duration the way a manager says it. */
export function humanDuration(workingDays: number, daysPerWeek = 6): string {
  if (workingDays <= 0) return "done";
  if (workingDays === 1) return "1 day";
  if (workingDays <= daysPerWeek) return `${workingDays} days`;
  const weeks = Math.round(workingDays / daysPerWeek);
  if (weeks <= 8) return `${weeks} week${weeks === 1 ? "" : "s"}`;
  const months = Math.round(workingDays / (daysPerWeek * 4.333));
  if (months < 24) return `${months} month${months === 1 ? "" : "s"}`;
  return `${(months / 12).toFixed(1)} years`;
}

/** The three tiers, in the order they are worked, with the words used on screen. */
export const TIER_META = {
  MONEY_OUT: {
    label: "Money out",
    short: "Money out",
    blurb: "A live loan at an address nobody holds. Chase these first — the exposure is real today.",
    tone: { ink: "#b91c1c", soft: "rgba(239,68,68,0.10)", ring: "rgba(239,68,68,0.28)", dot: "#ef4444" },
  },
  REPEAT: {
    label: "Blocked at next loan",
    short: "Next loan",
    blurb: "Cleared history and a standing limit — each one meets the location gate the next time they borrow.",
    tone: { ink: "#b45309", soft: "rgba(245,158,11,0.10)", ring: "rgba(245,158,11,0.28)", dot: "#f59e0b" },
  },
  DORMANT: {
    label: "Never borrowed",
    short: "Dormant",
    blurb: "On the book, never taken a loan. No exposure, no urgency — capture it when convenient.",
    tone: { ink: "#3f6212", soft: "rgba(132,204,22,0.10)", ring: "rgba(132,204,22,0.28)", dot: "#84cc16" },
  },
} as const;

export type TierKey = keyof typeof TIER_META;
