"use client";

import { Check, TriangleAlert, PhoneOff, CalendarClock, Handshake } from "lucide-react";
import { Card, CardHead, PageHead, Chip, Tag, Empty } from "@/components/suite/kit";

export default function TaxonomyBoard({
  drift, categories, dispositions, tasks,
}: {
  drift: { kind: string; id: number; ours: string | null; theirs: string | null }[];
  categories: {
    id: number; name: string; short: string; from: number; to: number;
    commission: number; column: string; severity: number; accent: string; posture: string;
  }[];
  dispositions: {
    id: number; name: string; callStatus: number; requiresPromise: boolean;
    schedulesTask: boolean; suppresses: boolean; accent: string; meaning: string;
  }[];
  tasks: { id: number; name: string; accent: string }[];
}) {
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6">
      <PageHead
        eyebrow="Plumbing"
        title="Dispositions & bands"
        sub="Micromart's own vocabulary, mirrored here so the client can colour a chip without a database round trip — and checked against their tables on every render so it cannot quietly rot."
      />

      {drift.length === 0 ? (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-4 py-3">
          <Check className="h-4 w-4 shrink-0 text-emerald-600" />
          <p className="text-[12.5px] font-medium text-emerald-900">
            Checked just now against <code className="rounded bg-emerald-900/[0.07] px-1 text-[11px]">CollectBox.LoanCategories</code> and{" "}
            <code className="rounded bg-emerald-900/[0.07] px-1 text-[11px]">CollectBox.PaymentResponse</code> — all{" "}
            {categories.length} bands and {dispositions.length} dispositions match.
          </p>
        </div>
      ) : (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-4 py-3">
          <p className="flex items-center gap-2 text-[12.5px] font-bold text-amber-900">
            <TriangleAlert className="h-4 w-4 shrink-0 text-amber-600" />
            {drift.length} difference{drift.length === 1 ? "" : "s"} against the live tables
          </p>
          <ul className="mt-2 space-y-1">
            {drift.map((d) => (
              <li key={`${d.kind}-${d.id}`} className="text-[11.5px] text-amber-800">
                <strong className="font-semibold">{d.kind} {d.id}</strong>: ours &ldquo;{d.ours ?? "—"}&rdquo; · theirs &ldquo;{d.theirs ?? "—"}&rdquo;
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-amber-800/85">
            This is reported rather than auto-corrected on purpose. A new disposition needs a decision — does it require
            a promise, does it schedule a follow-up, does it suppress the number — and appending it silently would put a
            row on the floor with no meaning attached to it.
          </p>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHead title="Collection bands" sub="The severity ladder. Ordinal, so the colour is a one-hue ramp rather than a set of unrelated hues." />
          <div className="space-y-2">
            {categories.map((c) => (
              <div key={c.id} className="rounded-lg border border-zinc-900/[0.07] p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <Chip label={c.short} accent={c.accent} />
                    <span className="text-[12.5px] font-semibold text-zinc-800">{c.name}</span>
                  </span>
                  <span className="flex items-center gap-2 text-[10.5px] tabular-nums text-zinc-500">
                    <span>{c.from === c.to ? `${c.from} days` : `${c.from}–${c.to > 10000 ? "∞" : c.to} days`}</span>
                    {c.commission > 0 && <Tag tone="good">{c.commission}% commission</Tag>}
                  </span>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">{c.posture}</p>
                <p className="mt-1 text-[9.5px] text-zinc-400">
                  balance carried in <code className="rounded bg-zinc-900/[0.05] px-1">CollectionTracker.{c.column}</code>
                </p>
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-3">
          <Card>
            <CardHead title="Dispositions" sub="What an agent can record. The rules each one carries are enforced by the API, not just suggested by the interface." />
            <div className="space-y-1.5">
              {dispositions.map((d) => (
                <div key={d.id} className="rounded-lg border border-zinc-900/[0.07] p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: d.accent }} />
                      <span className="text-[12.5px] font-semibold text-zinc-800">{d.name}</span>
                      <Tag tone={d.callStatus === 1 ? "good" : "neutral"}>
                        {d.callStatus === 1 ? "contact made" : "no contact"}
                      </Tag>
                    </span>
                    <span className="flex items-center gap-1">
                      {d.requiresPromise && (
                        <span title="Requires an amount and a date" className="text-emerald-600"><Handshake className="h-3.5 w-3.5" /></span>
                      )}
                      {d.schedulesTask && (
                        <span title="Suggests a follow-up task" className="text-violet-600"><CalendarClock className="h-3.5 w-3.5" /></span>
                      )}
                      {d.suppresses && (
                        <span title="Suppresses the number from redialling" className="text-zinc-500"><PhoneOff className="h-3.5 w-3.5" /></span>
                      )}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{d.meaning}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHead title="Task actions" sub="CollectBox.TaskAction — what a follow-up can be." />
            <div className="flex flex-wrap gap-1.5">
              {tasks.map((t) => (
                <span key={t.id} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-900/10 px-2 py-1 text-[11.5px] font-medium text-zinc-600">
                  <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: t.accent }} />
                  {t.name}
                </span>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
