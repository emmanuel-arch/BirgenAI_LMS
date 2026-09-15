// ─────────────────────────────────────────────────────────────────────────────
// POST /api/pwa/apply — Micromart's customer PWA applies for a loan at the
// period the customer chose, into the product's own ServiceSuite workflow.
//
// Headers: Authorization: Bearer <the customer's Micromart session token>
// Body:    { productId, principal, period }
//   →      { success, loanId, stage, workflowId, selectedPeriod, message }
//
// The lender's gate (sp_ValidateLoanApplication) runs first, then sp_InsertLoan
// with @SelectedPeriod — which, for Micromart Fintech products, parks the loan at
// the first stage of workflow 1022. Not idempotent and never retried: see
// applyLoan in lib/pwa/micromart-pwa.ts.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { verifyCustomer, servedProduct, checkTerms, applyLoan } from "@/lib/pwa/micromart-pwa";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { productId?: number; principal?: number; period?: number; acceptedTerms?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  if (body.acceptedTerms !== true) {
    return NextResponse.json({ success: false, reason: "terms", message: "You must accept the terms and conditions." }, { status: 400 });
  }

  const who = await verifyCustomer(req);
  if (!who.ok) return NextResponse.json({ success: false, reason: who.reason, message: who.message }, { status: who.status });

  const limited = await rateLimit(
    [
      { name: "pwa:apply:borrower", subject: String(who.customer.borrowerId), max: 5, windowSec: 3600 },
      { name: "pwa:apply:ip", subject: clientIp(req), max: 20, windowSec: 3600 },
    ],
    "You have tried to apply several times just now. Please wait a little and try again.",
  );
  if (limited) return limited;

  const product = await servedProduct(Number(body.productId)).catch(() => null);
  if (!product) return NextResponse.json({ success: false, reason: "product", message: "That product is not available right now." }, { status: 400 });

  const principal = Math.round(Number(body.principal));
  const period = body.period == null ? product.repaymentPeriod : Number(body.period);
  const bad = checkTerms(product, who.customer, principal, period);
  if (bad) return NextResponse.json({ success: false, reason: bad.reason, message: bad.message }, { status: bad.status });

  const result = await applyLoan(who.customer, product, principal, period).catch(() => null);
  if (!result) {
    // The booking may or may not have been written — say so, never "failed".
    return NextResponse.json(
      { success: false, reason: "unknown", message: "We could not confirm your application. Please check My Loans before applying again." },
      { status: 502 },
    );
  }
  if (!result.ok) return NextResponse.json({ success: false, reason: result.reason, message: result.message }, { status: result.status });

  return NextResponse.json({
    success: true,
    loanId: result.loanId,
    stage: result.stage,
    workflowId: result.workflowId,
    selectedPeriod: result.selectedPeriod,
    approved: result.approved,
    message: result.message,
  });
}
