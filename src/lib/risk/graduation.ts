// ─────────────────────────────────────────────────────────────────────────────
// BEHAVIOURAL SCORING AND GRADUATION — the database side.
//
// The ARITHMETIC lives in lib/scoring/behaviour.ts and the MATRIX lives in the
// lender's own `credit` policy (lib/scoring/behaviour-policy.ts). This file does
// only what those two cannot: load the facts, and write the consequences.
//
// It was previously a faithful but HARDCODED port of ServiceSuite's
// `sp_CreditScoringAndGraduation` — the 100/75/50 repayment cuts, the 0/3/6-day
// arrears cuts, the 50/50 weights, four fixed bands and a KES 5,000 constant all
// lived in this file. Every one of them is now a lender's choice.
//
// TWO BEHAVIOURS WORTH KNOWING ABOUT:
//
//   THE SCORE IS WRITTEN FOR EVERYONE; THE LIMIT MOVES FOR FEW. A lender wants the
//   behavioural score of every customer who has ever repaid them, especially the
//   ones sliding from Strong to Watch. Only the ones who have earned it get money.
//
//   IT CAN NOW RUN ON EVERY REPAYMENT. `onRepayment()` rescores one borrower the
//   moment their money lands, so a PD moves several times across a single loan
//   cycle instead of once, months later, when the loan finally closes.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { runWithOrg } from "@/lib/db/context";
import { readCreditPolicy } from "@/lib/config/store";
import { scoreBehaviour, assessLadder, type LoanFact, type LadderAssessment } from "@/lib/scoring/behaviour";
import type { BehaviourBlock, GraduationBlock } from "@/lib/scoring/behaviour-policy";
import type { CreditPolicy } from "@/lib/decision/policy";

export type { LadderAssessment } from "@/lib/scoring/behaviour";

/** The loans a scoring window needs, newest first. */
export async function loanFacts(orgId: string, borrowerId: string, policy: BehaviourBlock): Promise<LoanFact[]> {
  const statuses = policy.window.includeActive
    ? (["CLEARED", "ACTIVE"] as const)
    : (["CLEARED"] as const);

  // Load a little more than the window needs: the same-principal rule may look at
  // cleared loans that a window including live ones would otherwise crowd out.
  const rows = await runWithOrg(orgId, () =>
    prisma.loan.findMany({
      where: { orgId, borrowerId, status: { in: [...statuses] } },
      orderBy: [{ clearedAt: "desc" }, { borrowDate: "desc" }],
      take: Math.max(policy.window.lookbackLoans, 4) + 2,
      select: {
        id: true, principal: true, status: true, clearedAt: true, borrowDate: true,
        installments: {
          select: { seq: true, amountDue: true, amountPaid: true, dueDate: true, paidAt: true },
          orderBy: { seq: "asc" },
        },
      },
    }),
  );

  return rows.map((l) => ({
    id: l.id,
    principal: Number(l.principal),
    status: l.status === "CLEARED" ? "CLEARED" : l.status === "ACTIVE" ? "ACTIVE" : "OTHER",
    clearedAt: l.clearedAt,
    borrowDate: l.borrowDate,
    installments: l.installments.map((i) => ({
      seq: i.seq,
      amountDue: Number(i.amountDue),
      amountPaid: Number(i.amountPaid),
      dueDate: i.dueDate,
      paidAt: i.paidAt,
    })),
  }));
}

/** What this borrower's limit should be, under the lender's own rules. */
export async function assessBorrower(
  orgId: string,
  borrowerId: string,
  policy: CreditPolicy,
  now = new Date(),
): Promise<LadderAssessment> {
  const [borrower, loans] = await Promise.all([
    runWithOrg(orgId, () => prisma.borrower.findFirst({ where: { id: borrowerId, orgId }, select: { loanLimit: true } })),
    loanFacts(orgId, borrowerId, policy.behaviour),
  ]);
  const currentLimit = borrower?.loanLimit != null ? Number(borrower.loanLimit) : 0;
  return assessLadder({ loans, currentLimit }, policy.behaviour, policy.graduation, now);
}

/**
 * Persist a borrower's score, and move their limit if the ladder says so.
 *
 * Idempotent: a borrower already at the limit the ladder computes is not moved
 * again, so a cron that fires twice — or a repayment hook that races the cron —
 * cannot double anyone.
 */
export async function applyAssessment(
  orgId: string,
  borrowerId: string,
  a: LadderAssessment,
  opts: { actor?: string; policyVersion?: number; now?: Date } = {},
): Promise<"graduated" | "demoted" | "scored" | "skipped"> {
  const now = opts.now ?? new Date();
  const b = a.behaviour;

  if (b.scored) {
    await runWithOrg(orgId, () =>
      prisma.borrower.update({
        where: { id: borrowerId },
        data: { behaviouralScore: b.score, riskBand: b.category?.key ?? null, lastScoredAt: now },
      }),
    ).catch(() => {});
  }

  if ((a.move !== "graduate" && a.move !== "demote") || a.newLimit == null) {
    return b.scored ? "scored" : "skipped";
  }
  if (a.newLimit === a.currentLimit) return "scored";

  // The platform's default factors, kept in their own columns so existing screens
  // and reports keep working; the full breakdown goes to `factors`.
  const factorRaw = (key: string) => b.factors.find((f) => f.key === key)?.raw ?? 0;

  await runWithOrg(orgId, () =>
    prisma.$transaction(async (tx) => {
      await tx.borrower.update({
        where: { id: borrowerId },
        data: {
          previousLoanLimit: a.currentLimit || null,
          loanLimit: a.newLimit!,
          // A demotion is not a graduation: the count is a record of promotions.
          ...(a.move === "graduate" ? { graduationCount: { increment: 1 }, lastGraduationAt: now } : {}),
        },
      });
      await tx.graduationEvent.create({
        data: {
          orgId, borrowerId,
          move: a.move,
          previousLimit: a.currentLimit,
          newLimit: a.newLimit!,
          increase: a.change ?? 0,
          riskScore: b.score,
          riskBand: b.category?.key ?? "UNSCORED",
          repaymentHistoryScore: factorRaw("repayment_history"),
          daysInArrearsScore: factorRaw("days_in_arrears"),
          factors: b.factors as never,
          graduationPercent: a.graduationPercent,
          clearedLoans: a.clearedLoans,
          provenPrincipal: a.provenPrincipal ?? 0,
          cappedByCeiling: a.cappedByStep || a.cappedByCeiling,
          policyVersion: opts.policyVersion ?? 0,
          decidedBy: opts.actor ?? "engine",
        },
      });
    }),
  );

  return a.move === "graduate" ? "graduated" : "demoted";
}

