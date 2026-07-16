// GET/POST /api/cron/graduation — nightly behavioural scoring + automatic graduation.
//
// 04:45, and its place in the night matters:
//
//   03:00  outcome backfill   labels the loans that closed
//   03:45  portfolio scan     scores the LIVE book
//   04:45  THIS               scores CLOSED loans, and moves limits
//   05:00  arrears            chases what is late
//   05:30  retention          deletes what is spent
//
// After the backfill, because a loan that cleared yesterday should count today rather
// than tomorrow. Before arrears, because a customer whose limit just moved should be
// chased with the new number already on the officer's screen.
//
// PER-ORG, and gated on nothing. Graduation is not a paid feature — a lender's own
// customers earning their own limit increases is the product working, not an upsell.
// (Contrast the portfolio scan, which is Premium.)
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runAsPlatform, runWithOrg } from "@/lib/db/context";
import { runGraduations } from "@/lib/risk/graduation";

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
    const stats = await runAsPlatform(async () => {
      const orgs = await prisma.org.findMany({ where: { status: "ACTIVE" }, select: { id: true, slug: true } });
      const totals = { orgs: 0, scored: 0, graduated: 0, skipped: 0, errors: [] as string[] };

      for (const org of orgs) {
        try {
          const run = await runWithOrg(org.id, () => runGraduations(org.id, "cron"));
          totals.orgs++;
          totals.scored += run.scored;
          totals.graduated += run.graduated;
          totals.skipped += run.skipped;

          // A limit that moved is a decision the lender must be able to find later.
          if (run.graduated > 0) {
            await prisma.auditLog.create({
              data: {
                orgId: org.id,
                actorType: "system",
                actorId: "cron",
                action: "risk.graduation-run",
                entity: "Borrower",
                meta: { scored: run.scored, graduated: run.graduated, events: run.events },
              },
            }).catch(() => {});
          }
        } catch (err) {
          totals.errors.push(`${org.slug}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return totals;
    });

    return NextResponse.json({ success: stats.errors.length === 0, ranAt: new Date().toISOString(), ...stats });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err instanceof Error ? err.message : "Graduation run failed." },
      { status: 500 },
    );
  }
}

export const POST = GET;
