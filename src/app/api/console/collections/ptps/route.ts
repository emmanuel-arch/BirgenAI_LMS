// Promises to pay (own org).
//   GET  ?filter=pending|due-today|broken|kept|all  (collections.view)
//   POST { id, action: "cancel", note }             (collections.manage)
// Kept/partial/broken are resolved by the MONEY (see lib/collections/ptp) —
// cancellation is the only human verb here, and it demands a note.
import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireRight } from "@/lib/rbac/authz";
import { resolveDuePromises } from "@/lib/collections/ptp";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await auth();
  const denied = await requireRight(session, "collections.view");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;

  await resolveDuePromises(orgId).catch(() => {});

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const filter = req.nextUrl.searchParams.get("filter") ?? "pending";
  const where: Prisma.PromiseToPayWhereInput =
    filter === "due-today" ? { status: "PENDING", dueDate: { gte: today, lt: new Date(today.getTime() + 86400000) } }
    : filter === "broken" ? { status: "BROKEN" }
    : filter === "kept" ? { status: { in: ["KEPT", "PARTIAL"] } }
    : filter === "all" ? {}
    : { status: "PENDING" };

  const [ptps, staff] = await Promise.all([
    prisma.promiseToPay.findMany({
      where: { orgId, ...where },
      orderBy: [{ status: "asc" }, { dueDate: "asc" }],
      take: 200,
    }),
    prisma.staffUser.findMany({ where: { orgId }, select: { id: true, firstName: true } }),
  ]);
  const borrowers = await prisma.borrower.findMany({
    where: { id: { in: [...new Set(ptps.map((p) => p.borrowerId))] } },
    select: { id: true, firstName: true, otherName: true, phone: true },
  });
  const bName = new Map(borrowers.map((b) => [b.id, { name: `${b.firstName ?? ""}${b.otherName ? " " + b.otherName : ""}`.trim() || "Borrower", phone: b.phone }]));
  const sName = new Map(staff.map((s) => [s.id, s.firstName]));

  return NextResponse.json({
    success: true,
    ptps: ptps.map((p) => ({
      id: p.id, loanId: p.loanId, borrowerId: p.borrowerId,
      borrower: bName.get(p.borrowerId) ?? { name: "Borrower", phone: "" },
      amount: Number(p.amount), paidAmount: Number(p.paidAmount),
      dueDate: p.dueDate, status: p.status, note: p.note,
      takenBy: sName.get(p.createdBy) ?? "Staff", createdAt: p.createdAt, resolvedAt: p.resolvedAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const denied = await requireRight(session, "collections.manage");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;

  let body: { id?: string; action?: string; note?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }
  if (body.action !== "cancel") return NextResponse.json({ success: false, message: "Unknown action." }, { status: 400 });
  if (!body.id) return NextResponse.json({ success: false, message: "id required." }, { status: 400 });
  const note = body.note?.trim();
  if (!note) {
    return NextResponse.json({ success: false, message: "Say why — the note is the only record of a promise being withdrawn." }, { status: 400 });
  }

  const ptp = await prisma.promiseToPay.findFirst({ where: { id: body.id, orgId } });
  if (!ptp) return NextResponse.json({ success: false, message: "Promise not found." }, { status: 404 });
  if (ptp.status !== "PENDING") {
    return NextResponse.json({ success: false, message: "Only a pending promise can be cancelled — this one already resolved." }, { status: 409 });
  }

  await prisma.promiseToPay.update({
    where: { id: ptp.id },
    data: { status: "CANCELLED", note, resolvedAt: new Date() },
  });
  await prisma.auditLog.create({
    data: { orgId, actorId: session!.user!.id, actorType: "staff", action: "collections.ptp.cancel", entity: "PromiseToPay", entityId: ptp.id, meta: { note } },
  }).catch(() => {});

  return NextResponse.json({ success: true });
}
