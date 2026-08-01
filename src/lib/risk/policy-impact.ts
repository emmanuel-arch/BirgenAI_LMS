// ─────────────────────────────────────────────────────────────────────────────
// WHAT WOULD THIS POLICY DO? — the credit matrix, run against the real book
// before it is published.
//
// A credit policy is the most expensive document a lender owns and the least
// legible: "one day late costs 70 points" is a number in a table whose
// consequence is a customer whose limit stops moving. Nobody can read that off
// the form. So the form does not ask them to — it runs the edited matrix over
// the actual book and reports the difference.
//
// TWO PASSES, ONE LOAD. Every borrower is assessed TWICE from the same facts:
// once under the policy that is live today, once under the one being edited.
// The answer is not "340 customers would graduate" (which was probably already
// true) but "340 customers END UP SOMEWHERE ELSE than they do now" — the delta
// is the only number that means anything when you are about to press Publish.
//
// WRITES NOTHING. `assessLadder` is pure, so a preview is exactly the arithmetic
// the cron would do, minus the UPDATE. That is what makes it trustworthy: this
// is not a model of the engine, it IS the engine.
//
// SAMPLED, AND SAYS SO. A lender with 40,000 borrowers does not get 40,000 loan
// histories loaded into a settings screen. The newest N are assessed and the
// panel is explicit that it is a sample — an honest 250 beats a dishonest total.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { runWithOrg } from "@/lib/db/context";
import { assessLadder, type LoanFact, type LadderAssessment, type LadderMove } from "@/lib/scoring/behaviour";
import type { CreditPolicy } from "@/lib/decision/policy";

/** Enough to be representative, few enough to answer while someone is dragging. */
export const DEFAULT_SAMPLE = 250;
export const MAX_SAMPLE = 1_000;

/** Loans that can carry a repayment record. A written-off loan is a different question. */
const SCOREABLE = ["CLEARED", "ACTIVE"] as const;

export type Outcome = {
  move: LadderMove;
  /** null when the borrower could not be scored under this policy at all. */
  score: number | null;
  categoryKey: string | null;
  categoryLabel: string | null;
  /** What the borrower's limit IS once this policy has had its say. */
  limit: number;
  reason: string;
};

export type Mover = {
  borrowerId: string;
  /** Null when the caller may not see borrower data — the counts still hold. */
  name: string | null;
  phone: string | null;
  currentLimit: number;
  before: Outcome;
  after: Outcome;
  limitDelta: number;
  scoreDelta: number;
};

export type BandShift = { key: string; label: string; before: number; after: number };

export type PolicyImpact = {
  /** Borrowers on the book with any scoreable loan at all. */
  book: number;
  sampled: number;
  /** True when the book is bigger than the sample — the panel must say so. */
  truncated: boolean;
  scored: number;
  /** Borrowers who end up somewhere else than they do today. THE number. */
  changed: number;
  moves: Record<LadderMove, number>;
  baselineMoves: Record<LadderMove, number>;
  bands: BandShift[];
  /** Sum of every limit change across the sample, in KES. */
  limitDelta: number;
  exposureBefore: number;
  exposureAfter: number;
  /** The biggest movers, worst-to-best by absolute limit change. */
  movers: Mover[];
};

const outcomeOf = (a: LadderAssessment): Outcome => ({
  move: a.move,
  score: a.behaviour.scored ? a.behaviour.score : null,
  categoryKey: a.behaviour.category?.key ?? null,
  categoryLabel: a.behaviour.category?.label ?? null,
  limit: a.newLimit ?? a.currentLimit,
  reason: a.reason,
});

type LoanRow = {
  id: string;
  borrowerId: string;
  principal: unknown;
  status: string;
  clearedAt: Date | null;
  borrowDate: Date;
  installments: { seq: number; amountDue: unknown; amountPaid: unknown; dueDate: Date; paidAt: Date | null }[];
};

