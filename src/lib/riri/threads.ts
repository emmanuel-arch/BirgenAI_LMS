// ─────────────────────────────────────────────────────────────────────────────
// SAVED CONVERSATIONS — the Chats app's storage.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: A CONVERSATION IS A CONVENIENCE, AND A
// CONVENIENCE MAY NEVER BREAK THE THING IT IS ATTACHED TO.
//
// The tables are additive and they are not deployed until a human runs `db:push`
// on production — deliberately, because that is prod DDL on a live lender's book
// and it is not an agent's call to make. Between the code shipping and the table
// existing, every function here has to degrade to nothing rather than throw. So
// every write is wrapped, every read returns an empty list on failure, and the
// dock keeps working with an unsaved in-memory thread exactly as it does today.
// The same wrapper covers the other real case: a read replica that is a second
// behind, or a database that is briefly unreachable. A lender mid-question does
// not care why the transcript could not be filed; they care that their answer
// still arrives.
//
// `available()` is what the UI asks before it offers to save anything, so the
// Chats app can say "not switched on yet" instead of silently losing history.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { runWithOrg } from "@/lib/db/context";
import type { Prisma } from "@prisma/client";

export type ThreadSummary = {
  id: string;
  title: string;
  subjectId: string | null;
  subjectName: string | null;
  pinned: boolean;
  lastAt: string;
  messages: number;
  /** The last thing said, trimmed — a list of titles alone tells you nothing. */
  preview: string | null;
};

export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  body: string;
  engine: string | null;
  engineWhy: string | null;
  route: string | null;
  sql: string | null;
  data: unknown;
  createdAt: string;
};

/**
 * Every database call in this file goes through here.
 *
 * A missing table (P2021), a missing column (P2022), an unreachable database — all
 * of them mean the same thing to the caller: history is not available right now.
 * The error is logged once, at info level, because it is an expected state during a
 * staged rollout and shouting about it in production logs trains people to ignore
 * the log.
 */
async function safely<T>(what: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.info(`[riri:threads] ${what} unavailable — ${msg.split("\n")[0]}`);
    return fallback;
  }
}

/**
 * Is conversation history switched on for this deployment?
 *
 * Cached per process rather than per org, because the thing being asked is "does
 * the table exist", which is a property of the deployment and not of a tenant. The
 * one-minute TTL is what makes that safe either way: the instant the migration is
 * run, the answer flips within a minute without a restart, and a transient failure
 * cannot pin the whole process to "off".
 */
let availability: { at: number; ok: boolean } | null = null;
const AVAILABILITY_TTL_MS = 60_000;

export async function available(orgId: string): Promise<boolean> {
  const now = Date.now();
  if (availability && now - availability.at < AVAILABILITY_TTL_MS) return availability.ok;
  const ok = await safely(
    "availability probe",
    async () => {
      await runWithOrg(orgId, () => prisma.ririThread.count({ where: { orgId } }));
      return true;
    },
    false,
  );
  availability = { at: now, ok };
  return ok;
}

/**
 * A title from the first thing somebody said.
 *
 * Not the model's summary — that is a second round trip to name a thing the user
 * already named by asking it. Their own words are also what they will scan for in
 * a list, which is the only job a title has.
 */
export function titleFrom(question: string): string {
  const clean = question.replace(/\s+/g, " ").trim();
  if (!clean) return "New conversation";
  const cut = clean.length <= 48 ? clean : `${clean.slice(0, 47).replace(/[\s,.;:—-]+\S*$/, "")}…`;
  return cut.charAt(0).toUpperCase() + cut.slice(1);
}

export async function listThreads(orgId: string, staffId: string, limit = 40): Promise<ThreadSummary[]> {
  return safely(
    "list",
    async () => {
      const rows = await runWithOrg(orgId, () =>
        prisma.ririThread.findMany({
          where: { orgId, staffId, archivedAt: null },
          orderBy: [{ pinned: "desc" }, { lastAt: "desc" }],
          take: limit,
          select: {
            id: true, title: true, subjectId: true, subjectName: true, pinned: true, lastAt: true,
            _count: { select: { messages: true } },
            messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true } },
          },
        }),
      );
      return rows.map((t) => ({
        id: t.id,
        title: t.title,
        subjectId: t.subjectId,
        subjectName: t.subjectName,
        pinned: t.pinned,
        lastAt: t.lastAt.toISOString(),
        messages: t._count.messages,
        preview: t.messages[0]?.body.replace(/[*#`]/g, "").replace(/\s+/g, " ").slice(0, 90) ?? null,
      }));
    },
    [],
  );
}

