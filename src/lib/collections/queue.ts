// ─────────────────────────────────────────────────────────────────────────────
// The collections work queue — derived LIVE from the book, never persisted.
//
// A queue table goes stale the moment a payment lands; the book cannot. Every
// read recomputes: loans ACTIVE with an overdue installment, freshest arrears
// first (day-1 borrowers answer their phones; day-400 borrowers are a recovery
// problem, not a reminder call — same early-intervention framing the Hub call
// center used). What DOES persist is the human layer stitched on top: the open
// promise, the last call, open tickets.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";

export type QueueRow = {
  loanId: string;
  borrowerId: string;
  name: string;
  phone: string;
  product: string;
  dpd: number; // days past due on the OLDEST overdue installment
  amountOverdue: number; // outstanding across overdue+due installments (incl. penalties)
  balance: number;
  bucket: "1-7" | "8-30" | "31-60" | "60+";
  /** Open promise, if one is pending — the queue shows it instead of nagging. */
  ptp: { id: string; amount: number; dueDate: string; overdue: boolean } | null;
  lastCall: { outcome: string; at: string; by: string | null } | null;
  openTickets: number;
};

export type QueueSummary = {
  loansOverdue: number;
  amountOverdue: number;
  ptpsPending: number;
  ptpsDueToday: number;
  ptpsBroken30d: number;
  ticketsOpen: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function bucketOf(dpd: number): QueueRow["bucket"] {
  if (dpd <= 7) return "1-7";
  if (dpd <= 30) return "8-30";
  if (dpd <= 60) return "31-60";
  return "60+";
}

export async function collectionsQueue(orgId: string): Promise<{ rows: QueueRow[]; summary: QueueSummary }> {
  const today = dayStart(new Date());

  const loans = await prisma.loan.findMany({
    where: { orgId, status: "ACTIVE", installments: { some: { status: "OVERDUE" } } },
    select: {
      id: true, borrowerId: true, balance: true,
      borrower: { select: { firstName: true, otherName: true, phone: true } },
      product: { select: { name: true } },
      installments: {
        where: { status: { in: ["OVERDUE", "DUE", "PARTIAL"] } },
        select: { dueDate: true, amountDue: true, amountPaid: true, penalty: true, status: true },
        orderBy: { dueDate: "asc" },
      },
    },
    take: 500,
  });
  const loanIds = loans.map((l) => l.id);

  // The human layer, batched: open promises, last calls, open ticket counts.
  const [ptps, calls, tickets, staff] = await Promise.all([
    prisma.promiseToPay.findMany({
      where: { orgId, loanId: { in: loanIds }, status: "PENDING" },
      select: { id: true, loanId: true, amount: true, dueDate: true },
    }),
    prisma.collectionCall.findMany({
      where: { orgId, loanId: { in: loanIds } },
      orderBy: { createdAt: "desc" },
      select: { loanId: true, outcome: true, createdAt: true, createdBy: true },
      take: 1000,
    }),
    prisma.collectionTicket.groupBy({
      by: ["loanId"],
      where: { orgId, loanId: { in: loanIds }, status: { in: ["OPEN", "IN_PROGRESS"] } },
      _count: true,
    }),
    prisma.staffUser.findMany({ where: { orgId }, select: { id: true, firstName: true } }),
  ]);
  const staffName = new Map(staff.map((s) => [s.id, s.firstName]));
  const ptpByLoan = new Map(ptps.map((p) => [p.loanId, p]));
  const lastCallByLoan = new Map<string, (typeof calls)[number]>();
  for (const c of calls) if (!lastCallByLoan.has(c.loanId)) lastCallByLoan.set(c.loanId, c);
  const ticketsByLoan = new Map(tickets.map((t) => [t.loanId, t._count]));

  const rows: QueueRow[] = loans.map((l) => {
    const overdueInsts = l.installments.filter((i) => i.status === "OVERDUE");
    const oldest = overdueInsts[0]?.dueDate ?? today;
    const dpd = Math.max(1, Math.floor((today.getTime() - dayStart(oldest).getTime()) / 86400000));
    const amountOverdue = round2(
      l.installments.reduce((s, i) => s + Number(i.amountDue) + Number(i.penalty) - Number(i.amountPaid), 0),
    );
    const ptp = ptpByLoan.get(l.id);
    const call = lastCallByLoan.get(l.id);
    return {
      loanId: l.id,
      borrowerId: l.borrowerId,
      name: `${l.borrower.firstName ?? ""}${l.borrower.otherName ? " " + l.borrower.otherName : ""}`.trim() || "Borrower",
      phone: l.borrower.phone,
      product: l.product.name,
      dpd,
      amountOverdue,
      balance: Number(l.balance),
      bucket: bucketOf(dpd),
      ptp: ptp
        ? { id: ptp.id, amount: Number(ptp.amount), dueDate: ptp.dueDate.toISOString(), overdue: ptp.dueDate < today }
        : null,
      lastCall: call
        ? { outcome: call.outcome, at: call.createdAt.toISOString(), by: staffName.get(call.createdBy) ?? null }
        : null,
      openTickets: ticketsByLoan.get(l.id) ?? 0,
    };
  });

  // Freshest arrears first — the calls most likely to save the loan.
  rows.sort((a, b) => a.dpd - b.dpd || b.amountOverdue - a.amountOverdue);

  const thirtyAgo = new Date(today.getTime() - 30 * 86400000);
  const [ptpsPending, ptpsDueToday, ptpsBroken30d, ticketsOpen] = await Promise.all([
    prisma.promiseToPay.count({ where: { orgId, status: "PENDING" } }),
    prisma.promiseToPay.count({ where: { orgId, status: "PENDING", dueDate: { gte: today, lt: new Date(today.getTime() + 86400000) } } }),
    prisma.promiseToPay.count({ where: { orgId, status: "BROKEN", resolvedAt: { gte: thirtyAgo } } }),
    prisma.collectionTicket.count({ where: { orgId, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
  ]);

  return {
    rows,
    summary: {
      loansOverdue: rows.length,
      amountOverdue: round2(rows.reduce((s, r) => s + r.amountOverdue, 0)),
      ptpsPending,
      ptpsDueToday,
      ptpsBroken30d,
      ticketsOpen,
    },
  };
}
