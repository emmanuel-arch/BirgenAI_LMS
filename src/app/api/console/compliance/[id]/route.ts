// POST /api/console/compliance/[id] — decide a data-subject request.
//
//   { action: "approve" }  the second pair of eyes. For an erasure this also
//                          EXECUTES it: an approved-but-not-yet-run erasure is a
//                          promise to a customer that a crashed cron could break,
//                          and there is nothing to schedule — it takes a second.
//   { action: "reject", reason }  refused, with a reason, on the record.
//
// THE CHECKER MAY NOT BE THE MAKER. The one exception is a solo operator (a single
// active staff member), where there is no second person to ask — see
// src/lib/compliance/register.ts.
//
// ORG_DELETION is not decidable here at all. An org admin may ASK to have their
// tenant wiped; only BirgenAI may do it, from /platform. A console that could
// delete its own lender is a console one compromised admin session away from
// deleting a lender.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { eraseBorrower } from "@/lib/compliance/erasure";
import { isSoloOperator, auditCompliance } from "@/lib/compliance/register";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const denied = await requireRight(session, "compliance.manage");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;
  const staffId = session!.user!.id;
  const { id } = await ctx.params;

  const request = await prisma.complianceRequest.findFirst({ where: { id, orgId } });
  if (!request) return NextResponse.json({ success: false, message: "Request not found." }, { status: 404 });
  if (request.status !== "PENDING") {
    return NextResponse.json({ success: false, message: `This request is already ${request.status.toLowerCase()}.` }, { status: 409 });
  }

  let body: { action?: string; reason?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  if (body.action === "reject") {
    const reason = (body.reason ?? "").trim();
    if (reason.length < 10) {
      return NextResponse.json({ success: false, message: "Say why it was refused — the customer is entitled to a reason." }, { status: 400 });
    }
    await prisma.complianceRequest.update({
      where: { id },
      data: { status: "REJECTED", decidedById: staffId, decidedAt: new Date(), result: { ...(request.result as object ?? {}), rejectedBecause: reason } },
    });
    await auditCompliance(orgId, staffId, "compliance.rejected", id, { kind: request.kind, reason });
    return NextResponse.json({ success: true });
  }

  if (body.action !== "approve") {
    return NextResponse.json({ success: false, message: "Unknown action." }, { status: 400 });
  }

  // A tenant wipe is BirgenAI's to execute, never the lender's own console.
  if (request.kind === "ORG_DELETION") {
    return NextResponse.json(
      { success: false, message: "An organisation deletion is carried out by BirgenAI, not from this console. The request has been sent." },
      { status: 403 },
    );
  }

  // THE SECOND PAIR OF EYES.
  if (request.requestedById === staffId && !(await isSoloOperator(orgId))) {
    return NextResponse.json(
      { success: false, message: "You raised this request, so somebody else has to approve it. That is the point of it." },
      { status: 403 },
    );
  }

  if (request.kind !== "BORROWER_ERASURE" || !request.subjectId) {
    return NextResponse.json({ success: false, message: "This request has nothing to execute." }, { status: 400 });
  }

  // Approve and run in one motion. The erasure re-assesses from live data as it
  // goes, so an approval given yesterday cannot execute yesterday's plan.
  try {
    const outcome = await eraseBorrower(orgId, request.subjectId);
    await prisma.complianceRequest.update({
      where: { id },
      data: {
        status: "COMPLETED",
        decidedById: staffId,
        decidedAt: new Date(),
        completedAt: new Date(),
        result: { ...(request.result as object ?? {}), outcome },
      },
    });
    await auditCompliance(orgId, staffId, "compliance.erasure-executed", id, {
      borrowerId: request.subjectId,
      mode: outcome.mode,
      objectsDeleted: outcome.objectsDeleted,
      rowsDeleted: outcome.rowsDeleted,
      rowsAnonymised: outcome.rowsAnonymised,
    });
    return NextResponse.json({ success: true, outcome });
  } catch (err) {
    // A failed erasure is kept as FAILED, never silently retried: a half-erased
    // customer is a state a human needs to look at, not a job to re-queue.
    const message = err instanceof Error ? err.message : "The erasure failed.";
    await prisma.complianceRequest.update({
      where: { id },
      data: { status: "FAILED", decidedById: staffId, decidedAt: new Date(), result: { ...(request.result as object ?? {}), error: message } },
    });
    await auditCompliance(orgId, staffId, "compliance.erasure-failed", id, { borrowerId: request.subjectId, error: message });
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
