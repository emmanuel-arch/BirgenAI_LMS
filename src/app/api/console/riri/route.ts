// ServiceSuite AI — ONE endpoint, one assistant, three engines behind the glass.
//
//   support   → how the platform works, and where the screen is. Free, ungated.
//   assistant → who you are, your role, your book, the customer on your screen.
//   analytics → the live book. Catalogue metric first, guarded text-to-SQL for
//               novel questions, SQL always shown.
//
// WHAT CHANGED, AND WHY IT IS SAFER RATHER THAN LOOSER
// ---------------------------------------------------
// The client used to name the engine, because the dock made the human choose one
// before they typed. That was a real fix for a real failure (see lib/riri/router.ts
// for the full story), and it has been replaced by a better one: `model: "auto"`
// hands the finished question to a pure, deterministic, tested router. The safety
// property — a request for a hard number must not reach an engine that will reason
// one up — is now pinned by scripts/verify-router.ts instead of by a finger.
//
// The explicit ids still work. Legacy preferences, the `data-riri-open="analytics"`
// attributes scattered through the console, and the one-tap "I meant a number off
// the book" correction all send a concrete engine, and it is honoured verbatim.
//
// TWO THINGS THE COLLAPSE FORCED, AND BOTH ARE IMPROVEMENTS:
//
//   1. THE ANSWER MUST SAY WHICH ENGINE RAN. When the human picked, the tier was on
//      the screen before they asked. Now it is on the answer afterwards, with the
//      one-line reason — `engine`, `engineLabel`, `engineWhy`, `evidence`.
//   2. A PAYWALL CANNOT BE AN ERROR. Support is ungated; the other two are sold.
//      Under a switcher an unentitled lender simply never opened those tiles. In one
//      chat they will ask a number question on day one, and a 402 rendering as a red
//      bubble reads as "your software is broken". So the gate answers in prose, names
//      the package and its price, and offers the billing screen — the same shape
//      Support has always used for a feature somebody does not have.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight, getRights } from "@/lib/rbac/authz";
import { entitlementsFor } from "@/lib/billing/entitlements";
import { cheapestPlanWith } from "@/lib/billing/plans";
import { meter } from "@/lib/billing/meter";
import { normaliseModelId } from "@/lib/riri/models";
import { ASSISTANT_NAME } from "@/lib/riri/brand";
import { routeQuestion, ENGINE_LABEL, ENGINE_EVIDENCE, type Engine } from "@/lib/riri/router";
import { analyze } from "@/lib/riri/analyst";
import { answerSupport } from "@/lib/riri/support";
import { logRiriQuery } from "@/lib/riri/log";
import { askAssistant, rememberExchange, sanitizeHistory } from "@/lib/riri/assistant";
import { lmsHost } from "@/lib/riri/providers/lms";
import { appendExchange } from "@/lib/riri/threads";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const orgId = session.user.orgId;
  const staffId = session.user.id ?? null;

  let body: {
    question?: string;
    model?: string;
    lang?: string;
    subject?: { kind?: string; id?: string; name?: string };
    history?: unknown;
    threadId?: string | null;
    /** false ⇒ answer but do not file it (the Calls app's one-shot lookups). */
    save?: boolean;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const question = (body.question ?? "").trim();
  if (!question) return NextResponse.json({ success: false, message: `Ask ${ASSISTANT_NAME} something.` }, { status: 400 });
  if (question.length > 500) return NextResponse.json({ success: false, message: "That's a bit long — try a shorter question." }, { status: 400 });

  // The caller may say WHO they are asking about — an id, never the facts. Everything
  // the assistant is told about that customer is read here, from the org-scoped row, so
  // a client cannot invent a customer or edit one's balance before asking about them.
  // RLS means an id from another lender's book resolves to nothing.
  const subjectId = body.subject?.kind === "borrower" && typeof body.subject.id === "string" ? body.subject.id : null;
  const subjectName = typeof body.subject?.name === "string" ? body.subject.name : null;

  const [rights, ent] = await Promise.all([getRights(session), entitlementsFor(orgId)]);
  const features = new Set<string>(ent.features);
  const access = { rights, features };

  // ── WHICH ENGINE ───────────────────────────────────────────────────────────
  // An explicit id wins (legacy prefs, deep links, the user's own correction).
  // Otherwise the router decides from the finished question.
  const explicit = normaliseModelId(body.model);
  const routing = explicit
    ? { engine: explicit as Engine, confidence: "certain" as const, why: "", alternative: undefined }
    : routeQuestion(question, { hasSubject: !!subjectId, access });
  const engine = routing.engine;

  /** Everything every answer carries, so the client never has to guess what ran. */
  const stamp = {
    engine,
    engineLabel: ENGINE_LABEL[engine],
    engineWhy: routing.why || null,
    evidence: ENGINE_EVIDENCE[engine],
    confidence: routing.confidence,
    alternative: routing.alternative ?? null,
    routed: !explicit,
  };

  /**
   * File the exchange.
   *
   * This one IS awaited, unlike the memory write, and the reason is the thread id:
   * the client has to be told which conversation its next question belongs to, and
   * a fire-and-forget write cannot tell it. That is safe to sit in the response
   * path because `appendExchange` cannot throw — every database call inside it is
   * wrapped, and an unavailable table returns null rather than failing the answer
   * (see lib/riri/threads.ts). Worst case the lender gets their answer and it is
   * not filed, which is exactly the right way for a convenience to fail.
   */
  const file = async (answer: string, extra: {
    route?: string | null; sql?: string | null; data?: Prisma.InputJsonValue | null;
  }) => {
    if (body.save === false || !staffId) return null;
    return appendExchange({
      orgId, staffId,
      threadId: body.threadId ?? null,
      question, answer,
      engine, engineWhy: routing.why || null,
      route: extra.route ?? null,
      sql: extra.sql ?? null,
      data: extra.data ?? null,
      subject: subjectId ? { id: subjectId, name: subjectName } : null,
    });
  };

  // ── SUPPORT IS NOT SOLD, AND IS NOT GATED ──────────────────────────────────
  //
  // Every other engine needs `riri.use` and the `riri` plan feature. Support needs
  // neither, deliberately: a lender on the smallest package who cannot get help is a
  // lender who churns, and metering "how do I disburse a loan?" would be a tax on not
  // understanding our own software. It is still rights-AWARE, just in the opposite
  // direction: it reads the caller's rights so it never explains a screen they cannot
  // open (src/lib/riri/support.ts, src/lib/riri/guide.ts).
  if (engine === "support") {
    const r = await answerSupport(orgId, question, {
      rights,
      features,
      firstName: session.user.name?.split(" ")[0] ?? null,
      orgName: session.user.orgSlug ?? undefined,
      lang: body.lang === "sw" || body.lang === "en" ? body.lang : undefined,
    });

    void logRiriQuery({ orgId, staffId, model: engine, question, route: "knowledge", metricId: r.articleId ?? null, ok: true });
    const filed = await file(r.answer, { route: "knowledge", data: { actions: r.actions, suggestions: r.suggestions } });

    return NextResponse.json({
      success: true, ...stamp, model: engine, mode: "live", route: "knowledge",
      answer: r.answer, kind: "support",
      actions: r.actions, suggestions: r.suggestions,
      threadId: filed?.threadId ?? body.threadId ?? null,
      threadTitle: filed?.title ?? null,
    });
  }

  // ── THE SOLD ENGINES ───────────────────────────────────────────────────────
  const denied = await requireRight(session, "riri.use");
  if (denied) return denied;

  // A paywall in a single chat has to be an ANSWER, not an error. See the header.
  if (!features.has("riri")) {
    const plan = cheapestPlanWith("riri");
    const answer =
      engine === "analytics"
        ? `That's a question for your live book, and reading your book isn't on your package yet.\n\n` +
          (plan
            ? `It comes with **${plan.name}** (KES ${plan.monthlyKes.toLocaleString()}/mo) — I'd pull the figure straight from your data and show you the SQL behind it.\n\n`
            : "") +
          `In the meantime I can still explain anything about the platform, and your loan book keeps working exactly as it does now.`
        : `That one needs me to reason over your book, and that isn't on your package yet.\n\n` +
          (plan ? `It comes with **${plan.name}** (KES ${plan.monthlyKes.toLocaleString()}/mo).\n\n` : "") +
          `Ask me how anything on the platform works, though — that's always free.`;

    void logRiriQuery({ orgId, staffId, model: engine, question, route: "refused", ok: false, error: "feature:riri" });
    const filed = await file(answer, { route: "refused" });

    return NextResponse.json({
      success: true, ...stamp, model: engine, mode: "live", route: "refused",
      answer, kind: "upgrade",
      actions: [{ kind: "navigate", label: "See packages", href: "/console/billing" }],
      suggestions: ["What do the packages include?", "How do I upgrade?"],
      threadId: filed?.threadId ?? body.threadId ?? null,
      threadTitle: filed?.title ?? null,
    });
  }

  try {
    if (engine === "analytics") {
      const r = await analyze(orgId, question);

      void meter(orgId, "riri_query", 1, { model: engine, mode: "live", route: r.route });
      void logRiriQuery({
        orgId, staffId, model: engine, question,
        route: r.route, metricId: r.metricId ?? null,
        sql: r.sql ?? null, rows: r.rows ?? null, ms: r.ms ?? null,
        ok: r.ok, error: r.error ?? null,
      });

      const filed = await file(r.answer, {
        route: r.route, sql: r.sql ?? null,
        data: { chips: r.chips ?? null, series: r.series ?? null, table: r.table ?? null, rows: r.rows ?? null, ms: r.ms ?? null } as Prisma.InputJsonValue,
      });

      return NextResponse.json({
        success: true, ...stamp, model: engine,
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
        threadId: filed?.threadId ?? body.threadId ?? null,
        threadTitle: filed?.title ?? null,
      });
    }

    // ── The assistant. A real model, told who is asking and what is true. ────
    // The session carries the slug; it says the lender's name out loud, and
    // "techcrast" is not what anyone calls Techcrast Software Solutions.
    const org = await prisma.org.findUnique({ where: { id: orgId }, select: { name: true } });
    const host = lmsHost({
      orgId, lenderName: org?.name ?? "your lender", staffId, rights,
      // A platform admin acting as this lender is not a StaffUser — without this
      // the founder would be addressed as an anonymous "colleague".
      session: { name: session.user.name, role: session.user.role },
    });
    const r = await askAssistant(host, question, {
      subject: subjectId ? { kind: "borrower", id: subjectId } : null,
      history: sanitizeHistory(body.history),
    });

    void meter(orgId, "riri_query", 1, { model: engine, mode: r.mode });
    void logRiriQuery({ orgId, staffId, model: engine, question, route: "assistant", ok: true });

    // It decides what was worth keeping, after the answer is already on its way.
    // Never awaited: a slow memory write must not cost the officer a second.
    if (staffId && r.mode === "live") {
      void rememberExchange(host, staffId, question, r.answer, r.subjectId);
    }

    const filed = await file(r.answer, { route: "assistant" });

    return NextResponse.json({
      success: true, ...stamp, model: engine, mode: r.mode, answer: r.answer,
      kind: "reasoning", route: "assistant",
      threadId: filed?.threadId ?? body.threadId ?? null,
      threadTitle: filed?.title ?? null,
    });
  } catch (e) {
    console.error("[riri]", e);
    void logRiriQuery({
      orgId, staffId, model: engine, question, route: "refused", ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ success: false, message: `${ASSISTANT_NAME} hit a snag answering that. Try rephrasing.` }, { status: 500 });
  }
}
