"use client";

// The whole business, newest first. Filterable by which system an event came
// from — which is the only filter that matters here, because the point of the
// screen is that events from five different systems are sitting in one list.

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, PageHead, Tag, Stat, KES, N, ago, shortTime, Empty, TimeAgo } from "@/components/suite/kit";

type Item = {
  id: string; at: string; system: string; kind: string;
  headline: string; detail: string; subject: string;
  actor: string | null; actorRole: string | null;
  amount: number | null; tone: string; tags: string[]; loanId: number;
};

const TONE: Record<string, string> = {
  positive: "#059669", negative: "#dc2626", warning: "#d97706", neutral: "#94a3b8",
};

const SYSTEM_TONE: Record<string, "info" | "good" | "neutral"> = {
  "Call Centre": "info",
  "Fintech Pipeline": "good",
  ConnectDesk: "good",
};

export default function ActivityStream({ items }: { items: Item[] }) {
  const [system, setSystem] = useState<string | null>(null);

  const systems = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of items) counts.set(i.system, (counts.get(i.system) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);

  const shown = system ? items.filter((i) => i.system === system) : items;
  const money = items.filter((i) => i.kind === "payment").reduce((s, i) => s + (i.amount ?? 0), 0);
  const newest = items[0]?.at ?? null;

  // Group by day so a long stream stays readable.
  const groups = useMemo(() => {
    const out: { day: string; rows: Item[] }[] = [];
    for (const i of shown) {
      const day = new Date(i.at).toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long" });
      const last = out[out.length - 1];
      if (last && last.day === day) last.rows.push(i);
      else out.push({ day, rows: [i] });
    }
    return out;
  }, [shown]);

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
      <PageHead
        eyebrow="ConnectDesk"
        title="Activity stream"
        sub="Calls, payments, disbursements and desk actions from every system, merged into one list. No system Micromart runs today can produce this view."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Events shown" value={N(items.length)} foot={<>newest <TimeAgo at={newest} /></>} />
        <Stat label="Systems represented" value={String(systems.length)} foot={systems.map(([s]) => s).join(" · ")} />
        <Stat label="Money in this window" value={KES(money)} unit="KES" foot="payments only" />
        <Stat
          label="Distinct customers"
          value={N(new Set(items.map((i) => i.subject)).size)}
          foot="named on these events"
        />
      </div>

      <div className="mt-4 mb-3 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setSystem(null)}
          className={`rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${
            system == null ? "border-transparent bg-invert text-invert-fg" : "border-ash-900/10 bg-paper text-ash-600 hover:bg-ash-900/[0.03]"
          }`}
        >
          Everything ({N(items.length)})
        </button>
        {systems.map(([s, n]) => (
          <button
            key={s}
            type="button"
            onClick={() => setSystem(system === s ? null : s)}
            className={`rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${
              system === s ? "border-transparent bg-invert text-invert-fg" : "border-ash-900/10 bg-paper text-ash-600 hover:bg-ash-900/[0.03]"
            }`}
          >
            {s} ({N(n)})
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <Card><Empty title="Nothing in this window" /></Card>
      ) : (
        groups.map((g) => (
          <div key={g.day} className="mb-4">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-ash-400">{g.day}</p>
            <Card pad={false}>
              <ol>
                {g.rows.map((i) => (
                  <li key={i.id} className="border-b border-ash-900/[0.045] last:border-0">
                    <Link href={`/desk/case/${i.loanId}`} className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-ash-900/[0.022]">
                      <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TONE[i.tone] ?? TONE.neutral }} />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <span className="text-[12.5px] font-semibold text-ash-800">{i.headline}</span>
                          <span className="text-[10.5px] tabular-nums text-ash-400">{shortTime(i.at)}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-[11.5px] text-ash-500">
                          {i.subject}
                          {i.actor ? <span className="text-ash-400"> · {i.actor}{i.actorRole ? ` (${i.actorRole})` : ""}</span> : null}
                        </span>
                        {i.detail && <span className="mt-0.5 block truncate text-[11px] text-ash-400">{i.detail}</span>}
                        <span className="mt-1 flex flex-wrap gap-1">
                          <Tag tone={SYSTEM_TONE[i.system] ?? "neutral"}>{i.system}</Tag>
                          {i.tags.filter((t) => t && !["Payment", "Call"].includes(t)).slice(0, 3).map((t) => <Tag key={t}>{t}</Tag>)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            </Card>
          </div>
        ))
      )}
    </div>
  );
}
