// ─────────────────────────────────────────────────────────────────────────────
// /api/portal/riri — the customer's first contact.
//
//   GET  ?lenderSlug=        is Riri answering here, what is she called, and the
//                            opener — her line, her scope, and the escape hatch
//   POST { question, route, history? }   ask her something
//
// Riri Ecosystem AI plan, Sprint 2: "A customer asks about *334# and is answered
// without a thread being opened." A question that resolves never becomes a thread,
// and never becomes a number on the counter. Only what she cannot resolve reaches
// a person — and when somebody asks for a person, they get one immediately.
//
// ── THE CUSTOMER IS NEVER TRUSTED FOR IDENTITY ──────────────────────────────
// Same rule as every portal route: `borrowerFor()` gives the phone the code or the
// password door PROVED, and everything Riri says about money is read from that. The
// body names a question and a route. The route is resolved against the app's own
// map; a route that matches nothing is simply no screen.
//
// ── THE MODEL IS THE LAST RESORT, AND IT IS FENCED ──────────────────────────
// The deterministic engine (lib/riri/portal/first-response.ts) answers everything
// it recognises. Only `intent: "open"` reaches a model, with the customer's own
// facts and nothing else, and its answer is checked before it is sent: a shilling
// figure or a percentage that does not appear in those facts voids the model's
// answer and the honest floor is returned instead. "Never state a figure she did
// not read from the record" is a check in code, not a line in a prompt.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { borrowerFor, otpRequired } from "@/lib/portal/session";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { portalHost, isRefusal } from "@/lib/riri/providers/portal";
import { firstResponse, customerSystemPrompt, figuresGrounded, customerLang, type FirstResponse } from "@/lib/riri/portal/first-response";
import { escalateToTeam } from "@/lib/riri/portal/escalate";
import { generate, isLlmConfigured } from "@/lib/riri/gemini";
import { sanitizeHistory } from "@/lib/riri/assistant";
import { logRiriQuery } from "@/lib/riri/log";

export const runtime = "nodejs";

const MAX_QUESTION = 500;

export async function GET(req: NextRequest) {
  const org = await resolveOrg(req.nextUrl.searchParams.get("lenderSlug") ?? "");
  if (!org) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });
  enterOrg(org.id);

  const session = await borrowerFor(org.id);
  if (!session) return otpRequired();

  const host = portalHost({ org, session });
  const [enabled, name] = await Promise.all([host.firstResponseEnabled(), host.assistantName()]);

  return NextResponse.json({
    success: true,
    enabled,
    name,
    lender: org.name,
    // Plan §07, step 1: she opens by saying what happens when she fails. That sentence
    // is what makes a customer willing to try her at all.
    opener: {
      en: `I'm ${name}. I can help with your loan, your repayments, your limit, M-PESA Ratiba, and how Micro Eazy works — straight from your own account. If I find something I can't solve, I'll pass it to a person at ${org.name} with everything I've already checked.`,
      sw: `Mimi ni ${name}. Naweza kukusaidia na mkopo wako, malipo yako, kiwango chako, M-PESA Ratiba, na jinsi Micro Eazy inavyofanya kazi — moja kwa moja kutoka kwa akaunti yako. Nikikutana na jambo nisiloweza kulitatua, nitalipeleka kwa mtu ${org.name} pamoja na yote niliyokwisha kuangalia.`,
    },
    prompts: {
      en: ["What do I owe?", "When is my next payment?", "Do I need to dial *334# for Ratiba?", "How much can I borrow?", "Where is my application?", "I want to talk to a person"],
      sw: ["Nadaiwa kiasi gani?", "Nilipe lini?", "Ratiba ni nini?", "Naweza kukopa kiasi gani?", "Ombi langu liko wapi?", "Nataka kuongea na mtu"],
    },
  });
}

