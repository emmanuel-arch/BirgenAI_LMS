// POST /api/lms/eligibility  — graduated-customer check for the lms portal.
// Body: { lenderSlug, phone, nationalId? }
// Read-only against the lender's ServiceSuite DB. Degrades gracefully if the DB
// is unreachable (returns available:false so the borrower can still apply as new).

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getOrg, getEntityId, isOrgConfigured } from "@/lib/enterprise/connections";
import { checkGraduation } from "@/lib/lms/servicesuite";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Session is OPTIONAL: borrowers on the white-label lender subdomains identify
  // by phone + national ID, not a Hub account. Anonymous responses are masked.
  const session = await auth();
  const isAuthed = !!session?.user?.id;

  let body: { lenderSlug?: string; phone?: string; nationalId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 });
  }

  const phone = (body.phone ?? "").trim();
  if (!phone) return NextResponse.json({ success: false, message: "Enter your phone number." }, { status: 400 });

  const org = getOrg(body.lenderSlug ?? "");
  if (!org || org.isAdmin) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });

  // If the lender's DB isn't reachable/configured, let the borrower proceed as new.
  if (!isOrgConfigured(org)) {
    return NextResponse.json({ success: true, available: false, graduated: false, lender: org.name });
  }

  try {
    const grad = await checkGraduation(org, getEntityId(org), phone, body.nationalId);
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
      // Anonymous callers get the first name only (greeting), never the full
      // record — and no internal borrower id. Posting re-matches server-side.
      borrowerName: isAuthed ? grad.borrowerName : (grad.borrowerName?.split(" ")[0] ?? null),
      serviceSuiteBorrowerId: isAuthed ? grad.borrowerId : undefined,
    });
  } catch {
    // DB hiccup — don't block the funnel.
    return NextResponse.json({ success: true, available: false, graduated: false, lender: org.name });
  }
}
