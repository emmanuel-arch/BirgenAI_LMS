// ─────────────────────────────────────────────────────────────────────────────
// LEDGERLY — the books, read from the journal Micromart already keep.
//
// `Serviceconnect.dbo.Journals` holds 6.4 million double-entry postings for these
// two entities against an 18-account chart typed INCOME / EXPENSE / LIABILITY /
// ASSET, and it was last written minutes ago. Micromart have been keeping proper
// books for three years; what they have never had is a screen that reads them.
//
// This reports MOVEMENT over a window rather than a balance sheet, because that
// is what a journal without opening balances or period closes can honestly
// support — and the screen says so rather than deriving a statement it cannot.
// ─────────────────────────────────────────────────────────────────────────────
import { collectBoxOrg, CollectBoxUnavailable } from "@/lib/collectbox/client";
import { getBooks } from "@/lib/suite/ledger";
import BooksBoard from "@/components/books/BooksBoard";
import { Broken } from "@/components/suite/kit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function BooksPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.days) ? sp.days[0] : sp.days;
  const days = Math.min(Math.max(Number(raw ?? 30) || 30, 1), 365);

  try {
    const org = collectBoxOrg("micromart");
    const books = await getBooks(org, { days });

    return (
      <BooksBoard
        days={books.windowDays}
        totals={books.totals}
        accounts={books.accounts.filter((a) => a.entries > 0)}
        recent={books.recent.map((e) => ({
          id: e.id, at: e.at?.toISOString() ?? null, amount: e.amount,
          narration: e.narration, from: e.from, to: e.to,
          loanId: e.loanId, borrowerId: e.borrowerId, entityId: e.entityId,
        }))}
        daily={books.daily}
        lastEntryAt={books.lastEntryAt?.toISOString() ?? null}
        journalRows={books.journalRows}
        entityIds={books.entityIds}
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
