// The guarantor's side of the agreement.
//
//   GET  /api/portal/guarantee/[id]   → what they are being asked to stand behind
//   POST /api/portal/guarantee/[id]   → { action: "request-code" | "consent" | "decline", code? }
//
// Reached from an SMS, so there is no session. Two things authorise: holding the
// invitation's uuid (it was texted to their phone) and possessing that phone (the
// one-time code). Neither alone is enough to make somebody liable for a stranger's
// debt, and together they are the same standard the borrower's own signature meets.
//
// The GET is deliberately thin on personal data. A guarantor needs to know who is
// asking, for how much, and over what period — enough to decide. They do not need
// the borrower's national ID, their credit score, or their other loans, and a
// stranger who guesses a uuid should learn as little as possible.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enterOrg } from "@/lib/db/context";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { maskMsisdn } from "@/lib/portal/session";
import {
  resolveGuarantorOrg, requestGuarantorCode, consentGuarantor, declineGuarantor,
  effectiveGuarantorStatus, GuarantorError,
} from "@/lib/lending/guarantor";

export const runtime = "nodejs";

// `enterOrg` uses AsyncLocalStorage.enterWith, which does NOT propagate out of an
// async callee — set it from inside a helper and the handler that called the helper
// still has no tenant. So every handler here resolves the org, then binds it itself.
// (The borrower portal routes take the same care after resolveOrg.)

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  // A uuid is unguessable, but the endpoint is public. Rate-limit anyway.
  const limited = await rateLimit([{ name: "guarantee:read:ip", subject: clientIp(req), max: 60, windowSec: 3600 }]);
  if (limited) return limited;

  const orgId = await resolveGuarantorOrg(id);
  if (!orgId) return NextResponse.json({ success: false, message: "Invitation not found." }, { status: 404 });
  enterOrg(orgId);

  const g = await prisma.guarantor.findUnique({
    where: { id },
    include: {
      org: { select: { name: true } },
      borrower: { select: { firstName: true } },
      application: { include: { offer: true } },
    },
  });
  if (!g) return NextResponse.json({ success: false, message: "Invitation not found." }, { status: 404 });

  const offer = g.application.offer;
  const status = effectiveGuarantorStatus(g);

  return NextResponse.json({
    success: true,
    guarantee: {
      id: g.id,
      status,
      lender: g.org.name,
      yourName: g.fullName,
      yourPhone: maskMsisdn(g.phone),
      borrowerFirstName: g.borrower.firstName ?? "the borrower",
      relationship: g.relationship,
      expiresAt: g.expiresAt,
      consentedAt: g.consentedAt,
      // Null until the borrower has an agreement. You cannot stand behind nothing.
      agreement: offer
        ? {
            principal: Number(offer.principal),
            totalRepayable: Number(offer.totalRepayable),
            termCount: offer.termCount,
            termUnit: offer.termUnit,
            firstDueDate: offer.firstDueDate,
            expectedClearDate: offer.expectedClearDate,
            borrowerSigned: offer.status === "ACCEPTED",
          }
        : null,
    },
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let body: { action?: string; code?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const orgId = await resolveGuarantorOrg(id);
  if (!orgId) return NextResponse.json({ success: false, message: "Invitation not found." }, { status: 404 });
  enterOrg(orgId);

  if (body.action === "decline") {
    await declineGuarantor(id, clientIp(req));
    return NextResponse.json({ success: true, status: "DECLINED" });
  }

  if (body.action === "request-code") {
    const limited = await rateLimit([
      { name: "guarantee:code:id", subject: `${orgId}:${id}`, max: 3, windowSec: 900 },
      { name: "guarantee:code:ip", subject: clientIp(req), max: 20, windowSec: 3600 },
    ]);
    if (limited) return limited;

    try {
      const { delivered, devCode } = await requestGuarantorCode(id);
      return NextResponse.json({
        success: true, codeSent: true, delivered, ...(devCode ? { devCode } : {}),
        message: delivered ? "We sent a code to your phone." : "Could not send the code.",
      });
    } catch (err) {
      const message = err instanceof GuarantorError ? err.message : "Could not send the code.";
      return NextResponse.json({ success: false, message }, { status: 400 });
    }
  }

  if (body.action === "consent") {
    const limited = await rateLimit([
      { name: "guarantee:consent:id", subject: `${orgId}:${id}`, max: 10, windowSec: 900 },
      { name: "guarantee:consent:ip", subject: clientIp(req), max: 40, windowSec: 3600 },
    ]);
    if (limited) return limited;

    const result = await consentGuarantor(id, (body.code ?? "").trim(), {
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });
    if (!result.ok) return NextResponse.json({ success: false, reason: result.reason, message: result.message }, { status: 401 });
    return NextResponse.json({ success: true, status: "CONSENTED" });
  }

  return NextResponse.json({ success: false, message: "Unknown action." }, { status: 400 });
}