const toFact = (l: LoanRow): LoanFact => ({
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
});

/** How many loans to keep per borrower so BOTH policies' windows are satisfied. */
const windowDepth = (a: CreditPolicy, b: CreditPolicy) =>
  Math.max(a.behaviour.window.lookbackLoans, b.behaviour.window.lookbackLoans, 4) + 2;

/**
 * Assess the book under both policies and report the difference.
 *
 * `saved` is what is live now; `edited` is what the screen is holding. Pass the
 * same document twice to get a pure "where does the book stand today" reading.
 */
export async function creditPolicyImpact(
  orgId: string,
  saved: CreditPolicy,
  edited: CreditPolicy,
  opts: { sample?: number; includeNames?: boolean; now?: Date } = {},
): Promise<PolicyImpact> {
  const now = opts.now ?? new Date();
  const sample = Math.min(Math.max(Math.trunc(opts.sample ?? DEFAULT_SAMPLE), 1), MAX_SAMPLE);
  const where = { orgId, loans: { some: { status: { in: [...SCOREABLE] } } } };

  const { book, borrowers } = await runWithOrg(orgId, async () => ({
    book: await prisma.borrower.count({ where }),
    borrowers: await prisma.borrower.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: sample,
      select: { id: true, firstName: true, otherName: true, phone: true, loanLimit: true },
    }),
  }));

  const ids = borrowers.map((b) => b.id);
  const loans: LoanRow[] = ids.length
    ? await runWithOrg(orgId, () =>
        prisma.loan.findMany({
          where: { orgId, borrowerId: { in: ids }, status: { in: [...SCOREABLE] } },
          // Newest first — `scoreBehaviour` takes the head of this list as "recent".
          orderBy: [{ clearedAt: "desc" }, { borrowDate: "desc" }],
          select: {
            id: true, borrowerId: true, principal: true, status: true, clearedAt: true, borrowDate: true,
            installments: {
              select: { seq: true, amountDue: true, amountPaid: true, dueDate: true, paidAt: true },
              orderBy: { seq: "asc" },
            },
          },
        }),
      )
    : [];

  const depth = windowDepth(saved, edited);
  const byBorrower = new Map<string, LoanFact[]>();
  for (const l of loans) {
    const list = byBorrower.get(l.borrowerId) ?? [];
    if (list.length >= depth) continue;
    list.push(toFact(l));
    byBorrower.set(l.borrowerId, list);
  }

  const zero = (): Record<LadderMove, number> => ({ graduate: 0, demote: 0, hold: 0 });
  const out: PolicyImpact = {
    book, sampled: borrowers.length, truncated: book > borrowers.length,
    scored: 0, changed: 0,
    moves: zero(), baselineMoves: zero(),
    bands: [], limitDelta: 0, exposureBefore: 0, exposureAfter: 0, movers: [],
  };

  // The vocabulary may itself be under edit, so the shift table is the UNION of
  // both policies' categories — a band being retired must still show its before.
  const bandCount = new Map<string, { label: string; before: number; after: number }>();
  const bandOrder: string[] = [];
  for (const c of [...edited.behaviour.categories, ...saved.behaviour.categories]) {
    if (!bandCount.has(c.key)) { bandCount.set(c.key, { label: c.label, before: 0, after: 0 }); bandOrder.push(c.key); }
  }
  bandCount.set("UNSCORED", { label: "Not yet scoreable", before: 0, after: 0 });
  bandOrder.push("UNSCORED");

  const movers: Mover[] = [];

  for (const b of borrowers) {
    const facts = byBorrower.get(b.id) ?? [];
    const currentLimit = b.loanLimit != null ? Number(b.loanLimit) : 0;
    const input = { loans: facts, currentLimit };

    const before = outcomeOf(assessLadder(input, saved.behaviour, saved.graduation, now));
    const after = outcomeOf(assessLadder(input, edited.behaviour, edited.graduation, now));

    if (after.score !== null) out.scored++;
    out.moves[after.move]++;
    out.baselineMoves[before.move]++;
    out.exposureBefore += before.limit;
    out.exposureAfter += after.limit;
    out.limitDelta += after.limit - before.limit;

    bandCount.get(before.categoryKey ?? "UNSCORED")!.before++;
    bandCount.get(after.categoryKey ?? "UNSCORED")!.after++;

    // "Changed" means the borrower LANDS somewhere else — a different limit, or a
    // different band on their record. A different-sounding reason is not a change.
    const changed = before.limit !== after.limit || before.categoryKey !== after.categoryKey;
    if (!changed) continue;
    out.changed++;

    movers.push({
      borrowerId: b.id,
      name: opts.includeNames ? (`${b.firstName ?? ""} ${b.otherName ?? ""}`.trim() || null) : null,
      phone: opts.includeNames ? b.phone : null,
      currentLimit,
      before, after,
      limitDelta: after.limit - before.limit,
      scoreDelta: after.score !== null && before.score !== null ? Math.round((after.score - before.score) * 100) / 100 : 0,
    });
  }

  // Worst first. A lender reviewing a policy change wants the cuts at the top —
  // the increases are the ones they were already expecting.
  movers.sort((x, y) => (x.limitDelta - y.limitDelta) || Math.abs(y.scoreDelta) - Math.abs(x.scoreDelta));
  out.movers = movers.slice(0, 24);

  out.bands = bandOrder
    .map((key) => ({ key, ...bandCount.get(key)! }))
    .filter((r) => r.before > 0 || r.after > 0);

  return out;
}

