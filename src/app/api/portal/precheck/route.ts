// ─────────────────────────────────────────────────────────────────────────────
// POST /api/portal/precheck — where does this number belong, BEFORE a code is sent?
//
// Body: { lenderSlug, phone }  →  { success, route, ... }
//
// The create-account door calls this first, and the app routes on the answer
// instead of rendering an error:
//
//   new               send the code; onboarding under the lender's own rules
//   local             they began with us already; send the code and resume
//   fintech           an account exists on this lender's book; sign in instead
//   africa-active     the account is on Micromart's field book; the other portal
//   africa-portal     same, and not scheduled to move
//   africa-pipeline   settled on the field book; moves to Fintech on `eligibleOn`
//   both              on two books; a case is opened and the customer given a ref
//   unreachable       we could not ask — NEVER treated as "new"
//
// ── WHY THIS IS NOT THE MEMBERSHIP ORACLE THE OTHER DOORS REFUSE TO BE ──────
// It answers a routing question with a route, and nothing a stranger could use:
// no name, no balance, no loan state beyond "their account is served elsewhere".
// It is also throttled per number and per address, far tighter than a person
// creating one account ever needs.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { toMsisdn, isKenyanMsisdn } from "@/lib/portal/session";
import { precheckBooks, maskPhone, type PrecheckRoute } from "@/lib/portal/precheck";

export const runtime = "nodejs";

/** Micromart's own contact lines, printed on their loan agreement. */
const MICROMART_SUPPORT = { phone: "+254 20 2 736 622", email: "info@micromartafrica.com" };

/** The other portal — Micromart Africa's own customer app. */
const AFRICA_PORTAL = process.env.MICROMART_AFRICA_PORTAL_URL?.trim() || "https://pwa.servicesuitecloud.com/";

export async function POST(req: NextRequest) {
  let body: { lenderSlug?: string; phone?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 });
  }

  const org = await resolveOrg(body.lenderSlug ?? "");
  if (!org) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });
  enterOrg(org.id);

  const phone = toMsisdn(body.phone ?? "");
  if (!isKenyanMsisdn(phone)) {
    return NextResponse.json({ success: false, field: "phone", message: "Enter the number your M-Pesa is on." }, { status: 400 });
  }

  const limited = await rateLimit(
    [
      { name: "precheck:phone", subject: `${org.id}:${phone}`, max: 8, windowSec: 900 },
      { name: "precheck:ip", subject: clientIp(req), max: 40, windowSec: 900 },
    ],
    "Too many attempts from here. Please wait a few minutes and try again.",
  );
  if (limited) return limited;

  // ── Our own book first: cheap, ours, cannot be down ─────────────────────────
  const local = await prisma.borrower.findFirst({
    where: { orgId: org.id, phone: { endsWith: phone.slice(-9) }, erasedAt: null },
    select: { id: true, serviceSuiteBorrowerId: true },
  });

  // A native lender has one book and we just read it.
  if (!org.bridgedReady || !org.registry) {
    return NextResponse.json({ success: true, route: local ? "local" : "new", lender: org.name });
  }

  let answer: PrecheckRoute;
  try {
    answer = await precheckBooks(org.registry, phone);
  } catch {
    answer = { route: "unreachable" };
  }

  // Somebody who began onboarding with us and is not yet on the lender's book is
  // resumed, not restarted — and not mistaken for a stranger.
  if (answer.route === "new" && local) {
    return NextResponse.json({ success: true, route: "local", lender: org.name });
  }

  if (answer.route === "unreachable") {
    return NextResponse.json(
      {
        success: true,
        route: "unreachable",
        lender: org.name,
        message: `We could not reach ${org.name} to check this number. Nothing is wrong with it — please try again in a moment.`,
      },
      { status: 200 },
    );
  }

  if (answer.route === "both") {
    // ── A CASE, NOT A SENTENCE ──────────────────────────────────────────────
    // Recorded once per number per day, so a customer who presses the button
    // three times is one case with one reference rather than three.
    const since = new Date(Date.now() - 24 * 3_600_000);
    const prior = await prisma.auditLog.findFirst({
      where: { orgId: org.id, action: "portal.escalation.dual-book", entityId: phone, createdAt: { gte: since } },
      select: { id: true },
    });
    const row =
      prior ??
      (await prisma.auditLog.create({
        data: {
          orgId: org.id,
          actorType: "system",
          action: "portal.escalation.dual-book",
          entity: "Phone",
          entityId: phone,
          ip: clientIp(req),
          meta: {
            phoneMasked: maskPhone(phone),
            borrowerIds: answer.borrowerIds,
            books: ["3002", "3005"],
            raisedFrom: "micro-eazy/welcome",
            needs: "IT to merge or retire one record before this customer can use either app.",
          },
        },
        select: { id: true },
      }));
    return NextResponse.json({
      success: true,
      route: "both",
      lender: org.name,
      caseRef: `ME-${row.id.slice(0, 8).toUpperCase()}`,
      support: MICROMART_SUPPORT,
    });
  }

  return NextResponse.json({
    success: true,
    ...answer,
    lender: org.name,
    ...(answer.route === "africa-active" || answer.route === "africa-portal" || answer.route === "africa-pipeline"
      ? { portalUrl: AFRICA_PORTAL }
      : {}),
  });
}
