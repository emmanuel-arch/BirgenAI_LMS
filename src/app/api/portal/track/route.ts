// ─────────────────────────────────────────────────────────────────────────────
// POST /api/portal/track — where my loan actually is, right now.
//
// Body: { lenderSlug, nationalId? }
//
// The customer's half of the workflow. It renders the SAME stage chain the
// officer is working — resolved by lib/workflow/chain.ts, which both this route
// and POST /api/console/applications/[id] call — so "Risk Review" means the same
// desk on both screens and neither can drift from the other.
//
// ── WHAT IS DELIBERATELY NOT RETURNED ───────────────────────────────────────
// A stage's machinery is not the customer's business and some of it is actively
// dangerous to publish:
//
//   accessTier / roleIds / userIds   who may approve. This is the map of who to
//                                    social-engineer, and it tells a borrower
//                                    nothing about their own loan.
//   maxAmount                        the approval cap at each desk. Published,
//                                    it is an invitation to structure requests
//                                    just under whichever ceiling is softest.
//   checks / crbRequired             the gates. A borrower knowing a bureau pull
//                                    fires at stage three is fine; knowing the
//                                    exact threshold it is scored against is how
//                                    the threshold gets gamed.
//   the officer's note on a decline  shown ONLY through the conversation, where
//                                    a human chose to send it, never scraped out
//                                    of the audit log wholesale. Internal notes
//                                    are written in an internal register.
//
// What IS returned is the honest shape of the thing: what the stages are called,
// which one it is at, which are done, and how long each is meant to take.
//
// ── SLA IS SHOWN BECAUSE WAITING WITHOUT AN ESTIMATE IS THE COMPLAINT ───────
// `slaHours` is already configured per stage for escalation. Surfacing it as an
// expectation costs nothing and answers the question every waiting customer
// actually has, which no amount of stage naming does.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { borrowerFor, otpRequired } from "@/lib/portal/session";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { resolveStageChain } from "@/lib/workflow/chain";

export const runtime = "nodejs";

/** Terminal states — the chain stops mattering once one of these lands. */
const CLOSED = new Set(["APPROVED", "DISBURSED", "DECLINED", "WITHDRAWN"]);

/** The audit actions a customer may see, and what to call them in their own
 *  language. Anything not on this list is not shown — an allowlist, so a new
 *  internal action added elsewhere in the suite cannot leak onto this screen by
 *  simply existing. */
const VISIBLE_TRAIL: Record<string, string> = {
  "application.approve": "Moved forward",
  "application.finalize": "Approved",
  "application.decline": "Declined",
  "application.send-back": "Sent back for more information",
};

export async function POST(req: NextRequest) {
  let body: { lenderSlug?: string; nationalId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 });
  }

  const org = await resolveOrg(body.lenderSlug ?? "");
  if (!org) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });
  enterOrg(org.id);

  const verified = await borrowerFor(org.id);
  if (!verified) return otpRequired();

  const limited = await rateLimit([
    { name: "track:phone", subject: `${org.id}:${verified.phone}`, max: 30, windowSec: 900 },
    { name: "track:ip", subject: clientIp(req), max: 120, windowSec: 3600 },
  ]);
  if (limited) return limited;

  // The phone is server-authoritative; nationalId only narrows it when a number
  // carries more than one record.
  const nationalId = (body.nationalId ?? "").trim();
  const borrower = await prisma.borrower.findFirst({
    where: {
      orgId: org.id,
      phone: { endsWith: verified.phone.slice(-9) },
      ...(nationalId ? { nationalId } : {}),
    },
    select: { id: true, firstName: true, kycStatus: true, erasedAt: true },
    orderBy: { createdAt: "desc" },
  });
  if (!borrower || borrower.erasedAt) {
    return NextResponse.json({ success: true, found: false, lender: org.name });
  }

  const app = await prisma.loanApplication.findFirst({
    where: { orgId: org.id, borrowerId: borrower.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, orgId: true, productId: true, productName: true, currentStageId: true,
      stageTitle: true, status: true, amountRequested: true, approvedLimit: true,
      graduated: true, priorLoanCount: true, createdAt: true, decidedAt: true, updatedAt: true,
      loan: { select: { id: true, status: true, loanAmount: true, disbursedAt: true } },
    },
  });

  if (!app) {
    // Not an error, and an important answer in its own right: it is the
    // difference between "we lost your application" and "you have not made one".
    return NextResponse.json({
      success: true, found: true, lender: org.name,
      firstName: borrower.firstName, application: null,
      kycStatus: borrower.kycStatus,
    });
  }

  const [{ chain, index }, trailRows, thread] = await Promise.all([
    resolveStageChain(app),
    prisma.auditLog.findMany({
      where: { orgId: org.id, entityId: app.id, action: { in: Object.keys(VISIBLE_TRAIL) } },
      orderBy: { createdAt: "asc" },
      take: 40,
      select: { id: true, action: true, meta: true, createdAt: true },
    }),
    // So the screen can offer "ask about this" pointing at a conversation that
    // already exists, rather than opening a second one beside it.
    prisma.conversationThread.findFirst({
      where: { orgId: org.id, borrowerId: borrower.id, applicationId: app.id, state: { not: "RESOLVED" } },
      select: { id: true, unreadForBorrower: true },
      orderBy: { lastAt: "desc" },
    }),
  ]);

  const closed = CLOSED.has(app.status);
  const disbursed = app.status === "DISBURSED" || Boolean(app.loan?.disbursedAt);

  return NextResponse.json({
    success: true,
    found: true,
    lender: org.name,
    firstName: borrower.firstName,
    kycStatus: borrower.kycStatus,
    application: {
      id: app.id,
      product: app.productName,
      amount: Number(app.amountRequested),
      approvedLimit: app.approvedLimit != null ? Number(app.approvedLimit) : null,
      status: app.status,
      stageTitle: app.stageTitle,
      submittedAt: app.createdAt,
      decidedAt: app.decidedAt,
      lastMovedAt: app.updatedAt,
      declined: app.status === "DECLINED",
      // ── The chain, as the customer sees it ─────────────────────────────
      // `done` is positional rather than derived from the trail: a stage before
      // the current one has been passed, by definition. Reading it off audit
      // rows instead would show a gap wherever an action was logged under an
      // action name this route does not publish.
      stages: chain.map((s, i) => ({
        title: s.title,
        state:
          closed && !disbursed && app.status === "DECLINED" ? (i < index ? "done" : "stopped")
          : closed ? "done"
          : i < index ? "done"
          : i === index ? "current"
          : "upcoming",
        // An expectation, not a promise. Null where the lender set none, and the
        // screen says "no fixed time" rather than inventing one.
        expectedHours: s.slaHours > 0 ? s.slaHours : null,
      })),
      stepNumber: closed ? chain.length : index + 1,
      stepCount: chain.length,
    },
    loan: app.loan
      ? {
          id: app.loan.id,
          status: app.loan.status,
          amount: Number(app.loan.loanAmount),
          disbursedAt: app.loan.disbursedAt,
        }
      : null,
    trail: trailRows.map((r) => {
      const m = (r.meta ?? {}) as { stageTitle?: unknown; to?: unknown };
      return {
        id: r.id,
        label: VISIBLE_TRAIL[r.action],
        stage:
          typeof m.to === "string" ? m.to
          : typeof m.stageTitle === "string" ? m.stageTitle
          : null,
        at: r.createdAt,
      };
    }),
    conversation: thread ? { id: thread.id, unread: thread.unreadForBorrower } : null,
  });
}
