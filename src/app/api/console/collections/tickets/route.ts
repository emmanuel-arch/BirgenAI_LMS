// Collection tickets (own org) — disputes, hardship, escalations.
//   GET  ?status=open|all                                   (collections.view)
//   POST { borrowerId? , loanId?, kind, title, detail?, assignedToId? } (collections.manage)
//   PUT  { id, status?, assignedToId?, resolution? }        (collections.manage)
//        — moving to RESOLVED/CLOSED demands a resolution note: that row may be
//        the only record of why a lender stopped (or kept) chasing a debt.
import { NextRequest, NextResponse } from "next/server";
import { TicketKind, TicketStatus } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireRight } from "@/lib/rbac/authz";

export const runtime = "nodejs";

const KINDS = Object.values(TicketKind);
const STATUSES = Object.values(TicketStatus);

export async function GET(req: NextRequest) {
  const session = await auth();
  const denied = await requireRight(session, "collections.view");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;

  const status = req.nextUrl.searchParams.get("status") ?? "open";
  const [tickets, staff] = await Promise.all([
    prisma.collectionTicket.findMany({
      where: { orgId, ...(status === "all" ? {} : { status: { in: ["OPEN", "IN_PROGRESS"] } }) },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    prisma.staffUser.findMany({ where: { orgId }, select: { id: true, firstName: true, otherName: true, status: true } }),
  ]);
  const borrowers = await prisma.borrower.findMany({
    where: { id: { in: [...new Set(tickets.map((t) => t.borrowerId))] } },
    select: { id: true, firstName: true, otherName: true, phone: true },
  });
  const bName = new Map(borrowers.map((b) => [b.id, { name: `${b.firstName ?? ""}${b.otherName ? " " + b.otherName : ""}`.trim() || "Borrower", phone: b.phone }]));
  const sName = new Map(staff.map((s) => [s.id, `${s.firstName}${s.otherName ? " " + s.otherName : ""}`]));

  return NextResponse.json({
    success: true,
    tickets: tickets.map((t) => ({
      id: t.id, kind: t.kind, status: t.status, title: t.title, detail: t.detail,
      borrowerId: t.borrowerId, loanId: t.loanId,
      borrower: bName.get(t.borrowerId) ?? { name: "Borrower", phone: "" },
      assignedTo: t.assignedToId ? { id: t.assignedToId, name: sName.get(t.assignedToId) ?? "Staff" } : null,
      resolution: t.resolution, createdBy: sName.get(t.createdBy) ?? "Staff",
      createdAt: t.createdAt, updatedAt: t.updatedAt, resolvedAt: t.resolvedAt,
    })),
    // Assignment dropdown: active staff only.
    staff: staff.filter((s) => s.status === "ACTIVE").map((s) => ({ id: s.id, name: `${s.firstName}${s.otherName ? " " + s.otherName : ""}` })),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const denied = await requireRight(session, "collections.manage");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;

  let body: { borrowerId?: string; loanId?: string; kind?: string; title?: string; detail?: string; assignedToId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  if (!KINDS.includes(body.kind as TicketKind)) {
    return NextResponse.json({ success: false, message: "Pick what kind of case this is." }, { status: 400 });
  }
  const title = (body.title ?? "").trim();
  if (title.length < 4) return NextResponse.json({ success: false, message: "Give the ticket a short title." }, { status: 400 });

  // Anchor to a borrower — directly, or through the loan.
  let borrowerId = body.borrowerId ?? null;
  if (!borrowerId && body.loanId) {
    const loan = await prisma.loan.findFirst({ where: { id: body.loanId, orgId }, select: { borrowerId: true } });
    borrowerId = loan?.borrowerId ?? null;
  }
  if (!borrowerId) return NextResponse.json({ success: false, message: "A ticket needs a borrower (or a loan)." }, { status: 400 });
  const borrower = await prisma.borrower.findFirst({ where: { id: borrowerId, orgId }, select: { id: true } });
  if (!borrower) return NextResponse.json({ success: false, message: "Borrower not found." }, { status: 404 });

  const ticket = await prisma.collectionTicket.create({
    data: {
      orgId, borrowerId, loanId: body.loanId || null,
      kind: body.kind as TicketKind, title, detail: body.detail?.trim() || null,
      assignedToId: body.assignedToId || null,
      status: body.assignedToId ? "IN_PROGRESS" : "OPEN",
      createdBy: session!.user!.id,
    },
  });
  await prisma.auditLog.create({
    data: { orgId, actorId: session!.user!.id, actorType: "staff", action: "collections.ticket.open", entity: "CollectionTicket", entityId: ticket.id, meta: { kind: ticket.kind, title } },
  }).catch(() => {});

  return NextResponse.json({ success: true, ticketId: ticket.id });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  const denied = await requireRight(session, "collections.manage");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;

  let body: { id?: string; status?: string; assignedToId?: string | null; resolution?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ success: false, message: "id required." }, { status: 400 });

  const ticket = await prisma.collectionTicket.findFirst({ where: { id: body.id, orgId } });
  if (!ticket) return NextResponse.json({ success: false, message: "Ticket not found." }, { status: 404 });

  let status: TicketStatus | undefined;
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status as TicketStatus)) {
      return NextResponse.json({ success: false, message: "Unknown status." }, { status: 400 });
    }
    status = body.status as TicketStatus;
    const closing = (status === "RESOLVED" || status === "CLOSED") && ticket.status !== "RESOLVED" && ticket.status !== "CLOSED";
    if (closing && !(body.resolution ?? "").trim()) {
      return NextResponse.json({ success: false, message: "Say how it was resolved — this may be the only record of the decision." }, { status: 400 });
    }
  }

  await prisma.collectionTicket.update({
    where: { id: ticket.id },
    data: {
      status,
      assignedToId: body.assignedToId === undefined ? undefined : body.assignedToId,
      resolution: (body.resolution ?? "").trim() ? body.resolution!.trim() : undefined,
      resolvedAt: status === "RESOLVED" || status === "CLOSED" ? new Date() : undefined,
    },
  });
  await prisma.auditLog.create({
    data: { orgId, actorId: session!.user!.id, actorType: "staff", action: "collections.ticket.update", entity: "CollectionTicket", entityId: ticket.id, meta: { status: status ?? ticket.status } },
  }).catch(() => {});

  return NextResponse.json({ success: true });
}
