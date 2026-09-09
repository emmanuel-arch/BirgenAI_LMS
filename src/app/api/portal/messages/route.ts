// ─────────────────────────────────────────────────────────────────────────────
// GET  /api/portal/messages                 — my conversations
// GET  /api/portal/messages?threadId=…      — one conversation, and mark it read
// POST /api/portal/messages                 — write to my lender
//
// The customer's half of the thing this platform did not have. Until now a
// borrower whose liveness check failed could ring the office and hope; there was
// no channel from the app into the case file, and no way for the officer holding
// that case to answer where the customer would see it.
//
// ── THE BORROWER IS NEVER TRUSTED FOR IDENTITY ──────────────────────────────
// `borrowerFor()` gives the phone that was PROVEN by the code or the password
// door, and the borrower row is looked up from that. Nothing in the request body
// names a person. So `threadId` is not a capability: a thread is loaded only
// after its `borrowerId` is checked against the session's own borrower, and a
// guessed uuid answers 404 exactly as an absent one does.
//
// ── WHY POSTING CANNOT OPEN A THREAD ABOUT ANY APPLICATION ID ───────────────
// `applicationId` is accepted on POST, and it is VERIFIED to belong to this
// borrower before it is stored. Without that check, a customer could pin their
// message to somebody else's application and an officer opening the queue would
// read one person's question against another person's file — which is both a
// data leak and a decision made on the wrong evidence.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { borrowerFor, otpRequired } from "@/lib/portal/session";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { findOrOpenThread, postMessage, markRead, MAX_BODY } from "@/lib/conversation/threads";
import type { ThreadKind } from "@prisma/client";

export const runtime = "nodejs";

const THREAD_KINDS: ThreadKind[] = ["APPLICATION", "KYC_REVIEW", "LOAN", "REPAYMENT", "GENERAL"];

/** A conversation is a screen, not an archive. */
const MAX_THREADS = 50;
const MAX_MESSAGES = 200;

