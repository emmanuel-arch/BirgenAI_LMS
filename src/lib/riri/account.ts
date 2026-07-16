// ─────────────────────────────────────────────────────────────────────────────
// RIRI — ACCOUNT & USAGE.
//
// The dock's Account panel answers three questions an officer (or a buyer in a demo)
// will actually ask:
//
//   WHO does Riri think I am?      — name, role, branch, exactly as she is briefed.
//   WHAT have I used?              — this month's questions by tier, and exports.
//   WHAT does she remember about me? — every note, readable, and deletable.
//
// The memory list is the important one. Riri writes notes about people; a system that
// remembers you but will not show you what it remembers — or let you erase it — is the
// kind of AI that fails a procurement review. The notes are the officer's OWN (staffId
// from the session, never the client), so nobody reads a colleague's memory.
//
// This file is LMS-side (Prisma is fine here — it is provider territory, like
// providers/lms.ts). The assistant core stays database-free.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";

export type RiriUsage = {
  monthLabel: string;
  /** Questions asked this calendar month, by tier. */
  byModel: { support: number; assistant: number; analytics: number };
  total: number;
  exports: number;
};

export type RiriMemoryRow = {
  id: string;
  kind: string;
  body: string;
  createdAt: Date;
  expiresAt: Date | null;
};

const monthStart = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1);

/** Old log rows carry old tier ids — count them under the tier they became. */
const TIER_OF: Record<string, "support" | "assistant" | "analytics"> = {
  support: "support",
  assistant: "assistant",
  copilot: "assistant",
  analytics: "analytics",
  analyst: "analytics",
  max: "analytics",
};

export async function ririUsageThisMonth(orgId: string, staffId: string): Promise<RiriUsage> {
  const since = monthStart();
  const [logs, exports] = await Promise.all([
    prisma.ririQueryLog.groupBy({
      by: ["model"],
      where: { orgId, staffId, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.auditLog.count({
      where: { orgId, actorId: staffId, action: "riri.export", createdAt: { gte: since } },
    }),
  ]);

  const byModel = { support: 0, assistant: 0, analytics: 0 };
  for (const l of logs) {
    const tier = TIER_OF[l.model];
    if (tier) byModel[tier] += l._count._all;
  }
  return {
    monthLabel: since.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
    byModel,
    total: byModel.support + byModel.assistant + byModel.analytics,
    exports,
  };
}

/**
 * Everything Riri currently remembers about this person — including notes that have
 * expired but not yet been swept, because "show me what you hold" must never be a
 * subset of what is actually held.
 */
export async function ririMemories(orgId: string, staffId: string): Promise<RiriMemoryRow[]> {
  return prisma.ririMemory.findMany({
    where: { orgId, staffId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, kind: true, body: true, createdAt: true, expiresAt: true },
  });
}

/**
 * Forget one note, or everything.
 *
 * Scoped twice: the org AND the staffId, both from the session — so the worst a crafted
 * id can do is delete a note that was already the caller's own. Returns the count so the
 * UI can say what happened rather than guessing.
 */
export async function forgetMemories(orgId: string, staffId: string, id?: string): Promise<number> {
  const res = await prisma.ririMemory.deleteMany({
    where: { orgId, staffId, ...(id ? { id } : {}) },
  });
  return res.count;
}
