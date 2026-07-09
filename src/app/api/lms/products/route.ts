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
import { listProducts } from "@/lib/lms/servicesuite";

export const runtime = "nodejs";

// No auth: a lender's product catalogue is public marketing info, and borrowers
// on the white-label subdomains don't have accounts.
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

  if (org.mode === "NATIVE") {
    const rows = await prisma.product.findMany({
      where: { orgId: org.id, isActive: true },
      orderBy: [{ minPrincipal: "asc" }, { name: "asc" }],
      take: 100,
    });
    const products = rows.map((p) => ({
      id: p.id, // uuid — the wizard treats ids as opaque strings
      name: p.name,
      description: p.description,
      minPrincipal: Number(p.minPrincipal),
      maxPrincipal: Number(p.maxPrincipal),
      interestRate: Number(p.interestRate),
      interestUnit: p.interestPeriodUnit,
      repaymentPeriod: p.repaymentPeriod,
      repaymentUnit: p.repaymentPeriodUnit,
      minCreditScore: p.minCreditScore,
    }));
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
