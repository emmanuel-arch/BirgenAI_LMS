// The offer, from the lender's side.
//
//   GET  → the agreement and where it stands
//   POST → { action: "issue" | "record-branch-acceptance", note? }
//
// `record-branch-acceptance` exists because a real lender has walk-in customers who
// sign paper across a desk. Refusing to model that would not make the platform safer;
// it would push staff into pretending to be the borrower on the portal. So the branch
// path is first-class, attributed to the staff member by name, and marked BRANCH so a
// portal e-signature and a counter signature are never confused for one another.
//
// What staff CANNOT do is sign as the borrower. There is no endpoint that accepts an
// offer with channel PORTAL from a staff session — that path needs the code we sent
// to the borrower's own phone.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { createOfferForApplication, effectiveStatus, termsOf } from "@/lib/lending/offer";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "applications.view");
  if (denied) return denied;
  const { id } = await ctx.params;

  const offer = await prisma.loanOffer.findFirst({ where: { applicationId: id, orgId: session.user.orgId } });
  if (!offer) return NextResponse.json({ success: true, offer: null });

  const terms = termsOf(offer);
  return NextResponse.json({
    success: true,
    offer: {
      id: offer.id,
      status: effectiveStatus(offer),
      ...terms,
      borrowDate: offer.borrowDate,
      firstDueDate: offer.firstDueDate,
      expectedClearDate: offer.expectedClearDate,
      expiresAt: offer.expiresAt,
      schedule: offer.schedule,
      acceptedAt: offer.acceptedAt,
      channel: offer.channel,
      termsHash: offer.termsHash,
      recordedBy: offer.recordedBy,
      branchNote: offer.branchNote,
    },
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "applications.decide");
  if (denied) return denied;
  const { id } = await ctx.params;

  let body: { action?: string; note?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const app = await prisma.loanApplication.findFirst({
    where: { id, orgId: session.user.orgId },
    include: { offer: true, org: { select: { mode: true } } },
  });
  if (!app) return NextResponse.json({ success: false, message: "Application not found." }, { status: 404 });
  if (app.org.mode !== "NATIVE") {
    return NextResponse.json({ success: false, message: "Bridged books keep their paperwork in ServiceSuite." }, { status: 400 });
  }

  const tiers = session.user.tiers ?? { initiator: false, authorizer: false, validator: false };
  if (!tiers.initiator && !tiers.authorizer && !tiers.validator) {
    return NextResponse.json({ success: false, message: "Your role cannot action applications." }, { status: 403 });
  }

  // ── Re-issue: the previous offer lapsed or was declined ──────────────────────
  if (body.action === "issue") {
    if (app.offer && effectiveStatus(app.offer) === "OFFERED") {
      return NextResponse.json({ success: false, message: "A live offer is already with the borrower." }, { status: 409 });
    }
    if (app.offer?.status === "ACCEPTED") {
      return NextResponse.json({ success: false, message: "This offer is already signed." }, { status: 409 });
    }
    if (app.offer) {
      // An application holds one live agreement (applicationId is unique), so a
      // re-issue replaces the lapsed row. Its terms, hash and fate are already in
      // the audit log, which is where the history of an agreement belongs anyway.
      await prisma.auditLog.create({
        data: {
          orgId: app.orgId, actorId: session.user.id, actorType: "staff",
          action: "offer.supersede", entity: "LoanOffer", entityId: app.offer.id,
          meta: {
            applicationId: app.id, termsHash: app.offer.termsHash,
            status: effectiveStatus(app.offer), totalRepayable: Number(app.offer.totalRepayable),
          },
        },
      }).catch(() => {});
      await prisma.loanOffer.delete({ where: { id: app.offer.id } });
    }
    const created = await createOfferForApplication(app.id);
    if (!created) return NextResponse.json({ success: false, message: "Assign a product before issuing an offer." }, { status: 400 });
    await prisma.auditLog.create({
      data: { orgId: app.orgId, actorId: session.user.id, actorType: "staff", action: "offer.issue", entity: "LoanOffer", entityId: created.id, meta: { applicationId: app.id } },
    }).catch(() => {});
    return NextResponse.json({ success: true, offerId: created.id });
  }

  // ── Record a signature taken in person ───────────────────────────────────────
  if (body.action === "record-branch-acceptance") {
    if (!app.offer) return NextResponse.json({ success: false, message: "There is no offer to accept." }, { status: 400 });
    const status = effectiveStatus(app.offer);
    if (status !== "OFFERED") {
      return NextResponse.json({ success: false, message: `This offer is already ${status.toLowerCase()}.` }, { status: 409 });
    }
    const note = body.note?.trim();
    if (!note) {
      // The note IS the evidence — who signed, where, and what identification was
      // seen. An unexplained counter-acceptance is worth very little in a dispute.
      return NextResponse.json({ success: false, message: "Record how and where the borrower signed." }, { status: 400 });
    }

    await prisma.loanOffer.update({
      where: { id: app.offer.id },
      data: {
        status: "ACCEPTED", acceptedAt: new Date(), channel: "BRANCH",
        recordedBy: session.user.id, branchNote: note.slice(0, 500),
      },
    });
    await prisma.loanApplication.update({
      where: { id: app.id },
      data: { status: "OFFICER_REVIEW", stageTitle: "Offer accepted (in branch)" },
    });
    await prisma.auditLog.create({
      data: {
        orgId: app.orgId, actorId: session.user.id, actorType: "staff",
        action: "offer.accept.branch", entity: "LoanOffer", entityId: app.offer.id,
        ip: req.headers.get("x-forwarded-for"),
        meta: { applicationId: app.id, termsHash: app.offer.termsHash, note: note.slice(0, 500) },
      },
    }).catch(() => {});

    return NextResponse.json({ success: true, status: "ACCEPTED", channel: "BRANCH" });
  }

  return NextResponse.json({ success: false, message: "Unknown action." }, { status: 400 });
}
