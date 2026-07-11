// Collection calls (own org).
//   GET  ?loanId=  → that loan's call history (collections.view)
//   POST { loanId, outcome, note?, ptp?: { amount, dueDate } } (collections.manage)
//        — logs the call; outcome PROMISE_TO_PAY takes a promise, superseding
//        any pending one (two live promises on one debt is imaginary cashflow).
import { NextRequest, NextResponse } from "next/server";
import { CallOutcome } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireRight } from "@/lib/rbac/authz";
import { takePromise } from "@/lib/collections/ptp";

export const runtime = "nodejs";

const OUTCOMES = Object.values(CallOutcome);
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export async function GET(req: NextRequest) {
  const session = await auth();
  const denied = await requireRight(session, "collections.view");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;

  const loanId = req.nextUrl.searchParams.get("loanId") ?? "";
  if (!loanId) return NextResponse.json({ success: false, message: "loanId required." }, { status: 400 });

  const [calls, staff] = await Promise.all([
    prisma.collectionCall.findMany({
      where: { orgId, loanId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.staffUser.findMany({ where: { orgId }, select: { id: true, firstName: true, otherName: true } }),
  ]);
  const names = new Map(staff.map((s) => [s.id, `${s.firstName}${s.otherName ? " " + s.otherName : ""}`]));
  return NextResponse.json({
    success: true,
    calls: calls.map((c) => ({ id: c.id, outcome: c.outcome, note: c.note, at: c.createdAt, by: names.get(c.createdBy) ?? "Staff" })),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const denied = await requireRight(session, "collections.manage");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;
  const staffId = session!.user!.id;

  let body: { loanId?: string; outcome?: string; note?: string; ptp?: { amount?: number; dueDate?: string } };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  if (!body.loanId) return NextResponse.json({ success: false, message: "loanId required." }, { status: 400 });
  if (!OUTCOMES.includes(body.outcome as CallOutcome)) {
    return NextResponse.json({ success: false, message: "Pick a call outcome." }, { status: 400 });
  }
  const outcome = body.outcome as CallOutcome;

  const loan = await prisma.loan.findFirst({ where: { id: body.loanId, orgId }, select: { id: true, borrowerId: true } });
  if (!loan) return NextResponse.json({ success: false, message: "Loan not found." }, { status: 404 });

  let ptpId: string | null = null;
  if (outcome === "PROMISE_TO_PAY") {
    const amount = Number(body.ptp?.amount);
    const dueDate = body.ptp?.dueDate ? new Date(body.ptp.dueDate) : null;
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ success: false, message: "A promise needs an amount." }, { status: 400 });
    }
    if (!dueDate || isNaN(dueDate.getTime()) || dayStart(dueDate) < dayStart(new Date())) {
      return NextResponse.json({ success: false, message: "A promise needs a date — today or later." }, { status: 400 });
    }
    const ptp = await takePromise({
      orgId, loanId: loan.id, borrowerId: loan.borrowerId,
      amount, dueDate: dayStart(dueDate), note: body.note, createdBy: staffId,
    });
    ptpId = ptp.id;
  }

  const call = await prisma.collectionCall.create({
    data: {
      orgId, loanId: loan.id, borrowerId: loan.borrowerId,
      outcome, note: body.note?.trim() || null, ptpId, createdBy: staffId,
    },
  });

  await prisma.auditLog.create({
    data: {
      orgId, actorId: staffId, actorType: "staff", action: "collections.call",
      entity: "CollectionCall", entityId: call.id, meta: { loanId: loan.id, outcome, ptpId },
    },
  }).catch(() => {});

  return NextResponse.json({ success: true, callId: call.id, ptpId });
}
