// Finance's exceptions queue.
//   GET  → open exceptions + recently closed + tiles
//   POST → { action: "sweep" }                     re-run every check for this org
//          { action: "resolve" | "ignore", id, note }   note is mandatory — the row
//                                                        is the only record of why
//          { action: "reopen", id }
//          { action: "apply", id }                 STK_SUCCESS_UNAPPLIED only: post
//                                                  the confirmed money to its loan —
//                                                  the fix the webhook failed to make
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { reconcileOrg, resolveException } from "@/lib/finance/reconcile";
import { allocateRepayment } from "@/lib/lending/allocate";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "reconciliation.view");
  if (denied) return denied;
  const orgId = session.user.orgId;

  const [open, closed] = await Promise.all([
    prisma.reconciliationException.findMany({
      where: { orgId, status: "OPEN" },
      orderBy: [{ severity: "asc" }, { detectedAt: "asc" }], // HIGH first (enum order), oldest first
    }),
    prisma.reconciliationException.findMany({
      where: { orgId, status: { in: ["RESOLVED", "IGNORED"] } },
      orderBy: { resolvedAt: "desc" },
      take: 20,
    }),
  ]);

  const shape = (e: (typeof open)[number]) => ({
    id: e.id, kind: e.kind, reference: e.reference, severity: e.severity,
    amountKes: e.amountKes === null ? null : Number(e.amountKes),
    message: e.message, meta: e.meta, status: e.status,
    detectedAt: e.detectedAt, lastSeenAt: e.lastSeenAt,
    resolvedAt: e.resolvedAt, resolvedBy: e.resolvedBy, resolution: e.resolution,
  });

  const lastSweep = await prisma.reconciliationException.aggregate({
    where: { orgId }, _max: { lastSeenAt: true },
  });

  return NextResponse.json({
    success: true,
    open: open.map(shape),
    closed: closed.map(shape),
    tiles: {
      open: open.length,
      high: open.filter((e) => e.severity === "HIGH").length,
      atIssueKes: open.reduce((s, e) => s + Math.abs(Number(e.amountKes ?? 0)), 0),
    },
    lastCheckedAt: lastSweep._max.lastSeenAt,
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "reconciliation.resolve");
  if (denied) return denied;
  const orgId = session.user.orgId;
  const actor = session.user.id ?? "staff";

  let body: { action?: string; id?: string; note?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  if (body.action === "sweep") {
    const stats = await reconcileOrg(orgId);
    await prisma.auditLog.create({
      data: { orgId, actorId: session.user.id, actorType: "staff", action: "recon.sweep", entity: "ReconciliationException", entityId: orgId, meta: stats },
    }).catch(() => {});
    return NextResponse.json({ success: true, ...stats });
  }

  if (!body.id) return NextResponse.json({ success: false, message: "Which exception?" }, { status: 400 });
  const ex = await prisma.reconciliationException.findFirst({ where: { id: body.id, orgId } });
  if (!ex) return NextResponse.json({ success: false, message: "Exception not found." }, { status: 404 });

  if (body.action === "apply") {
    // Post the money the webhook failed to post. Only meaningful for a confirmed
    // STK payment that carries a loan; everything else is fixed elsewhere.
    if (ex.kind !== "STK_SUCCESS_UNAPPLIED") {
      return NextResponse.json({ success: false, message: "Only an unapplied M-Pesa payment can be applied." }, { status: 400 });
    }
    const intent = await prisma.paymentIntent.findFirst({ where: { id: ex.reference, orgId } });
    if (!intent || intent.state !== "SUCCESS") {
      return NextResponse.json({ success: false, message: "The payment behind this exception is gone or not confirmed." }, { status: 409 });
    }
    if (!intent.loanId) {
      return NextResponse.json({ success: false, message: "This payment has no loan attached — allocate it manually and resolve with a note." }, { status: 400 });
    }
    const ref = `STK:${intent.mpesaReceipt || intent.checkoutRequestId}`;
    // If the posting already exists (a race with the sweep, or a retried click),
    // do NOT credit the borrower twice — just close the exception honestly.
    const already = await prisma.auditLog.findFirst({
      where: { orgId, action: "repayment.allocate", meta: { path: ["ref"], equals: ref } },
      select: { id: true },
    });
    if (!already) {
      await allocateRepayment(intent.loanId, Number(intent.amount), ref);
    }
    await resolveException(orgId, ex.id, actor, "RESOLVED", already ? "already posted — closed without re-applying" : `applied to loan ${intent.loanId.slice(0, 8).toUpperCase()}`);
    await prisma.auditLog.create({
      data: { orgId, actorId: session.user.id, actorType: "staff", action: "recon.apply", entity: "ReconciliationException", entityId: ex.id, meta: { intentId: intent.id, loanId: intent.loanId, amount: Number(intent.amount), reApplied: !already } },
    }).catch(() => {});
    return NextResponse.json({ success: true, applied: !already });
  }

  if (body.action === "resolve" || body.action === "ignore") {
    const note = body.note?.trim();
    // No silent dismissals: this row may be the only record of a money decision.
    if (!note) return NextResponse.json({ success: false, message: "A note is required — say what was done, or why this is fine." }, { status: 400 });
    await resolveException(orgId, ex.id, actor, body.action === "resolve" ? "RESOLVED" : "IGNORED", note);
    await prisma.auditLog.create({
      data: { orgId, actorId: session.user.id, actorType: "staff", action: `recon.${body.action}`, entity: "ReconciliationException", entityId: ex.id, meta: { kind: ex.kind, note } },
    }).catch(() => {});
    return NextResponse.json({ success: true });
  }

  if (body.action === "reopen") {
    await resolveException(orgId, ex.id, actor, "OPEN");
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: false, message: "Unknown action." }, { status: 400 });
}
