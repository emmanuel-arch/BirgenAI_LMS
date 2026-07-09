// POST /api/lms/customer-info — the borrower's own "Customer 360" profile, shown
// after their phone number matches the lender's database (the trust step: the
// portal mirrors what the lender's LMS knows about them). Body: { lenderSlug }.
// Read-only against ServiceSuite.
//
// REQUIRES a verified borrower session; the phone comes from the OTP cookie.
// Sensitive identifiers are still masked and the internal borrower id is never
// returned — defence in depth, since the profile carries a photo, an officer, a
// branch, a credit score and an outstanding balance.

import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { borrowerFor, otpRequired } from "@/lib/portal/session";
import { getCustomer360 } from "@/lib/lms/servicesuite";

export const runtime = "nodejs";

const maskId = (id: string | null) =>
  id && id.length >= 5 ? `${id.slice(0, 2)}${"•".repeat(Math.max(3, id.length - 4))}${id.slice(-2)}` : id;
const maskEmail = (e: string | null) => {
  if (!e || !e.includes("@") || e === "#") return null;
  const [user, domain] = e.split("@");
  return `${user.slice(0, 2)}•••@${domain}`;
};

export async function POST(req: NextRequest) {
  let body: { lenderSlug?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 });
  }

  const org = await resolveOrg(body.lenderSlug ?? "");
  // Bind the RLS tenant in OUR async context (enterWith does not escape a callee).
  if (org) enterOrg(org.id);
  if (!org) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });

  // The whole profile — photo, officer, branch, credit score, loan limit,
  // outstanding balance — for the holder of the verified phone, and no one else.
  const verified = await borrowerFor(org.id);
  if (!verified) return otpRequired();

  // NATIVE orgs: no ServiceSuite profile — the wizard skips the 360 step.
  // (A native Customer-360 from our own Borrower/Loan tables lands with the
  // borrowers module.)
  if (org.mode === "NATIVE" || !org.bridgedReady || !org.registry) {
    return NextResponse.json({ success: true, found: false, lender: org.name });
  }

  try {
    const c = await getCustomer360(org.registry, org.entityId, verified.phone);
    if (!c) return NextResponse.json({ success: true, found: false, lender: org.name });

    // Never expose the internal borrower id — posting re-matches server-side.
    const { borrowerId, ...profile } = c;
    void borrowerId;
    return NextResponse.json({
      success: true,
      found: true,
      lender: org.name,
      customer: { ...profile, nationalId: maskId(profile.nationalId), email: maskEmail(profile.email) },
    });
  } catch {
    // Lender DB hiccup — the wizard skips the profile step and continues.
    return NextResponse.json({ success: true, found: false, lender: org.name });
  }
}
