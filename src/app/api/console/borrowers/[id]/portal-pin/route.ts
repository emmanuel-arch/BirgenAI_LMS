// POST /api/console/borrowers/[id]/portal-pin — issue this customer a new portal PIN.
//
// The support call this exists for: "I can't get into the app." An officer with the
// customer on the phone presses one button, a fresh PIN goes to their handset and
// their inbox, and the call ends.
//
// THREE THINGS IT DELIBERATELY DOES NOT DO:
//
//   • It never shows the officer the PIN. The plaintext exists for exactly as long
//     as it takes to hand it to the SMS and email senders, and is then gone — only
//     the bcrypt hash is stored. An officer who can read a customer's credential can
//     also use it, and "the loan officer signed in as me" is not a sentence any
//     lender wants to defend. The confirmation says it was sent, not what it is.
//   • It does not confirm the customer's identity for you. Whoever pressed it is on
//     the audit row; the lender's own process decides who may.
//   • It does not reveal delivery failure as success. If neither channel could carry
//     it, the response says so, because a PIN nobody received is worse than no PIN —
//     the old one has already been replaced.
//
// Gated on `borrowers.manage` and the caller's data scope: an officer may only reset
// the PIN of a customer they could already open.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { resolveScope, canSeeBorrower } from "@/lib/rbac/scope";
import { prisma } from "@/lib/prisma";
import { issuePin, maskPhone } from "@/lib/portal/pin";
import { sendSms } from "@/lib/sms/send";
import { sendTemplatedEmail } from "@/lib/email/send";
import { emailBrandFor } from "@/lib/email/layout";
import { portalPinEmail } from "@/lib/email/templates";

export const runtime = "nodejs";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const denied = await requireRight(session, "borrowers.manage");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;
  const { id } = await ctx.params;

  const scope = await resolveScope(session!);
  if (!(await canSeeBorrower(scope, id))) {
    return NextResponse.json({ success: false, message: "Borrower not found." }, { status: 404 });
  }

  const b = await prisma.borrower.findFirst({
    where: { id, orgId, erasedAt: null },
    select: { id: true, phone: true, email: true, firstName: true, nationalId: true },
  });
  if (!b) return NextResponse.json({ success: false, message: "Borrower not found." }, { status: 404 });
  if (!b.nationalId) {
    // The PIN door is opened WITH a national ID. Issuing a PIN to someone whose
    // ID we don't hold creates a credential with no lock to fit — better to say so
    // than to send a code that can never be used.
    return NextResponse.json({
      success: false,
      message: "Add their national ID first — the portal asks for it before the PIN.",
    }, { status: 400 });
  }

  const pin = await issuePin(b.id);

  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { name: true } });
  const orgName = org?.name ?? "your lender";

  const smsId = await sendSms(orgId, b.phone, "portal_pin", { pin, org: orgName });
  let emailed = false;
  if (b.email) {
    const brand = await emailBrandFor(orgId);
    emailed = !!(await sendTemplatedEmail(
      orgId, b.email,
      portalPinEmail(brand, { name: b.firstName, email: b.email, pin }),
      "portal_pin",
    ));
  }

  await prisma.auditLog.create({
    data: {
      orgId, actorId: session!.user!.id, actorType: "staff",
      action: "borrower.portal-pin-reset",
      meta: { borrowerId: b.id, sms: !!smsId, email: emailed },
    },
  }).catch(() => {});

  const channels = [smsId ? `SMS to ${maskPhone(b.phone)}` : null, emailed ? `email to ${b.email}` : null].filter(Boolean);

  return NextResponse.json({
    success: true,
    // Never the PIN. See the header.
    delivered: channels.length > 0,
    message: channels.length
      ? `New PIN sent by ${channels.join(" and ")}.`
      : "The PIN was reset, but neither SMS nor email could deliver it. Check the messaging setup before telling the customer.",
  });
}
