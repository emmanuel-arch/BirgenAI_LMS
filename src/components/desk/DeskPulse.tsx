"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE PULSE — the header's proof that this screen is reading, not remembering.
//
// It polls one small endpoint and shows two things: how many agents have moved
// money in the last hour, and how long ago the last shilling landed. That second
// number is the whole point. A demo of a "live" system is worth nothing if the
// audience cannot tell live from a screenshot, and a timestamp that visibly
// advances while you are talking is the only proof that lands.
//
// Polling, not a socket, and deliberately: the underlying source is a SQL Server
// on the other side of a Tailscale link, there is no change feed to subscribe to,
// and a thirty-second poll of a two-column aggregate is a rounding error against
// the 2,000 payments a day that floor is processing anyway.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { ago, KES } from "@/components/suite/kit";

type Pulse = {
  activeAgents: number;
  eventsLastHour: number;
  lastEventAt: string | null;
  recoveredToday: number;
  ok: boolean;
};

export default function DeskPulse() {
  const [p, setP] = useState<Pulse | null>(null);
  const [failed, setFailed] = useState(false);
  // Re-render on a timer as well as on fetch, so "12s ago" keeps counting up
  // between polls instead of freezing and looking stale.
  const [, tick] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/desk/pulse", { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as Pulse;
        if (alive) { setP(j); setFailed(false); }
      } catch {
        if (alive) setFailed(true);
      }
    };
    load();
    const poll = setInterval(load, 30_000);
    const beat = setInterval(() => tick((n) => n + 1), 1000);
    return () => { alive = false; clearInterval(poll); clearInterval(beat); };
  }, []);

  if (failed) {
    return (
      <span className="hidden items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/[0.07] px-2.5 py-1 text-[10px] font-semibold text-amber-700 sm:inline-flex">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Floor unreachable
      </span>
    );
  }

  if (!p) {
    return <span className="hidden h-[26px] w-40 animate-pulse rounded-full bg-ash-900/[0.05] sm:block" aria-hidden />;
  }

  return (
    <span
      className="hidden items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/[0.06] py-1 pl-2.5 pr-3 text-[10px] font-semibold text-emerald-800 sm:inline-flex"
      title={`${p.eventsLastHour} payments in the last hour · KES ${KES(p.recoveredToday)} recovered today`}
    >
      <span className="relative flex h-1.5 w-1.5" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-600" />
      </span>
      <span className="tabular-nums">{p.activeAgents} active this hour</span>
      <span className="text-emerald-700/40" aria-hidden>·</span>
      <span className="font-normal tabular-nums text-emerald-700/80">last payment {ago(p.lastEventAt)}</span>
    </span>
  );
}
