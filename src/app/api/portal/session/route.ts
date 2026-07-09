// GET    /api/portal/session — is this browser a verified borrower?
// DELETE /api/portal/session — sign out ("not you?").
//
// Lets the funnel, /myloan and /verify resume across a page reload — and lets
// them skip re-issuing a code the borrower already used — instead of burning an
// SMS (and the borrower's 3-per-15-minutes budget) on every back-navigation.
//
// The phone comes back masked: the cookie is the credential, not the number.
// `?phone=` answers only "is this the number you already verified?", which tells
// a caller who already holds the cookie nothing it could not read from its own
// session.
import { NextRequest, NextResponse } from "next/server";
import { readBorrowerSession, destroyBorrowerSession, maskMsisdn, toMsisdn } from "@/lib/portal/session";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const s = await readBorrowerSession();
  if (!s) return NextResponse.json({ authenticated: false });

  const asked = req.nextUrl.searchParams.get("phone");
  return NextResponse.json({
    authenticated: true,
    lenderSlug: s.orgSlug,
    phoneMasked: maskMsisdn(s.phone),
    ...(asked ? { matchesPhone: toMsisdn(asked) === s.phone } : {}),
  });
}

export async function DELETE() {
  await destroyBorrowerSession();
  return NextResponse.json({ success: true });
}
