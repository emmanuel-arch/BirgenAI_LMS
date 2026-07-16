// POST /api/console/borrowers/[id]/crunch-report — freeze a counter crunch onto
// the customer's file.
//
// The crunch itself is compute-only (nothing stored — the statement PDF is
// never kept). What IS worth keeping is the VERDICT: the score, the features
// and the reasons, saved as
//   • a ScoreSnapshot — so the 360's score history shows how they scored the
//     first time and how the loan aged against it (the closed ML loop), and
//   • a Document — the full report in their bio, readable years later.
// The borrower's headline creditScore is only set when they don't have one yet;
// a crunch must never quietly overwrite a deliberate manual score.
import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { resolveScope, canSeeBorrower } from "@/lib/rbac/scope";
import { bandForScore } from "@/lib/risk/bands";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const denied = await requireRight(session, "loans.apply");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;
  const { id } = await ctx.params;

  const scope = await resolveScope(session!);
  if (!(await canSeeBorrower(scope, id))) {
    return NextResponse.json({ success: false, message: "Borrower not found." }, { status: 404 });
  }
  const borrower = await prisma.borrower.findFirst({ where: { id, orgId }, select: { id: true, creditScore: true, firstName: true, otherName: true } });
  if (!borrower) return NextResponse.json({ success: false, message: "Borrower not found." }, { status: 404 });

  let body: {
    creditScore?: { modelVersion?: string; score?: number; pd?: number; band?: string; decision?: string; reasonCodes?: unknown };
    features?: Record<string, unknown>;
    affordability?: Record<string, unknown>;
    monthly?: unknown;
    transactionCount?: number;
    nameCheck?: { statementName?: string | null; expectedName?: string; matched?: boolean; overridden?: boolean } | null;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const cs = body.creditScore;
  const score = Math.round(Number(cs?.score));
  if (!cs || !Number.isFinite(score) || score < 300 || score > 900) {
    return NextResponse.json({ success: false, message: "No crunch result to save." }, { status: 400 });
  }
  const band = typeof cs.band === "string" ? cs.band.slice(0, 30) : null;
  const pd = Number(cs.pd);

  const snapshot = await prisma.scoreSnapshot.create({
    data: {
      orgId,
      borrowerId: id,
      modelKind: "thin-file",
      modelVersion: typeof cs.modelVersion === "string" ? cs.modelVersion.slice(0, 60) : "thin-file",
      score,
      pd: Number.isFinite(pd) ? pd : null,
      riskBand: band,
      features: (body.features ?? undefined) as Prisma.InputJsonValue | undefined,
      reasons: (cs.reasonCodes ?? undefined) as Prisma.InputJsonValue | undefined,
      capturedBy: "console-crunch",
    },
  });

  const report = {
    kind: "mpesa-statement-crunch",
    crunchedAt: new Date().toISOString(),
    crunchedBy: session!.user!.name ?? session!.user!.id,
    creditScore: cs,
    features: body.features ?? null,
    affordability: body.affordability ?? null,
    monthly: body.monthly ?? null,
    transactionCount: body.transactionCount ?? null,
    nameCheck: body.nameCheck ?? null,
    scoreSnapshotId: snapshot.id,
  };
  const bytes = Buffer.byteLength(JSON.stringify(report));
  const day = new Date().toISOString().slice(0, 10);
  await prisma.document.create({
    data: {
      orgId,
      borrowerId: id,
      kind: "BANK_STATEMENT",
      filename: `mpesa-crunch-report-${day}.json`,
      contentType: "application/json",
      bytes,
      storageKey: `sim/crunch/${snapshot.id}.json`,
      status: "PARSED",
      confidence: 1,
      fields: report as Prisma.InputJsonValue,
      note: `M-Pesa statement crunch — score ${score}${band ? ` (${band})` : ""}, decision ${cs.decision ?? "—"}, ${body.transactionCount ?? "?"} transactions.`,
      parserMode: "cruncher",
      uploadedBy: session!.user!.id,
    },
  });

  // First score on the record graduates the headline number too — AND clusters them.
  //
  // The band is derived from the score by the one ladder every engine shares
  // (src/lib/risk/bands.ts), never taken from whatever string the cruncher happened to
  // emit. Two engines that each invent their own band names are two engines an officer
  // has to translate between, and the Customer-360 would be showing a word from one
  // model beside a probability from another.
  if (borrower.creditScore == null) {
    const cluster = bandForScore(score);
    await prisma.borrower.update({
      where: { id },
      data: { creditScore: score, riskBand: cluster?.key ?? null, lastScoredAt: new Date() },
    });
  }

  await prisma.auditLog.create({
    data: {
      orgId, actorId: session!.user!.id, actorType: "staff", action: "borrower.crunch-report",
      entity: "Borrower", entityId: id,
      meta: { score, band, decision: cs.decision ?? null, overridden: body.nameCheck?.overridden ?? false },
    },
  }).catch(() => {});

  return NextResponse.json({ success: true, snapshotId: snapshot.id });
}
