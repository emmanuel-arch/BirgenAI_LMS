// ─────────────────────────────────────────────────────────────────────────────
// GET /api/console/riri/first-response?days=7 — what Riri did before the counter.
//
// Riri Ecosystem AI plan §07 step 5: "The counter learns from what it stops seeing.
// Every deflection is a row. A weekly view of 'the ten questions Riri answered
// most' is the lender's own product backlog. A view of 'the ten she escalated most'
// is the next ten KB entries somebody should write — and after they are written,
// the escalation rate for that cluster should fall. That is the only honest
// measure of whether any of this works."
//
// Read from RiriQueryLog rows written by the customer surface (model "customer").
// Grouped on a normalised question, because "What do I owe?" and "what do i owe"
// are one question and a leaderboard that splits them is a leaderboard nobody trusts.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { runWithOrg } from "@/lib/db/context";

export const runtime = "nodejs";

const norm = (q: string) => q.toLowerCase().replace(/[^a-z0-9*# ]+/g, " ").replace(/\s+/g, " ").trim();

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "borrowers.view");
  if (denied) return denied;
  const orgId = session.user.orgId;

  const days = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 7));
  const since = new Date(Date.now() - days * 86_400_000);

  const rows = await runWithOrg(orgId, () =>
    prisma.ririQueryLog.findMany({
      where: { orgId, model: "customer", createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 5000,
      select: { question: true, route: true, metricId: true, createdAt: true },
    }),
  ).catch(() => []);

  const totals = { resolved: 0, offered: 0, escalated: 0, helpful: 0, unhelpful: 0 };
  const answered = new Map<string, { question: string; count: number; source: string | null }>();
  const escalated = new Map<string, { question: string; count: number }>();

  for (const r of rows) {
    const key = norm(r.question);
    if (r.route === "customer:resolved" || r.route === "customer:offer" || r.route === "customer:escalate") {
      if (r.route === "customer:resolved") totals.resolved++;
      else totals.offered++;
      const a = answered.get(key) ?? { question: r.question, count: 0, source: r.metricId };
      a.count++;
      answered.set(key, a);
    } else if (r.route === "customer:escalated") {
      totals.escalated++;
      const e = escalated.get(key) ?? { question: r.question, count: 0 };
      e.count++;
      escalated.set(key, e);
    } else if (r.route === "customer:helpful") totals.helpful++;
    else if (r.route === "customer:unhelpful") totals.unhelpful++;
  }

  const asked = totals.resolved + totals.offered + totals.escalated;
  const top = <T extends { count: number }>(m: Map<string, T>) => [...m.values()].sort((a, z) => z.count - a.count).slice(0, 10);

  return NextResponse.json({
    success: true,
    days,
    totals,
    asked,
    // Share of conversations that ended without a person. Null with nothing asked,
    // never a 0% that reads as failure on a quiet week.
    deflectionRate: asked ? Math.round(((totals.resolved + totals.offered) / asked) * 100) : null,
    answered: top(answered),
    escalated: top(escalated),
  });
}
