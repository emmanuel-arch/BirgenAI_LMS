// ─────────────────────────────────────────────────────────────────────────────
// Rate limiting — Postgres fixed-window counters.
//
// The public surface of a lender is a lending decision, an SMS bill and an STK
// prompt on a stranger's phone. Every one of those is expensive, and none of
// them was throttled. This is the throttle.
//
// Why Postgres and not memory: the app is serverless. An in-process Map is a
// per-lambda counter, which is to say no counter at all. Why not Redis: we would
// be adding an entire piece of infrastructure to protect endpoints that already
// touch this database on every request. One extra round trip is the cheaper
// trade, and the counter is exactly as durable as the thing it protects.
//
// Each bucket is one row, upserted atomically. The window advances in place:
// when the incoming windowStart differs from the stored one, the count resets to
// 1 rather than incrementing. No read-modify-write, so no lost updates under
// concurrency — the count is decided by Postgres, not by us.
//
// Fixed windows admit a 2× burst across a boundary (max requests at the end of
// one window, max again at the start of the next). Where that matters, stack a
// second bucket with a longer window — 3/15min AND 8/day cannot be gamed by
// straddling a boundary.
//
// FAIL-OPEN. If the limiter's query fails we allow the request. This is not
// laxity: the limiter shares a database with the handler it guards, so a limiter
// outage is a handler outage, and the request was going to fail anyway. Better
// that it fails on its own terms than that a transient DB blip locks every
// borrower out of their loan.
// ─────────────────────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";
import { rawPrisma } from "@/lib/prisma";

/**
 * One counter. `name` groups the bucket (so limits don't collide across
 * endpoints); `subject` is who is being counted — a phone, an IP, an email.
 */
export type Bucket = {
  name: string;
  subject: string;
  max: number;
  windowSec: number;
};

/** Caller IP, as seen through Vercel's proxy. "unknown" collapses to one bucket. */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim() || "unknown";
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Increment one bucket's window and return the new count. */
async function hit(b: Bucket, nowMs: number): Promise<number> {
  const windowMs = b.windowSec * 1000;
  const windowStart = new Date(Math.floor(nowMs / windowMs) * windowMs);
  const expiresAt = new Date(windowStart.getTime() + windowMs);
  const key = `${b.name}:${b.subject}`;

  const rows = await rawPrisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count", "expiresAt")
    VALUES (${key}, ${windowStart}, 1, ${expiresAt})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimit"."windowStart" = EXCLUDED."windowStart" THEN "RateLimit"."count" + 1
        ELSE 1
      END,
      "windowStart" = EXCLUDED."windowStart",
      "expiresAt"   = EXCLUDED."expiresAt"
    RETURNING "count"
  `;
  return rows[0]?.count ?? 0;
}

function humanWait(sec: number): string {
  if (sec <= 90) return `${Math.max(1, sec)} seconds`;
  const mins = Math.ceil(sec / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
  const hrs = Math.ceil(mins / 60);
  return `${hrs} hour${hrs === 1 ? "" : "s"}`;
}

/**
 * Consume one request against every bucket.
 *
 * Returns a ready-to-send 429 when any bucket is exhausted, or null to proceed.
 * Buckets are all incremented even when one is already over — the caller is
 * being throttled regardless, and skipping the rest would let a hot bucket mask
 * a slower-filling one.
 *
 *   const limited = await rateLimit([
 *     { name: "otp:issue:phone", subject: msisdn, max: 3, windowSec: 900 },
 *     { name: "otp:issue:ip", subject: clientIp(req), max: 20, windowSec: 3600 },
 *   ]);
 *   if (limited) return limited;
 */
export async function rateLimit(buckets: Bucket[], message?: string): Promise<NextResponse | null> {
  const now = Date.now();
  let counts: number[];
  try {
    counts = await Promise.all(buckets.map((b) => hit(b, now)));
  } catch (err) {
    console.error("[ratelimit] counter unavailable — allowing request:", err);
    return null;
  }

  // The longest wait among the exhausted buckets is the honest Retry-After.
  let retryAfter = 0;
  for (const [i, b] of buckets.entries()) {
    if (counts[i]! <= b.max) continue;
    const windowMs = b.windowSec * 1000;
    const endsAt = Math.floor(now / windowMs) * windowMs + windowMs;
    retryAfter = Math.max(retryAfter, Math.ceil((endsAt - now) / 1000));
  }
  if (retryAfter === 0) return null;

  return NextResponse.json(
    {
      success: false,
      rateLimited: true,
      message: message ?? `Too many attempts. Please try again in ${humanWait(retryAfter)}.`,
      retryAfterSec: retryAfter,
    },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}

/** Drop counters whose window has closed. Called from the daily arrears cron. */
export async function sweepRateLimits(): Promise<number> {
  try {
    return await rawPrisma.$executeRaw`DELETE FROM "RateLimit" WHERE "expiresAt" < now()`;
  } catch {
    return 0;
  }
}
