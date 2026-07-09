// ─────────────────────────────────────────────────────────────────────────────
// Prisma client (Prisma 7: driver adapter carries the connection).
//
// RLS-SCOPED BY DEFAULT. Postgres row-level security (prisma/rls.sql) filters
// every tenant table on `app.org_id`; this client sets that GUC, transaction-
// locally, immediately before each statement. The upshot: an ordinary
// `prisma.loan.findMany()` — even one that forgets `where: { orgId }` — can only
// ever see the caller's own org. Isolation stops being a code review promise and
// becomes a database guarantee.
//
// `set_config(..., TRUE)` is transaction-local, which is exactly why this works
// through the pgbouncer transaction pooler: the GUC and the statement share one
// server connection for the life of the transaction.
//
// Exports:
//   prisma     — use everywhere. Throws if no tenant context is bound.
//   rawPrisma  — unscoped escape hatch. Only migrations/seeds/tooling.
//   orgTx      — interactive transactions (extensions can't nest them, so the
//                GUC is set on the transaction client by hand).
// ─────────────────────────────────────────────────────────────────────────────
import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { currentTenant, type TenantContext } from "./db/context";
import { orgIdFromSession } from "./db/session-tenant";

const globalForPrisma = globalThis as unknown as { rawPrisma?: PrismaClient };

function createClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  return new PrismaClient({
    adapter,
    // Every query now runs inside a transaction (to carry the tenant stamp), and
    // this pooler lives a region away. Prisma's 2s default maxWait times out on
    // cold connections with P2028, so give the pool room to hand one over.
    transactionOptions: { maxWait: 15_000, timeout: 30_000 },
  });
}

/** Unscoped client — bypasses the tenant stamp. Never import this from app code. */
export const rawPrisma = globalForPrisma.rawPrisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.rawPrisma = rawPrisma;

const NO_CONTEXT =
  "[rls] No tenant context for this query. Wrap the call in runWithOrg(orgId, …) or " +
  "runAsPlatform(…), or call enterOrg(orgId) after resolveOrg(). Staff surfaces resolve " +
  "automatically from the session cookie.";

/**
 * Who is this query running as?
 *   1. an explicitly bound scope (runWithOrg / runAsPlatform / enterOrg), else
 *   2. the org on the verified staff session cookie, else
 *   3. nothing — and we refuse to run rather than run unscoped.
 */
async function resolveTenant(): Promise<TenantContext> {
  const ctx = currentTenant();
  if (ctx?.platform || ctx?.orgId) return ctx;
  const orgId = await orgIdFromSession();
  if (orgId) return { orgId };
  throw new Error(NO_CONTEXT);
}

/** The statement that stamps this transaction with the caller's tenant identity. */
function tenantStamp(ctx: TenantContext): Prisma.PrismaPromise<number> {
  return ctx.platform
    ? rawPrisma.$executeRaw`SELECT set_config('app.platform', 'on', TRUE)`
    : rawPrisma.$executeRaw`SELECT set_config('app.org_id', ${ctx.orgId!}, TRUE)`;
}

export const prisma = rawPrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ args, query }) {
        const ctx = await resolveTenant();
        // Batch the stamp and the statement into one transaction so they land on
        // the same connection — required for a transaction-local GUC to apply.
        const [, result] = await rawPrisma.$transaction([
          tenantStamp(ctx),
          query(args) as Prisma.PrismaPromise<unknown>,
        ]);
        return result;
      },
    },
  },
});

/**
 * Interactive transaction that carries the tenant stamp. Prisma extensions can't
 * open a nested transaction, so multi-statement work must come through here —
 * the stamp is applied to the transaction client itself, and every statement
 * inside inherits it.
 */
export async function orgTx<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { timeout?: number; maxWait?: number },
): Promise<T> {
  const ctx = await resolveTenant();
  return rawPrisma.$transaction(async (tx) => {
    if (ctx.platform) await tx.$executeRaw`SELECT set_config('app.platform', 'on', TRUE)`;
    else await tx.$executeRaw`SELECT set_config('app.org_id', ${ctx.orgId!}, TRUE)`;
    return fn(tx);
  }, options);
}
