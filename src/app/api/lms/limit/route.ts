// POST /api/lms/limit — the borrower's approved limit for a product, previewed.
// Body: { lenderSlug, productRef, features }
//
// The amount step of the funnel calls this once the statement has been crunched
// and a product chosen, so the slider can stop at the ceiling BEFORE the customer
// picks a number they cannot have. Same engine, same inputs as the enforcement
// inside /api/lms/apply — this is the preview, that is the wall; they cannot
// disagree because they are one function (lib/lending/limits.ts).
//
// Verified borrower session required: the limit is derived from the caller's own
// history, and the phone comes from the OTP cookie — never the request body.
// Native books only; a bridged lender's exposure rules live in their own system.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { borrowerFor, otpRequired } from "@/lib/portal/session";
import { rateLimit } from "@/lib/ratelimit";
import { scoreThinFileAuto } from "@/lib/statement/score-thinfile";
import type { CashflowFeatures } from "@/lib/statement/features";
import { fuseScores } from "@/lib/scoring/fusion";
import { computeApprovedLimit } from "@/lib/lending/limits";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { lenderSlug?: string; productRef?: string; features?: CashflowFeatures };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const org = await resolveOrg(body.lenderSlug ?? "");
  if (org) enterOrg(org.id);
  if (!org) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });
  if (org.mode !== "NATIVE") {
    return NextResponse.json({ success: true, available: false, message: "Limits are set by your lender." });
  }

  const verified = await borrowerFor(org.id);
  if (!verified) return otpRequired();
  const phone = verified.phone;

  const limited = await rateLimit([{ name: "limit:phone", subject: `${org.id}:${phone}`, max: 30, windowSec: 900 }]);
  if (limited) return limited;

  if (!body.features) {
    return NextResponse.json({ success: false, message: "Run the M-Pesa statement check first." }, { status: 400 });
  }
  const product = await prisma.product.findFirst({
    where: { id: String(body.productRef ?? ""), orgId: org.id, isActive: true },
    select: { minPrincipal: true, maxPrincipal: true, interestRate: true, repaymentPeriod: true, repaymentPeriodUnit: true, minLoanLimit: true },
  });
  if (!product) return NextResponse.json({ success: false, message: "Choose a product." }, { status: 400 });

  // The same server-authoritative score the apply route computes — the preview
  // must never flatter, or the wall at apply reads as a betrayal. `features` is
  // client-supplied JSON, so a mangled payload is a 400, never a crash.
  let thinFile: ReturnType<typeof scoreThinFileAuto>;
  try {
    thinFile = scoreThinFileAuto(body.features);
  } catch {
    return NextResponse.json({ success: false, message: "The statement features are incomplete — run the M-Pesa statement check again." }, { status: 400 });
  }

  const row = await prisma.borrower.findFirst({

    where: { orgId: org.id, phone: { endsWith: phone.slice(-9) } },
    select: { id: true },
  });
  let priorLoanCount = 0;
  let graduated = false;
  let largestCleared: number | null = null;
  if (row) {
    const [cleared, active, biggest] = await Promise.all([
      prisma.loan.count({ where: { orgId: org.id, borrowerId: row.id, status: "CLEARED" } }),
      prisma.loan.count({ where: { orgId: org.id, borrowerId: row.id, status: { in: ["ACTIVE", "PENDING_DISBURSEMENT"] } } }),
      prisma.loan.aggregate({ where: { orgId: org.id, borrowerId: row.id, status: "CLEARED" }, _max: { principal: true } }),
    ]);
    priorLoanCount = cleared;
    graduated = cleared >= 5 && active === 0;
    largestCleared = biggest._max.principal != null ? Number(biggest._max.principal) : null;
  }

  // Mirror apply exactly: the fusion step (origination is null on a native book,
  // so this is the thin-file PD run through the same decision bands apply uses).
  const fused = fuseScores({ thinFilePd: thinFile.pd, originationPd: null, hasHistory: graduated || priorLoanCount > 0 });

  const limit = computeApprovedLimit({
    pd: fused.pd,
    decision: fused.decision,
    avgMonthlyNet: Number((body.features as { avgMonthlyNet?: number }).avgMonthlyNet) || null,
    priorLoanCount,
    graduated,
    largestCleared,
    productMin: Number(product.minPrincipal),
    productMax: Number(product.maxPrincipal),
    productRate: Number(product.interestRate),
    repaymentPeriod: product.repaymentPeriod,
    repaymentPeriodUnit: product.repaymentPeriodUnit,
    minLoanLimit: product.minLoanLimit != null ? Number(product.minLoanLimit) : null,
  });

  return NextResponse.json({
    success: true,
    available: true,
    approvedLimit: limit.approvedLimit,
    borrowerClass: limit.borrowerClass,
    reasons: limit.reasons,
    affordableInstallment: limit.affordableInstallment,
    installmentCount: limit.installmentCount,
    installmentUnit: limit.installmentUnit,
  });
}
