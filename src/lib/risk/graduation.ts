// ─────────────────────────────────────────────────────────────────────────────
// BEHAVIOURAL SCORING AND GRADUATION.
//
// A port of ServiceSuite's `sp_CreditScoringAndGraduation`, with its arithmetic kept
// exactly and its plumbing thrown away.
//
// WHAT IS KEPT, BECAUSE IT IS RIGHT:
//
//   THE SCORE IS TWO NUMBERS, HALF AND HALF.
//     Repayment history (50%) — did they pay the whole installment?
//     Days in arrears   (50%) — did they pay it on the day?
//   Two customers can both repay in full and be completely different risks; one paid
//   on the due date and one paid three weeks late every single time. A model that
//   only looks at whether the money arrived cannot tell them apart, and will keep
//   lending to the second one.
//
//   IT SCORES THE LAST TWO CLEARED LOANS, and nothing else. Not the live one (it has
//   not finished, so it has nothing to say), and not the one from four years ago
//   (they were a different person). A closed loan is a completed experiment.
//
//   GRADUATION NEEDS TWO CLEARED LOANS AT THE SAME PRINCIPAL. This is the clever part
//   of the original and it is easy to miss: it is not "have they borrowed twice", it
//   is "have they borrowed the SAME amount twice and cleared it both times" — i.e.
//   they have proved the ceiling is no longer stretching them. That is exactly when a
//   ladder should move, and never before.
//
//   THE INCREASE IS CAPPED AT KES 5,000. A 30% graduation on a 100,000 loan is 30,000
//   of new exposure on the strength of two repayments. The cap is what keeps the
//   ladder a ladder rather than a cliff.
//
// WHAT IS CHANGED:
//
//   FOUR BANDS, NOT THREE (src/lib/risk/bands.ts). The old top band ran from 77 to 100
//   and paid everyone in it the same 30%, so a flawless customer and a merely good one
//   graduated identically. Now: Prime 30% · Strong 20% · Watch 10% · High 0%.
//
//   IT IS AUDITED AND IT IS REVERSIBLE. Every graduation writes a GraduationEvent with
//   the score, the band, the two loans it was based on and the before/after limit — so
//   a customer who asks "why did my limit go up" gets an answer, and a lender who
//   thinks the engine is wrong can see precisely what it thought.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { RISK_BANDS, bandForBehavioural, type RiskBand } from "./bands";

/** The most a single graduation may add, whatever the percentage works out at. */
export const MAX_INCREASE_KES = 5000;
/** Two cleared loans at the same principal. Fewer is not a track record. */
export const MIN_CLEARED_LOANS = 2;

export type BehaviouralScore = {
  /** 0–100. The half-and-half blend. */
  score: number;
  repaymentHistory: number;
  daysInArrears: number;
  installmentsUsed: number;
  band: RiskBand | null;
};

/**
 * Score one installment's repayment. Straight from the stored procedure:
 * paid the lot → 100 · three quarters → 75 · half → 50 · less → nothing.
 */
export function repaymentPoints(amountDue: number, amountPaid: number): number {
  if (amountDue <= 0) return 100;
  if (amountPaid >= amountDue) return 100;
  if (amountPaid >= 0.75 * amountDue) return 75;
  if (amountPaid >= 0.5 * amountDue) return 50;
  return 0;
}

/**
 * Score one installment's timeliness. Also straight from the procedure, and note how
 * BRUTAL it is: one day late costs you 70 points. That is deliberate — in a 30-day
 * microloan, "a few days late" is most of the way to not paying at all, and a scoring
 * curve that shrugs at it will happily lend again to someone who is already sliding.
 *
 * An installment that has not been paid AT ALL is scored against TODAY, so an account
 * in arrears gets worse every day it stays there rather than sitting frozen at its
 * last good score.
 */
export function arrearsPoints(dueDate: Date, paidAt: Date | null, now = new Date()): number {
  const asOf = paidAt ?? now;
  const daysLate = Math.floor((asOf.getTime() - dueDate.getTime()) / 86_400_000);
  if (daysLate <= 0) return 100;
  if (daysLate <= 3) return 30;
  if (daysLate <= 6) return 10;
  return 0;
}

/**
 * The behavioural score for a borrower, from their last two CLEARED loans.
 *
 * Averaged per loan and then across loans — not across all installments pooled — so a
 * twelve-installment loan does not drown out a three-installment one. (The procedure
 * did the same, via its GROUP BY BorrowerId, LoanId.)
 */
