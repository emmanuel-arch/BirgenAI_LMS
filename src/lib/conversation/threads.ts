// ─────────────────────────────────────────────────────────────────────────────
// THE CONVERSATION, IN ONE PLACE.
//
// Both sides post through here — the borrower app via /api/portal/messages, the
// console via /api/console/conversations — and neither writes a message row
// directly. That is not tidiness. A thread carries five derived fields
// (`lastAt`, `lastPreview`, `lastAuthorType`, and the two unread counters) plus
// a state machine, and every one of them has to move in the same transaction as
// the message or the queue lies:
//
//   · a thread whose `lastAt` did not move sorts to the bottom, so the newest
//     message is the one nobody sees;
//   · a counter that did not increment is a customer waiting on a reply that no
//     officer has been told to write;
//   · a `state` that did not flip leaves the case out of the work queue entirely.
//
// Two call sites doing that by hand is two chances to get it wrong, and the
// failure is silent in both directions.
//
// ── THE STATE MACHINE ───────────────────────────────────────────────────────
// Three states, and the transition is decided by WHO WROTE, never passed in:
//
//   borrower writes → AWAITING_STAFF     (this is the work queue)
//   staff writes    → AWAITING_CUSTOMER
//   system writes   → state unchanged
//
// A system message must not move the state, and that is the subtle one. When a
// case advances a stage we write a system message into the thread so the
// customer sees it in the same scroll as everything else — but the officer's
// obligation to answer the question underneath it has not gone away. Letting
// `stage.advanced` flip a thread to AWAITING_CUSTOMER would silently clear the
// queue every time the workflow moved, which is exactly when a customer is most
// likely to be waiting on an answer.
//
// Resolving is therefore an explicit act by a human, and even then the customer
// writing again reopens it. Nothing else closes a thread.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { ThreadKind, ThreadState } from "@prisma/client";

/** Long enough for a real explanation, short enough that nobody pastes a book
 *  into a column the console renders in a 720px panel. */
export const MAX_BODY = 4000;

/** What the thread list shows under the subject. */
const PREVIEW_CHARS = 140;

export type AuthorType = "borrower" | "staff" | "system";

/** The machine-readable half of a system message. The app renders these as
 *  chips rather than as prose, so adding one here without teaching the client
 *  about it degrades to plain text rather than to a blank row. */
export type SystemEvent =
  | "thread.opened"
  | "application.submitted"
  | "stage.advanced"
  | "stage.returned"
  | "decision.made"
  | "kyc.referred"
  | "kyc.cleared"
  | "offer.signed"
  | "disbursed";

function preview(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length <= PREVIEW_CHARS ? flat : `${flat.slice(0, PREVIEW_CHARS - 1)}…`;
}

/**
 * Find the open thread for a subject, or start one.
 *
 * Keyed on (borrower, kind, applicationId) rather than on subject text: a
 * customer who asks about their application twice in a week is having ONE
 * conversation about it, and two threads means two officers each holding half
 * the context. A RESOLVED thread is deliberately excluded from the match — once
 * a case is closed, a new question is a new case.
 */
export async function findOrOpenThread(args: {
  orgId: string;
  borrowerId: string;
  kind: ThreadKind;
  subject: string;
  applicationId?: string | null;
  loanId?: string | null;
  stageTitle?: string | null;
}): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.conversationThread.findFirst({
    where: {
      orgId: args.orgId,
      borrowerId: args.borrowerId,
      kind: args.kind,
      applicationId: args.applicationId ?? null,
      state: { not: "RESOLVED" },
    },
    select: { id: true },
    orderBy: { lastAt: "desc" },
  });
  if (existing) return { id: existing.id, created: false };

  const thread = await prisma.conversationThread.create({
    data: {
      orgId: args.orgId,
      borrowerId: args.borrowerId,
      kind: args.kind,
      subject: args.subject.slice(0, 200),
      applicationId: args.applicationId ?? null,
      loanId: args.loanId ?? null,
      stageTitle: args.stageTitle ?? null,
      state: "AWAITING_STAFF",
    },
    select: { id: true },
  });
  return { id: thread.id, created: true };
}

/**
 * Write one message and move the thread with it, atomically.
 *
 * The transaction is the point. Without it a crash between the two writes
 * leaves a message nobody is counted as owing a reply to — invisible in both
 * queues, and discoverable only by opening the thread it is buried in.
 */
