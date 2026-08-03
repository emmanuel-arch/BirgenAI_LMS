// ─────────────────────────────────────────────────────────────────────────────
// TODAY — the three numbers a lending team wakes up to.
//
// HOW MUCH IS DUE TODAY. HOW MUCH IS IN ARREARS. WHO PROMISED TO PAY TODAY.
//
// Everything the Alerts tray does is a COUNT with a threshold — "3 promises fall
// due today" — which is the right shape for a notification and the wrong shape for
// a morning. An officer who is told there are three promises still has to open a
// screen to learn whose, how much, and which phone to call. So this endpoint is
// the tray's other half: the same counted truth, but carrying the ROWS, ready to
// be worked from a lock screen before anybody has sat down.
//
// THREE PROPERTIES IT SHARES WITH signals.ts, deliberately:
//
//   1. NOTHING HERE IS GENERATED. Every figure is a query over installments,
//      promises and receipts. A model does not get to phrase a number that sends
//      somebody to a customer's door.
//   2. SCOPE IS THE SAME SCOPE. A relationship officer sees their own book; a
//      regional manager sees the region; head office sees the lender. The fences
//      are the shared `loanScopeWhere` / `borrowerScopeWhere` fragments, so this
//      screen cannot disagree with the screen it links to.
//   3. RIGHTS GATE EACH SECTION SEPARATELY. A call-centre agent with collections
//      rights but no loans rights gets promises and nothing else, rather than a
//      403 for the whole morning.
//
// THE LISTS ARE CAPPED. This is read on a phone-sized panel: twelve rows is a
// worklist, two hundred is a report, and the report already exists on the console
// screens each row deep-links into.
// ─────────────────────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithOrg } from "@/lib/db/context";
import { getRights } from "@/lib/rbac/authz";
import { resolveScope, borrowerScopeWhere, loanScopeWhere, type ResolvedScope } from "@/lib/rbac/scope";

export const runtime = "nodejs";

const LIST_CAP = 12;

const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const endOfToday = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d; };
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

/** One row on a worklist: a person, an amount, and the phone that reaches them. */
export type TodayRow = {
  borrowerId: string;
  loanId: string;
  name: string;
  phone: string;
  tel: string;
  /** Formatted — the client does no currency maths. */
  amount: string;
  amountRaw: number;
  /** ISO. The installment's due date, or the promise's. */
  dueDate: string;
  /** Only on arrears rows. */
  daysLate?: number;
  branch?: string | null;
  note?: string | null;
};

export type TodayBucket = { key: string; label: string; count: number; amount: string; amountRaw: number };

export type TodayPayload = {
  due: { available: boolean; count: number; amount: string; amountRaw: number; rows: TodayRow[] };
  arrears: { available: boolean; count: number; amount: string; amountRaw: number; buckets: TodayBucket[]; rows: TodayRow[] };
  promises: { available: boolean; count: number; amount: string; amountRaw: number; broken: number; rows: TodayRow[] };
  /** What has already landed today — the counterweight, so the screen is not only debt. */
  collected: { count: number; amount: string; amountRaw: number };
};

const can = (rights: ReadonlySet<string>, r: string) => rights.has("*") || rights.has(r);

/** One probe failing costs its own section, never the response. */
async function probe<T>(what: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (e) {
    console.info(`[riri:today] ${what} skipped — ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`);
    return fallback;
  }
}

const empty = { available: false, count: 0, amount: kes(0), amountRaw: 0, rows: [] as TodayRow[] };

/** Borrower name, falling back to the number — never a blank row. */
const nameOf = (b: { firstName: string | null; otherName: string | null; phone: string }) =>
  [b.firstName, b.otherName].filter(Boolean).join(" ").trim() || b.phone;

