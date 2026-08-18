// ─────────────────────────────────────────────────────────────────────────────
// THE PHONE FLOOR — the physical handsets, and the raw PBX trace behind them.
//
// ConnectDesk does not dial: that is the PBX's job, and pretending otherwise
// would be a demo that breaks the moment somebody picks up a handset. What this
// screen does is make the seats visible — which extension an agent is on, so a
// supervisor can walk over, and so a call recording can be traced back to a seat.
// ─────────────────────────────────────────────────────────────────────────────
import { collectBoxOrg, CollectBoxUnavailable } from "@/lib/collectbox/client";
import { listExtensions, listRecentCdr, listAgents } from "@/lib/collectbox/agents";
import PhoneFloor from "@/components/desk/PhoneFloor";
import { Broken } from "@/components/suite/kit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PhonesPage() {
  try {
    const org = collectBoxOrg("micromart");
    const [exts, cdr, agents] = await Promise.all([
      listExtensions(org),
      listRecentCdr(org, 60),
      listAgents(org),
    ]);

    return (
      <PhoneFloor
        extensions={exts.map((e) => ({
          id: e.id, extension: e.extension, mac: e.mac, status: e.status,
          userId: e.userId, agentName: e.agentName,
          role: agents.find((a) => a.id === e.userId)?.role ?? null,
        }))}
        cdr={cdr.map((c) => ({
          id: c.id, callId: c.callId, from: c.from, to: c.to,
          start: c.start?.toISOString() ?? null,
          duration: c.duration, talk: c.talk, status: c.status, type: c.type,
          hasRecording: !!c.recording,
        }))}
      />
    );
  } catch (e) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Broken
          title="The phone floor could not be read"
          detail={e instanceof CollectBoxUnavailable ? e.message : e instanceof Error ? e.message : "Unknown error."}
        />
      </div>
    );
  }
}
