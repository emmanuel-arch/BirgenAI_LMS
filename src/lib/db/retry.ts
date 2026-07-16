// ─────────────────────────────────────────────────────────────────────────────
// COLD-POOLER RESILIENCE.
//
// Supabase's Supavisor pooler drops idle connections. The first query after that
// throws P1001 ("Can't reach database server") — not because anything is broken,
// but because the pool is cold and needs a moment to wake. A retry a few hundred
// milliseconds later connects fine.
//
// Left unhandled this surfaces as a 500 (an HTML error page), and a login screen
// that does `res.json()` on it throws and shows "Sign-in failed" — telling a founder
// with the CORRECT password that their password is wrong. So the reachability-
// sensitive reads (login, above all) run through `withDbRetry`, and a blip that
// survives the retry is reported as a 503 "waking up", never a credential failure.
// ─────────────────────────────────────────────────────────────────────────────
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

/** True when the error is a transient reachability blip (cold pooler / dropped
 *  connection), as opposed to a real query or logic error. */
export function isTransientDbError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  const code = (err as { code?: string })?.code;
  // P1001 unreachable · P1002 timed out · P1008 operation timed out · P1017 server closed.
  if (code === "P1001" || code === "P1002" || code === "P1008" || code === "P1017") return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /can't reach database server|connection.*(closed|terminated|reset)|timed out fetching|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE/i.test(msg);
}

/** Run a DB operation, retrying on a transient reachability blip with a short
 *  backoff. Only transient errors are retried; a real error throws immediately. */
export async function withDbRetry<T>(fn: () => Promise<T>, opts?: { retries?: number; delayMs?: number }): Promise<T> {
  const retries = opts?.retries ?? 1;
  const delay = opts?.delayMs ?? 400;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientDbError(err) || attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, delay * (attempt + 1)));
    }
  }
  throw lastErr;
}

/** The honest 503 for a cold-start blip: "waking up", never "wrong password". */
export function wakingUpResponse() {
  return NextResponse.json(
    { success: false, wakingUp: true, message: "The service is waking up — please try again in a moment." },
    { status: 503 },
  );
}
