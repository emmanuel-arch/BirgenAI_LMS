// ─────────────────────────────────────────────────────────────────────────────
// POST /api/portal/crunch/escalate — "this IS my statement": a case for a person.
//
// Body: { lenderSlug, statementName, reason }
//
// The cruncher refuses a statement whose holder is not the customer, and the
// customer cannot overrule it — that is the fraud gate. But M-PESA is often
// registered under ONE of a person's registry names, or a maiden name, and a
// refusal with no appeal turns a genuine customer away for a clerical fact.
//
// So the refusal has a door: a conversation on the customer's file, carrying the
// name the statement printed, the name we hold and the customer's own reason, in
// the KYC queue an officer already works. The officer can vouch, ask for proof,
// or refuse — and every one of those is a human, on the record.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { borrowerFor, otpRequired } from "@/lib/portal/session";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { findOrOpenThread, postMessage } from "@/lib/conversation/threads";
import { portalBorrowerId } from "@/lib/portal/borrower";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { lenderSlug?: string; statementName?: string; reason?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const org = await resolveOrg(body.lenderSlug ?? "");
  if (!org) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });
  enterOrg(org.id);

  const session = await borrowerFor(org.id);
  if (!session) return otpRequired();

  const limited = await rateLimit([{ name: "crunch-escalate:phone", subject: `${org.id}:${session.phone}`, max: 4, windowSec: 3600 }]);
  if (limited) return limited;

  const reason = (body.reason ?? "").trim();
  if (reason.length < 10) {
    return NextResponse.json({ success: false, field: "reason", message: "Tell us in a sentence why the name on the statement is different." }, { status: 400 });
  }

  const borrowerId = await portalBorrowerId(org, session);
  if (!borrowerId) {
    return NextResponse.json({ success: false, message: "Verify your identity first, then we can look at this with you." }, { status: 409 });
  }
  const who = await prisma.borrower.findUnique({ where: { id: borrowerId }, select: { firstName: true, otherName: true } });
  const heldName = [who?.firstName, who?.otherName].filter(Boolean).join(" ").trim() || "the name on your account";
  const statementName = (body.statementName ?? "").trim().slice(0, 80) || "a different name";

  const thread = await findOrOpenThread({
    orgId: org.id,
    borrowerId,
    kind: "KYC_REVIEW",
    subject: "Statement name check",
    stageTitle: "Statement review",
  });

  await postMessage({
    orgId: org.id,
    threadId: thread.id,
    authorType: "system",
    authorName: "Micro Eazy",
    body: `The M-PESA statement uploaded is registered to “${statementName}”, but this account is in the name of ${heldName}. The statement was not scored. An officer will review and either vouch for it, ask for proof, or ask for a different statement.`,
    event: "kyc.referred",
    eventData: { check: "statement-name", statementName, heldName },
  });
  const message = await postMessage({
    orgId: org.id,
    threadId: thread.id,
    authorType: "borrower",
    authorId: borrowerId,
    authorName: heldName,
    body: reason.slice(0, 1500),
  });

  await prisma.auditLog.create({
    data: {
      orgId: org.id, actorId: borrowerId, actorType: "borrower", action: "crunch.name-escalated",
      entity: "ConversationThread", entityId: thread.id, ip: clientIp(req),
      meta: { statementName, heldName },
    },
  }).catch(() => {});

  return NextResponse.json({
    success: true,
    threadId: thread.id,
    caseRef: `SN-${thread.id.slice(0, 8).toUpperCase()}`,
    at: message.createdAt,
  });
}
