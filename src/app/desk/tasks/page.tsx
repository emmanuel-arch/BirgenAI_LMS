// ─────────────────────────────────────────────────────────────────────────────
// CALLBACKS AND FIELD VISITS.
//
// 30,713 of Micromart's 48,945 task rows are still marked open, and the most
// recent was created in August 2025. That is not a backlog, it is a feature that
// was used and then abandoned — and this screen says so rather than presenting
// a year-old callback list as today's work.
// ─────────────────────────────────────────────────────────────────────────────
import { collectBoxOrg, CollectBoxUnavailable, CB, cbOne, dt, num } from "@/lib/collectbox/client";
import { listTasks } from "@/lib/collectbox/promises";
import TaskBoard from "@/components/desk/TaskBoard";
import { Broken } from "@/components/suite/kit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function TasksPage() {
  try {
    const org = collectBoxOrg("micromart");
    const [rows, stats] = await Promise.all([
      listTasks(org, { openOnly: true, limit: 150 }),
      cbOne<{ total: number; open: number; lastCreated: Date; overdue: number }>(
        org,
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN IsActive = 1 THEN 1 ELSE 0 END) AS [open],
                MAX(CreatedDate) AS lastCreated,
                SUM(CASE WHEN IsActive = 1 AND TaskDate < CAST(GETDATE() AS date) THEN 1 ELSE 0 END) AS overdue
           FROM ${CB}.TaskScheduler`,
        [], { timeoutMs: 25000 },
      ),
    ]);

    return (
      <TaskBoard
        rows={rows.map((t) => ({
          id: t.id, loanId: t.loanId, name: t.name, phone: t.phone,
          action: t.action, actionName: t.actionName,
          dueAt: t.dueAt?.toISOString() ?? null,
          createdAt: t.createdAt?.toISOString() ?? null,
          note: t.note, open: t.open, overdue: t.overdue,
          agentName: t.agentName, olb: t.olb,
          band: t.band ? { short: t.band.short, name: t.band.name, accent: t.band.accent } : null,
        }))}
        stats={{
          total: num(stats?.total),
          open: num(stats?.open),
          overdue: num(stats?.overdue),
          lastCreatedAt: dt(stats?.lastCreated)?.toISOString() ?? null,
        }}
      />
    );
  } catch (e) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Broken
          title="Tasks could not be read"
          detail={e instanceof CollectBoxUnavailable ? e.message : e instanceof Error ? e.message : "Unknown error."}
        />
      </div>
    );
  }
}
