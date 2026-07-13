// POST /api/console/reports/custom — the Report Builder's engine.
//
// The user COMPOSES a report out of the metric catalogue (the same one Riri
// quotes from — she knows every published column, and this is that knowledge
// with checkboxes). Each selected measure runs through the analyst engine
// EXACTLY as if it had been asked in the dock: same compiled SQL, same
// security_invoker views, same read-only transaction, same guard. There is no
// second query path to audit — a report is a batch of Riri questions with a
// letterhead.
//
// Billing follows the same rule as the dock: every measure is one riri_query.
// The builder says so before the user runs it; nothing here is a surprise line
// on an invoice.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { requireFeature } from "@/lib/billing/entitlements";
import { meter } from "@/lib/billing/meter";
import { analyze } from "@/lib/riri/analyst";
import { logRiriQuery } from "@/lib/riri/log";
import { METRICS } from "@/lib/riri/catalog";

export const runtime = "nodejs";
export const maxDuration = 60;

const PERIODS: Record<string, string> = {
  all: "",
  "this-month": " this month",
  "last-month": " last month",
  "90d": " in the last 90 days",
};
const SLICES: Record<string, string> = {
  none: "",
  product: " by product",
  branch: " by branch",
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "reports.view");
  if (denied) return denied;
  const orgId = session.user.orgId;

  const gated = await requireFeature(orgId, "riri");
  if (gated) return gated;

  let body: { metricIds?: string[]; period?: string; slice?: string; title?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const ids = Array.isArray(body.metricIds) ? body.metricIds.slice(0, 12) : [];
  const specs = ids
    .map((id) => METRICS.find((m) => m.id === id))
    .filter((m): m is (typeof METRICS)[number] => !!m);
  if (specs.length === 0) return NextResponse.json({ success: false, message: "Pick at least one measure." }, { status: 400 });

  const period = PERIODS[body.period ?? "all"] ?? "";
  const slice = SLICES[body.slice ?? "none"] ?? "";

  const items = [];
  for (const spec of specs) {
    // The question is composed the way a person would say it — the analyst's
    // router owns period/slice parsing, so the builder and the dock can never
    // interpret "last month" differently.
    const question = `${spec.synonyms[0] ?? spec.label}${period}${slice}`.trim();
    const r = await analyze(orgId, question);
    void meter(orgId, "riri_query", 1, { model: "analyst", mode: "live", route: r.route, via: "report-builder" });
    void logRiriQuery({
      orgId, staffId: session.user.id ?? null, model: "analyst", question,
      route: r.route, metricId: r.metricId ?? null, sql: r.sql ?? null,
      rows: r.rows ?? null, ms: r.ms ?? null, ok: r.ok, error: r.error ?? null,
    });
    items.push({
      metricId: spec.id,
      label: spec.label,
      description: spec.description,
      question,
      ok: r.ok,
      answer: r.answer,
      chips: r.chips ?? null,
      series: r.series ?? null,
      table: r.table ?? null,
      sql: r.sql ?? null,
    });
  }

  return NextResponse.json({
    success: true,
    title: (body.title ?? "").trim().slice(0, 120) || "Portfolio report",
    generatedAt: new Date().toISOString(),
    generatedBy: session.user.name ?? "staff",
    items,
  });
}
