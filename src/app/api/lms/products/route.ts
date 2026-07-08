// POST /api/lms/products — list a lender's active loan products for the borrower
// to pick from. Body: { lenderSlug }. Read-only against the lender's ServiceSuite
// DB. Degrades gracefully (returns products: []) when the lender isn't connected
// or the DB is unreachable, so the wizard can fall back to a manual amount entry.

import { NextRequest, NextResponse } from "next/server";
import { getOrg, getEntityId, isOrgConfigured } from "@/lib/enterprise/connections";
import { listProducts } from "@/lib/lms/servicesuite";

export const runtime = "nodejs";

// No auth: a lender's product catalogue is public marketing info, and borrowers
// on the white-label subdomains don't have Hub accounts.
export async function POST(req: NextRequest) {
  let body: { lenderSlug?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 });
  }

  const org = getOrg(body.lenderSlug ?? "");
  if (!org || org.isAdmin) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });

  if (!isOrgConfigured(org)) {
    return NextResponse.json({ success: true, connected: false, lender: org.name, products: [] });
  }

  try {
    const products = await listProducts(org, getEntityId(org));
    return NextResponse.json({ success: true, connected: true, lender: org.name, products });
  } catch {
    // DB hiccup — let the borrower proceed with a manual amount.
    return NextResponse.json({ success: true, connected: false, lender: org.name, products: [] });
  }
}
