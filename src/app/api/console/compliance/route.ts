// The compliance register.
//
//   GET  → the retention schedule (policy + what is due tonight) and the register
//          of data-subject requests.
//   POST → raise a request:
//            { kind: "BORROWER_ERASURE", borrowerId, reason }
//            { kind: "ORG_DELETION", reason }
//          Exports are NOT raised here — they are a download, and they live on
//          /api/console/compliance/export. This endpoint is for the things that
//          destroy data, and destroying data waits for a second person.
//
// MAKER-CHECKER, exactly as the disbursement queue does it: the person who asks
// is not the person who approves. Solo-operator orgs (one active staff member)
// may approve their own, because a one-man lender who cannot honour a DPA request
// has a worse problem than the one this rule prevents.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { resolveScope, canSeeBorrower } from "@/lib/rbac/scope";
import { RETENTION_POLICY, retentionDue } from "@/lib/compliance/retention";
import { assessErasure } from "@/lib/compliance/erasure";
import { subjectLabel } from "@/lib/compliance/export";
import { isSoloOperator, auditCompliance } from "@/lib/compliance/register";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  const denied = await requireRight(session, "compliance.view");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;

  const [requests, due, solo] = await Promise.all([
    prisma.complianceRequest.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    // RLS stamps app.org_id on every transaction this client opens, so these counts
    // are THIS lender's rows — the same query the cron runs platform-wide. The
    // lender sees what is about to age out of their own book, which is the only
    // version of the number that means anything to them.
    retentionDue(),
    isSoloOperator(orgId),
  ]);

  const staff = await prisma.staffUser.findMany({
    where: { orgId, id: { in: [...new Set(requests.flatMap((r) => [r.requestedById, r.decidedById].filter((x): x is string => !!x)))] } },
    select: { id: true, firstName: true, otherName: true },
  });
  const nameOf = new Map(staff.map((s) => [s.id, [s.firstName, s.otherName].filter(Boolean).join(" ")]));

  return NextResponse.json({
    success: true,
    solo,
    policy: RETENTION_POLICY,
    due,
    requests: requests.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      subjectId: r.subjectId,
      subjectLabel: r.subjectLabel,
      reason: r.reason,
      requestedBy: r.requestedById ? nameOf.get(r.requestedById) ?? "—" : "—",
      decidedBy: r.decidedById ? nameOf.get(r.decidedById) ?? "—" : null,
      decidedAt: r.decidedAt,
      completedAt: r.completedAt,
      result: r.result,
      createdAt: r.createdAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const denied = await requireRight(session, "compliance.manage");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;

  let body: { kind?: string; borrowerId?: string; reason?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const reason = (body.reason ?? "").trim();
  // The note is mandatory and it is not a formality: this row is what an ODPC
  // inspector reads to understand why a customer's file was destroyed.
  if (reason.length < 10) {
    return NextResponse.json(
      { success: false, message: "Say why this was requested — at least a sentence. It goes on the record." },
      { status: 400 },
    );
  }

  if (body.kind === "ORG_DELETION") {
    const existing = await prisma.complianceRequest.findFirst({
      where: { orgId, kind: "ORG_DELETION", status: { in: ["PENDING", "APPROVED"] } },
    });
    if (existing) {
      return NextResponse.json({ success: false, message: "A deletion request for this organisation is already open." }, { status: 409 });
    }
    const request = await prisma.complianceRequest.create({
      data: {
        orgId, kind: "ORG_DELETION", status: "PENDING", reason,
        requestedById: session!.user!.id,
        // Nobody inside the lender may execute this. It goes to the platform.
        result: { note: "Awaiting BirgenAI. A tenant wipe is executed by the platform, never from inside the lender's own console." },
      },
    });
    await auditCompliance(orgId, session!.user!.id, "compliance.org-deletion-requested", request.id, { reason });
    return NextResponse.json({ success: true, id: request.id, message: "Requested. BirgenAI will be in touch before anything is deleted." });
  }

  if (body.kind === "BORROWER_ERASURE") {
    const borrowerId = String(body.borrowerId ?? "");
    const scope = await resolveScope(session!);
    if (!borrowerId || !(await canSeeBorrower(scope, borrowerId))) {
      return NextResponse.json({ success: false, message: "Borrower not found." }, { status: 404 });
    }

    const assessment = await assessErasure(orgId, borrowerId);
    if (!assessment) return NextResponse.json({ success: false, message: "Borrower not found." }, { status: 404 });
    if (assessment.alreadyErased) {
      return NextResponse.json({ success: false, message: "This customer has already been erased." }, { status: 409 });
    }

    const open = await prisma.complianceRequest.findFirst({
      where: { orgId, kind: "BORROWER_ERASURE", subjectId: borrowerId, status: { in: ["PENDING", "APPROVED"] } },
    });
    if (open) return NextResponse.json({ success: false, message: "An erasure request for this customer is already open." }, { status: 409 });

    const request = await prisma.complianceRequest.create({
      data: {
        orgId, kind: "BORROWER_ERASURE", status: "PENDING", reason,
        subjectId: borrowerId,
        subjectLabel: await subjectLabel(orgId, borrowerId),
        requestedById: session!.user!.id,
        // The assessment is frozen onto the request so the approver sees the same
        // consequences the requester did. It is RECOMPUTED at execution — an
        // approval must never carry out a plan that has since gone stale.
        result: { assessedAt: new Date().toISOString(), mode: assessment.mode, summary: assessment.summary, retains: assessment.retains },
      },
    });
    await auditCompliance(orgId, session!.user!.id, "compliance.erasure-requested", request.id, { borrowerId, mode: assessment.mode, reason });
    return NextResponse.json({ success: true, id: request.id, assessment });
  }

  return NextResponse.json({ success: false, message: "Unknown request kind." }, { status: 400 });
}
