// POST /api/portal/otp/verify — exchange a code for a borrower session.
// Body: { lenderSlug, phone, code }
//
// On success the phone becomes server-authoritative: it lives in an httpOnly
// cookie, and from here on the portal routes read it from there rather than from
// whatever the client sends.
import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { verifyBorrowerOtp } from "@/lib/portal/otp";
import { createBorrowerSession, toMsisdn, isKenyanMsisdn } from "@/lib/portal/session";

export const runtime = "nodejs";

const MESSAGES = {
  invalid: "That code isn't right. Check the SMS and try again.",
  expired: "That code has expired. Request a new one.",
  locked: "Too many wrong attempts. Request a new code.",
} as const;

export async function POST(req: NextRequest) {
  let body: { lenderSlug?: string; phone?: string; code?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const msisdn = toMsisdn(body.phone ?? "");
  const code = (body.code ?? "").trim();
  if (!isKenyanMsisdn(msisdn) || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ success: false, message: "Enter the 6-digit code we sent you." }, { status: 400 });
  }

  const org = await resolveOrg(body.lenderSlug ?? "");
  if (org) enterOrg(org.id);
  if (!org) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });

  // The per-challenge attempt counter already burns a code after 5 wrong
  // guesses. This stops the other attack: burn a code, request another, repeat.
  const limited = await rateLimit([
    { name: "otp:verify:phone", subject: `${org.id}:${msisdn}`, max: 10, windowSec: 900 },
    { name: "otp:verify:ip", subject: clientIp(req), max: 40, windowSec: 3600 },
  ]);
  if (limited) return limited;

  const result = await verifyBorrowerOtp(org.id, msisdn, code);
  if (!result.ok) {
    return NextResponse.json({ success: false, reason: result.reason, message: MESSAGES[result.reason] }, { status: 401 });
  }

  await createBorrowerSession({ orgId: org.id, orgSlug: org.slug, phone: msisdn });
  return NextResponse.json({ success: true, phone: msisdn, lender: org.name });
}
