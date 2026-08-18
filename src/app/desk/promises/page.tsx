// ─────────────────────────────────────────────────────────────────────────────
// THE PROMISE BOARD.
//
// Two things this screen does that a promise list normally does not:
//
//   1. It DERIVES the state. `PaymentStatus` on their table is written once and
//      never updated when a promise lapses, so a board that reads it reports
//      150,345 promises as permanently "open". Kept / broken / part-paid are
//      computed from the money and the calendar.
//
//   2. It says out loud when the data has stopped. The last promise in
//      CollectBox was taken on 21 November 2024 — the floor stopped using the
//      feature nearly two years ago while continuing to log calls. That is not
//      something to paper over with an empty state; it is the single most
//      useful thing this screen can tell Micromart.
// ─────────────────────────────────────────────────────────────────────────────
import { collectBoxOrg, CollectBoxUnavailable, CB, cbOne, dt } from "@/lib/collectbox/client";
import { listPromises, getPromiseStats } from "@/lib/collectbox/promises";
import PromiseBoard from "@/components/desk/PromiseBoard";
import { Broken } from "@/components/suite/kit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PromisesPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const filter = (Array.isArray(sp.filter) ? sp.filter[0] : sp.filter) as
    | "open" | "due-today" | "overdue" | "all" | undefined;

  try {
    const org = collectBoxOrg("micromart");
    const [stats, rows, freshness] = await Promise.all([
      getPromiseStats(org),
      listPromises(org, { filter: filter ?? "all", limit: 120 }),
      cbOne<{ lastTaken: Date; n: number }>(
        org,
        `SELECT MAX(CreatedDate) AS lastTaken, COUNT(*) AS n FROM ${CB}.PromisedToPay`,
        [], { timeoutMs: 20000 },
      ),
    ]);

    return (
      <PromiseBoard
        filter={filter ?? "all"}
        stats={stats}
        lastTakenAt={dt(freshness?.lastTaken)?.toISOString() ?? null}
        totalOnRecord={Number(freshness?.n ?? 0)}
        rows={rows.map((p) => ({
          id: p.id, loanId: p.loanId, name: p.name, phone: p.phone,
          amount: p.amount, paid: Math.max(p.paid, p.recoveredSince),
          dueAt: p.dueAt?.toISOString() ?? null,
          takenAt: p.takenAt?.toISOString() ?? null,
          agentName: p.agentName,
          state: { key: p.state.key, label: p.state.label, accent: p.state.accent },
          band: p.band ? { short: p.band.short, name: p.band.name, accent: p.band.accent } : null,
          olb: p.olb,
          recoveredSince: p.recoveredSince,
        }))}
      />
    );
  } catch (e) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Broken
          title="The promise board could not be read"
          detail={e instanceof CollectBoxUnavailable ? e.message : e instanceof Error ? e.message : "Unknown error."}
        />
      </div>
    );
  }
}
