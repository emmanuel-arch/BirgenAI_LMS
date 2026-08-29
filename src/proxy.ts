// ─────────────────────────────────────────────────────────────────────────────
// HOST ROUTING — each of the six subdomains serves its own system.
//
//     lms.servicesuitecloud.com          → /console    Lending Console
//     microeazy.servicesuitecloud.com    → /microeazy  the consumer app (D1, 0.6)
//     analytics.servicesuitecloud.com    → /analytics  Analytics & Reporting
//     peoplehub.servicesuitecloud.com    → /people     PeopleHub HR
//     ledgerly.servicesuitecloud.com     → /books      Ledgerly Accounting
//     connectdesk.servicesuitecloud.com  → /desk       ConnectDesk Call-Center
//
// The table itself lives in lib/suite/labels.ts, which the launcher's subdomain
// labels and the reserved-label list also read, so a rename cannot land in one
// place and not the other. That file has no imports on purpose — SUITE_APPS
// carries a lucide icon per app, and a React bundle has no business in the hot
// path of every request in the product.
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
import { doorForLabel } from "@/lib/suite/labels";

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
 * "connectdesk.servicesuitecloud.com:3000" → "connectdesk"; "localhost" → "localhost".
 */
function subdomain(host: string): string {
  return host.split(":")[0].trim().toLowerCase().split(".")[0];
}

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const { pathname } = request.nextUrl;

  // Not one of the six, or a path that must reach the framework untouched.
  // Either way this returns before allocating anything.
  const target = doorForLabel(subdomain(host));
  if (!target) return NextResponse.next();
  if (isPassThrough(pathname)) return NextResponse.next();

  // ONLY the bare host is rewritten. Every other path on these hosts is a real
  // route that must keep working unchanged — /desk/queue on connectdesk,
  // /console/borrowers on lms, /myloan and /verify on microeazy. The subdomain
  // decides which front door you came through, not which routes exist.
  if (pathname !== "/" && pathname !== "") return NextResponse.next();

  // The URL is CLONED rather than rebuilt from a bare path, because the query
  // string is load-bearing on at least one of these hosts: the PWA manifest's
  // start_url is "/?src=pwa", which is the only thing that distinguishes an
  // installed Micro Eazy launch from a browser visit. `new URL(target,
  // request.url)` would drop it and every install would report as a browser
  // session.
  const url = request.nextUrl.clone();
  url.pathname = target;
  return NextResponse.rewrite(url);
}

export const config = {
  // Skip the static tree entirely. The host check above is cheap, but not running
  // at all is cheaper, and this keeps the proxy off every image request.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
