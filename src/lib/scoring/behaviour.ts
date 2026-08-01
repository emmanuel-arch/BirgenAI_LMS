// ─────────────────────────────────────────────────────────────────────────────
// THE BEHAVIOURAL ENGINE — pure, declarative, and able to move mid-loan.
//
// Reads the lender's own matrix (behaviour-policy.ts) and answers three questions
// about a borrower's repayment record:
//
//   what is their score, and why      → scoreBehaviour()
//   what does that make their limit   → assessLadder()
//   how has it moved this loan cycle  → the per-installment trail on the result
//
// Pure and serialisable: no database, no clock beyond the `now` you pass in. That is
// what lets `npm run test:behaviour` hold it to the stored procedure's arithmetic on
// worked examples, and what lets the same function answer a "what if" on screen
// without writing anything.
//
// THE ONE STRUCTURAL DEPARTURE FROM THE PROCEDURE: it can score a LIVE loan. The
// original reads `WHERE l.LoanCleared = 1`, so a borrower's score is frozen between
// borrowing and clearing — a post-mortem, not a monitor. With `window.includeActive`
// an installment paid this morning moves the score this morning, which is the only
// way a PD can change several times across one cycle.
// ─────────────────────────────────────────────────────────────────────────────
import {
  metricSpec,
  type BehaviourBlock, type GraduationBlock, type RiskCategory,
  type ScoreFactor, type FactorMetric,
} from "./behaviour-policy";

// ── Inputs ────────────────────────────────────────────────────────────────────

export type InstallmentFact = {
  seq: number;
  amountDue: number;
  amountPaid: number;
  dueDate: Date;
  paidAt: Date | null;
};

export type LoanFact = {
  id: string;
  principal: number;
  /** The limit the borrower held when this loan was taken, for utilisation. */
  limitAtBorrow?: number | null;
  status: "ACTIVE" | "CLEARED" | "OTHER";
  clearedAt?: Date | null;
  borrowDate: Date;
  installments: InstallmentFact[];
};

// ── Outputs ───────────────────────────────────────────────────────────────────

export type FactorScore = {
  key: string;
  label: string;
  weight: number;
  /** 0–100 before weighting. */
  raw: number;
  /** raw × weight ÷ 100 — what it actually contributed. */
  contribution: number;
  /** Which band most installments landed in, for the explanation. */
  commonBand: string;
};

export type LoanScore = {
  loanId: string;
  live: boolean;
  /** Weight after recency decay; 1 for the most recent. */
  recencyWeight: number;
  score: number;
  factors: FactorScore[];
  installmentsUsed: number;
};

