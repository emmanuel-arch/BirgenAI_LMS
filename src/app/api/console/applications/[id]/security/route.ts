// Guarantors and collateral, from the lender's side.
//
//   GET  → who stands behind this application, what secures it, and whether that is enough
//   POST → { action: "invite-guarantor" | "remind" | "remove-guarantor"
//                  | "add-collateral" | "verify-collateral" | "reject-collateral" }
//
// Staff can ASK someone to guarantee a loan. Staff can never consent on their behalf:
// there is no action here that sets a guarantor to CONSENTED, and the only path that
// does needs a code sent to the guarantor's own phone.
//
// Verifying collateral is different, and deliberately so. Somebody has to physically
// look at the lorry, and that somebody is a named staff member whose name goes into
// the audit log beside the valuation they accepted.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toMsisdn, isKenyanMsisdn } from "@/lib/portal/session";
import { inviteGuarantor, effectiveGuarantorStatus, standsBehind, GuarantorError } from "@/lib/lending/guarantor";
import { checkSecurity } from "@/lib/lending/security";

export const runtime = "nodejs";

const KINDS = ["VEHICLE", "LAND", "EQUIPMENT", "STOCK", "CHATTEL", "OTHER"];

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const orgId = session.user.orgId;
  const { id } = await ctx.params;

  const app = await prisma.loanApplication.findFirst({
    where: { id, orgId },
    include: { product: true, offer: true, guarantors: { orderBy: { invitedAt: "asc" } } },
  });
  if (!app) return NextResponse.json({ success: false, message: "Application not found." }, { status: 404 });

  const collateral = await prisma.collateral.findMany({ where: { orgId, applicationId: id }, orderBy: { createdAt: "asc" } });
  const security = app.product
    ? await checkSecurity(id, Number(app.amountRequested), app.product)
    : null;

  const termsHash = app.offer?.termsHash ?? null;
  const guarantors = app.guarantors.map((g) => ({
    id: g.id, fullName: g.fullName, phone: g.phone, relationship: g.relationship,
    status: effectiveGuarantorStatus(g),
    // A consent bound to a superseded agreement is not a consent to this one.
    stale: !!termsHash && effectiveGuarantorStatus(g) === "CONSENTED" && !standsBehind(g, termsHash),
    consentedAt: g.consentedAt, expiresAt: g.expiresAt,
    amountGuaranteed: g.amountGuaranteed ? Number(g.amountGuaranteed) : null,
  }));

  return NextResponse.json({
    success: true,
    guarantorRequired: app.product?.guarantorRequired ?? false,
    hasStandingGuarantor: !!termsHash && app.guarantors.some((g) => standsBehind(g, termsHash)),
    hasOffer: !!app.offer,
    guarantors,
    collateral: collateral.map((c) => ({
      id: c.id, kind: c.kind, description: c.description,
      estimatedValueKes: Number(c.estimatedValueKes), registrationRef: c.registrationRef,
      status: c.status, verifiedAt: c.verifiedAt, rejectedReason: c.rejectedReason,
    })),
    security,
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const orgId = session.user.orgId;
  const { id } = await ctx.params;

  let body: {
    action?: string; fullName?: string; phone?: string; nationalId?: string; relationship?: string;
    guarantorId?: string; collateralId?: string; kind?: string; description?: string;
    estimatedValueKes?: number; registrationRef?: string; reason?: string;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const app = await prisma.loanApplication.findFirst({ where: { id, orgId }, select: { id: true, borrowerId: true } });
  if (!app) return NextResponse.json({ success: false, message: "Application not found." }, { status: 404 });

  const tiers = session.user.tiers ?? { initiator: false, authorizer: false, validator: false };
  if (!tiers.initiator && !tiers.authorizer && !tiers.validator) {
    return NextResponse.json({ success: false, message: "Your role cannot action applications." }, { status: 403 });
  }

  const audit = (action: string, entity: string, entityId: string, meta?: Record<string, unknown>) =>
    prisma.auditLog.create({
      data: { orgId, actorId: session.user!.id, actorType: "staff", action, entity, entityId, meta: meta as never, ip: req.headers.get("x-forwarded-for") },
    }).catch(() => {});

  // ── Guarantors ───────────────────────────────────────────────────────────────
  if (body.action === "invite-guarantor") {
    const phone = toMsisdn(body.phone ?? "");
    if (!isKenyanMsisdn(phone)) return NextResponse.json({ success: false, message: "Enter a valid Safaricom number." }, { status: 400 });
    if (!body.fullName?.trim()) return NextResponse.json({ success: false, message: "Enter their name." }, { status: 400 });

    try {
      const { id: gid, delivered } = await inviteGuarantor({
        applicationId: id, fullName: body.fullName, phone,
        nationalId: body.nationalId, relationship: body.relationship, invitedBy: session.user.id,
      });
      await audit("guarantor.invite", "Guarantor", gid, { applicationId: id, phone });
      return NextResponse.json({
        success: true, guarantorId: gid, delivered,
        message: delivered ? "We texted them the request." : "Saved, but no SMS provider is configured — call them.",
      });
    } catch (err) {
      const message = err instanceof GuarantorError ? err.message : "Could not send the request.";
      return NextResponse.json({ success: false, message }, { status: 400 });
    }
  }

  if (body.action === "remove-guarantor") {
    const g = await prisma.guarantor.findFirst({ where: { id: body.guarantorId ?? "", orgId, applicationId: id } });
    if (!g) return NextResponse.json({ success: false, message: "Not found." }, { status: 404 });
    // A given consent is evidence. Withdraw the request, never erase the answer.
    if (effectiveGuarantorStatus(g) === "CONSENTED") {
      return NextResponse.json({ success: false, message: "They already consented. That record stays." }, { status: 409 });
    }
    await prisma.guarantor.delete({ where: { id: g.id } });
    await audit("guarantor.remove", "Guarantor", g.id, { applicationId: id });
    return NextResponse.json({ success: true });
  }

  // ── Collateral ───────────────────────────────────────────────────────────────
  if (body.action === "add-collateral") {
    const kind = KINDS.includes(body.kind ?? "") ? body.kind! : null;
    const value = Number(body.estimatedValueKes);
    if (!kind) return NextResponse.json({ success: false, message: `kind must be one of ${KINDS.join(", ")}.` }, { status: 400 });
    if (!body.description?.trim()) return NextResponse.json({ success: false, message: "Describe the security." }, { status: 400 });
    if (!Number.isFinite(value) || value <= 0) return NextResponse.json({ success: false, message: "Enter what it is worth." }, { status: 400 });

    const c = await prisma.collateral.create({
      data: {
        orgId, applicationId: id, borrowerId: app.borrowerId,
        kind: kind as never, description: body.description.trim().slice(0, 300),
        estimatedValueKes: value, registrationRef: body.registrationRef?.trim() || null,
      },
    });
    await audit("collateral.register", "Collateral", c.id, { applicationId: id, kind, value });
    return NextResponse.json({ success: true, collateralId: c.id });
  }

  if (body.action === "verify-collateral" || body.action === "reject-collateral") {
    const c = await prisma.collateral.findFirst({ where: { id: body.collateralId ?? "", orgId, applicationId: id } });
    if (!c) return NextResponse.json({ success: false, message: "Not found." }, { status: 404 });
    if (c.status !== "REGISTERED") return NextResponse.json({ success: false, message: `Already ${c.status.toLowerCase()}.` }, { status: 409 });

    const verifying = body.action === "verify-collateral";
    if (!verifying && !body.reason?.trim()) {
      return NextResponse.json({ success: false, message: "Say why you are rejecting it." }, { status: 400 });
    }

    await prisma.collateral.update({
      where: { id: c.id },
      data: verifying
        ? { status: "VERIFIED", verifiedBy: session.user.id, verifiedAt: new Date() }
        : { status: "REJECTED", rejectedReason: body.reason!.trim().slice(0, 300) },
    });
    // The valuation a named person accepted, recorded beside their name.
    await audit(verifying ? "collateral.verify" : "collateral.reject", "Collateral", c.id, {
      applicationId: id, kind: c.kind, value: Number(c.estimatedValueKes), reason: body.reason ?? null,
    });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: false, message: "Unknown action." }, { status: 400 });
}
