// ─────────────────────────────────────────────────────────────────────────────
// POST /api/pwa/quote — Micromart's customer PWA prices a loan at a CHOSEN period.
//
// Headers: Authorization: Bearer <the customer's Micromart session token>
// Body:    { productId, principal, period }
//   →      { success, product: { id, name, repaymentPeriod, unit, periodChoice },
//            period, Table: [summary], Table1: [schedule] }
//
// Table / Table1 use the column names of Micromart's own LoanPreview, so the PWA
// renders this unchanged. Reached same-origin through the PWA's vercel.json
// rewrite. See lib/pwa/micromart-pwa.ts.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { verifyCustomer, servedProduct, checkTerms, quoteLoan } from "@/lib/pwa/micromart-pwa";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { productId?: number; principal?: number; period?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const limited = await rateLimit(
    [{ name: "pwa:quote:ip", subject: clientIp(req), max: 120, windowSec: 600 }],
    "Too many requests from here. Please wait a moment and try again.",
  );
  if (limited) return limited;

  const who = await verifyCustomer(req);
  if (!who.ok) return NextResponse.json({ success: false, reason: who.reason, message: who.message }, { status: who.status });

  const product = await servedProduct(Number(body.productId)).catch(() => null);
  if (!product) return NextResponse.json({ success: false, reason: "product", message: "That product is not available right now." }, { status: 400 });

  const principal = Math.round(Number(body.principal));
  const period = body.period == null ? product.repaymentPeriod : Number(body.period);
  const bad = checkTerms(product, who.customer, principal, period);
  if (bad) return NextResponse.json({ success: false, reason: bad.reason, message: bad.message }, { status: bad.status });

  try {
    const quote = await quoteLoan(product, principal, period);
    return NextResponse.json({
      success: true,
      product: { id: product.id, name: product.name, repaymentPeriod: product.repaymentPeriod, unit: product.unit, periodChoice: product.periodChoice },
      ...quote,
    });
  } catch {
    return NextResponse.json({ success: false, reason: "unreachable", message: "We could not price this loan just now. Please try again." }, { status: 502 });
  }
}
