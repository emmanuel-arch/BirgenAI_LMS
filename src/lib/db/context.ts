// ─────────────────────────────────────────────────────────────────────────────
// Ambient tenant context — the request-scoped identity every DB query runs under.
//
// The blueprint calls tenant isolation a hard security boundary: a cross-tenant
// leak is company-ending. App-level `where: { orgId }` is necessary but not
// sufficient — one forgotten clause is a breach. So Postgres RLS is the real
// fence (prisma/rls.sql), and this module carries the fence's key.
//
// Every query the Prisma client runs reads this context and stamps the
// transaction with `app.org_id` (or `app.platform`) before the statement runs.
// There is deliberately NO implicit fallback: with no context, the client throws
// rather than silently running unscoped. Fail loud, never fail open.
//
// Two ways in:
//   runWithOrg / runAsPlatform  — scope a callback (preferred; explicit)
//   enterOrg / enterPlatform    — set it for the rest of the current async
//                                 context (used by auth() and resolveOrg(), so
//                                 every downstream query inherits it for free)
// ─────────────────────────────────────────────────────────────────────────────
import { AsyncLocalStorage } from "node:async_hooks";

export type TenantContext = {
  /** The org whose rows this execution may see. */
  orgId?: string;
  /** Cross-tenant escape hatch — platform console, webhooks pre-resolution, crons, seeds. */
  platform?: boolean;
};

const als = new AsyncLocalStorage<TenantContext>();

export function currentTenant(): TenantContext | undefined {
  return als.getStore();
}

// NOTE: both runners `await fn()` *inside* the store rather than returning its
// promise. Prisma promises are LAZY — the query (and our tenant stamp) only runs
// when `.then()` is called. Returning one from als.run() would defer that call
// until after the store had exited, and the stamp would find no context.

/** Run `fn` scoped to a single org. Queries see only that org's rows. */
export function runWithOrg<T>(orgId: string, fn: () => Promise<T> | T): Promise<T> {
  return als.run({ orgId }, async () => await fn());
}

/**
 * Run `fn` with cross-tenant access. The ONLY places this is legitimate:
 * platform admin, M-Pesa webhooks (before the slug resolves to an org), cron
 * jobs that sweep every org, org self-onboarding (no org exists yet), staff
 * login and password reset (email is matched across orgs), and seeds.
 */
export function runAsPlatform<T>(fn: () => Promise<T> | T): Promise<T> {
  return als.run({ platform: true }, async () => await fn());
}

/** Bind the org for the remainder of the current async execution. */
export function enterOrg(orgId: string): void {
  const store = als.getStore();
  if (store) store.orgId = orgId;
  else als.enterWith({ orgId });
}

/** Bind platform access for the remainder of the current async execution. */
export function enterPlatform(): void {
  const store = als.getStore();
  if (store) store.platform = true;
  else als.enterWith({ platform: true });
}
