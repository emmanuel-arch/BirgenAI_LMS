// Model tuning — the lender's own early-warning policy.
//
//   GET  → the current policy, the defaults, the labels, and what it flags today
//   POST → { action: "preview" | "save" | "reset", weights?, thresholds?, note? }
//
// `preview` scores the REAL book against weights that have not been saved. A Credit
// Manager should never have to guess what moving "31 to 60 days late" from 42 to 30
// does to their watchlist — they should see the borrowers who fall off it, by name,
// before they commit. Preview writes nothing.
//
// Saving is an admin action and is audited with the whole policy, because a scoring
// policy that cannot be reconstructed after the fact is one a regulator will not
// accept. Tuning is advisory: it changes who an officer calls first, never what a
// borrower owes.
import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auth, hasAdminAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireFeature } from "@/lib/billing/entitlements";
import { portfolioEarlyWarning } from "@/lib/intelligence/earlywarning";
import {
  tuningFor, validate, invalidateTuning, isDefault,
  DEFAULT_CONFIG, WEIGHT_LABELS, type TuningConfig,
} from "@/lib/intelligence/tuning";

export const runtime = "nodejs";

/** The handful of numbers a Credit Manager actually judges a policy by. */
function summarize(ew: Awaited<ReturnType<typeof portfolioEarlyWarning>>) {
  return {
    watchlist: ew.tiles.watchlist,
    high: ew.tiles.high,
    elevated: ew.rows.filter((r) => r.band === "ELEVATED").length,
    atRiskValue: Math.round(ew.tiles.atRiskValue),
    projectedLoss: Math.round(ew.tiles.projectedLoss),
    fieldVisits: ew.rows.filter((r) => r.action.kind === "FIELD_VISIT").length,
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const orgId = session.user.orgId;

  // Two gates. Tuning is Premium's, but it tunes the early-warning engine — and a
  // lapsed subscription revokes that engine. Without this check a past-due org could
  // still read its watchlist through the preview it is no longer entitled to.
  const scan = await requireFeature(orgId, "portfolio-scan");
  if (scan) return scan;
  const gate = await requireFeature(orgId, "model-tuning");
  if (gate) return gate;

  const [config, row] = await Promise.all([
    tuningFor(orgId),
    prisma.tuningProfile.findUnique({ where: { orgId }, select: { version: true, note: true, updatedAt: true } }),
  ]);
  const current = summarize(await portfolioEarlyWarning(orgId, config));

  return NextResponse.json({
    success: true,
    config,
    defaults: DEFAULT_CONFIG,
    labels: WEIGHT_LABELS,
    isDefault: isDefault(config),
    version: row?.version ?? 0,
    note: row?.note ?? null,
    updatedAt: row?.updatedAt ?? null,
    current,
    canEdit: hasAdminAccess(session),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const orgId = session.user.orgId;

  // Two gates. Tuning is Premium's, but it tunes the early-warning engine — and a
  // lapsed subscription revokes that engine. Without this check a past-due org could
  // still read its watchlist through the preview it is no longer entitled to.
  const scan = await requireFeature(orgId, "portfolio-scan");
  if (scan) return scan;
  const gate = await requireFeature(orgId, "model-tuning");
  if (gate) return gate;

  let body: { action?: string; weights?: unknown; thresholds?: unknown; note?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  // ── Preview: score the real book against an unsaved policy ───────────────────
  if (body.action === "preview") {
    const { config, adjustments } = validate({ weights: body.weights, thresholds: body.thresholds } as Partial<TuningConfig>);
    const [before, after] = await Promise.all([
      portfolioEarlyWarning(orgId, await tuningFor(orgId)),
      portfolioEarlyWarning(orgId, config),
    ]);

    // Who moves, by name. A count tells a manager the size of a change; a name tells
    // them whether it is the right one.
    const beforeBand = new Map(before.rows.map((r) => [r.loanId, r.band]));
    const changed = after.rows
      .filter((r) => beforeBand.get(r.loanId) !== r.band)
      .slice(0, 12)
      .map((r) => ({ name: r.name, from: beforeBand.get(r.loanId) ?? "—", to: r.band, riskScore: r.riskScore, dpd: r.dpd }));
    const dropped = before.rows
      .filter((r) => !after.rows.some((a) => a.loanId === r.loanId))
      .slice(0, 12)
      .map((r) => ({ name: r.name, from: r.band, to: "not watched", riskScore: r.riskScore, dpd: r.dpd }));

    return NextResponse.json({
      success: true,
      config,
      adjustments,
      before: summarize(before),
      after: summarize(after),
      changed,
      dropped,
    });
  }

  // Everything below writes.
  if (!hasAdminAccess(session)) {
    return NextResponse.json({ success: false, message: "Only an admin can change the risk policy." }, { status: 403 });
  }

  if (body.action === "reset") {
    await prisma.tuningProfile.deleteMany({ where: { orgId } });
    invalidateTuning(orgId);
    await prisma.auditLog.create({
      data: { orgId, actorId: session.user.id, actorType: "staff", action: "tuning.reset", entity: "TuningProfile", entityId: orgId },
    }).catch(() => {});
    return NextResponse.json({ success: true, config: DEFAULT_CONFIG, isDefault: true, version: 0 });
  }

  if (body.action === "save") {
    const { config, adjustments } = validate({ weights: body.weights, thresholds: body.thresholds } as Partial<TuningConfig>);
    const existing = await prisma.tuningProfile.findUnique({ where: { orgId }, select: { version: true } });
    const version = (existing?.version ?? 0) + 1;

    await prisma.tuningProfile.upsert({
      where: { orgId },
      create: {
        orgId,
        weights: config.weights as unknown as Prisma.InputJsonValue,
        thresholds: config.thresholds as unknown as Prisma.InputJsonValue,
        version, note: body.note?.slice(0, 300) ?? null, updatedBy: session.user.id,
      },
      update: {
        weights: config.weights as unknown as Prisma.InputJsonValue,
        thresholds: config.thresholds as unknown as Prisma.InputJsonValue,
        version, note: body.note?.slice(0, 300) ?? null, updatedBy: session.user.id,
      },
    });
    invalidateTuning(orgId);

    // The whole policy goes in the audit row, not a diff. Reconstructing what a
    // borrower was scored against should never require replaying a change history.
    await prisma.auditLog.create({
      data: {
        orgId, actorId: session.user.id, actorType: "staff", action: "tuning.save",
        entity: "TuningProfile", entityId: orgId,
        meta: { version, note: body.note ?? null, adjustments, ...config } as unknown as Prisma.InputJsonValue,
      },
    }).catch(() => {});

    const after = summarize(await portfolioEarlyWarning(orgId, config));
    return NextResponse.json({ success: true, config, adjustments, version, isDefault: isDefault(config), current: after });
  }

  return NextResponse.json({ success: false, message: "Unknown action." }, { status: 400 });
}
