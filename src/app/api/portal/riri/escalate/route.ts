// ─────────────────────────────────────────────────────────────────────────────
// POST /api/portal/riri/escalate — "yes, raise it with the team".
//
// Body: { lenderSlug, questions: string[], route?, note? }
//
// The customer accepted Riri's offer, or tapped the hand-off she recommended on a
// money dispute. What arrives here is ONLY what is theirs to send: the questions
// they typed, and anything they want to add. What Riri checked is re-read on the
// server, now, from the record — see lib/riri/portal/triage.ts for why a triage
// note assembled in a browser must never reach an officer's queue.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { borrowerFor, otpRequired } from "@/lib/portal/session";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { portalHost, isRefusal } from "@/lib/riri/providers/portal";
import { firstResponse, customerLang } from "@/lib/riri/portal/first-response";
import { escalateToTeam } from "@/lib/riri/portal/escalate";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { lenderSlug?: string; questions?: unknown; route?: string; note?: string; nationalId?: string };
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

  // Bounded because this writes a row and puts work on an officer's desk.
  const limited = await rateLimit(
    [{ name: "riri:escalate:phone", subject: `${org.id}:${session.phone}`, max: 6, windowSec: 3600 }],
    "You've raised a few cases in the last hour. The team has them — their replies will appear in Messages.",
  );
  if (limited) return limited;

  const questions = (Array.isArray(body.questions) ? body.questions : [])
    .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
    .map((q) => q.trim().slice(0, 500))
    .slice(-6);
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1500) : null;
  const last = questions[questions.length - 1] ?? "";

  const lang = customerLang(last || note || "");
  const host = portalHost({ org, session, route: body.route, lang, nationalId: body.nationalId });
  const [facts, packs, assistantName] = await Promise.all([host.record(), host.packs(), host.assistantName()]);
  if (isRefusal(facts)) return NextResponse.json({ success: false, message: "I can't read that from here." }, { status: 403 });

  // Re-derived, never received. With no question at all this is a request for a person.
  const response = firstResponse({
    question: last || "I want to talk to a person",
    facts, packs, screen: host.context.screen, lang,
  });

  const done = await escalateToTeam({
    org, session,
    borrowerId: await host.borrowerId(),
    questions,
    response: response.needsHuman ? response : { ...response, needsHuman: "The customer asked to take this further with the team after Riri's answer." },
    screen: host.context.screen,
    note,
    assistantName,
    applicationId: facts.application?.id ?? null,
    ip: clientIp(req),
  });

  if (!done.ok) return NextResponse.json({ success: false, reason: done.reason, message: done.message }, { status: 409 });

  return NextResponse.json({
    success: true,
    threadId: done.threadId,
    caseRef: done.caseRef,
    created: done.created,
    message:
      lang === "sw"
        ? `Nimeipeleka kwa timu ${org.name} — kesi ${done.caseRef}. Wataona ulichouliza na nilichoangalia, na jibu lao litaonekana kwenye Messages.`
        : `Done — I've passed this to the team at ${org.name} as case ${done.caseRef}. They can see what you asked and what I checked, and their reply will appear in Messages.`,
  });
}
