// POST /api/lms/eligibility — graduated-customer check for the borrower portal.
// Body: { lenderSlug }
//   NATIVE orgs  → our own book (Borrower + Loan tables).
//   BRIDGED orgs → read-only against the lender's ServiceSuite DB.
// Degrades gracefully (available:false) so the borrower can still apply as new.
//
// REQUIRES a verified borrower session. This endpoint answers "how many loans
// has the holder of this number cleared, and what is their name" — served to
// anyone who could type a phone number, it was an enumeration oracle over the
// lender's entire customer base. The phone now comes from the OTP cookie, so the
// only record you can look up is your own.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { borrowerFor, otpRequired } from "@/lib/portal/session";
import { checkGraduation } from "@/lib/lms/servicesuite";

export const runtime = "nodejs";

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

  const verified = await borrowerFor(org.id);
  if (!verified) return otpRequired();
  const phone = verified.phone;

  // NATIVE: graduation from our own loan book.
  if (org.mode === "NATIVE") {
    // Matched on the VERIFIED phone alone. There used to be an `OR nationalId`
    // branch here; with a session it would have let a verified borrower pull up
    // a stranger's record by typing the stranger's ID number.
    const row = await prisma.borrower.findFirst({
      where: { orgId: org.id, phone: { endsWith: phone.slice(-9) } },
      orderBy: { createdAt: "desc" },
    });
    if (!row) {
      return NextResponse.json({ success: true, available: true, found: false, graduated: false, lender: org.name });
    }
    const [clearedLoans, activeLoans] = await Promise.all([
      prisma.loan.count({ where: { orgId: org.id, borrowerId: row.id, status: "CLEARED" } }),
      prisma.loan.count({ where: { orgId: org.id, borrowerId: row.id, status: { in: ["ACTIVE", "PENDING_DISBURSEMENT"] } } }),
    ]);
    const name = `${row.firstName ?? ""} ${row.otherName ?? ""}`.trim();
    return NextResponse.json({
      success: true,
      available: true,
      found: true,
      lender: org.name,
      graduated: clearedLoans >= 5 && activeLoans === 0,
      clearedLoans,
      activeLoans,
      // Safe to return in full: the caller proved they hold this number.
      borrowerName: name || null,
    });
  }

  // BRIDGED: the lender's ServiceSuite DB (unchanged behavior).
  if (!org.bridgedReady || !org.registry) {
    return NextResponse.json({ success: true, available: false, graduated: false, lender: org.name });
  }

  try {
    const grad = await checkGraduation(org.registry, org.entityId, phone);
    if (!grad) {
      return NextResponse.json({ success: true, available: true, found: false, graduated: false, lender: org.name });
    }
    return NextResponse.json({
      success: true,
      available: true,
      found: true,
      lender: org.name,
      graduated: grad.graduated,
      clearedLoans: grad.clearedLoans,
      activeLoans: grad.activeLoans,
      borrowerName: grad.borrowerName || null,
      // The lender's internal borrower id stays server-side. `apply` re-derives
      // it from the verified phone rather than accepting it back from a client.
    });
  } catch {
    // DB hiccup — don't block the funnel.
    return NextResponse.json({ success: true, available: false, graduated: false, lender: org.name });
  }
}
