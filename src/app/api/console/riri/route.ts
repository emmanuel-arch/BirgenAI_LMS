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
import { requireRight, getRights } from "@/lib/rbac/authz";
import { requireFeature, entitlementsFor } from "@/lib/billing/entitlements";
import { meter } from "@/lib/billing/meter";
import { isRiriModel } from "@/lib/riri/models";
import { analyze } from "@/lib/riri/analyst";
import { answerReasoning } from "@/lib/riri/copilot";
import { answerSupport } from "@/lib/riri/support";
import { logRiriQuery } from "@/lib/riri/log";
import { actorContext, borrowerContext, contextPreamble } from "@/lib/riri/context";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const orgId = session.user.orgId;
  const staffId = session.user.id ?? null;

  let body: { question?: string; model?: string; lang?: string; subject?: { kind?: string; id?: string } };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const question = (body.question ?? "").trim();
  const model = isRiriModel(body.model) ? body.model : "analyst";

  // The caller may say WHO they are asking about — an id, never the facts. Everything
  // Riri is told about that customer is read here, from the org-scoped row, so a client
  // cannot invent a customer or edit one's balance before asking about them. RLS means
  // an id from another lender's book resolves to nothing. See lib/riri/context.ts.
  const subjectId = body.subject?.kind === "borrower" && typeof body.subject.id === "string" ? body.subject.id : null;
  if (!question) return NextResponse.json({ success: false, message: "Ask Riri something." }, { status: 400 });
  if (question.length > 500) return NextResponse.json({ success: false, message: "That's a bit long — try a shorter question." }, { status: 400 });

  // ── SUPPORT IS NOT SOLD, AND IS NOT GATED ──────────────────────────────────
  //
  // Every other Riri tier needs `riri.use` and the `riri` plan feature. Support needs
  // neither, deliberately: a lender on the 10,000/mo package who cannot get help is a
  // lender who churns, and metering "how do I disburse a loan?" would be a tax on not
  // understanding our own software. It is also the surface that makes the rest of the
  // product usable, so putting it behind the paywall would be self-defeating.
  //
  // It IS still rights-aware — just in the opposite direction: Riri reads the caller's
  // rights so she never explains a screen they cannot open (src/lib/riri/support.ts).
  if (model === "support") {
    const [rights, ent] = await Promise.all([getRights(session), entitlementsFor(orgId)]);
    const features = new Set<string>(ent.features);

    const r = await answerSupport(orgId, question, {
      rights,
      features,
      firstName: session.user.name?.split(" ")[0] ?? null,
      orgName: session.user.orgSlug ?? undefined,
      // The voice path knows what the microphone was set to; typed questions
      // let the words themselves decide (detectLang in knowledge.ts).
      lang: body.lang === "sw" || body.lang === "en" ? body.lang : undefined,
    });

    void logRiriQuery({
      orgId, staffId, model, question,
      route: "knowledge", metricId: r.articleId ?? null, ok: true,
    });

    return NextResponse.json({
      success: true, model, mode: "live", route: "knowledge",
      answer: r.answer, kind: "support",
      actions: r.actions, suggestions: r.suggestions,
    });
  }

  const denied = await requireRight(session, "riri.use");
  if (denied) return denied;

  const gated = await requireFeature(orgId, "riri");
  if (gated) return gated;

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

    // Who is asking, and who they have on screen. Both server-built — see
    // lib/riri/context.ts for why neither is ever taken from the browser.
    const [rights, subject] = await Promise.all([
      getRights(session),
      subjectId ? borrowerContext(orgId, subjectId) : Promise.resolve(null),
    ]);
    const actor = await actorContext(orgId, staffId, rights);
    const r = await answerReasoning(model, orgId, question, contextPreamble(actor, subject));

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