export async function behaviouralScore(orgId: string, borrowerId: string, now = new Date()): Promise<BehaviouralScore> {
  const cleared = await prisma.loan.findMany({
    where: { orgId, borrowerId, status: "CLEARED" },
    orderBy: [{ clearedAt: "desc" }, { borrowDate: "desc" }],
    take: MIN_CLEARED_LOANS,
    select: {
      id: true,
      installments: { select: { amountDue: true, amountPaid: true, dueDate: true, paidAt: true } },
    },
  });

  const perLoan: { rh: number; da: number; n: number }[] = [];
  for (const loan of cleared) {
    if (loan.installments.length === 0) continue;
    let rh = 0, da = 0;
    for (const i of loan.installments) {
      rh += repaymentPoints(Number(i.amountDue), Number(i.amountPaid));
      da += arrearsPoints(i.dueDate, i.paidAt, now);
    }
    perLoan.push({ rh: rh / loan.installments.length, da: da / loan.installments.length, n: loan.installments.length });
  }

  if (perLoan.length === 0) {
    return { score: 0, repaymentHistory: 0, daysInArrears: 0, installmentsUsed: 0, band: null };
  }

  const repaymentHistory = round2(perLoan.reduce((s, l) => s + l.rh, 0) / perLoan.length);
  const daysInArrears = round2(perLoan.reduce((s, l) => s + l.da, 0) / perLoan.length);
  const score = round2(0.5 * repaymentHistory + 0.5 * daysInArrears);

  return {
    score,
    repaymentHistory,
    daysInArrears,
    installmentsUsed: perLoan.reduce((s, l) => s + l.n, 0),
    band: bandForBehavioural(score),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Graduation ───────────────────────────────────────────────────────────────

export type GraduationAssessment = {
  eligible: boolean;
  /** Why not — in words the officer can read to the customer. */
  reason: string;
  behavioural: BehaviouralScore;
  clearedLoans: number;
  /** The principal they have now cleared twice. */
  provenPrincipal: number | null;
  currentLimit: number;
  graduationPercent: number;
  newLimit: number | null;
  increase: number | null;
  /** True when the cap, not the percentage, decided the increase. */
  cappedByCeiling: boolean;
};

export async function assessGraduation(orgId: string, borrowerId: string, now = new Date()): Promise<GraduationAssessment> {
  const [borrower, cleared, behavioural] = await Promise.all([
    prisma.borrower.findFirst({ where: { id: borrowerId, orgId }, select: { loanLimit: true } }),
    prisma.loan.findMany({
      where: { orgId, borrowerId, status: "CLEARED" },
      orderBy: [{ clearedAt: "desc" }, { borrowDate: "desc" }],
      take: MIN_CLEARED_LOANS,
      select: { id: true, principal: true },
    }),
    behaviouralScore(orgId, borrowerId, now),
  ]);

  const currentLimit = borrower?.loanLimit != null ? Number(borrower.loanLimit) : 0;
  const nope = (reason: string): GraduationAssessment => ({
    eligible: false, reason, behavioural, clearedLoans: cleared.length,
    provenPrincipal: null, currentLimit, graduationPercent: 0, newLimit: null, increase: null,
    cappedByCeiling: false,
  });

  if (cleared.length < MIN_CLEARED_LOANS) {
    const need = MIN_CLEARED_LOANS - cleared.length;
    return nope(`They need ${need} more cleared loan${need === 1 ? "" : "s"} before their limit can move.`);
  }

  // THE SAME-PRINCIPAL RULE. They must have cleared the SAME amount twice — that is
  // what proves the ceiling is no longer a stretch. Two different amounts is not a
  // plateau, it is a customer still finding their level.
  const principals = cleared.map((l) => Number(l.principal));
  const proven = principals[0];
  if (principals.some((p) => p !== proven)) {
    return nope(
      `Their last two cleared loans were different amounts (KES ${principals.map((p) => Math.round(p).toLocaleString()).join(" and KES ")}). ` +
      `A limit moves when someone clears the SAME amount twice — that is what shows the ceiling is holding them back.`,
    );
  }

  const band = behavioural.band;
  const percent = band?.graduationPercent ?? 0;

  if (!band || percent <= 0) {
    return {
      ...nope(
        `Their repayment record scores ${behavioural.score}/100 (${band?.label ?? "unscored"}) — too low to earn an increase. ` +
        `Repayment history ${behavioural.repaymentHistory}, timeliness ${behavioural.daysInArrears}.`,
      ),
      graduationPercent: 0,
    };
  }

  const uncapped = (proven * percent) / 100;
  const increase = Math.min(uncapped, MAX_INCREASE_KES);
  const newLimit = Math.round(proven + increase);

  return {
    eligible: true,
    reason:
      `Cleared KES ${Math.round(proven).toLocaleString()} twice, and their repayment record scores ` +
      `${behavioural.score}/100 (${band.label}). That earns ${percent}%.`,
    behavioural,
    clearedLoans: cleared.length,
    provenPrincipal: proven,
    currentLimit,
    graduationPercent: percent,
    newLimit,
    increase: Math.round(increase),
    cappedByCeiling: uncapped > MAX_INCREASE_KES,
  };
}

export type GraduationRun = {
  scored: number;
  graduated: number;
  skipped: number;
  events: { borrowerId: string; from: number; to: number; band: string; score: number }[];
};

/**
 * Score every borrower with a closed loan, and graduate the ones who have earned it.
 *
 * ⚠ THE SCORE IS WRITTEN FOR EVERYONE; THE LIMIT MOVES FOR FEW. That asymmetry is the
 * point: a lender wants to see the behavioural score of every customer who has ever
 * repaid them, including the bad ones, and especially the ones sliding from Strong to
 * Watch. Only the ones who cleared the same amount twice with a clean record get more
 * money.
 *
 * Idempotent within a day: a borrower whose limit already equals what they would
 * graduate to is not graduated again, so a cron that fires twice does not double them.
 */
export async function runGraduations(orgId: string, actor = "cron", now = new Date()): Promise<GraduationRun> {
  const out: GraduationRun = { scored: 0, graduated: 0, skipped: 0, events: [] };

  // Only people with a CLOSED loan have anything to be scored on.
  const borrowerIds = (
    await prisma.loan.findMany({
      where: { orgId, status: "CLEARED" },
      select: { borrowerId: true },
      distinct: ["borrowerId"],
    })
  ).map((l) => l.borrowerId);

  for (const borrowerId of borrowerIds) {
    const a = await assessGraduation(orgId, borrowerId, now);

    // The score itself lands on the customer whether or not they graduate.
    if (a.behavioural.installmentsUsed > 0) {
      await prisma.borrower.update({
        where: { id: borrowerId },
        data: {
          behaviouralScore: a.behavioural.score,
          riskBand: a.behavioural.band?.key ?? null,
          lastScoredAt: now,
        },
      }).catch(() => {});
      out.scored++;
    }

    if (!a.eligible || a.newLimit == null) { out.skipped++; continue; }
    // Already there — a second cron run in the same window must not stack.
    if (a.currentLimit >= a.newLimit) { out.skipped++; continue; }

    await prisma.$transaction(async (tx) => {
      await tx.borrower.update({
        where: { id: borrowerId },
        data: {
          previousLoanLimit: a.currentLimit || null,
          loanLimit: a.newLimit!,
          graduationCount: { increment: 1 },
          lastGraduationAt: now,
        },
      });
      await tx.graduationEvent.create({
        data: {
          orgId, borrowerId,
          previousLimit: a.currentLimit,
          newLimit: a.newLimit!,
          increase: a.increase ?? 0,
          riskScore: a.behavioural.score,
          riskBand: a.behavioural.band?.key ?? "HIGH",
          graduationPercent: a.graduationPercent,
          repaymentHistoryScore: a.behavioural.repaymentHistory,
          daysInArrearsScore: a.behavioural.daysInArrears,
          clearedLoans: a.clearedLoans,
          provenPrincipal: a.provenPrincipal ?? 0,
          cappedByCeiling: a.cappedByCeiling,
          decidedBy: actor,
        },
      });
    });

    out.graduated++;
    out.events.push({
      borrowerId,
      from: a.currentLimit,
      to: a.newLimit,
      band: a.behavioural.band?.key ?? "HIGH",
      score: a.behavioural.score,
    });
  }

  return out;
}

/** The ladder, for a screen that wants to show a customer where they stand. */
export const LADDER = RISK_BANDS.map((b) => ({
  key: b.key, label: b.label, percent: b.graduationPercent, minBehavioural: b.minBehavioural,
}));
