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
import { prisma } from "@/lib/prisma";
import { runAsPlatform } from "@/lib/db/context";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { getBrand, type LenderBrand } from "@/lib/lms/branding";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const limited = await rateLimit(
    [{ name: "brand:ip", subject: clientIp(req), max: 120, windowSec: 900 }],
    "Slow down.",
  );
  if (limited) return limited;

  const slug = (req.nextUrl.searchParams.get("lender") ?? "").trim().toLowerCase();
  const base = getBrand(slug || null);
  if (!slug || !/^[a-z][a-z0-9-]{1,30}$/.test(slug)) {
    return NextResponse.json({ success: true, known: false, brand: base });
  }

  const org = await runAsPlatform(() =>
    prisma.org.findUnique({
      where: { slug },
      select: { name: true, status: true, accent: true, accentSoft: true, accent2: true, tagline: true, blurb: true, logoUrl: true },
    }),
  );
  if (!org || org.status === "SUSPENDED") {
    return NextResponse.json({ success: true, known: base.slug === slug, brand: base });
  }

  const brand: LenderBrand = {
    ...base,
    slug,
    name: org.name,
    accent: org.accent || base.accent,
    accentSoft: org.accentSoft || base.accentSoft,
    accent2: org.accent2 ?? base.accent2 ?? null,
    tagline: org.tagline || base.tagline,
    blurb: org.blurb || base.blurb,
    logo: org.logoUrl || base.logo,
    fallbackLogo: org.logoUrl || base.fallbackLogo,
  };
  return NextResponse.json({ success: true, known: true, brand });
}
