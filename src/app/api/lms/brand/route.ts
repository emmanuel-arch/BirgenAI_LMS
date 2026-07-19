// GET /api/lms/brand?lender=<slug> — public, anonymous.
//
// The borrower portal's branding source. The static registry in
// src/lib/lms/branding.ts keeps the legacy lenders (micromart/axe/buysimu)
// pixel-stable, but every org that onboards through the wizard lives in the
// database — this route lets the portal wear THEIR logo and colors on their
// subdomain without a code change. DB values win when set; the registry (or
// the BirgenAI default) fills the gaps.
//
// Returns brand data only — never products, never money, never status beyond
// "does this lender exist". Safe to serve anonymously; still rate-limited.
import { NextRequest, NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { resolveLenderBrand } from "@/lib/lms/brand-server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const limited = await rateLimit(
    [{ name: "brand:ip", subject: clientIp(req), max: 120, windowSec: 900 }],
    "Slow down.",
  );
  if (limited) return limited;

  const slug = (req.nextUrl.searchParams.get("lender") ?? "").trim().toLowerCase();
  const { known, brand } = await resolveLenderBrand(slug);
  return NextResponse.json({ success: true, known, brand });
}
