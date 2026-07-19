// POST /api/lms/products — list a lender's active loan products for the borrower
// to pick from. Body: { lenderSlug }.
//   NATIVE orgs  → our Product table (the org's own product builder).
//   BRIDGED orgs → read-only against the lender's ServiceSuite DB.
// Degrades gracefully (products: []) when unconfigured/unreachable so the
// wizard can fall back to a manual amount entry.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { listProducts } from "@/lib/lms/servicesuite";

export const runtime = "nodejs";

// No auth: a lender's product catalogue is public marketing info, and borrowers
// on the white-label subdomains don't have accounts. Throttled anyway — for
// bridged orgs this reaches into the lender's own SQL Server.
export async function POST(req: NextRequest) {
  let body: { lenderSlug?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 });
  }

  const limited = await rateLimit([{ name: "products:ip", subject: clientIp(req), max: 60, windowSec: 3600 }]);
  if (limited) return limited;

  const org = await resolveOrg(body.lenderSlug ?? "");
  // Bind the RLS tenant in OUR async context (enterWith does not escape a callee).
  if (org) enterOrg(org.id);
  if (!org) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });

  // NATIVE orgs always sell from our product builder. A BRIDGED org normally
  // mirrors its lender's live shelf — but when it has products in OUR builder,
  // those are a CURATED shelf and they win (the Micromart pilot sells exactly
  // one product, MIROMART FINTECH, which lives in a separate ServiceSuite the
  // portal cannot list from). Emptying the local shelf restores the live mirror.
  const local = await prisma.product.findMany({
    where: { orgId: org.id, isActive: true },
    orderBy: [{ minPrincipal: "asc" }, { name: "asc" }],
    take: 100,
  });
  if (org.mode === "NATIVE" || local.length > 0) {
    const products = local.map((p) => {
      // Whole-term rates ("term") read better the way the lender quotes them:
      // per repayment period. 82.5% flat over 10 weeks → "8.25%/week".
      const perPeriod = p.interestPeriodUnit === "term" && p.repaymentPeriod > 0
        ? Math.round((Number(p.interestRate) / p.repaymentPeriod) * 100) / 100
        : null;
      return {
        id: p.id, // uuid — the wizard treats ids as opaque strings
        name: p.name,
        description: p.description,
        minPrincipal: Number(p.minPrincipal),
        maxPrincipal: Number(p.maxPrincipal),
        interestRate: perPeriod ?? Number(p.interestRate),
        interestUnit: perPeriod != null ? p.repaymentPeriodUnit : p.interestPeriodUnit,
        // Reducing-balance products reward early settlement; the wizard says so.
        interestMethod: p.interestMethod,
        // TO_THIRD_PARTY (school fees): the wizard asks for the institution's paybill.
        disbursementMode: p.disbursementMode,
        repaymentPeriod: p.repaymentPeriod,
        repaymentUnit: p.repaymentPeriodUnit,
        minCreditScore: p.minCreditScore,
      };
    });
    return NextResponse.json({ success: true, connected: true, lender: org.name, products });
  }

  if (!org.bridgedReady || !org.registry) {
    return NextResponse.json({ success: true, connected: false, lender: org.name, products: [] });
  }

  try {
    const products = await listProducts(org.registry, org.entityId);
    return NextResponse.json({ success: true, connected: true, lender: org.name, products });
  } catch {
    // DB hiccup — let the borrower proceed with a manual amount.
    return NextResponse.json({ success: true, connected: false, lender: org.name, products: [] });
  }
}
