// POST /api/portal/my-loan — borrower self-service loan lookup.
// Body: { lenderSlug, nationalId } — the phone comes from the verified OTP
// session; the national ID remains a second factor (possession + knowledge), so
// a SIM swap alone does not open someone's loan book. Output is masked.
// NATIVE orgs only — bridged books live in the lender's ServiceSuite.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { borrowerFor, otpRequired } from "@/lib/portal/session";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { lenderSlug?: string; nationalId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const nationalId = (body.nationalId ?? "").trim();
  if (!nationalId) {
    return NextResponse.json({ success: false, message: "Enter your national ID." }, { status: 400 });
  }

  const org = await resolveOrg(body.lenderSlug ?? "");
  // Bind the RLS tenant in OUR async context (enterWith does not escape a callee).
  if (org) enterOrg(org.id);
  if (!org) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });

  const verified = await borrowerFor(org.id);
  if (!verified) return otpRequired();
  const phone = verified.phone;

  // The ID is the remaining guessable factor — cap the guesses.
  const limited = await rateLimit([
    { name: "myloan:phone", subject: `${org.id}:${phone}`, max: 10, windowSec: 900 },
    { name: "myloan:ip", subject: clientIp(req), max: 60, windowSec: 3600 },
  ]);
  if (limited) return limited;

  if (org.mode !== "NATIVE") {
    return NextResponse.json({ success: true, found: false, bridged: true, lender: org.name, message: `Your ${org.name} loan is managed on the lender's own system — check with them or the main portal.` });
  }

  const borrower = await prisma.borrower.findFirst({
    where: { orgId: org.id, phone: { endsWith: phone.slice(-9) }, nationalId },
    orderBy: { createdAt: "desc" },
  });
  if (!borrower) return NextResponse.json({ success: true, found: false, lender: org.name });

  const loan = await prisma.loan.findFirst({
    where: { orgId: org.id, borrowerId: borrower.id, status: { in: ["ACTIVE", "PENDING_DISBURSEMENT"] } },
    orderBy: { borrowDate: "desc" },
    include: {
      product: { select: { name: true } },
      installments: { where: { status: { in: ["UPCOMING", "DUE", "PARTIAL", "OVERDUE"] } }, orderBy: { seq: "asc" }, take: 1 },
    },
  });

  const cleared = await prisma.loan.count({ where: { orgId: org.id, borrowerId: borrower.id, status: "CLEARED" } });

  if (!loan) {
    return NextResponse.json({
      success: true, found: true, lender: org.name,
      firstName: borrower.firstName, activeLoan: null, clearedLoans: cleared,
    });
  }

  const next = loan.installments[0] ?? null;
  return NextResponse.json({
    success: true,
    found: true,
    lender: org.name,
    firstName: borrower.firstName,
    clearedLoans: cleared,
    activeLoan: {
      ref: loan.id.slice(0, 8).toUpperCase(),
      product: loan.product.name,
      status: loan.status,
      loanAmount: Number(loan.loanAmount),
      balance: Number(loan.balance),
      expectedClearDate: loan.expectedClearDate?.toISOString().slice(0, 10) ?? null,
      nextDue: next
        ? {
            date: next.dueDate.toISOString().slice(0, 10),
            amount: Math.max(0, Number(next.amountDue) + Number(next.penalty) - Number(next.amountPaid)),
          }
        : null,
    },
  });
}
