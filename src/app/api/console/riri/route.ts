// Riri — the console AI. One endpoint, three models:
//   • analyst → the semantic metric layer over the org's live book (real SQL, shown)
//   • copilot → operations co-pilot (simulation-first LLM → live)
//   • max     → frontier strategy tier (simulation-first LLM → live)
//
// Every query meters a `riri_query` UsageEvent for Intelligence-Suite billing, and
// every query — answered, refused or failed — is written to RiriQueryLog with the
// SQL that ran. The refusals are the valuable half: they are the questions the metric
// catalogue could not yet express.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { requireFeature } from "@/lib/billing/entitlements";
import { meter } from "@/lib/billing/meter";
import { isRiriModel } from "@/lib/riri/models";
import { analyze } from "@/lib/riri/analyst";
import { answerReasoning } from "@/lib/riri/copilot";
import { logRiriQuery } from "@/lib/riri/log";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "riri.use");
  if (denied) return denied;
  const orgId = session.user.orgId;
  const staffId = session.user.id ?? null;

  const gated = await requireFeature(orgId, "riri");
  if (gated) return gated;

  let body: { question?: string; model?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const question = (body.question ?? "").trim();
  const model = isRiriModel(body.model) ? body.model : "analyst";
  if (!question) return NextResponse.json({ success: false, message: "Ask Riri something." }, { status: 400 });
  if (question.length > 500) return NextResponse.json({ success: false, message: "That's a bit long — try a shorter question." }, { status: 400 });

  try {
    if (model === "analyst") {
      const r = await analyze(orgId, question);

      void meter(orgId, "riri_query", 1, { model, mode: "live", route: r.route });
      void logRiriQuery({
        orgId, staffId, model, question,
        route: r.route, metricId: r.metricId ?? null,
        sql: r.sql ?? null, rows: r.rows ?? null, ms: r.ms ?? null,
        ok: r.ok, error: r.error ?? null,
      });

      return NextResponse.json({
        success: true,
        model,
        mode: "live", // reads real rows — no credential, no simulation
        answer: r.answer,
        kind: r.kind,
        route: r.route,
        chips: r.chips ?? null,
        series: r.series ?? null,
        table: r.table ?? null,
        sql: r.sql ?? null,
        rows: r.rows ?? null,
        ms: r.ms ?? null,
      });
    }

    const r = await answerReasoning(model, orgId, question);

    void meter(orgId, "riri_query", 1, { model, mode: r.mode });
    void logRiriQuery({ orgId, staffId, model, question, route: "narrative", ok: true });

    return NextResponse.json({ success: true, model, mode: r.mode, answer: r.answer, kind: "reasoning", route: "narrative" });
  } catch (e) {
    console.error("[riri]", e);
    void logRiriQuery({
      orgId, staffId, model, question, route: "refused", ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ success: false, message: "Riri hit a snag answering that. Try rephrasing." }, { status: 500 });
  }
}
