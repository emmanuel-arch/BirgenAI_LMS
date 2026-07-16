// Riri — the console AI. One endpoint, three tiers:
//   • support   → how the platform works. Free, ungated, never metered.
//   • assistant → Riri 2.5: who you are, your role, your book, the customer on screen.
//   • analytics → Riri 2.5 Max: the live book. Catalogue metric first, guarded
//                 text-to-SQL for novel questions, SQL always shown.
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
import { normaliseModelId } from "@/lib/riri/models";
import { analyze } from "@/lib/riri/analyst";
import { answerSupport } from "@/lib/riri/support";
import { logRiriQuery } from "@/lib/riri/log";
import { askAssistant, rememberExchange, sanitizeHistory } from "@/lib/riri/assistant";
import { lmsHost } from "@/lib/riri/providers/lms";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const orgId = session.user.orgId;
  const staffId = session.user.id ?? null;

  let body: { question?: string; model?: string; lang?: string; subject?: { kind?: string; id?: string }; history?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const question = (body.question ?? "").trim();
  // Legacy ids (copilot/analyst/max) still arrive from saved preferences — translate
  // rather than silently resetting someone to Support.
  const model = normaliseModelId(body.model) ?? "analytics";

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
    if (model === "analytics") {
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

    // ── The assistant. A real model, told who is asking and what is true. ────
    if (model === "assistant") {
      // The session carries the slug; Riri says the lender's name out loud, and
      // "techcrast" is not what anyone calls Techcrast Software Solutions.
      const [rights, org] = await Promise.all([
        getRights(session),
        prisma.org.findUnique({ where: { id: orgId }, select: { name: true } }),
      ]);
      const host = lmsHost({
        orgId, lenderName: org?.name ?? "your lender", staffId, rights,
        // A platform admin acting as this lender is not a StaffUser — without this
        // Riri would address the founder as an anonymous "colleague".
        session: { name: session.user.name, role: session.user.role },
      });
      // Prior turns of this conversation, so "what about last month?" has an
      // antecedent. Sanitised for shape and size; see sanitizeHistory for the trust story.
      const r = await askAssistant(host, question, {
        subject: subjectId ? { kind: "borrower", id: subjectId } : null,
        history: sanitizeHistory(body.history),
      });

      void meter(orgId, "riri_query", 1, { model, mode: r.mode });
      void logRiriQuery({ orgId, staffId, model, question, route: "assistant", ok: true });

      // She decides what was worth keeping, after the answer is already on its way.
      // Never awaited: a slow memory write must not cost the officer a second.
      if (staffId && r.mode === "live") {
        void rememberExchange(host, staffId, question, r.answer, r.subjectId);
      }

      return NextResponse.json({ success: true, model, mode: r.mode, answer: r.answer, kind: "reasoning", route: "assistant" });
    }

    // Unreachable: support/analytics/assistant is the whole lineup, and each returned
    // above. Kept as a loud failure rather than a silent fallthrough, so adding a tier
    // and forgetting to route it is a 500 in testing, not a blank bubble in production.
    throw new Error(`No handler for Riri model "${model}".`);
  } catch (e) {
    console.error("[riri]", e);
    void logRiriQuery({
      orgId, staffId, model, question, route: "refused", ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ success: false, message: "Riri hit a snag answering that. Try rephrasing." }, { status: 500 });
  }
}
