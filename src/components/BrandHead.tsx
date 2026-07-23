"use client";

// Swaps the browser-tab favicon (and, optionally, the document title) to a
// lender's own logo on surfaces that resolve their brand at runtime — the staff
// console and the borrower portal. Server routes that know the brand up front set
// this via generateMetadata instead; this covers the client-rendered cases.
//
// The DEFAULT tab icon (no lender) is the BirgenAI logo.png, set in the root
// layout metadata — never the old triangle favicon.
import { useEffect } from "react";

export default function BrandHead({ logoUrl, title }: { logoUrl?: string | null; title?: string | null }) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (title) document.title = title;
    if (!logoUrl) return;

    // Reuse a dedicated link so we don't stack duplicates across navigations.
    let link = document.querySelector<HTMLLinkElement>('link[data-brand-icon="1"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      link.setAttribute("data-brand-icon", "1");
      document.head.appendChild(link);
    }
    link.href = logoUrl;
  }, [logoUrl, title]);

  return null;
}
