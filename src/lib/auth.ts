// ─────────────────────────────────────────────────────────────────────────────
// Phase-1 auth stub. The funnel is white-label-first: borrowers identify by
// phone (+ national ID) inside the wizard, and every loan-book write is
// server-authoritative, so no session is required to apply.
//
// Phase 2 replaces this with NextAuth (staff credentials + OTP, borrower
// phone-OTP, optional birgenai.com suite-SSO federation) behind the SAME
// exports so the ported routes don't change again.
// ─────────────────────────────────────────────────────────────────────────────

export type Session = {
  user?: { id?: string; name?: string | null; email?: string | null; role?: string | null };
} | null;

/** No session in Phase 1 — anonymous funnel; routes already handle null. */
export async function auth(): Promise<Session> {
  return null;
}

/** Admin-only surfaces (e.g. manual outcome-backfill trigger). With no auth
 *  system yet, only the CRON_SECRET path can authorize — never a browser. */
export function hasAdminAccess(session: Session): boolean {
  return session?.user?.role === "ADMIN";
}
