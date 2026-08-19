// ─────────────────────────────────────────────────────────────────────────────
// LEDGERLY → JOURNAL.
//
// 6.4 million double-entry postings, newest first, both sides named — and the
// loan each one belongs to. That last column is the connection: an accountant
// reading a line here is looking at the same loan the officer originated and the
// agent is calling about. See src/lib/suite/journal.ts.
// ─────────────────────────────────────────────────────────────────────────────
import { collectBoxOrg, CollectBoxUnavailable } from "@/lib/collectbox/client";
import { getJournalPage } from "@/lib/suite/journal";
import JournalBoard from "@/components/books/JournalBoard";
import { Broken } from "@/components/suite/kit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const page = Math.max(Number(one(sp.page) ?? 1) || 1, 1);
  const days = Math.min(Math.max(Number(one(sp.days) ?? 30) || 30, 1), 365);
  const acct = Number(one(sp.account) ?? 0) || 0;

  try {
    const org = collectBoxOrg("micromart");
    const j = await getJournalPage(org, { page, days, accountId: acct > 0 ? acct : null, pageSize: 100 });

    return (
      <JournalBoard
        rows={j.rows.map((r) => ({
          id: r.id,
          at: r.at?.toISOString() ?? null,
          amount: r.amount,
          narration: r.narration,
          from: r.from,
          to: r.to,
          loanId: r.loanId,
          borrowerId: r.borrowerId,
          entityId: r.entityId,
        }))}
        accounts={j.accounts}
        page={j.page}
        pageSize={j.pageSize}
        matched={j.matched}
        journalRows={j.journalRows}
        windowDays={j.windowDays}
        accountId={j.accountId}
        lastEntryAt={j.lastEntryAt?.toISOString() ?? null}
      />
    );
  } catch (e) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Broken
          title="The journal could not be read"
          detail={e instanceof CollectBoxUnavailable ? e.message : e instanceof Error ? e.message : "Unknown error."}
        />
      </div>
    );
  }
}