export async function readThread(
  orgId: string,
  staffId: string,
  threadId: string,
): Promise<{ thread: ThreadSummary; messages: StoredMessage[] } | null> {
  return safely(
    "read",
    async () => {
      const t = await runWithOrg(orgId, () =>
        prisma.ririThread.findFirst({
          where: { id: threadId, orgId, staffId },
          include: { messages: { orderBy: { createdAt: "asc" }, take: 200 } },
        }),
      );
      if (!t) return null;
      return {
        thread: {
          id: t.id, title: t.title, subjectId: t.subjectId, subjectName: t.subjectName,
          pinned: t.pinned, lastAt: t.lastAt.toISOString(), messages: t.messages.length,
          preview: null,
        },
        messages: t.messages.map((m) => ({
          id: m.id,
          role: m.role === "user" ? "user" : "assistant",
          body: m.body,
          engine: m.engine,
          engineWhy: m.engineWhy,
          route: m.route,
          sql: m.sql,
          data: m.data,
          createdAt: m.createdAt.toISOString(),
        })),
      };
    },
    null,
  );
}

/**
 * File one exchange.
 *
 * Takes the thread id the client believes it is in, and returns the one it is
 * ACTUALLY in — because a client holding a stale id (history switched on since the
 * page loaded, a thread deleted from another tab) must not lose the exchange. An
 * unknown id opens a new thread rather than throwing it away.
 *
 * Returns null when history is unavailable. That is a normal answer, not a failure.
 */
export async function appendExchange(input: {
  orgId: string;
  staffId: string;
  threadId?: string | null;
  question: string;
  answer: string;
  engine?: string | null;
  engineWhy?: string | null;
  route?: string | null;
  sql?: string | null;
  data?: Prisma.InputJsonValue | null;
  subject?: { id: string; name?: string | null } | null;
}): Promise<{ threadId: string; title: string } | null> {
  const { orgId, staffId } = input;

  return safely(
    "append",
    () =>
      runWithOrg(orgId, async () => {
        let thread = input.threadId
          ? await prisma.ririThread.findFirst({ where: { id: input.threadId, orgId, staffId } })
          : null;

        if (!thread) {
          thread = await prisma.ririThread.create({
            data: {
              orgId, staffId,
              title: titleFrom(input.question),
              subjectId: input.subject?.id ?? null,
              subjectName: input.subject?.name ?? null,
            },
          });
        }

        await prisma.ririMessage.createMany({
          data: [
            { orgId, threadId: thread.id, role: "user", body: input.question },
            {
              orgId, threadId: thread.id, role: "assistant", body: input.answer,
              engine: input.engine ?? null,
              engineWhy: input.engineWhy ?? null,
              route: input.route ?? null,
              sql: input.sql ?? null,
              ...(input.data ? { data: input.data } : {}),
            },
          ],
        });

        await prisma.ririThread.update({
          where: { id: thread.id },
          data: {
            lastAt: new Date(),
            // A thread that was opened blind and later pinned to a customer picks the
            // customer up here rather than staying anonymous in the list.
            ...(input.subject && !thread.subjectId
              ? { subjectId: input.subject.id, subjectName: input.subject.name ?? null }
              : {}),
          },
        });

        return { threadId: thread.id, title: thread.title };
      }),
    null,
  );
}

export async function renameThread(orgId: string, staffId: string, threadId: string, title: string): Promise<boolean> {
  const clean = title.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!clean) return false;
  return safely(
    "rename",
    async () => {
      const r = await runWithOrg(orgId, () =>
        prisma.ririThread.updateMany({ where: { id: threadId, orgId, staffId }, data: { title: clean } }),
      );
      return r.count > 0;
    },
    false,
  );
}

export async function pinThread(orgId: string, staffId: string, threadId: string, pinned: boolean): Promise<boolean> {
  return safely(
    "pin",
    async () => {
      const r = await runWithOrg(orgId, () =>
        prisma.ririThread.updateMany({ where: { id: threadId, orgId, staffId }, data: { pinned } }),
      );
      return r.count > 0;
    },
    false,
  );
}

/**
 * Delete, properly.
 *
 * Not archived, not hidden — removed, messages and all. Somebody deleting a
 * conversation with an assistant is usually deleting something they said about a
 * customer or about a colleague, and "we kept it, just out of your sight" is the
 * wrong answer to that. The audit trail already records that the questions were
 * asked (RiriQueryLog); the transcript is theirs.
 */
export async function deleteThread(orgId: string, staffId: string, threadId: string): Promise<boolean> {
  return safely(
    "delete",
    async () => {
      const r = await runWithOrg(orgId, async () => {
        const owned = await prisma.ririThread.findFirst({ where: { id: threadId, orgId, staffId }, select: { id: true } });
        if (!owned) return 0;
        await prisma.ririMessage.deleteMany({ where: { orgId, threadId } });
        const d = await prisma.ririThread.deleteMany({ where: { id: threadId, orgId, staffId } });
        return d.count;
      });
      return r > 0;
    },
    false,
  );
}

export async function clearAll(orgId: string, staffId: string): Promise<number> {
  return safely(
    "clear all",
    () =>
      runWithOrg(orgId, async () => {
        const ids = await prisma.ririThread.findMany({ where: { orgId, staffId }, select: { id: true } });
        if (!ids.length) return 0;
        await prisma.ririMessage.deleteMany({ where: { orgId, threadId: { in: ids.map((t) => t.id) } } });
        const d = await prisma.ririThread.deleteMany({ where: { orgId, staffId } });
        return d.count;
      }),
    0,
  );
}
