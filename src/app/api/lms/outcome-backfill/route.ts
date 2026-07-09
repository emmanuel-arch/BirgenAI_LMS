// POST /api/lms/outcome-backfill — close the ML loop.
//
// Joins BirgenAI's scoring records (lms_applications + borrower_score_snapshots)
// back to the lender's ServiceSuite loan book and writes the realised outcome
// (REPAID / DEFAULTED) so the training labels (y) catch up to the features (X).
//
// Meant to run on a schedule (daily/weekly). Gated two ways:
//   • a scheduler calls it with header `Authorization: Bearer <CRON_SECRET>`, or
//   • a signed-in ADMIN triggers it from the app.
// Optional body: { lenderSlug?: "micromart" | "axe" } to restrict to one lender.

import { NextRequest, NextResponse } from "next/server";
import { auth, hasAdminAccess } from "@/lib/auth";
import { runAsPlatform } from "@/lib/db/context";
import { backfillOutcomes } from "@/lib/lms/outcome";

export const runtime = "nodejs";
export const maxDuration = 300; // outcome scans can be slow on a cold pool

async function isAuthorized(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const header = req.headers.get("authorization") || "";
    const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
    if (token && token === secret) return true;
  }
  const session = await auth();
  return hasAdminAccess(session);
}

// Vercel Cron invokes with GET (and sends `Authorization: Bearer ${CRON_SECRET}`
// automatically when the env var is set) — same gate, backfills every lender.
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }
  try {
    // Sweeps every lender's book — platform-scoped by necessity.
    const result = await runAsPlatform(() => backfillOutcomes({}));
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Backfill failed.";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  let lenderSlug: string | undefined;
  try {
    const body = await req.json();
    if (typeof body?.lenderSlug === "string") lenderSlug = body.lenderSlug;
  } catch {
    /* no body is fine — backfill every configured lender */
  }

  try {
    const result = await runAsPlatform(() => backfillOutcomes({ lenderSlug }));
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Backfill failed.";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
