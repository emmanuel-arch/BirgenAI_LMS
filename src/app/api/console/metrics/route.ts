// The metric catalogue — Riri's semantic layer, made inspectable.
//
//   GET  → every measure Riri knows: what it means, the SQL that computes it, the
//          words she answers to, this lender's target, and the questions their staff
//          have actually asked her (including the ones she could not answer).
//   POST → { metricId, label?, synonyms?, enabled?, target?, targetDirection? }
//
// The GET is the point of the whole item. A lender who is told "PAR 30 is 36%" by an
// AI has no way to challenge it; a lender who can read the definition, see the SQL,
// and check it against their own book can. Showing the query is not a debugging
// affordance — it is what makes the number admissible.
//
// What a lender may change is deliberately narrow (definitions.ts): their words,
// their targets, what they hide. Never the arithmetic — PAR 30 is a number they
// report to a regulator, and a lender who could redefine it could flatter it.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight, hasRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { requireFeature } from "@/lib/billing/entitlements";
import { bind, compile, metricSpec, type MetricSpec } from "@/lib/riri/catalog";
import { metricsFor, saveOverlay } from "@/lib/riri/definitions";
import { displaySql, usingReadReplica } from "@/lib/riri/readpath";
import { READ_SURFACE } from "@/lib/riri/guard";

export const runtime = "nodejs";

/** The statement this metric compiles to, with a stand-in org so it reads cleanly. */
function definitionSql(spec: MetricSpec): string {
  const { sql, params } = bind(compile(spec), "your-org-id");
  return displaySql(sql, params);
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "metrics.view");
  if (denied) return denied;
  const orgId = session.user.orgId;

  // The catalogue describes what Riri can do; an org without Riri shouldn't be
  // browsing it as though they had her.
  const gated = await requireFeature(orgId, "riri");
  if (gated) return gated;

  const [metrics, log] = await Promise.all([
    metricsFor(orgId),
    prisma.ririQueryLog.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, question: true, model: true, route: true, metricId: true, sql: true, rows: true, ms: true, ok: true, error: true, createdAt: true },
    }),
  ]);

  return NextResponse.json({
    success: true,
    canManage: await hasRight(session, "metrics.manage"),
    readSurface: READ_SURFACE,
    readReplica: usingReadReplica(),
    metrics: metrics.map((m) => {
      const spec = metricSpec(m.id)!;
      return {
        id: m.id,
        label: m.displayLabel,
        catalogLabel: spec.label,
        unit: spec.unit,
        description: spec.description,
        synonyms: m.allSynonyms,
        ownSynonyms: m.allSynonyms.filter((s) => !spec.synonyms.includes(s)),
        enabled: m.enabled,
        target: m.target,
        targetDirection: m.targetDirection,
        customised: m.customised,
        dimensions: Object.entries(spec.dimensions ?? {}).map(([id, d]) => ({ id, label: d!.label })),
        period: Boolean(spec.timeColumn),
        sql: definitionSql(spec),
      };
    }),
    // Refusals first is deliberate: the questions Riri could NOT answer are the ones
    // worth a human's attention, and they are what tells us which metric to add next.
    log: log.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "metrics.manage");
  if (denied) return denied;
  const orgId = session.user.orgId;

  const gated = await requireFeature(orgId, "riri");
  if (gated) return gated;

  let body: { metricId?: string } & Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const metricId = String(body.metricId ?? "");
  const result = await saveOverlay(orgId, metricId, body);
  if (!result.ok) return NextResponse.json({ success: false, message: result.reason }, { status: 400 });

  await prisma.auditLog.create({
    data: {
      orgId, actorId: session.user.id, actorType: "staff", action: "metrics.update",
      entity: "MetricDefinition", entityId: metricId,
      meta: result.overlay as object,
    },
  }).catch(() => {});

  const metrics = await metricsFor(orgId);
  const m = metrics.find((x) => x.id === metricId)!;
  return NextResponse.json({
    success: true,
    metric: { id: m.id, label: m.displayLabel, synonyms: m.allSynonyms, enabled: m.enabled, target: m.target, targetDirection: m.targetDirection, customised: m.customised },
  });
}
