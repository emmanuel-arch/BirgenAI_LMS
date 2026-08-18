// ─────────────────────────────────────────────────────────────────────────────
// THE AGENTS.
//
// Ranked by CASH, and the three numbers a floor is actually run on are kept
// apart rather than blended: RECOVERED is money that landed, PROMISED is a
// forecast, CONTACT is the leading indicator an agent controls. A board that
// adds them together is why floors end up managed by anecdote.
//
// The identity column is the quietly important one. Each agent is shown with the
// lending-system identity they were matched to, AND the method used to match —
// `CollectionAgents.CollectBoxRef` where it is populated, phone or email where it
// is not. A silent fuzzy match between two staff directories is how one agent's
// commission lands on another agent's payslip.
// ─────────────────────────────────────────────────────────────────────────────
import { collectBoxOrg, CollectBoxUnavailable } from "@/lib/collectbox/client";
import { listAgents, getLeaderboard, listExtensions, WINDOW_LABEL, type Window } from "@/lib/collectbox/agents";
import AgentBoard from "@/components/desk/AgentBoard";
import { Broken } from "@/components/suite/kit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AgentsPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const raw = (Array.isArray(sp.window) ? sp.window[0] : sp.window) ?? "today";
  const window = (["today", "7d", "30d", "mtd"].includes(raw) ? raw : "today") as Window;

  try {
    const org = collectBoxOrg("micromart");
    const [agents, board, exts] = await Promise.all([
      listAgents(org),
      getLeaderboard(org, window),
      listExtensions(org),
    ]);

    const extOf = new Map(exts.filter((e) => e.userId > 0).map((e) => [e.userId, e.extension]));

    return (
      <AgentBoard
        window={window}
        windowLabel={WINDOW_LABEL[window]}
        rows={board.map((s) => {
          const a = agents.find((x) => x.id === s.agentId);
          return {
            agentId: s.agentId,
            name: s.name,
            role: a?.role ?? "Agent",
            email: a?.email ?? "",
            phone: a?.phone ?? "",
            extension: extOf.get(s.agentId) ?? null,
            lms: a?.lms ?? null,
            linkedBy: a?.linkedBy ?? null,
            recovered: s.recovered,
            payments: s.payments,
            loansPaying: s.loansPaying,
            assigned: s.assigned,
            assignedOlb: s.assignedOlb,
            calls: s.calls,
            contacts: s.contacts,
            contactRate: s.contactRate,
            promises: s.promises,
            promisedValue: s.promisedValue,
            commission: s.commission,
            recoveryRate: s.recoveryRate,
            lastActivityAt: s.lastActivityAt?.toISOString() ?? null,
          };
        })}
        roster={{
          total: agents.length,
          linked: agents.filter((a) => a.lms).length,
          byMethod: agents.reduce<Record<string, number>>((m, a) => {
            if (a.linkedBy) m[a.linkedBy] = (m[a.linkedBy] ?? 0) + 1;
            return m;
          }, {}),
          extensions: exts.length,
          extensionsMapped: exts.filter((e) => e.agentName).length,
        }}
      />
    );
  } catch (e) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Broken
          title="The agent board could not be read"
          detail={e instanceof CollectBoxUnavailable ? e.message : e instanceof Error ? e.message : "Unknown error."}
        />
      </div>
    );
  }
}
