// ─────────────────────────────────────────────────────────────────────────────
// LEDGERLY → IN AND OUT.
//
// Disbursement against collection, day by day. The two series come from two
// DIFFERENT DATABASES — Serviceconnect.Loans and CollectBox.PayedAmount — which
// is what makes the comparison worth making: nobody reconciled them, and they
// still line up. See src/lib/suite/journal.ts.
// ─────────────────────────────────────────────────────────────────────────────
import { collectBoxOrg, CollectBoxUnavailable } from "@/lib/collectbox/client";
import { getFlows } from "@/lib/suite/journal";
import FlowsBoard from "@/components/books/FlowsBoard";
import { Broken } from "@/components/suite/kit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function FlowsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.days) ? sp.days[0] : sp.days;
  const days = Math.min(Math.max(Number(raw ?? 30) || 30, 1), 365);

  try {
    const org = collectBoxOrg("micromart");
    const flows = await getFlows(org, { days });
    return <FlowsBoard days={flows.days} totals={flows.totals} windowDays={flows.windowDays} peak={flows.peak} />;
  } catch (e) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Broken
          title="The cash flows could not be read"
          detail={e instanceof CollectBoxUnavailable ? e.message : e instanceof Error ? e.message : "Unknown error."}
        />
      </div>
    );
  }
}
