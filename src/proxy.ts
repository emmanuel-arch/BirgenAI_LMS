// ─────────────────────────────────────────────────────────────────────────────
// HOST ROUTING — analytics.birgenai.com serves the analytics studio.
//
// NOTE THE FILENAME. This is `proxy.ts`, not `middleware.ts`. The middleware file
// convention is deprecated in this version of Next and renamed to `proxy` — and a
// `middleware.ts` written from memory is not an error, it is SILENTLY IGNORED.
// Nothing logs, nothing throws, the subdomain simply never routes. See
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md
//
// WHAT THIS DOES, AND DELIBERATELY NOTHING MORE. Analytics is its own product on
// its own host, but it is the SAME Next application: it inherits auth, the daily
// OTP, tenancy resolution, the vault and RBAC rather than duplicating the two
// surfaces — auth and tenancy — where a multi-tenant bug becomes a cross-lender
// data leak. So the subdomain is a rewrite, not a second deployment.
//
// This runs before every request in the product. Anything that is not the
// analytics host returns untouched, on the first line, before any allocation.
// ─────────────────────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Where the studio actually lives inside the app. */
const STUDIO = "/console/intelligence/analytics";

/**
 * The leading label of the host, lowercased, port stripped.
 * "analytics.birgenai.com:3000" → "analytics"; "localhost" → "localhost".
 */
function subdomain(host: string): string {
  return host.split(":")[0].trim().toLowerCase().split(".")[0];
}

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (subdomain(host) !== "analytics") return NextResponse.next();

  const { pathname } = request.nextUrl;

  // Everything the app needs to function must pass through untouched. Rewriting
  // an asset or an auth callback to the studio would break sign-in on the very
  // host that needs it most.
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/brand/") ||
    pathname.startsWith("/images/") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/onboard") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  // The bare host IS the studio. A person who types analytics.birgenai.com has
  // already said what they want; making them then click "Analytics" in a console
  // sidebar is the subdomain doing nothing for them.
  if (pathname === "/" || pathname === "") {
    return NextResponse.rewrite(new URL(STUDIO, request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Skip the static tree entirely. The host check above is cheap, but not running
  // at all is cheaper, and this keeps the proxy off every image request.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
