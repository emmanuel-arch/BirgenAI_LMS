// ─────────────────────────────────────────────────────────────────────────────
// THE ARREARS QUEUE, FOR A LENDER WHOSE BOOK IS NOT OURS.
//
// `collectionsQueue` builds this from our Postgres — loans with OVERDUE
// instalments. For a BRIDGED lender that returns nothing at all, because none of
// their loans are in our tables: Micromart has 47 customers behind on their
// payments and the collections screen has been showing an empty queue the whole
// time. An empty queue does not read as "we cannot see this book". It reads as
// "nobody is late", which is the most expensive possible way to be wrong on this
// particular screen.
//
// ── DPD AND THE AMOUNT COME FROM THEIR REGISTER ─────────────────────────────
// Transactions.dbo.LoansInArrears is what their own dashboard reads, and it is
// what a collections officer will have in front of them if they open
// ServiceSuite. Deriving our own figure from the schedule produced a different
// answer (33 loans vs 47), and two systems disagreeing about who is late is how
// a customer gets chased for money they do not owe.
//
// ── THE HUMAN LAYER IS STILL OURS ───────────────────────────────────────────
// Promises, calls and tickets live in our Postgres and are keyed on OUR loan
// ids, which a live loan does not have. They are attached by BORROWER instead,
// matched on the last nine digits of the phone, for customers who have already
// been resolved into a local record — which is what the resolve step exists to
// create.
//
// A row with no local record still appears, with an empty human layer and
// `needsResolve`. That is the honest state: the debt is real and visible, and
// the officer resolves the customer to start working them. Hiding the row until
// somebody had clicked resolve would mean the queue only shows customers
// somebody already knew about.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { listLoansLive, getLoanBookStats } from "@/lib/lms/servicesuite-loans";
import { bucketOf, type QueueRow, type QueueSummary } from "./queue";
import type { ResolvedOrg } from "@/lib/tenancy";

/** How many arrears rows one queue page carries. Their whole delinquent book is
 *  double figures; the cap is a guard, not a pager. */
const MAX_ROWS = 200;

export type LiveQueueRow = QueueRow & {
  /** `ss:<borrowerId>` — for the resolve link. */
  liveBorrowerRef: string;
  /** True when this customer has no local record yet, so calls and promises
   *  cannot be logged against them until an officer opens them. */
  needsResolve: boolean;
};

export async function collectionsQueueLive(
  org: ResolvedOrg,
  orgId: string,
): Promise<{ rows: LiveQueueRow[]; summary: QueueSummary }> {
  if (!org.registry || !org.entityId) return { rows: [], summary: emptySummary() };

  const [{ loans }, book] = await Promise.all([
    listLoansLive(org.registry, org.entityId, { status: "arrears", take: MAX_ROWS }),
    getLoanBookStats(org.registry, org.entityId),
  ]);

  // Match their customers to any local record by the last nine digits — the same
  // rule every other phone comparison in this codebase uses, because the column
  // holds a mix of 07…, 2547… and +2547… from years of different intake paths.
  const tails = loans
    .map((l) => (l.phone ?? "").replace(/\D/g, "").slice(-9))
    .filter((t) => t.length === 9);

  const locals = tails.length
    ? await prisma.borrower.findMany({
        where: { orgId, OR: tails.map((t) => ({ phone: { endsWith: t } })) },
        select: { id: true, phone: true },
      })
    : [];

  const localByTail = new Map<string, string>();
  for (const b of locals) {
    const t = (b.phone ?? "").replace(/\D/g, "").slice(-9);
    if (t.length === 9 && !localByTail.has(t)) localByTail.set(t, b.id);
  }

  const localIds = [...localByTail.values()];

  // The human layer, batched, by borrower rather than by loan.
  const [ptps, calls, tickets] = localIds.length
    ? await Promise.all([
        prisma.promiseToPay.findMany({
          where: { orgId, borrowerId: { in: localIds }, status: "PENDING" },
          select: { id: true, borrowerId: true, amount: true, dueDate: true },
          orderBy: { dueDate: "asc" },
        }),
        prisma.collectionCall.findMany({
          where: { orgId, borrowerId: { in: localIds } },
          select: { borrowerId: true, outcome: true, createdAt: true, createdBy: true },
          orderBy: { createdAt: "desc" },
          take: 500,
        }),
        prisma.collectionTicket.groupBy({
          by: ["borrowerId"],
          where: { orgId, borrowerId: { in: localIds }, status: { not: "CLOSED" } },
          _count: true,
        }),
      ])
    : [[], [], []];

  const ptpBy = new Map<string, (typeof ptps)[number]>();
  for (const p of ptps) if (!ptpBy.has(p.borrowerId)) ptpBy.set(p.borrowerId, p);

  const callBy = new Map<string, (typeof calls)[number]>();
  for (const c of calls) if (!callBy.has(c.borrowerId)) callBy.set(c.borrowerId, c);

  const ticketBy = new Map<string, number>();
  for (const t of tickets) ticketBy.set(t.borrowerId, t._count);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rows: LiveQueueRow[] = loans.map((l) => {
    const tail = (l.phone ?? "").replace(/\D/g, "").slice(-9);
    const localId = tail.length === 9 ? localByTail.get(tail) : undefined;
    const ptp = localId ? ptpBy.get(localId) : undefined;
    const call = localId ? callBy.get(localId) : undefined;
    const dpd = l.daysInArrears ?? 0;

    return {
      // `ss:` so nothing downstream mistakes this for an LMS uuid and tries to
      // load a loan that is not in our tables.
      loanId: `ss:${l.serviceSuiteId}`,
      borrowerId: localId ?? `ss:${l.borrowerId}`,
      name: l.borrowerName ?? l.phone ?? `Borrower ${l.borrowerId}`,
      phone: l.phone ?? "",
      product: l.product ?? "—",
      dpd,
      amountOverdue: l.arrears,
      balance: l.balance,
      bucket: bucketOf(dpd),
      ptp: ptp
        ? {
            id: ptp.id,
            amount: Number(ptp.amount),
            dueDate: ptp.dueDate.toISOString().slice(0, 10),
            overdue: ptp.dueDate < today,
          }
        : null,
      lastCall: call ? { outcome: call.outcome, at: call.createdAt.toISOString(), by: call.createdBy } : null,
      openTickets: localId ? (ticketBy.get(localId) ?? 0) : 0,
      liveBorrowerRef: `ss:${l.borrowerId}`,
      needsResolve: !localId,
    };
  });

  return {
    rows,
    summary: {
      // The lender's own count, so the header agrees with their dashboard even
      // when the page is capped.
      loansOverdue: book.inArrears,
      amountOverdue: book.arrearsValue,
      ptpsPending: ptps.length,
      ptpsDueToday: ptps.filter((p) => p.dueDate.toDateString() === today.toDateString()).length,
      // Broken promises are counted from OUR history and are genuinely zero for
      // a customer we have never worked — not a number we are failing to find.
      ptpsBroken30d: 0,
      ticketsOpen: [...ticketBy.values()].reduce((a, b) => a + b, 0),
    },
  };
}

function emptySummary(): QueueSummary {
  return {
    loansOverdue: 0,
    amountOverdue: 0,
    ptpsPending: 0,
    ptpsDueToday: 0,
    ptpsBroken30d: 0,
    ticketsOpen: 0,
  };
}
