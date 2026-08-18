// ─────────────────────────────────────────────────────────────────────────────
// THE WORK QUEUE — the list an agent actually dials.
//
// Filters live in the URL, not in component state, and that is a working
// decision rather than a stylistic one: a supervisor who has narrowed to "Watch
// 2, Kisii, untouched today, highest value first" needs to be able to send that
// to an agent in a message. State that cannot be linked to cannot be delegated.
// ─────────────────────────────────────────────────────────────────────────────
import { collectBoxOrg, CollectBoxUnavailable } from "@/lib/collectbox/client";
import { getQueue, countQueue, listBranches, type QueueFilters } from "@/lib/collectbox/floor";
import { listAgents } from "@/lib/collectbox/agents";
import { CATEGORY_LIST, type CategoryId } from "@/lib/collectbox/taxonomy";
import QueueBoard from "@/components/desk/QueueBoard";
import { Broken } from "@/components/suite/kit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE = 40;

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined));

  const cats = (one("band") ?? "")
    .split(",")
    .map((s) => Number(s))
    .filter((n) => CATEGORY_LIST.some((c) => c.id === n)) as CategoryId[];

  const page = Math.max(1, Number(one("p") ?? 1) || 1);
  const sort = (one("sort") ?? "value") as NonNullable<QueueFilters["sort"]>;

  const filters: QueueFilters = {
    categories: cats.length ? cats : undefined,
    agentId: one("agent") ? Number(one("agent")) : undefined,
    untouchedToday: one("untouched") === "1",
    withPromise: one("promise") === "1",
    branch: one("branch") || undefined,
    search: one("q") || undefined,
    sort: ["value", "dpd", "oldest-touch", "promise"].includes(sort) ? sort : "value",
    limit: PAGE,
    offset: (page - 1) * PAGE,
  };

  try {
    const org = collectBoxOrg("micromart");
    const [rows, total, branches, agents] = await Promise.all([
      getQueue(org, filters),
      countQueue(org, filters),
      listBranches(org),
      listAgents(org),
    ]);

    return (
      <QueueBoard
        rows={rows.map((r) => ({
          trackerId: r.trackerId,
          loanId: r.loanId,
          borrowerId: r.borrowerId,
          name: r.name,
          phone: r.phone,
          dpd: r.dpd,
          band: { id: r.category.id, short: r.category.short, name: r.category.name, accent: r.category.accent },
          olb: r.olb,
          amountDue: r.amountDue,
          product: r.product,
          branch: r.branch,
          officer: r.officer,
          agentName: r.agentName,
          agentId: r.agentId,
          actioned: r.actioned,
          lastActionAt: r.lastActionAt?.toISOString() ?? null,
          lastComment: r.lastComment,
          lastCallAt: r.lastCallAt?.toISOString() ?? null,
          callCount: r.callCount,
          recovered30d: r.recovered30d,
          ptpDate: r.ptpDate?.toISOString() ?? null,
          ptpAmount: r.ptpAmount,
          entityId: r.entityId,
        }))}
        total={total}
        page={page}
        pageSize={PAGE}
        bands={CATEGORY_LIST.map((c) => ({ id: c.id, short: c.short, name: c.name, accent: c.accent, posture: c.posture, commission: c.commission }))}
        branches={branches.slice(0, 60)}
        agents={agents.filter((a) => a.roleId === 4 || a.roleId === 6).map((a) => ({ id: a.id, name: a.name }))}
      />
    );
  } catch (e) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Broken
          title="The queue could not be read"
          detail={e instanceof CollectBoxUnavailable ? e.message : e instanceof Error ? e.message : "Unknown error."}
        />
      </div>
    );
  }
}