export type BorrowerPreview = {
  borrowerId: string;
  name: string | null;
  phone: string | null;
  currentLimit: number;
  loansUsed: number;
  before: LadderAssessment;
  after: LadderAssessment;
};

/**
 * One borrower, in full — the "and here's one of them" behind the headline.
 *
 * The whole assessment on both sides, factor breakdown and reasons included, so
 * the officer's sentence ("their record scores 62/100…") is the same sentence the
 * screen shows before anyone publishes anything.
 */
export async function previewBorrower(
  orgId: string,
  borrowerId: string,
  saved: CreditPolicy,
  edited: CreditPolicy,
  opts: { includeNames?: boolean; now?: Date } = {},
): Promise<BorrowerPreview | null> {
  const now = opts.now ?? new Date();

  const borrower = await runWithOrg(orgId, () =>
    prisma.borrower.findFirst({
      where: { id: borrowerId, orgId },
      select: { id: true, firstName: true, otherName: true, phone: true, loanLimit: true },
    }),
  );
  if (!borrower) return null;

  const rows: LoanRow[] = await runWithOrg(orgId, () =>
    prisma.loan.findMany({
      where: { orgId, borrowerId, status: { in: [...SCOREABLE] } },
      orderBy: [{ clearedAt: "desc" }, { borrowDate: "desc" }],
      take: windowDepth(saved, edited),
      select: {
        id: true, borrowerId: true, principal: true, status: true, clearedAt: true, borrowDate: true,
        installments: {
          select: { seq: true, amountDue: true, amountPaid: true, dueDate: true, paidAt: true },
          orderBy: { seq: "asc" },
        },
      },
    }),
  );

  const facts = rows.map(toFact);
  const currentLimit = borrower.loanLimit != null ? Number(borrower.loanLimit) : 0;
  const input = { loans: facts, currentLimit };

  return {
    borrowerId: borrower.id,
    name: opts.includeNames ? (`${borrower.firstName ?? ""} ${borrower.otherName ?? ""}`.trim() || null) : null,
    phone: opts.includeNames ? borrower.phone : null,
    currentLimit,
    loansUsed: facts.length,
    before: assessLadder(input, saved.behaviour, saved.graduation, now),
    after: assessLadder(input, edited.behaviour, edited.graduation, now),
  };
}
