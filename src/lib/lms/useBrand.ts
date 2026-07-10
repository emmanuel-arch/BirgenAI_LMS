"use client";

// DB-first lender branding for the borrower portal.
//
// Paints instantly from the static registry (legacy lenders stay pixel-stable
// with zero flicker), then swaps in the org's own logo/colors from
// /api/lms/brand — which is how a lender that onboarded five minutes ago gets
// a branded portal without anyone deploying anything.
import { useState } from "react";
import { useLoad } from "@/lib/hooks/useLoad";
import { getBrand, type LenderBrand } from "./branding";

/** Subdomain labels that are platform surfaces, never lender slugs. */
const RESERVED_SUBDOMAINS = new Set(["www", "api", "lms", "app", "admin", "console", "hub", "birgenai", "login", "onboard", "platform", "localhost"]);

/** The lender slug implied by the address bar: subdomain first, ?lender= second. */
export function lenderFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  const label = window.location.hostname.split(".")[0]?.toLowerCase() ?? "";
  // Any non-reserved subdomain is a candidate — /api/lms/brand decides whether
  // it's a real lender (new orgs must work the moment they onboard).
  if (label && !RESERVED_SUBDOMAINS.has(label) && !/^\d+$/.test(label)) return label;
  const q = new URLSearchParams(window.location.search).get("lender");
  return q || null;
}

export function useBrand(slug: string | null | undefined): LenderBrand {
  const [brand, setBrand] = useState<LenderBrand>(() => getBrand(slug));
  useLoad(async () => {
    setBrand(getBrand(slug)); // repaint the static base whenever the slug changes
    if (!slug) return;
    try {
      const res = await fetch(`/api/lms/brand?lender=${encodeURIComponent(slug)}`);
      const data = await res.json();
      if (data?.success && data.brand) setBrand(data.brand as LenderBrand);
    } catch { /* the static brand stands */ }
  }, [slug]);
  return brand;
}
