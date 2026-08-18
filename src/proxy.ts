// ─────────────────────────────────────────────────────────────────────────────
// HOST ROUTING — analytics.birgenai.com serves the analytics studio, and
// microeazy.birgenai.com serves the consumer app (blueprint D1, task 0.6).
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
const STUDIO = "/analytics";

/** Where the consumer app's door actually lives inside the app. */
const MICRO_EAZY = "/microeazy";

/**
 * Paths that must reach the framework untouched on ANY branded host: assets, the
 * API, the auth doors. Rewriting one of these to a product surface breaks
 * sign-in on the very host that needs it.
 */
function isPassThrough(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/brand/") ||
    pathname.startsWith("/images/") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/onboard") ||
    pathname === "/favicon.ico"
  );
}

/**
 * The leading label of the host, lowercased, port stripped.
 * "analytics.birgenai.com:3000" → "analytics"; "localhost" → "localhost".
 */
function subdomain(host: string): string {
  return host.split(":")[0].trim().toLowerCase().split(".")[0];
}

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const label = subdomain(host);
  const { pathname } = request.nextUrl;

  if (label !== "analytics" && label !== "microeazy") return NextResponse.next();
  if (isPassThrough(pathname)) return NextResponse.next();

  // The bare host IS the studio. A person who types analytics.birgenai.com has
  // already said what they want; making them then click "Analytics" in a console
  // sidebar is the subdomain doing nothing for them.
  if (label === "analytics") {
    if (pathname === "/" || pathname === "") {
      return NextResponse.rewrite(new URL(STUDIO, request.url));
    }
    return NextResponse.next();
  }

  // ── microeazy.birgenai.com ────────────────────────────────────────────────
  // The bare host is the consumer app's door. Only "/" is rewritten: every other
  // customer route (/myloan, /verify, the portal wizard) is a real path that must
  // keep working unchanged on this host, because they are the SAME screens the
  // lender portals serve — this host changes the chrome, not the routes.
  //
  // The URL is CLONED rather than rebuilt from a bare path, because the query
  // string is load-bearing here: the manifest's start_url is "/?src=pwa", which
  // is the only thing that distinguishes an installed launch from a browser
  // visit. `new URL("/microeazy", request.url)` would drop it and every install
  // would report as a browser session.
  if (pathname === "/" || pathname === "") {
    const url = request.nextUrl.clone();
    url.pathname = MICRO_EAZY;
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  // Skip the static tree entirely. The host check above is cheap, but not running
  // at all is cheaper, and this keeps the proxy off every image request.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
