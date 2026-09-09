// ─────────────────────────────────────────────────────────────────────────────
// GET   /api/console/conversations              — the queue
// GET   /api/console/conversations?threadId=…   — one conversation, marked read
// POST  /api/console/conversations              — reply, assign, or resolve
//
// The officer's half of the channel the customer writes into. It is a QUEUE
// before it is an inbox: the default order is AWAITING_STAFF first, oldest
// first, because a conversation nobody has answered is the only kind that costs
// anything.
//
// ── WHY THE RIGHT IS borrowers.view AND NOT A NEW ONE ───────────────────────
// Everything readable here — a customer's name, what they asked, which of their
// applications it is about — is already on the Customer-360 that right opens.
// Minting a `conversations.view` would let a lender grant someone the ability to
// read a borrower's messages while denying them the borrower's file, which is a
// distinction with no security meaning and one more thing to configure wrong.
//
// Replying is a different matter and takes `borrowers.manage`: reading what a
// customer said and SAYING SOMETHING BACK IN THE LENDER'S NAME are not the same
// act, and the second one is the lender's voice.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { postMessage, markRead, MAX_BODY } from "@/lib/conversation/threads";
import type { Prisma, ThreadState } from "@prisma/client";

export const runtime = "nodejs";

const MAX_THREADS = 100;
const MAX_MESSAGES = 200;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "borrowers.view");
  if (denied) return denied;
  const orgId = session.user.orgId;

  const threadId = req.nextUrl.searchParams.get("threadId");

  // ── One conversation ──────────────────────────────────────────────────────
  if (threadId) {
    const thread = await prisma.conversationThread.findFirst({
      where: { id: threadId, orgId },
      select: {
        id: true, subject: true, kind: true, state: true, stageTitle: true,
        applicationId: true, loanId: true, assignedStaffId: true, assignedStaffName: true,
        createdAt: true, closedAt: true,
        borrower: {
          select: { id: true, firstName: true, otherName: true, phone: true, nationalId: true, kycStatus: true, erasedAt: true },
        },
      },
    });
    if (!thread) return NextResponse.json({ success: false, message: "Conversation not found." }, { status: 404 });

    const messages = await prisma.conversationMessage.findMany({
      where: { orgId, threadId: thread.id },
      orderBy: { createdAt: "asc" },
      take: MAX_MESSAGES,
      select: {
        id: true, authorType: true, authorName: true, body: true,
        event: true, eventData: true, attachments: true, createdAt: true,
      },
    });

    await markRead({ orgId, threadId: thread.id, side: "staff" });

    const b = thread.borrower;
    return NextResponse.json({
      success: true,
      thread: {
        id: thread.id,
        subject: thread.subject,
        kind: thread.kind,
        state: thread.state,
        stageTitle: thread.stageTitle,
        applicationId: thread.applicationId,
        loanId: thread.loanId,
        assignedTo: thread.assignedStaffId,
        assignedName: thread.assignedStaffName,
        openedAt: thread.createdAt,
        closedAt: thread.closedAt,
        // An erased borrower's thread still opens — the conversation is a record
        // of what the lender was asked and answered, and it survives the person.
        // What it does not do is resurrect their identity.
        borrower: b.erasedAt
          ? { id: b.id, name: "(erased)", phone: null, nationalId: null, erased: true }
          : {
              id: b.id,
              name: [b.firstName, b.otherName].filter(Boolean).join(" ").trim() || "Customer",
              phone: b.phone,
              nationalId: b.nationalId,
              kycStatus: b.kycStatus,
              erased: false,
            },
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

  // ── The queue ─────────────────────────────────────────────────────────────
  const stateFilter = req.nextUrl.searchParams.get("state");
  const mine = req.nextUrl.searchParams.get("mine") === "1";
  const valid: ThreadState[] = ["AWAITING_STAFF", "AWAITING_CUSTOMER", "RESOLVED"];

  const where: Prisma.ConversationThreadWhereInput = {
    orgId,
    ...(stateFilter && (valid as string[]).includes(stateFilter)
      ? { state: stateFilter as ThreadState }
      // Unfiltered means WORK, not everything: resolved threads are history and
      // burying twelve live questions under six months of closed ones is how an
      // inbox stops being opened.
      : { state: { not: "RESOLVED" } }),
    ...(mine ? { assignedStaffId: session.user.id } : {}),
  };

  const [threads, waiting] = await Promise.all([
    prisma.conversationThread.findMany({
      where,
      // Oldest unanswered first. Newest-first is right for a chat app and wrong
      // for a queue — it buries the person who has been waiting longest under
      // everyone who wrote since.
      orderBy: [{ state: "asc" }, { lastAt: "asc" }],
      take: MAX_THREADS,
      select: {
        id: true, subject: true, kind: true, state: true, stageTitle: true,
        lastAt: true, lastPreview: true, lastAuthorType: true, unreadForStaff: true,
        assignedStaffId: true, assignedStaffName: true, applicationId: true, createdAt: true,
        borrower: { select: { id: true, firstName: true, otherName: true, phone: true, erasedAt: true } },
      },
    }),
    prisma.conversationThread.count({ where: { orgId, state: "AWAITING_STAFF" } }),
  ]);

  return NextResponse.json({
    success: true,
    waiting,
    threads: threads.map((t) => ({
      id: t.id,
      subject: t.subject,
      kind: t.kind,
      state: t.state,
      stageTitle: t.stageTitle,
      lastAt: t.lastAt,
      preview: t.lastPreview,
      lastAuthor: t.lastAuthorType,
      unread: t.unreadForStaff,
      assignedTo: t.assignedStaffId,
      assignedName: t.assignedStaffName,
      applicationId: t.applicationId,
      openedAt: t.createdAt,
      borrower: t.borrower.erasedAt
        ? { id: t.borrower.id, name: "(erased)", phone: null }
        : {
            id: t.borrower.id,
            name: [t.borrower.firstName, t.borrower.otherName].filter(Boolean).join(" ").trim() || "Customer",
            phone: t.borrower.phone,
          },
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "borrowers.manage");
  if (denied) return denied;
  const orgId = session.user.orgId;

  let body: { threadId?: string; action?: string; body?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 });
  }

  const threadId = (body.threadId ?? "").trim();
  if (!threadId) return NextResponse.json({ success: false, message: "Which conversation?" }, { status: 400 });

  const thread = await prisma.conversationThread.findFirst({
    where: { id: threadId, orgId },
    select: { id: true, state: true, assignedStaffId: true },
  });
  if (!thread) return NextResponse.json({ success: false, message: "Conversation not found." }, { status: 404 });

  // The session carries a display name, not the name parts the Borrower rows
  // use. "Support" rather than the email as the fallback: a customer reading a
  // reply signed with an officer's work address is being shown an internal
  // detail they did not ask for and can do nothing with.
  const staffName = (session.user.name ?? "").trim() || "Support";

  const action = body.action ?? "reply";

  if (action === "assign") {
    await prisma.conversationThread.update({
      where: { id: thread.id },
      data: { assignedStaffId: session.user.id, assignedStaffName: staffName },
    });
    return NextResponse.json({ success: true, assignedTo: session.user.id, assignedName: staffName });
  }

  if (action === "resolve") {
    await prisma.conversationThread.update({
      where: { id: thread.id },
      data: { state: "RESOLVED", closedAt: new Date(), unreadForStaff: 0 },
    });
    await prisma.auditLog.create({
      data: {
        orgId, actorId: session.user.id, actorType: "staff",
        action: "conversation.resolve", entity: "ConversationThread", entityId: thread.id,
        ip: req.headers.get("x-forwarded-for"),
      },
    }).catch(() => {});
    return NextResponse.json({ success: true, state: "RESOLVED" });
  }

  if (action !== "reply") {
    return NextResponse.json({ success: false, message: "Unknown action." }, { status: 400 });
  }

  const text = (body.body ?? "").trim();
  if (!text) return NextResponse.json({ success: false, message: "Write a reply first." }, { status: 400 });
  if (text.length > MAX_BODY) {
    return NextResponse.json({ success: false, message: `Keep the reply under ${MAX_BODY} characters.` }, { status: 400 });
  }

  const message = await postMessage({
    orgId,
    threadId: thread.id,
    authorType: "staff",
    authorId: session.user.id,
    authorName: staffName,
    body: text,
  });

  // Answering a conversation takes ownership of it. Without this, a thread every
  // officer has replied to once is a thread nobody owns — the classic shared
  // inbox failure, where the second question goes unanswered because three
  // people each assume one of the others has it.
  if (!thread.assignedStaffId) {
    await prisma.conversationThread.update({
      where: { id: thread.id },
      data: { assignedStaffId: session.user.id, assignedStaffName: staffName },
    });
  }

  return NextResponse.json({ success: true, messageId: message.id, at: message.createdAt });
}