export type BehaviourResult = {
  scored: boolean;
  /** 0–100. */
  score: number;
  category: RiskCategory | null;
  /** Probability of default implied by the category, when no model has spoken. */
  pd: number | null;
  factors: FactorScore[];
  loans: LoanScore[];
  installmentsUsed: number;
  /** True when a loan still being repaid contributed — i.e. this score can still move. */
  includesLiveLoan: boolean;
  /** Plain sentences an officer can read to the customer. */
  reasons: string[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;

/** Where one measurement lands on a factor's table. */
function bandFor(factor: ScoreFactor, value: number): { points: number; label: string } {
  const { compare } = metricSpec(factor.metric);
  for (const band of factor.bands) {
    if (band.threshold === null) return { points: band.points, label: band.label };
    const hit = compare === "gte" ? value >= band.threshold : value <= band.threshold;
    if (hit) return { points: band.points, label: band.label };
  }
  // Unreachable while validation insists on a catch-all, but a policy written by
  // hand and pushed straight to the database must not crash the scorer.
  return { points: 0, label: "Unscored" };
}

/** The measurement itself, per installment. */
function measure(metric: FactorMetric, i: InstallmentFact, loan: LoanFact, now: Date): number | null {
  switch (metric) {
    case "installment_paid_ratio":
      return i.amountDue <= 0 ? 1 : i.amountPaid / i.amountDue;
    case "days_late": {
      // An installment not yet paid is measured against TODAY, so an account in
      // arrears gets worse every day it stays there rather than freezing at its
      // last good score. One that is not yet DUE is not late — measuring it would
      // punish a borrower for the future.
      const asOf = i.paidAt ?? now;
      const days = Math.floor((asOf.getTime() - i.dueDate.getTime()) / 86_400_000);
      if (i.paidAt === null && days < 0) return null;
      return days;
    }
    case "days_early": {
      if (!i.paidAt) return null;
      return Math.floor((i.dueDate.getTime() - i.paidAt.getTime()) / 86_400_000);
    }
    case "arrears_streak":
      return null; // computed per loan, not per installment — see scoreLoan
    case "limit_utilisation": {
      const limit = loan.limitAtBorrow ?? 0;
      return limit > 0 ? loan.principal / limit : null;
    }
  }
}

/** The longest run of consecutive installments that came due and were not paid. */
function arrearsStreak(loan: LoanFact, now: Date): number {
  let longest = 0, run = 0;
  for (const i of [...loan.installments].sort((a, b) => a.seq - b.seq)) {
    if (i.dueDate.getTime() > now.getTime()) break; // not yet due
    const missed = i.amountPaid < i.amountDue;
    run = missed ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  return longest;
}

function scoreLoan(loan: LoanFact, policy: BehaviourBlock, now: Date): LoanScore | null {
  const due = loan.installments.filter((i) => i.dueDate.getTime() <= now.getTime() || i.paidAt !== null);
  if (due.length < policy.window.minInstallments) return null;

  const active = policy.factors.filter((f) => f.enabled);
  const factors: FactorScore[] = [];

  for (const f of active) {
    let raw: number;
    let commonBand: string;

    if (f.metric === "arrears_streak") {
      const b = bandFor(f, arrearsStreak(loan, now));
      raw = b.points;
      commonBand = b.label;
    } else {
      // Averaged ACROSS INSTALLMENTS within the loan, then loans are averaged
      // across each other — not all installments pooled — so a twelve-installment
      // loan does not drown out a three-installment one. (The procedure did the
      // same, via GROUP BY BorrowerId, LoanId.)
      const counts = new Map<string, number>();
      let sum = 0, n = 0;
      for (const i of due) {
        const v = measure(f.metric, i, loan, now);
        if (v === null) continue;
        const b = bandFor(f, v);
        sum += b.points; n += 1;
        counts.set(b.label, (counts.get(b.label) ?? 0) + 1);
      }
      if (n === 0) continue; // this factor has nothing to say about this loan
      raw = sum / n;
      commonBand = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
    }

    factors.push({ key: f.key, label: f.label, weight: f.weight, raw: round2(raw), contribution: round2((raw * f.weight) / 100), commonBand });
  }

  if (factors.length === 0) return null;

  // Weights are renormalised over the factors that actually spoke, so a metric that
  // had no data (nobody paid early) does not silently drag the score toward zero.
  const spoken = factors.reduce((s, f) => s + f.weight, 0);
  const score = spoken > 0 ? round2(factors.reduce((s, f) => s + f.raw * f.weight, 0) / spoken) : 0;

  return {
    loanId: loan.id,
    live: loan.status === "ACTIVE",
    recencyWeight: 1,
    score,
    factors,
    installmentsUsed: due.length,
  };
}

/**
 * Score a borrower from their recent loans.
 *
 * `loans` must arrive newest-first; the caller decides what "recent" means by how
 * many it loads, and the policy decides how many of those count.
 */
export function scoreBehaviour(loans: LoanFact[], policy: BehaviourBlock, now = new Date()): BehaviourResult {
  const empty: BehaviourResult = {
    scored: false, score: 0, category: null, pd: null, factors: [], loans: [],
    installmentsUsed: 0, includesLiveLoan: false,
    reasons: ["No repayment history yet — nothing to score."],
  };
  if (!policy.enabled) return { ...empty, reasons: ["Behavioural scoring is switched off for this lender."] };

  const eligible = loans
    .filter((l) => l.status === "CLEARED" || (policy.window.includeActive && l.status === "ACTIVE"))
    .slice(0, policy.window.lookbackLoans);

  const scored = eligible.map((l) => scoreLoan(l, policy, now)).filter((x): x is LoanScore => x !== null);
  if (scored.length === 0) return empty;

  // Recency: the newest loan carries full weight, each older one decays.
  const decay = policy.window.recencyDecay;
  scored.forEach((l, idx) => { l.recencyWeight = round2(Math.pow(1 - decay, idx)); });
  const totalWeight = scored.reduce((s, l) => s + l.recencyWeight, 0);

  const score = round2(scored.reduce((s, l) => s + l.score * l.recencyWeight, 0) / totalWeight);

  // Roll the per-loan factor breakdown up, so the explanation survives the average.
  const factors: FactorScore[] = [];
  for (const f of policy.factors.filter((x) => x.enabled)) {
    const parts = scored.map((l) => l.factors.find((x) => x.key === f.key)).filter((x): x is FactorScore => !!x);
    if (parts.length === 0) continue;
    const w = parts.reduce((s, _, i) => s + scored[i].recencyWeight, 0);
    const raw = round2(parts.reduce((s, p, i) => s + p.raw * scored[i].recencyWeight, 0) / w);
    const counts = new Map<string, number>();
    for (const p of parts) counts.set(p.commonBand, (counts.get(p.commonBand) ?? 0) + 1);
    factors.push({
      key: f.key, label: f.label, weight: f.weight, raw,
      contribution: round2((raw * f.weight) / 100),
      commonBand: [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—",
    });
  }

  const category = categoryFor(score, policy);
  const includesLiveLoan = scored.some((l) => l.live);

  const reasons: string[] = [
    `Scored ${score}/100 across ${scored.length} loan${scored.length === 1 ? "" : "s"} (${scored.reduce((s, l) => s + l.installmentsUsed, 0)} installments).`,
    ...factors.map((f) => `${f.label}: ${f.raw}/100 — mostly "${f.commonBand}" (${f.weight}% of the score).`),
  ];
  if (includesLiveLoan) {
    reasons.push("Includes the loan they are repaying now, so this score moves with every payment.");
  }

  return {
    scored: true,
    score,
    category,
    pd: category ? round4((category.pdMin + category.pdMax) / 2) : null,
    factors,
    loans: scored,
    installmentsUsed: scored.reduce((s, l) => s + l.installmentsUsed, 0),
    includesLiveLoan,
    reasons,
  };
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

export function categoryFor(score: number, policy: BehaviourBlock): RiskCategory | null {
  return policy.categories.find((c) => score >= c.minScore) ?? policy.categories[policy.categories.length - 1] ?? null;
}

// ── The ladder ────────────────────────────────────────────────────────────────

export type LadderMove = "graduate" | "demote" | "hold";

export type LadderAssessment = {
  move: LadderMove;
  /** In words the officer can read to the customer. */
  reason: string;
  behaviour: BehaviourResult;
  clearedLoans: number;
  /** The principal they have now cleared the required number of times. */
  provenPrincipal: number | null;
  currentLimit: number;
  graduationPercent: number;
  /** What the percentage was applied to — the fix for the original's cut bug. */
  basisAmount: number;
  newLimit: number | null;
  change: number | null;
  cappedByStep: boolean;
  cappedByCeiling: boolean;
};

/**
 * What this borrower's limit should be, given their record.
 *
 * The whole ladder — up, down, and the reason for standing still — in one pure
 * function, so a screen can preview it and a cron can apply it from the same answer.
 */
export function assessLadder(
  input: { loans: LoanFact[]; currentLimit: number },
  behaviour: BehaviourBlock,
  ladder: GraduationBlock,
  now = new Date(),
): LadderAssessment {
  const result = scoreBehaviour(input.loans, behaviour, now);
  const cleared = input.loans.filter((l) => l.status === "CLEARED");
  const currentLimit = input.currentLimit;

  const base = {
    behaviour: result,
    clearedLoans: cleared.length,
    provenPrincipal: null as number | null,
    currentLimit,
    graduationPercent: 0,
    basisAmount: currentLimit,
    newLimit: null as number | null,
    change: null as number | null,
    cappedByStep: false,
    cappedByCeiling: false,
  };
  const hold = (reason: string): LadderAssessment => ({ ...base, move: "hold", reason });

  if (!ladder.enabled) return hold("The graduation ladder is switched off for this lender.");

  const category = result.category;

  // ── Down before up. A deteriorating borrower is the urgent case, and the original
  // has no path for it at all: someone who graduated to 30,000 and then started
  // missing installments keeps 30,000 forever.
  if (ladder.demotion.enabled && result.scored && category) {
    const order = behaviour.categories.map((c) => c.key);
    const at = order.indexOf(category.key);
    const trigger = order.indexOf(ladder.demotion.belowCategory);
    if (at >= 0 && trigger >= 0 && at >= trigger && currentLimit > ladder.demotion.floor) {
      const cut = (currentLimit * ladder.demotion.percent) / 100;
      const newLimit = roundTo(Math.max(ladder.demotion.floor, currentLimit - cut), ladder.roundTo);
      if (newLimit < currentLimit) {
        return {
          ...base, move: "demote",
          reason: `Their record has fallen to ${result.score}/100 (${category.label}). The limit comes down ${ladder.demotion.percent}%, from ${kes(currentLimit)} to ${kes(newLimit)}.`,
          newLimit, change: Math.round(newLimit - currentLimit),
        };
      }
    }
  }

  if (!result.scored) return hold("They have no repayment record yet, so their limit stays where it is.");

  if (cleared.length < ladder.requireClearedLoans) {
    const need = ladder.requireClearedLoans - cleared.length;
    return hold(`They need ${need} more cleared loan${need === 1 ? "" : "s"} before their limit can move.`);
  }

  // THE SAME-PRINCIPAL RULE — the clever part of the original. Not "have they
  // borrowed twice" but "have they borrowed the SAME amount twice and cleared it
  // both times": they have proved the ceiling is no longer stretching them.
  let proven: number | null = null;
  if (ladder.requireSamePrincipalCycles > 0) {
    const recent = cleared.slice(0, ladder.requireSamePrincipalCycles).map((l) => l.principal);
    if (recent.length < ladder.requireSamePrincipalCycles) {
      return hold(`They need ${ladder.requireSamePrincipalCycles} cleared loans at the same amount before their limit can move.`);
    }
    if (recent.some((p) => p !== recent[0])) {
      return hold(
        `Their last ${recent.length} cleared loans were different amounts (${recent.map(kes).join(", ")}). ` +
        `A limit moves when someone clears the SAME amount repeatedly — that is what shows the ceiling is holding them back.`,
      );
    }
    proven = recent[0];
  } else {
    proven = cleared[0]?.principal ?? null;
  }

  const percent = category?.graduationPercent ?? 0;
  if (!category || percent <= 0) {
    return {
      ...hold(
        `Their record scores ${result.score}/100 (${category?.label ?? "unscored"}) — not enough to earn an increase. ` +
        result.factors.map((f) => `${f.label} ${f.raw}`).join(", ") + ".",
      ),
      provenPrincipal: proven,
    };
  }

  // WHAT THE PERCENTAGE IS APPLIED TO. `last_principal` reproduces the original —
  // including its ability to REDUCE a limit when someone borrows less than they are
  // allowed. `higher_of` is the default because a routine called "graduation" should
  // never be the thing that cuts someone.
  const basisAmount =
    ladder.basis === "last_principal" ? (proven ?? 0)
      : ladder.basis === "current_limit" ? currentLimit
        : Math.max(proven ?? 0, currentLimit);

  const uncapped = (basisAmount * percent) / 100;
  const capped = ladder.capPerStep > 0 ? Math.min(uncapped, ladder.capPerStep) : uncapped;
  let newLimit = roundTo(basisAmount + capped, ladder.roundTo);

  let cappedByCeiling = false;
  if (ladder.ceiling > 0 && newLimit > ladder.ceiling) {
    newLimit = ladder.ceiling;
    cappedByCeiling = true;
  }

  if (newLimit === currentLimit) return { ...hold("They have already earned this limit — nothing further to add."), provenPrincipal: proven, graduationPercent: percent, basisAmount };

  return {
    ...base,
    move: "graduate",
    reason:
      `Cleared ${kes(proven ?? 0)}${ladder.requireSamePrincipalCycles > 1 ? ` ${ladder.requireSamePrincipalCycles} times` : ""}, ` +
      `and their record scores ${result.score}/100 (${category.label}). That earns ${percent}% — ` +
      `${kes(currentLimit)} → ${kes(newLimit)}.`,
    provenPrincipal: proven,
    graduationPercent: percent,
    basisAmount,
    newLimit,
    change: Math.round(newLimit - currentLimit),
    cappedByStep: ladder.capPerStep > 0 && uncapped > ladder.capPerStep,
    cappedByCeiling,
  };
}

const roundTo = (n: number, step: number) => (step <= 1 ? Math.round(n) : Math.round(n / step) * step);