export async function POST(req: NextRequest) {
  let body: { lenderSlug?: string; question?: string; route?: string; history?: unknown; lang?: string; nationalId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 });
  }

  const org = await resolveOrg(body.lenderSlug ?? "");
  if (!org) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });
  enterOrg(org.id);

  const session = await borrowerFor(org.id);
  if (!session) return otpRequired();

  const question = (body.question ?? "").trim();
  if (!question) return NextResponse.json({ success: false, message: "Ask me something." }, { status: 400 });
  if (question.length > MAX_QUESTION) {
    return NextResponse.json({ success: false, message: "That's a bit long for me — try it in a sentence or two." }, { status: 400 });
  }

  const limited = await rateLimit(
    [
      { name: "riri:customer:phone", subject: `${org.id}:${session.phone}`, max: 40, windowSec: 600 },
      { name: "riri:customer:ip", subject: clientIp(req), max: 120, windowSec: 3600 },
    ],
    "You've asked a lot in a short time. Give me a moment, then try again.",
  );
  if (limited) return limited;

  const lang = body.lang === "sw" || body.lang === "en" ? body.lang : customerLang(question);
  const host = portalHost({ org, session, route: body.route, lang, nationalId: body.nationalId });

  const [facts, packs, assistantName] = await Promise.all([host.record(), host.packs(), host.assistantName()]);
  if (isRefusal(facts)) {
    return NextResponse.json({ success: false, message: "I can't read that from here." }, { status: 403 });
  }

  let response: FirstResponse = firstResponse({ question, facts, packs, screen: host.context.screen, lang });
  let engine: "record" | "knowledge" | "map" | "model" = engineOf(response);

  // ── THE FENCED MODEL, for questions nothing recognised ────────────────────
  if (response.intent === "open" && isLlmConfigured() && facts.bookSource !== "unavailable") {
    try {
      const system = customerSystemPrompt(facts, packs.map((p) => p.ref.pack));
      const said = await generate(system, question, sanitizeHistory(body.history), { temperature: 0.4, maxOutputTokens: 400 });
      if (figuresGrounded(said, system)) {
        response = {
          ...response,
          answer: said,
          confidence: "likely",
          checked: [...response.checked, { tool: "model", said: "Phrased by the model from the customer's own facts; figures checked against the record" }],
        };
        engine = "model";
      }
    } catch (e) {
      console.error("[riri:customer] model fallback failed:", e instanceof Error ? e.message : e);
    }
  }

  // ── A PERSON, NOW ─────────────────────────────────────────────────────────
  // "Let me get you to someone" is instant. No second tap, no sheet, no argument.
  let escalation: { threadId: string; caseRef: string } | null = null;
  let escalationError: string | null = null;
  if (response.intent === "human") {
    const done = await escalateToTeam({
      org, session,
      borrowerId: await host.borrowerId(),
      questions: [question],
      response,
      screen: host.context.screen,
      assistantName,
      applicationId: facts.application?.id ?? null,
      ip: clientIp(req),
    });
    if (done.ok) escalation = { threadId: done.threadId, caseRef: done.caseRef };
    else escalationError = done.message;
  } else {
    void logRiriQuery({
      orgId: org.id, staffId: null, model: "customer", question,
      route: `customer:${response.outcome}`,
      metricId: response.sources[0]?.id ?? `intent:${response.intent}`,
      ok: response.intent !== "open",
    });
  }

  return NextResponse.json({
    success: true,
    name: assistantName,
    outcome: escalation ? "escalated" : response.outcome,
    intent: response.intent,
    lang: response.lang,
    answer: escalationError ?? response.answer,
    engine,
    confidence: response.confidence,
    sources: response.sources,
    // What she read — shown to the customer as "what I checked", with no figure in
    // it that the answer itself did not already state.
    checked: response.checked.map((c) => c.tool),
    actions: response.actions,
    suggestions: response.suggestions,
    screen: host.context.screen ? { id: host.context.screen.id, title: host.context.screen.title } : null,
    escalation: escalation ? { threadId: escalation.threadId, caseRef: escalation.caseRef } : null,
    canEscalate: response.outcome !== "resolved" || response.intent === "open",
  });
}

function engineOf(r: FirstResponse): "record" | "knowledge" | "map" | "model" {
  if (r.intent === "knowledge" || r.intent === "dispute") return "knowledge";
  if (r.intent === "screen" || r.intent === "navigate") return "map";
  return "record";
}
