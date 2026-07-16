// GET/POST /api/cron/retention — the nightly retention sweep (CRON_SECRET).
//
// Runs at 05:30, last of the night's jobs: everything else has finished writing,
// so nothing is deleted out from under a job that was about to read it.
//
// PLATFORM-SCOPED, DELIBERATELY. Retention is a promise made to every borrower of
// every lender, not a per-tenant feature — so it sweeps the whole database in one
// pass rather than iterating orgs. It is also NOT gated on plan or subscription
// status: a lender who stops paying does not thereby acquire the right to keep a
// customer's selfie forever. The one thing a lapsed subscription must never buy is
// a data-protection breach.
//
// The policy it enforces (and the reasoning behind every window) is in
// src/lib/compliance/retention.ts.
import { NextRequest, NextResponse } from "next/server";
import { runAsPlatform } from "@/lib/db/context";
import { prisma } from "@/lib/prisma";
import { sweepRetention } from "@/lib/compliance/retention";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  return !!token && token === secret;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });

  try {
    const results = await runAsPlatform(async () => {
      const swept = await sweepRetention();

      // The sweep is itself an act on personal data, so it leaves a trace. One
      // platform-level audit row per night, carrying what it destroyed — the
      // evidence that the policy on the screen is the policy that actually runs.
      await prisma.auditLog
        .create({
          data: {
            actorType: "system",
            actorId: "cron",
            action: "compliance.retention-sweep",
            entity: "RetentionPolicy",
            meta: { swept },
          },
        })
        .catch(() => {});

      return swept;
    });

    const affected = results.reduce((n, r) => n + r.affected, 0);
    const errors = results.filter((r) => r.error);

    return NextResponse.json({
      success: errors.length === 0,
      ranAt: new Date().toISOString(),
      affected,
      results,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err instanceof Error ? err.message : "Retention sweep failed." },
      { status: 500 },
    );
  }
}

export const POST = GET;