export async function GET() {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const orgId = session.user.orgId;

  const [rights, scope] = await Promise.all([getRights(session), resolveScope(session)]);

  const loanWhere = loanScopeWhere(scope);
  const seesLoans = can(rights, "loans.view") || can(rights, "collections.view");
  const seesCollections = can(rights, "collections.view");

  const payload: TodayPayload = {
    due: { ...empty },
    arrears: { ...empty, buckets: [] },
    promises: { ...empty, broken: 0 },
    collected: { count: 0, amount: kes(0), amountRaw: 0 },
  };

  await runWithOrg(orgId, async () => {
    // ── DUE TODAY ────────────────────────────────────────────────────────────
    // Not "scheduled today" — OWED today. An installment already part-paid is
    // counted at what is left on it, because that is the figure a collections
    // team is measured against by the close of business.
    if (seesLoans) {
      payload.due.available = true;
      await probe("due today", async () => {
        const rows = await prisma.installment.findMany({
          where: {
            orgId,
            dueDate: { gte: startOfToday(), lte: endOfToday() },
            status: { in: ["UPCOMING", "DUE", "PARTIAL"] },
            loan: { ...loanWhere, status: "ACTIVE" },
          },
          orderBy: { amountDue: "desc" },
          take: 400,
          select: {
            dueDate: true, amountDue: true, amountPaid: true,
            loan: {
              select: {
                id: true, branchId: true,
                borrower: { select: { id: true, firstName: true, otherName: true, phone: true } },
              },
            },
          },
        });

        const outstanding = rows.map((r) => ({ r, left: Number(r.amountDue) - Number(r.amountPaid) })).filter((x) => x.left > 0);
        payload.due.count = outstanding.length;
        payload.due.amountRaw = outstanding.reduce((s, x) => s + x.left, 0);
        payload.due.amount = kes(payload.due.amountRaw);
        payload.due.rows = outstanding.slice(0, LIST_CAP).map(({ r, left }) => ({
          borrowerId: r.loan.borrower.id,
          loanId: r.loan.id,
          name: nameOf(r.loan.borrower),
          phone: r.loan.borrower.phone,
          tel: `tel:+${r.loan.borrower.phone}`,
          amount: kes(left),
          amountRaw: left,
          dueDate: r.dueDate.toISOString(),
        }));
        return true;
      }, false);
    }

    // ── ARREARS ──────────────────────────────────────────────────────────────
    // Bucketed by AGE, because age is what decides the action. Money one to seven
    // days late is a phone call; money past sixty is a decision about whether this
    // is still a loan. A single "arrears" total hides that difference and is how a
    // team spends its morning on the least collectable accounts on the book.
    if (seesLoans) {
      payload.arrears.available = true;
      await probe("arrears", async () => {
        const rows = await prisma.installment.findMany({
          where: { orgId, status: "OVERDUE", loan: { ...loanWhere, status: "ACTIVE" } },
          orderBy: { dueDate: "asc" },
          take: 1500,
          select: {
            dueDate: true, amountDue: true, amountPaid: true, penalty: true,
            loan: {
              select: {
                id: true,
                borrower: { select: { id: true, firstName: true, otherName: true, phone: true } },
              },
            },
          },
        });

        const BUCKETS: { key: string; label: string; lo: number; hi: number }[] = [
          { key: "b1", label: "1–7 days", lo: 1, hi: 7 },
          { key: "b2", label: "8–30 days", lo: 8, hi: 30 },
          { key: "b3", label: "31–60 days", lo: 31, hi: 60 },
          { key: "b4", label: "60+ days", lo: 61, hi: Number.MAX_SAFE_INTEGER },
        ];
        const tally = new Map(BUCKETS.map((b) => [b.key, { count: 0, amount: 0 }]));

        // The WORST account per loan is what a worklist wants: one row per customer
        // showing the oldest miss, not four rows for four missed installments.
        const worstByLoan = new Map<string, TodayRow>();
        let total = 0;

        for (const r of rows) {
          const left = Number(r.amountDue) - Number(r.amountPaid) + Number(r.penalty);
          if (left <= 0) continue;
          const days = Math.max(1, Math.floor((Date.now() - r.dueDate.getTime()) / 86_400_000));
          const bucket = BUCKETS.find((b) => days >= b.lo && days <= b.hi);
          if (bucket) { const t = tally.get(bucket.key)!; t.count += 1; t.amount += left; }
          total += left;

          const existing = worstByLoan.get(r.loan.id);
          if (existing) {
            // Same loan, later installment: fold the money in, keep the oldest date.
            existing.amountRaw += left;
            existing.amount = kes(existing.amountRaw);
          } else {
            worstByLoan.set(r.loan.id, {
              borrowerId: r.loan.borrower.id,
              loanId: r.loan.id,
              name: nameOf(r.loan.borrower),
              phone: r.loan.borrower.phone,
              tel: `tel:+${r.loan.borrower.phone}`,
              amount: kes(left),
              amountRaw: left,
              dueDate: r.dueDate.toISOString(),
              daysLate: days,
            });
          }
        }

        payload.arrears.count = worstByLoan.size;
        payload.arrears.amountRaw = total;
        payload.arrears.amount = kes(total);
        payload.arrears.buckets = BUCKETS.map((b) => {
          const t = tally.get(b.key)!;
          return { key: b.key, label: b.label, count: t.count, amount: kes(t.amount), amountRaw: t.amount };
        });
        // Oldest and largest first — the order a supervisor would put them in.
        payload.arrears.rows = [...worstByLoan.values()]
          .sort((a, b) => (b.daysLate ?? 0) - (a.daysLate ?? 0) || b.amountRaw - a.amountRaw)
          .slice(0, LIST_CAP);
        return true;
      }, false);
    }

    // ── PROMISES DUE TODAY ───────────────────────────────────────────────────
    //
    // PromiseToPay carries a borrowerId but no relation to walk, so scope cannot be
    // expressed as a nested filter the way it can for installments. The visible
    // borrower ids are resolved first and the query fenced to them — the same
    // approach signals.ts takes, for the same reason: quietly listing the whole
    // lender's promises to an officer on OWN scope is the kind of leak that only
    // surfaces as "why does my list say twelve when I have three?"
    if (seesCollections) {
      payload.promises.available = true;
      await probe("promises", async () => {
        const window = { gte: startOfToday(), lte: endOfToday() };
        let fence: { borrowerId?: { in: string[] } } = {};
        if (!scope.unrestricted) {
          const mine = await prisma.borrower.findMany({
            where: { orgId, ...borrowerScopeWhere(scope), erasedAt: null },
            select: { id: true },
            take: 2000,
          });
          if (!mine.length) return false;
          fence = { borrowerId: { in: mine.map((b) => b.id) } };
        }

        const [pending, broken] = await Promise.all([
          prisma.promiseToPay.findMany({
            where: { orgId, status: "PENDING", dueDate: window, ...fence },
            orderBy: { amount: "desc" },
            take: 200,
            select: { id: true, loanId: true, borrowerId: true, amount: true, paidAmount: true, dueDate: true, note: true },
          }),
          // A promise that already went past its date without money is the reason
          // today's list is worth working: it is what happens when nobody does.
          prisma.promiseToPay.count({ where: { orgId, status: "BROKEN", dueDate: { gte: daysAgo(30) }, ...fence } }),
        ]);

        payload.promises.broken = broken;
        payload.promises.count = pending.length;
        payload.promises.amountRaw = pending.reduce((s, p) => s + Math.max(0, Number(p.amount) - Number(p.paidAmount)), 0);
        payload.promises.amount = kes(payload.promises.amountRaw);

        const ids = [...new Set(pending.slice(0, LIST_CAP).map((p) => p.borrowerId))];
        const people = await prisma.borrower.findMany({
          where: { orgId, id: { in: ids } },
          select: { id: true, firstName: true, otherName: true, phone: true },
        });
        const byId = new Map(people.map((p) => [p.id, p]));

        payload.promises.rows = pending.slice(0, LIST_CAP).flatMap((p) => {
          const b = byId.get(p.borrowerId);
          if (!b) return [];
          const left = Math.max(0, Number(p.amount) - Number(p.paidAmount));
          return [{
            borrowerId: b.id,
            loanId: p.loanId,
            name: nameOf(b),
            phone: b.phone,
            tel: `tel:+${b.phone}`,
            amount: kes(left),
            amountRaw: left,
            dueDate: p.dueDate.toISOString(),
            note: p.note,
          }];
        });
        return true;
      }, false);
    }

    // ── ALREADY IN TODAY ─────────────────────────────────────────────────────
    // Receipts allocated since midnight. Not scoped by officer: money arriving is a
    // lender-level fact, and a receipt does not know whose customer sent it until
    // it is allocated — which is exactly what reconciliation is for.
    if (can(rights, "repayments.view") || seesLoans) {
      await probe("collected today", async () => {
        const agg = await prisma.c2BReceipt.aggregate({
          _sum: { amount: true },
          _count: { _all: true },
          where: { orgId, allocatedAt: { gte: startOfToday(), lte: endOfToday() } },
        });
        payload.collected.count = agg._count._all;
        payload.collected.amountRaw = Number(agg._sum.amount ?? 0);
        payload.collected.amount = kes(payload.collected.amountRaw);
        return true;
      }, false);
    }
  });

  return NextResponse.json({
    success: true,
    ...payload,
    scope: (scope as ResolvedScope).kind,
    at: new Date().toISOString(),
  });
}
