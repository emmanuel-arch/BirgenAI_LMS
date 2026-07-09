// POST /api/portal/otp — send a verification code to a borrower's phone.
// Body: { lenderSlug, phone }
//
// Always answers the same way for any well-formed Kenyan number, whether or not
// that number is known to the lender. Anything else would turn this endpoint
// into a "does this person borrow here?" oracle.
import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { issueBorrowerOtp, OTP_TTL_SEC } from "@/lib/portal/otp";
import { toMsisdn, isKenyanMsisdn } from "@/lib/portal/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { lenderSlug?: string; phone?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const msisdn = toMsisdn(body.phone ?? "");
  if (!isKenyanMsisdn(msisdn)) {
    return NextResponse.json({ success: false, message: "Enter a valid Kenyan phone number." }, { status: 400 });
  }

  const org = await resolveOrg(body.lenderSlug ?? "");
  if (org) enterOrg(org.id);
  if (!org) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });

  // Every code is an SMS the lender pays for and a buzz on someone's phone. The
  // per-day bucket is what stops a boundary-straddling burst from the 15-minute
  // one; the IP bucket is deliberately loose because Kenyan mobile carriers NAT
  // very large numbers of subscribers behind one address.
  const limited = await rateLimit(
    [
      { name: "otp:issue:phone", subject: `${org.id}:${msisdn}`, max: 3, windowSec: 900 },
      { name: "otp:issue:phone:day", subject: `${org.id}:${msisdn}`, max: 8, windowSec: 86400 },
      { name: "otp:issue:ip", subject: clientIp(req), max: 20, windowSec: 3600 },
    ],
    "Too many codes requested for this number. Please wait before trying again.",
  );
  if (limited) return limited;

  const { delivered, devCode } = await issueBorrowerOtp(org.id, org.name, msisdn);

  return NextResponse.json({
    success: true,
    delivered,
    expiresInSec: OTP_TTL_SEC,
    // Present only outside production, and only when no provider could deliver.
    ...(devCode ? { devCode } : {}),
    message: delivered
      ? `We sent a 6-digit code to your phone.`
      : devCode
        ? `SMS is not configured — your code is ${devCode}.`
        : `We couldn't send the code right now. Please try again shortly.`,
  });
}