export async function postMessage(args: {
  orgId: string;
  threadId: string;
  authorType: AuthorType;
  authorId?: string | null;
  authorName: string;
  body: string;
  attachments?: string[];
  event?: SystemEvent;
  eventData?: Prisma.InputJsonValue;
}): Promise<{ id: string; createdAt: Date }> {
  const body = args.body.trim().slice(0, MAX_BODY);

  // Who owes the next move. System messages leave it alone — see the header.
  const state: ThreadState | undefined =
    args.authorType === "borrower" ? "AWAITING_STAFF"
    : args.authorType === "staff" ? "AWAITING_CUSTOMER"
    : undefined;

  const [message] = await prisma.$transaction([
    prisma.conversationMessage.create({
      data: {
        orgId: args.orgId,
        threadId: args.threadId,
        authorType: args.authorType,
        authorId: args.authorId ?? null,
        authorName: args.authorName,
        body,
        attachments: (args.attachments ?? []) as Prisma.InputJsonValue,
        event: args.event ?? null,
        eventData: args.eventData ?? Prisma.DbNull,
        // The author has by definition read their own message. Marking it here
        // stops a staff reply landing in the staff unread queue.
        readByStaffAt: args.authorType === "staff" ? new Date() : null,
        readByBorrowerAt: args.authorType === "borrower" ? new Date() : null,
      },
      select: { id: true, createdAt: true },
    }),
    prisma.conversationThread.update({
      where: { id: args.threadId },
      data: {
        lastAt: new Date(),
        lastPreview: preview(body),
        lastAuthorType: args.authorType,
        ...(state ? { state } : {}),
        // A staff reply clears the customer's obligation to be chased, and vice
        // versa. `increment` rather than a recount: the count is a queue depth,
        // not a fact worth a second query on every write.
        ...(args.authorType === "borrower"
          ? { unreadForStaff: { increment: 1 } }
          : args.authorType === "staff"
            ? { unreadForBorrower: { increment: 1 }, unreadForStaff: 0 }
            : { unreadForBorrower: { increment: 1 } }),
        // Writing into a resolved thread reopens it. A customer replying to a
        // closed case is not a closed case.
        ...(args.authorType === "borrower" ? { closedAt: null } : {}),
      },
    }),
  ]);

  return message;
}

/**
 * Announce something that happened TO the case, into the thread the customer is
 * already reading.
 *
 * This is what makes the thread a transparent record rather than a chat box:
 * "your application moved to Risk review" arrives in the same scroll as the
 * conversation about it, in order, so there is nothing for anyone to reconcile
 * afterwards.
 *
 * It NEVER opens a thread. A borrower with no conversation has not asked
 * anything, and manufacturing one to hold a stage notification would fill the
 * console queue with cases nobody needs to answer — the tracker screen already
 * shows the stage to a customer who has not written in. It announces into a
 * conversation that already exists, or does nothing.
 */
export async function announce(args: {
  orgId: string;
  borrowerId: string;
  applicationId?: string | null;
  event: SystemEvent;
  body: string;
  eventData?: Prisma.InputJsonValue;
}): Promise<boolean> {
  const thread = await prisma.conversationThread.findFirst({
    where: {
      orgId: args.orgId,
      borrowerId: args.borrowerId,
      state: { not: "RESOLVED" },
      ...(args.applicationId ? { applicationId: args.applicationId } : {}),
    },
    select: { id: true },
    orderBy: { lastAt: "desc" },
  });
  if (!thread) return false;

  await postMessage({
    orgId: args.orgId,
    threadId: thread.id,
    authorType: "system",
    authorName: "Micro Eazy",
    body: args.body,
    event: args.event,
    eventData: args.eventData,
  });
  return true;
}

/** Clear one side's unread count and stamp the receipts. Idempotent. */
export async function markRead(args: {
  orgId: string;
  threadId: string;
  side: "staff" | "borrower";
}): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.conversationMessage.updateMany({
      where: {
        orgId: args.orgId,
        threadId: args.threadId,
        ...(args.side === "staff" ? { readByStaffAt: null } : { readByBorrowerAt: null }),
      },
      data: args.side === "staff" ? { readByStaffAt: now } : { readByBorrowerAt: now },
    }),
    prisma.conversationThread.update({
      where: { id: args.threadId },
      data: args.side === "staff" ? { unreadForStaff: 0 } : { unreadForBorrower: 0 },
    }),
  ]);
}
