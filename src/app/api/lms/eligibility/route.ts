// POST /api/lms/eligibility — graduated-customer check for the borrower portal.
// Body: { lenderSlug, phone, nationalId? }
//   NATIVE orgs  → our own book (Borrower + Loan tables).
//   BRIDGED orgs → read-only against the lender's ServiceSuite DB.
// Degrades gracefully (available:false) so the borrower can still apply as new.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { checkGraduation } from "@/lib/lms/servicesuite";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Session is OPTIONAL: borrowers identify by phone + national ID inside the
  // wizard. Anonymous responses are masked (first name, no internal ids).
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

  const org = await resolveOrg(body.lenderSlug ?? "");
  // Bind the RLS tenant in OUR async context (enterWith does not escape a callee).
  if (org) enterOrg(org.id);
  if (!org) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });

  // NATIVE: graduation from our own loan book.
  if (org.mode === "NATIVE") {
    const phoneKey = phone.replace(/\D/g, "");
    const borrower = await prisma.borrower.findFirst({
      where: {
        orgId: org.id,
        OR: [
          { phone: phoneKey },
          { phone: { endsWith: phoneKey.slice(-9) } },
          ...(body.nationalId?.trim() ? [{ nationalId: body.nationalId.trim() }] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
    });
    if (!borrower) {
      return NextResponse.json({ success: true, available: true, found: false, graduated: false, lender: org.name });
    }
    const [clearedLoans, activeLoans] = await Promise.all([
      prisma.loan.count({ where: { orgId: org.id, borrowerId: borrower.id, status: "CLEARED" } }),
      prisma.loan.count({ where: { orgId: org.id, borrowerId: borrower.id, status: { in: ["ACTIVE", "PENDING_DISBURSEMENT"] } } }),
    ]);
    const name = `${borrower.firstName ?? ""} ${borrower.otherName ?? ""}`.trim();
    return NextResponse.json({
      success: true,
      available: true,
      found: true,
      lender: org.name,
      graduated: clearedLoans >= 5 && activeLoans === 0,
      clearedLoans,
      activeLoans,
      borrowerName: isAuthed ? name || null : (name.split(" ")[0] || null),
    });
  }

  // BRIDGED: the lender's ServiceSuite DB (unchanged behavior).
  if (!org.bridgedReady || !org.registry) {
    return NextResponse.json({ success: true, available: false, graduated: false, lender: org.name });
  }

  try {
    const grad = await checkGraduation(org.registry, org.entityId, phone, body.nationalId);
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
