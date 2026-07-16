// Riri's opening briefing on a customer.
//
// When an officer presses Ask Riri from a customer's page, she should already know who
// she is looking at. This is where that comes from — and it is deliberately NOT a model
// answer. Every line is read out of our own rows (lib/riri/context.ts), org-scoped by
// RLS, so what she opens with is true by construction rather than true if the model
// behaved. No key required, nothing metered: this is a read of the page the officer is
// already on, not a question.
//
// The client sends an id. It never sends the facts — see lib/riri/context.ts.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRights } from "@/lib/rbac/authz";
import { actorContext, borrowerContext } from "@/lib/riri/context";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const orgId = session.user.orgId;

  let body: { kind?: string; id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  if (body.kind !== "borrower" || typeof body.id !== "string" || !body.id) {
    return NextResponse.json({ success: false, message: "Name a customer." }, { status: 400 });
  }

  const rights = await getRights(session);
  // Riri may not brief someone on a customer they are not allowed to open. The Ask Riri
  // button lives on a page that already requires this right, but the endpoint cannot
  // assume it was reached from there.
  if (!rights.has("borrowers.view")) {
    return NextResponse.json({ success: false, message: "You do not have access to customers." }, { status: 403 });
  }

  const [actor, subject] = await Promise.all([
    actorContext(orgId, session.user.id ?? null, rights),
    borrowerContext(orgId, body.id),
  ]);
  if (!subject) return NextResponse.json({ success: false, message: "That customer is not on your book." }, { status: 404 });

  const greeting = actor.name ? `${actor.name.split(" ")[0]}, here` : "Here";
  const answer = [
    `${greeting} is what I can see on this customer:`,
    "",
    ...subject.lines.map((l) => `• ${l}`),
    "",
    "Ask me anything about them — or about the book they sit in.",
  ].join("\n");

  return NextResponse.json({ success: true, answer, subject: { kind: subject.kind, id: subject.id } });
}
