// ─────────────────────────────────────────────────────────────────────────────
// THE HAND-OFF — Riri opens the case, writes the triage, and gets out of the way.
//
// Called from two places, deliberately through one function:
//   · POST /api/portal/riri          when the customer asked for a person — an
//                                    instant, cheerful escalation, no second tap
//   · POST /api/portal/riri/escalate when the customer accepted her offer
//
// ── THE OWNERSHIP CHECKS STAY EXACTLY WHERE THEY WERE ────────────────────────
// Plan §07: "findOrOpenThread and postMessage already exist — the kind, the
// subject and the applicationId are hers to set, and the ownership check on
// applicationId stays exactly where it is." The applicationId here is never from
// a request: it is the application on the customer's OWN position, read by the
// server from the proven phone. The borrower id likewise.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import type { ResolvedOrg } from "@/lib/tenancy";
import type { BorrowerSession } from "@/lib/portal/session";
import { portalBorrowerId } from "@/lib/portal/borrower";
import { findOrOpenThread, postMessage } from "@/lib/conversation/threads";
import { logRiriQuery } from "../log";
import type { FirstResponse } from "./first-response";
import type { RiriScreen } from "../core/context";
import { triageNote, caseRef } from "./triage";

export type EscalationResult =
  | { ok: true; threadId: string; caseRef: string; created: boolean }
  | { ok: false; reason: "not-enrolled"; message: string };

export async function escalateToTeam(args: {
  org: ResolvedOrg;
  session: BorrowerSession;
  borrowerId: string | null;
  questions: string[];
  response: FirstResponse;
  screen: RiriScreen | null;
  note?: string | null;
  assistantName: string;
  applicationId?: string | null;
  ip?: string | null;
}): Promise<EscalationResult> {
  const { org, session, response } = args;

  // A customer of ten years may have no row here yet; resolve them from the
  // lender's book the same way every other hand-off route does.
  const borrowerId = args.borrowerId ?? (await portalBorrowerId(org, session).catch(() => null));
  if (!borrowerId) {
    return {
      ok: false,
      reason: "not-enrolled",
      message:
        response.lang === "sw"
          ? `Siwezi kufungua kesi hadi umalize kujisajili — timu inahitaji akaunti ya kuiambatanisha. Ukimaliza, niulize tena na nitaipeleka mara moja.`
          : `I can't open a case until you've finished signing up — the team needs an account to attach it to. Once you're through, ask me again and I'll pass it straight over.`,
    };
  }

  const thread = await findOrOpenThread({
    orgId: org.id,
    borrowerId,
    kind: response.threadKind,
    subject: `${args.assistantName}: ${response.subject}`,
    applicationId: response.threadKind === "APPLICATION" ? args.applicationId ?? null : null,
    stageTitle: null,
  });

  const ref = caseRef(thread.id);
  const body = triageNote({
    questions: args.questions,
    response,
    screen: args.screen,
    note: args.note,
    lender: org.name,
  });

  await postMessage({
    orgId: org.id,
    threadId: thread.id,
    authorType: "assistant",
    authorName: args.assistantName,
    body: `${body}\n\nCase ${ref}`,
    event: "riri.escalated",
    eventData: {
      caseRef: ref,
      intent: response.intent,
      outcome: response.outcome,
      sources: response.sources.map((s) => s.id),
      screen: args.screen?.id ?? null,
    },
  });

  await prisma.auditLog.create({
    data: {
      orgId: org.id, actorId: borrowerId, actorType: "borrower", action: "riri.escalated",
      entity: "ConversationThread", entityId: thread.id, ip: args.ip ?? null,
      meta: { caseRef: ref, intent: response.intent },
    },
  }).catch(() => {});

  void logRiriQuery({
    orgId: org.id, staffId: null, model: "customer",
    question: args.questions[args.questions.length - 1] ?? "(asked for a person)",
    route: "customer:escalated", metricId: `thread:${thread.id}`, ok: true,
  });

  return { ok: true, threadId: thread.id, caseRef: ref, created: thread.created };
}