/** Resolve the signed-in borrower's own row, or null. */
async function me(orgId: string, phone: string) {
  return prisma.borrower.findFirst({
    where: { orgId, phone: { endsWith: phone.slice(-9) } },
    select: { id: true, firstName: true, otherName: true, erasedAt: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function GET(req: NextRequest) {
  const org = await resolveOrg(req.nextUrl.searchParams.get("lenderSlug") ?? "");
  if (!org) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });
  enterOrg(org.id);

  const verified = await borrowerFor(org.id);
  if (!verified) return otpRequired();

  const borrower = await me(org.id, verified.phone);
  // No borrower row yet is a perfectly normal answer — somebody who has verified
  // a phone but not yet enrolled. An empty list, not an error.
  if (!borrower || borrower.erasedAt) {
    return NextResponse.json({ success: true, threads: [], lender: org.name });
  }

  const threadId = req.nextUrl.searchParams.get("threadId");

  // ── One conversation ──────────────────────────────────────────────────────
  if (threadId) {
    const thread = await prisma.conversationThread.findFirst({
      // borrowerId in the WHERE, not checked after the read: a thread belonging
      // to somebody else must not be fetched at all.
      where: { id: threadId, orgId: org.id, borrowerId: borrower.id },
      select: {
        id: true, subject: true, kind: true, state: true, stageTitle: true,
        applicationId: true, assignedStaffName: true, createdAt: true,
      },
    });
    if (!thread) return NextResponse.json({ success: false, message: "Conversation not found." }, { status: 404 });

    const messages = await prisma.conversationMessage.findMany({
      where: { orgId: org.id, threadId: thread.id },
      orderBy: { createdAt: "asc" },
      take: MAX_MESSAGES,
      select: {
        id: true, authorType: true, authorName: true, body: true,
        event: true, eventData: true, attachments: true, createdAt: true,
      },
    });

    // Opening it IS reading it.
    await markRead({ orgId: org.id, threadId: thread.id, side: "borrower" });

    return NextResponse.json({
      success: true,
      lender: org.name,
      thread: {
        ...thread,
        // The officer's name is shown; their staff id is not. A customer needs
        // to know a person answered, not who to look up.
        messages: messages.map((m) => ({
          id: m.id,
          author: m.authorType,
          authorName: m.authorName,
          body: m.body,
          event: m.event,
          eventData: m.eventData,
          attachments: m.attachments,
          at: m.createdAt,
        })),
      },
    });
  }

  // ── The list ──────────────────────────────────────────────────────────────
  const threads = await prisma.conversationThread.findMany({
    where: { orgId: org.id, borrowerId: borrower.id },
    orderBy: { lastAt: "desc" },
    take: MAX_THREADS,
    select: {
      id: true, subject: true, kind: true, state: true, stageTitle: true,
      lastAt: true, lastPreview: true, lastAuthorType: true,
      unreadForBorrower: true, assignedStaffName: true, applicationId: true,
    },
  });

  return NextResponse.json({
    success: true,
    lender: org.name,
    threads: threads.map((t) => ({
      id: t.id,
      subject: t.subject,
      kind: t.kind,
      state: t.state,
      stageTitle: t.stageTitle,
      lastAt: t.lastAt,
      preview: t.lastPreview,
      lastAuthor: t.lastAuthorType,
      unread: t.unreadForBorrower,
      answeredBy: t.assignedStaffName,
      applicationId: t.applicationId,
    })),
    // The count the tab badge renders. Summed here rather than in the client so
    // a paginated list cannot under-report it.
    unread: threads.reduce((n, t) => n + t.unreadForBorrower, 0),
  });
}

export async function POST(req: NextRequest) {
  let body: {
    lenderSlug?: string;
    threadId?: string;
    kind?: string;
    subject?: string;
    applicationId?: string;
    body?: string;
  };
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

  const text = (body.body ?? "").trim();
  if (!text) return NextResponse.json({ success: false, message: "Write a message first." }, { status: 400 });
  if (text.length > MAX_BODY) {
    return NextResponse.json(
      { success: false, message: `That is longer than we can send. Keep it under ${MAX_BODY} characters.` },
      { status: 400 },
    );
  }

  // Generous, because a customer mid-problem writes several short messages —
  // but bounded, because this route writes rows and notifies an officer.
  const limited = await rateLimit(
    [
      { name: "portal:message:phone", subject: `${org.id}:${verified.phone}`, max: 20, windowSec: 900 },
      { name: "portal:message:ip", subject: clientIp(req), max: 60, windowSec: 3600 },
    ],
    "You have sent a lot of messages just now. Give us a moment to read them.",
  );
  if (limited) return limited;

  const borrower = await me(org.id, verified.phone);
  if (!borrower || borrower.erasedAt) {
    return NextResponse.json(
      { success: false, message: "We could not find your account. Please finish signing up first." },
      { status: 404 },
    );
  }

  let threadId = (body.threadId ?? "").trim();

  if (threadId) {
    // Ownership, before anything is written into it.
    const owned = await prisma.conversationThread.findFirst({
      where: { id: threadId, orgId: org.id, borrowerId: borrower.id },
      select: { id: true },
    });
    if (!owned) return NextResponse.json({ success: false, message: "Conversation not found." }, { status: 404 });
  } else {
    const kind = (THREAD_KINDS as string[]).includes(body.kind ?? "")
      ? (body.kind as ThreadKind)
      : "GENERAL";

    // An applicationId is a claim about whose file this is. Verify it or drop it
    // — never store it unchecked. See the header.
    let applicationId: string | null = null;
    let stageTitle: string | null = null;
    if (body.applicationId) {
      const app = await prisma.loanApplication.findFirst({
        where: { id: body.applicationId, orgId: org.id, borrowerId: borrower.id },
        select: { id: true, stageTitle: true },
      });
      if (app) {
        applicationId = app.id;
        stageTitle = app.stageTitle;
      }
    }

    const opened = await findOrOpenThread({
      orgId: org.id,
      borrowerId: borrower.id,
      kind,
      subject: (body.subject ?? "").trim() || defaultSubject(kind),
      applicationId,
      stageTitle,
    });
    threadId = opened.id;
  }

  const name = [borrower.firstName, borrower.otherName].filter(Boolean).join(" ").trim() || "Customer";
  const message = await postMessage({
    orgId: org.id,
    threadId,
    authorType: "borrower",
    authorId: borrower.id,
    authorName: name,
    body: text,
  });

  return NextResponse.json({ success: true, threadId, messageId: message.id, at: message.createdAt });
}

/** Never blank. A queue of conversations called "(no subject)" is a queue nobody
 *  triages — the officer picks what to open by what it is about. */
function defaultSubject(kind: ThreadKind): string {
  switch (kind) {
    case "APPLICATION": return "About my application";
    case "KYC_REVIEW": return "About my ID check";
    case "LOAN": return "About my loan";
    case "REPAYMENT": return "About a repayment";
    default: return "A question";
  }
}
