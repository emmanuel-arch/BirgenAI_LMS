// Server-side lender brand resolution — DB values win, the static registry
// (or the BirgenAI default) fills the gaps. This is the ONE place the merge
// lives: /api/lms/brand serves it to the borrower portal, and the org-scoped
// staff login at /[org] renders it server-side (no flicker, no extra fetch).
import { prisma } from "@/lib/prisma";
import { runAsPlatform } from "@/lib/db/context";
import { getBrand, type LenderBrand } from "./branding";

export type ResolvedBrand = { known: boolean; brand: LenderBrand };

export async function resolveLenderBrand(slugRaw: string | null | undefined): Promise<ResolvedBrand> {
  const slug = (slugRaw ?? "").trim().toLowerCase();
  const base = getBrand(slug || null);
  if (!slug || !/^[a-z][a-z0-9-]{1,30}$/.test(slug)) {
    return { known: false, brand: base };
  }

  const org = await runAsPlatform(() =>
    prisma.org.findUnique({
      where: { slug },
      select: { name: true, status: true, accent: true, accentSoft: true, accent2: true, tagline: true, blurb: true, logoUrl: true, logoScale: true },
    }),
  );
  if (!org || org.status === "SUSPENDED") {
    return { known: base.slug === slug, brand: base };
  }

  return {
    known: true,
    brand: {
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
      logoScale: org.logoScale || base.logoScale || 100,
    },
  };
}