/**
 * THE AUTOMATIC PATH — rescore one borrower the moment a repayment lands.
 *
 * This is what makes a limit move "after repayment has happened" rather than at
 * whatever hour a nightly batch happens to run, and what lets a PD change several
 * times across one loan cycle. Call it from the payment allocator.
 *
 * Deliberately quiet: a scoring failure must never fail the payment that triggered
 * it. Money landing on a loan is the important event; the score is a consequence.
 */
export async function onRepayment(orgId: string, borrowerId: string, now = new Date()): Promise<void> {
  try {
    const doc = await readCreditPolicy(orgId);
    const policy = doc.value;
    if (!policy.behaviour.enabled) return;
    // `on_clearance` and `scheduled` lenders are not rescored here — respecting the
    // trigger is what keeps a lender's chosen cadence theirs.
    if (policy.graduation.trigger !== "on_repayment") {
      const a = await assessBorrower(orgId, borrowerId, policy, now);
      // Still write the SCORE — only the limit move waits for their trigger.
      if (a.behaviour.scored) {
        await runWithOrg(orgId, () =>
          prisma.borrower.update({
            where: { id: borrowerId },
            data: { behaviouralScore: a.behaviour.score, riskBand: a.behaviour.category?.key ?? null, lastScoredAt: now },
          }),
        ).catch(() => {});
      }
      return;
    }
    const a = await assessBorrower(orgId, borrowerId, policy, now);
    await applyAssessment(orgId, borrowerId, a, { actor: "repayment", policyVersion: doc.version, now });
  } catch {
    /* scoring must never break a payment */
  }
}

/** Called when a loan closes — for lenders whose trigger is `on_clearance`. */
export async function onLoanCleared(orgId: string, borrowerId: string, now = new Date()): Promise<void> {
  try {
    const doc = await readCreditPolicy(orgId);
    if (doc.value.graduation.trigger === "scheduled") return;
    const a = await assessBorrower(orgId, borrowerId, doc.value, now);
    await applyAssessment(orgId, borrowerId, a, { actor: "clearance", policyVersion: doc.version, now });
  } catch {
    /* never break loan closure */
  }
}

export type GraduationRun = {
  scored: number;
  graduated: number;
  demoted: number;
  skipped: number;
  events: { borrowerId: string; move: string; from: number; to: number; band: string; score: number }[];
};

/**
 * Score every borrower with repayment history, and move the ones who have earned it.
 *
 * The batch path — still useful for a lender on a `scheduled` trigger, for a first
 * run after a policy change, and as a backstop if a repayment hook was ever missed.
 */
export async function runGraduations(orgId: string, actor = "cron", now = new Date()): Promise<GraduationRun> {
  const out: GraduationRun = { scored: 0, graduated: 0, demoted: 0, skipped: 0, events: [] };
  const doc = await readCreditPolicy(orgId);
  const policy = doc.value;
  if (!policy.behaviour.enabled) return out;

  const statuses = policy.behaviour.window.includeActive ? ["CLEARED", "ACTIVE"] : ["CLEARED"];
  const borrowerIds = (
    await runWithOrg(orgId, () =>
      prisma.loan.findMany({
        where: { orgId, status: { in: statuses as never } },
        select: { borrowerId: true },
        distinct: ["borrowerId"],
      }),
    )
  ).map((l) => l.borrowerId);

  for (const borrowerId of borrowerIds) {
    const a = await assessBorrower(orgId, borrowerId, policy, now);
    const result = await applyAssessment(orgId, borrowerId, a, { actor, policyVersion: doc.version, now });

    if (a.behaviour.scored) out.scored++;
    if (result === "graduated" || result === "demoted") {
      if (result === "graduated") out.graduated++; else out.demoted++;
      out.events.push({
        borrowerId, move: a.move, from: a.currentLimit, to: a.newLimit!,
        band: a.behaviour.category?.key ?? "UNSCORED", score: a.behaviour.score,
      });
    } else {
      out.skipped++;
    }
  }

  return out;
}

/** The ladder, for a screen that wants to show a customer where they stand. */
export function ladderFor(policy: CreditPolicy) {
  return policy.behaviour.categories.map((c) => ({
    key: c.key, label: c.label, percent: c.graduationPercent, minScore: c.minScore,
  }));
}

/** A "what if" preview that writes nothing — for the Customer-360. */
export async function previewLadder(orgId: string, borrowerId: string, now = new Date()) {
  const doc = await readCreditPolicy(orgId);
  return { policyVersion: doc.version, assessment: await assessBorrower(orgId, borrowerId, doc.value, now) };
}

/** Re-exported so callers that only want a score do not reach past this module. */
export { scoreBehaviour };
export type { BehaviourBlock, GraduationBlock };
