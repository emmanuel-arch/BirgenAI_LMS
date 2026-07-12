// POST /api/console/kyc/vouch — a human overrides a face the machine couldn't confirm.
//
// The honest failure mode of automated KYC in Kenya: a national ID issued fifteen
// years ago carries a photograph of a teenager, and the face-match model scores the
// forty-year-old at the counter as a stranger. The machine is not wrong about the
// pixels; it is wrong about the person. Someone senior looks at both images and
// says "that is him" — and puts their name on it.
//
// Three rules keep this an accountability feature and not a back door:
//
//   1. IT CANNOT OVERRIDE THE REGISTRY. A vouch answers "is this face that face?" —
//      a question a human is genuinely better at than a model reading a worn photo.
//      It does not answer "does this ID exist?" — if IPRS said no, no amount of
//      seniority makes the record real, and the vouch is refused.
//   2. THE NOTE IS MANDATORY and the override is written three ways: a VOUCH
//      KycCheck on the session (with the scores it overrode), an AuditLog row under
//      the voucher's own staffId, and the session status itself.
//   3. IT IS A SEPARATE RIGHT (`kyc.vouch`), not part of kyc.verify — the officer
//      who ran the failed check and the person who overrides it should not have to
//      be the same pair of hands.
import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { resolveScope, canSeeBorrower } from "@/lib/rbac/scope";
import { attachKycSession } from "@/lib/kyc/attach";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "kyc.vouch");
  if (denied) return denied;
  const orgId = session.user.orgId;
  const staffId = session.user.id;

  let body: { sessionId?: string; note?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const note = (body.note ?? "").trim();
  if (note.length < 10) {
    return NextResponse.json({ success: false, message: "Say why you are vouching — the note goes on the permanent record (at least 10 characters)." }, { status: 400 });
  }

  const s = await prisma.kycSession.findFirst({ where: { id: String(body.sessionId ?? ""), orgId } });
  if (!s) return NextResponse.json({ success: false, message: "Verification session not found." }, { status: 404 });
  if (!s.borrowerId) return NextResponse.json({ success: false, message: "This session isn't linked to a customer yet." }, { status: 409 });
  if (s.status === "VERIFIED") return NextResponse.json({ success: false, message: "This customer is already verified." }, { status: 409 });
  if (s.status !== "PENDING_REVIEW" && s.status !== "FAILED") {
    return NextResponse.json({ success: false, message: "Only a completed check that needs review can be vouched for." }, { status: 409 });
  }

  // The line a vouch cannot cross: the government registry.
  if (s.iprsMatched === false) {
    return NextResponse.json({
      success: false,
      message: "The national registry has no matching record for this ID. A vouch can confirm a face — it cannot make an ID real. This one needs the document re-checked.",
    }, { status: 409 });
  }

  const scope = await resolveScope(session);
  if (!(await canSeeBorrower(scope, s.borrowerId))) {
    return NextResponse.json({ success: false, message: "That customer isn't in your scope." }, { status: 403 });
  }

  const borrower = await prisma.borrower.findFirst({
    where: { id: s.borrowerId, orgId },
    select: { id: true, phone: true, firstName: true, otherName: true, nationalId: true },
  });
  if (!borrower) return NextResponse.json({ success: false, message: "Customer not found." }, { status: 404 });

  const overrode = {
    previousStatus: s.status,
    faceMatchScore: s.faceMatchScore,
    livenessScore: s.livenessScore,
    livenessPassed: s.livenessPassed,
    riskFlags: s.riskFlags ?? [],
  };

  // The override, in the same trail as the checks it overrides.
  await prisma.kycCheck.create({
    data: {
      orgId, sessionId: s.id, borrowerId: s.borrowerId,
      kind: "VOUCH", passed: true, score: null,
      payload: { note, vouchedBy: staffId, overrode } as unknown as Prisma.InputJsonValue,
    },
  });
  await prisma.kycSession.update({
    where: { id: s.id },
    data: { status: "VERIFIED", completedAt: s.completedAt ?? new Date() },
  });

  // Promote onto the Borrower through the same code every other verification uses.
  const attached = await attachKycSession(orgId, borrower.id, borrower.phone, borrower.nationalId);

  await prisma.auditLog.create({
    data: {
      orgId, actorId: staffId, actorType: "staff", action: "kyc.vouch",
      entity: "Borrower", entityId: borrower.id,
      meta: { sessionId: s.id, note, overrode } as unknown as Prisma.InputJsonValue,
      ip: req.headers.get("x-forwarded-for"),
    },
  }).catch(() => {});

  const name = `${borrower.firstName ?? ""} ${borrower.otherName ?? ""}`.trim() || borrower.phone;
  return NextResponse.json({
    success: true,
    message: `${name} is verified on your word — the override is on the record under your name.`,
    attached: attached?.status === "VERIFIED",
  });
}
