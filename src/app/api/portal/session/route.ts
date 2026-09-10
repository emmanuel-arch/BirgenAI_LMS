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
//
// ── IT ALSO RETURNS THE NATIONAL ID, AND HERE IS WHY ─────────────────────────
// The borrower app needs a national ID to call most of these routes, and it was
// keeping the only copy in the browser's `sessionStorage` — which dies with the
// tab. The app then had a signed-in customer it could not fetch anything for:
// every screen sat on "Checking with your lender…" for ever, with no request and
// no error, because the client refuses to call without one. Two doors led there
// — closing the tab, and signing in with the SMS password, which never asks for
// an ID at all.
//
// The fix belongs on this side. The cookie already identifies the borrower well
// enough to find their record, so the ID is something this endpoint KNOWS. A
// client that has to remember it is a client that can forget it.
//
// It is deliberately best-effort: this GET is what the whole app boots on, and a
// database blip answering it with a 500 would sign every customer out. If the
// lookup fails, the response is exactly what it was before and the app runs on
// the routes that can work from the cookie alone.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readBorrowerSession, destroyBorrowerSession, maskMsisdn, toMsisdn } from "@/lib/portal/session";

export const runtime = "nodejs";

/**
 * The national ID on the borrower record this session belongs to.
 *
 * Matched the same way /api/portal/pay matches it — org plus the last nine
 * digits of the verified phone — so this cannot hand back an ID that route
 * would then disagree with. Newest record wins, for the same reason it does
 * there: a borrower re-registered after a correction has two rows and the later
 * one is the true one.
 *
 * Never throws. See the note above about what a 500 here would cost.
 */
async function nationalIdFor(orgId: string, phone: string): Promise<string | null> {
  try {
    const borrower = await prisma.borrower.findFirst({
      where: { orgId, phone: { endsWith: phone.slice(-9) } },
      orderBy: { createdAt: "desc" },
      select: { nationalId: true },
    });
    return borrower?.nationalId ?? null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const s = await readBorrowerSession();
  if (!s) return NextResponse.json({ authenticated: false });

  const asked = req.nextUrl.searchParams.get("phone");
  const nationalId = await nationalIdFor(s.orgId, s.phone);

  return NextResponse.json({
    authenticated: true,
    lenderSlug: s.orgSlug,
    phoneMasked: maskMsisdn(s.phone),
    // Omitted rather than sent as null when there is no record to read it from,
    // so a caller cannot tell "we looked and there is none" apart from "we could
    // not look" and act on the difference. Both mean the same thing to the app:
    // carry on without it.
    ...(nationalId ? { nationalId } : {}),
    ...(asked ? { matchesPhone: toMsisdn(asked) === s.phone } : {}),
  });
}

export async function DELETE() {
  await destroyBorrowerSession();
  return NextResponse.json({ success: true });
}
