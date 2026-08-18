// ─────────────────────────────────────────────────────────────────────────────
// THE ACTIVITY STREAM — every system, one list.
//
// This is the interaction timeline pointed at the whole business rather than at
// one customer. It answers "what is happening right now", which is a question no
// screen Micromart currently owns can answer at all: their call centre knows
// about calls, their core ledger knows about loans, and nothing knows about both.
// ─────────────────────────────────────────────────────────────────────────────
import { auth } from "@/lib/auth";
import { collectBoxOrg, CollectBoxUnavailable } from "@/lib/collectbox/client";
import { getActivityFeed } from "@/lib/interactions/timeline";
import ActivityStream from "@/components/desk/ActivityStream";
import { Broken } from "@/components/suite/kit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const session = await auth();
  try {
    const org = collectBoxOrg("micromart");
    const feed = await getActivityFeed(org, { limit: 120, orgId: session?.user?.orgId });
    return (
      <ActivityStream
        items={feed.map((f) => ({
          id: f.id, at: f.at.toISOString(), system: f.system, kind: f.kind,
          headline: f.headline, detail: f.detail, subject: f.subjectLabel,
          actor: f.actor?.name ?? null, actorRole: f.actor?.role ?? null,
          amount: f.amount ?? null, tone: f.tone, tags: f.tags, loanId: f.subject.loanId,
        }))}
      />
    );
  } catch (e) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Broken
          title="The activity stream could not be read"
          detail={e instanceof CollectBoxUnavailable ? e.message : e instanceof Error ? e.message : "Unknown error."}
        />
      </div>
    );
  }
}
