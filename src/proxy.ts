// Root redirect — Next 16 Proxy (the renamed `middleware` convention; edge is not
// used, so `proxy` on the nodejs runtime is exactly right here).
//
// This platform is lender-first: the apex lms.birgenai.com is a door for lenders
// and prospects, not borrowers. So the apex "/" lands on /platform/login (sign in
// to the platform, then pick a console — or create an organization).
//
// Borrower portals live on lender SUBDOMAINS (micromart.birgenai.com,
// mular.birgenai.com …) whose "/" must keep serving the borrower funnel. The
// host check below is the whole point: only the apex is redirected; every lender
// subdomain passes straight through, so the portal code is never touched.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Labels that are platform surfaces, never a lender slug. Mirrors the borrower
// portal's own reserved list so the two agree on "what is a lender subdomain".
const RESERVED = new Set([
  "lms", "www", "api", "app", "admin", "console", "hub", "birgenai", "platform", "login", "onboard", "localhost",
]);

/** True when the request is on a real lender subdomain (mular.birgenai.com). */
function isLenderSubdomain(host: string): boolean {
  const label = host.split(".")[0] ?? "";
  if (!label || RESERVED.has(label) || /^\d+$/.test(label)) return false;
  if (host.endsWith(".localhost")) return true;              // mular.localhost (dev)
  if (host.endsWith(".vercel.app")) return false;            // preview builds = apex
  return host.split(".").length >= 3;                        // mular.birgenai.com
}

export function proxy(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").split(":")[0].toLowerCase();
  if (isLenderSubdomain(host)) return NextResponse.next();   // borrower portal — untouched
  return NextResponse.redirect(new URL("/platform/login", request.url));
}

// Only the site root. /console, /platform, /micromart, /mular, /login etc. never
// reach here, so nothing else in the app is affected.
export const config = {
  matcher: "/",
};
