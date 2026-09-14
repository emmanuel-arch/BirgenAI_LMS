// ─────────────────────────────────────────────────────────────────────────────
// GET /api/portal/journey?lenderSlug= — the lender's onboarding rules for the app,
// and where this signed-in customer stands in them.
//
// The customer app's KYC Verification, Statement Cruncher and Apply Now screens
// render from this one answer. The contract half is built by the same function
// the console counter reads (lib/config/onboarding-contract.ts), so a rail, a
// field, a selfie rule or a location requirement a lender changes in Borrower
// settings reaches both screens on the next request.
//
// Safe for a handset by construction: the contract carries no thresholds and no
// credentials (see that file's header), and the status is the caller's own.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { borrowerFor, otpRequired } from "@/lib/portal/session";
import { portalContract, journeyStatus } from "@/lib/portal/journey";
import { findBookBorrower } from "@/lib/portal/micromart-book";

export const runtime = "nodejs";

/**
 * Is this phone already a customer on the lender's own book?
 *
 * The password door proves it (the session carries their ServiceSuite id). The
 * code door does not, and an existing customer who chose the code must not be
 * walked through onboarding as though they were new — so the book is asked, by
 * the same cached phone match Home uses. A failed lookup answers "not known to
 * be existing", which costs them a KYC screen rather than inventing an account.
 */
async function onLenderBook(org: NonNullable<Awaited<ReturnType<typeof resolveOrg>>>, phone: string, hasLocal: boolean): Promise<boolean> {
  if (hasLocal || org.mode === "NATIVE" || !org.registry || !org.entityId) return false;
  try {
    return (await findBookBorrower(org.registry, org.entityId, phone)).kind === "found";
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const org = await resolveOrg(req.nextUrl.searchParams.get("lenderSlug") ?? "");
  if (!org) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });
  enterOrg(org.id);

  const session = await borrowerFor(org.id);
  if (!session) return otpRequired();

  const [contract, status] = await Promise.all([portalContract(org), journeyStatus(org, session.phone)]);
  const existingCustomer =
    session.ssBorrowerId != null ||
    status.borrower?.lenderLinked === true ||
    (await onLenderBook(org, session.phone, Boolean(status.borrower)));

  return NextResponse.json({
    success: true,
    lender: org.name,
    contract,
    status,
    // An existing customer of the lender is not onboarding: their identity lives
    // on the lender's book already, whichever door they came in by.
    existingCustomer,
  });
}
