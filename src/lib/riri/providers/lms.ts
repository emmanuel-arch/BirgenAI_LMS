// ─────────────────────────────────────────────────────────────────────────────
// The BirgenAI LMS host — Riri, running on our own Postgres.
//
// One of (eventually) several: a ServiceSuite host will implement the same interface
// over their SQL Server through the existing read-only adapter, and assistant.ts will
// not know the difference. See host.ts for why that seam exists.
//
// Every read here is org-scoped in code AND fenced by RLS at the database, so a subject
// id from another lender's book resolves to nothing rather than to their customer.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { actorContext, borrowerContext, bookContext } from "@/lib/riri/context";
import { roleFromTitle } from "@/lib/riri/persona";
import type { RiriHost, RiriActor, RiriSubjectFacts, RiriMemoryNote } from "@/lib/riri/host";

export function lmsHost(args: {
  orgId: string;
  lenderName: string;
  staffId: string | null;
  rights: ReadonlySet<string>;
  /** Identity from the session — the only source for an actor who is not a StaffUser. */
  session?: { name?: string | null; role?: string | null };
}): RiriHost {
  const { orgId, lenderName, staffId, rights, session } = args;

  return {
    orgId,
    lenderName,

    async actor(): Promise<RiriActor> {
      const a = await actorContext(orgId, staffId, rights, session);
      return {
        id: staffId, name: a.name, roleTitle: a.role, branch: a.branch, rights,
        isPlatformAdmin: a.isPlatformAdmin,
      };
    },

    async subject(kind: string, id: string): Promise<RiriSubjectFacts | null> {
      if (kind !== "borrower") return null;
      const s = await borrowerContext(orgId, id);
      if (!s) return null;
      return {
        kind: "borrower",
        id: s.id,
        label: s.label,
        lines: s.lines,
        restricted: s.restricted,
      };
    },

    async book(actor: RiriActor): Promise<string[]> {
      // Scope follows the job, not the rights: a manager who CAN see everything is also
      // accountable for everything, while an officer asking about "my customers" means
      // the ones they registered. A platform admin has no book of their own — they are
      // looking at the lender's.
      const role = roleFromTitle(actor.roleTitle);
      const scope = actor.isPlatformAdmin || role === "manager" || role === "admin" ? "all" : "own";
      return bookContext(orgId, staffId, scope);
    },

    async recall(who: string, limit: number): Promise<RiriMemoryNote[]> {
      const rows = await prisma.ririMemory.findMany({
        where: {
          orgId, staffId: who,
          // Advice that has aged out is not recalled — Riri nagging in November about an
          // October arrears run is how an assistant loses credibility.
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: { kind: true, body: true, subjectId: true, createdAt: true },
      });
      return rows.map((r) => ({
        kind: r.kind as RiriMemoryNote["kind"],
        body: r.body,
        subjectId: r.subjectId,
        createdAt: r.createdAt,
      }));
    },

    async remember(who: string, note, ttlDays): Promise<void> {
      await prisma.ririMemory.create({
        data: {
          orgId, staffId: who,
          kind: note.kind,
          body: note.body,
          subjectId: note.subjectId ?? null,
          expiresAt: ttlDays ? new Date(Date.now() + ttlDays * 86_400_000) : null,
        },
      });
    },
  };
}
