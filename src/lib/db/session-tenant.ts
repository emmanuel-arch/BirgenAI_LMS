// Fallback tenant resolution from the staff session cookie.
//
// Why this exists: AsyncLocalStorage.enterWith() binds the store for "the
// remainder of the current synchronous execution and any following async calls"
// — of the function that CALLS it. It does not propagate back up to that
// function's caller. So `auth()` cannot bind the tenant on behalf of the page
// that awaited it; when auth() resolves, the page resumes in the context it
// captured before the call.
//
// Rather than wrap forty staff surfaces in runWithOrg(), the Prisma client falls
// back to reading the tenant straight off the verified session cookie. Staff
// routes and pages therefore need no changes at all, and the tenant still comes
// from a signed token the client cannot forge.
//
// Borrower surfaces have no session, so they bind explicitly with enterOrg()
// right after resolveOrg() — one line, in their own async context, where
// enterWith() does propagate.
import { SESSION_COOKIE } from "@/lib/auth";

/** The orgId on the verified staff session, or null (anonymous / not a request). */
export async function orgIdFromSession(): Promise<string | null> {
  try {
    // Dynamic imports: this module is reachable from tsx scripts and seeds, where
    // `next/headers` has no request scope. Those callers always bind a scope
    // explicitly, so they never reach this path.
    const { cookies } = await import("next/headers");
    const { jwtVerify } = await import("jose");

    const secret = process.env.NEXTAUTH_SECRET?.trim();
    if (!secret) return null;

    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    if (!token) return null;

    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    const user = payload.user as { orgId?: string } | undefined;
    return user?.orgId ?? null;
  } catch {
    return null; // no request scope, expired or tampered token → anonymous
  }
}
