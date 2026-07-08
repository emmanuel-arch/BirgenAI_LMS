// POST /api/lms/customer-info — the borrower's own "Customer 360" profile, shown
// after their phone number matches the lender's database (the trust step: the
// portal mirrors what the lender's LMS knows about them). Body: { lenderSlug,
// phone, nationalId? }. Read-only against ServiceSuite.
//
// This is borrower-facing and reachable without a Hub session (white-label
// subdomains), so sensitive identifiers are MASKED and the internal borrower id
// is never returned — posting re-matches server-side at submission.
// TODO(hardening): phone-OTP proof-of-possession before public launch.

import { NextRequest, NextResponse } from "next/server";
import { getOrg, getEntityId, isOrgConfigured } from "@/lib/enterprise/connections";
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
  if (!isOrgConfigured(org)) return NextResponse.json({ success: true, found: false, lender: org.name });

  try {
    const c = await getCustomer360(org, getEntityId(org), phone, body.nationalId);
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
