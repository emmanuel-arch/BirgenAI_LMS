// Riri — the console AI. One endpoint, three models:
//   • analyst → REAL semantic metric layer over the org's live loan book
//   • copilot → operations co-pilot (simulation-first LLM → live)
//   • max     → frontier strategy tier (simulation-first LLM → live)
// Every query meters a `riri_query` UsageEvent for Intelligence-Suite billing.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { requireFeature } from "@/lib/billing/entitlements";
import { meter } from "@/lib/billing/meter";
import { isRiriModel } from "@/lib/riri/models";
import { analyze } from "@/lib/riri/analyst";
import { answerReasoning } from "@/lib/riri/copilot";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "riri.use");
  if (denied) return denied;
  const orgId = session.user.orgId;

  const gated = await requireFeature(orgId, "riri");
  if (gated) return gated;

  let body: { question?: string; model?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const question = (body.question ?? "").trim();
  const model = isRiriModel(body.model) ? body.model : "analyst";
  if (!question) return NextResponse.json({ success: false, message: "Ask Riri something." }, { status: 400 });
  if (question.length > 500) return NextResponse.json({ success: false, message: "That's a bit long — try a shorter question." }, { status: 400 });

  try {
    let payload: Record<string, unknown>;
    let mode: "live" | "simulation";

    if (model === "analyst") {
      const r = await analyze(orgId, question);
      mode = "live"; // reads real rows — no credential, no simulation
      payload = { answer: r.answer, kind: r.kind, chips: r.chips ?? null, series: r.series ?? null, table: r.table ?? null };
    } else {
      const r = await answerReasoning(model, orgId, question);
      mode = r.mode;
      payload = { answer: r.answer, kind: "reasoning" };
    }

    void meter(orgId, "riri_query", 1, { model, mode });

    return NextResponse.json({ success: true, model, mode, ...payload });
  } catch (e) {
    console.error("[riri]", e);
    return NextResponse.json({ success: false, message: "Riri hit a snag answering that. Try rephrasing." }, { status: 500 });
  }
}
