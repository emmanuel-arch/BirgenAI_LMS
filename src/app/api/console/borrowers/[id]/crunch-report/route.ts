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
  const borrower = await prisma.borrower.findFirst({ where: { id, orgId }, select: { id: true, creditScore: true, loanLimit: true, firstName: true, otherName: true } });
  if (!borrower) return NextResponse.json({ success: false, message: "Borrower not found." }, { status: 404 });

  let body: {
    creditScore?: { modelVersion?: string; score?: number; pd?: number; band?: string; decision?: string; reasonCodes?: unknown };
    features?: Record<string, unknown>;
    /** The derived model vector the scorer actually consumed (see the training-row note below). */
    modelFeatures?: Record<string, number>;
    affordability?: Record<string, unknown>;
    monthly?: unknown;
    transactionCount?: number;
    nameCheck?: { statementName?: string | null; expectedName?: string; matched?: boolean; overridden?: boolean } | null;
    qualification?: {
      eligible?: boolean; startingLimit?: number; tier?: string | null; internalScore?: number;
      reasonCodes?: { code: string; label: string; detail: string; tone: string }[];
      recommendedProductId?: string | null;
    } | null;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const cs = body.creditScore;
  const score = Math.round(Number(cs?.score));
  if (!cs || !Number.isFinite(score) || score < 300 || score > 900) {
    return NextResponse.json({ success: false, message: "No crunch result to save." }, { status: 400 });
  }
  const band = typeof cs.band === "string" ? cs.band.slice(0, 30) : null;
  const pd = Number(cs.pd);

  // THE TRAINING ROW.
  //
  // What is frozen here is the X of a supervised example whose y arrives months
  // later from the outcome backfill. It used to be the raw cashflow vector alone,
  // which is enough to RE-DERIVE the model features but not enough to reproduce a
  // decision: the derivation itself is code that will change. So three blocks are
  // stored side by side —
  //
  //   <raw cashflow>   spread flat, so every existing reader keeps working;
  //   _model           the exact numeric vector the scorer consumed, so a model
  //                    refitted next year sees the values that were actually used,
  //                    not today's mapping applied to yesterday's statement;
  //   _qualification   the internal score, starting limit, tier and reason codes —
  //                    the OUTPUT half of the decision, which is what makes this a
  //                    labelled example of our policy and not just of the borrower.
  //
  // The underscore prefix is load-bearing: lib/intelligence/loop.ts counts the raw
  // signal keys by filtering it out, so adding a block never inflates the feature
  // count on the Closed Loop screen.
  const featureBlob: Prisma.InputJsonValue | undefined = body.features
    ? {
        ...(body.features as Record<string, unknown>),
        ...(body.modelFeatures ? { _model: body.modelFeatures } : {}),
        ...(body.qualification ? { _qualification: body.qualification } : {}),
      } as Prisma.InputJsonValue
    : undefined;

  const snapshot = await prisma.scoreSnapshot.create({
    data: {
      orgId,
      borrowerId: id,
      modelKind: "thin-file",
      modelVersion: typeof cs.modelVersion === "string" ? cs.modelVersion.slice(0, 60) : "thin-file",
      score,
      pd: Number.isFinite(pd) ? pd : null,
      riskBand: band,
      features: featureBlob,
      reasons: (cs.reasonCodes ?? undefined) as Prisma.InputJsonValue | undefined,
      // The amount the decision was made ABOUT. Without it the loop can measure
      // whether we were right but never what being wrong cost.
      loanContextAmount: Number.isFinite(Number(body.qualification?.startingLimit))
        ? Number(body.qualification!.startingLimit)
        : null,
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

  // ── STARTING LIMIT ALLOCATION ────────────────────────────────────────────────
  // When the score→product-match engine cleared them, allocate the starting loan
  // limit onto the record (moving the old one to previous, so the change is legible
  // on their 360). The number is the server-computed one echoed from the cruncher;
  // we still clamp it to a sane band and record the reasons behind it.
  const q = body.qualification;
  let limitAllocated: number | null = null;
  if (q?.eligible && Number.isFinite(Number(q.startingLimit))) {
    const startingLimit = Math.round(Number(q.startingLimit));
    if (startingLimit >= 0 && startingLimit <= 1_000_000) {
      const prev = borrower.loanLimit != null ? Number(borrower.loanLimit) : null;
      await prisma.borrower.update({
        where: { id },
        data: { loanLimit: startingLimit, previousLoanLimit: prev, lastScoredAt: new Date() },
      });
      limitAllocated = startingLimit;
      await prisma.auditLog.create({
        data: {
          orgId, actorId: session!.user!.id, actorType: "staff", action: "borrower.limit-allocated",
          entity: "Borrower", entityId: id,
          meta: { startingLimit, previous: prev, tier: q.tier ?? null, internalScore: q.internalScore ?? null, reasons: (q.reasonCodes ?? []).slice(0, 6) },
        },
      }).catch(() => {});
    }
  }

  await prisma.auditLog.create({
    data: {
      orgId, actorId: session!.user!.id, actorType: "staff", action: "borrower.crunch-report",
      entity: "Borrower", entityId: id,
      meta: { score, band, decision: cs.decision ?? null, overridden: body.nameCheck?.overridden ?? false },
    },
  }).catch(() => {});

  return NextResponse.json({ success: true, snapshotId: snapshot.id, limitAllocated });
}
