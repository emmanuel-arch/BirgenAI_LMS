"use client";

// ─────────────────────────────────────────────────────────────────────────────
// RIRI · FIRST RESPONSE — what reached this queue, and what never had to.
//
// Plan §07: Riri makes the counter smaller and sharper. It also changes what
// arrives — fewer, harder, pre-triaged. This strip is the officer's evidence of
// both halves: how many customers got their answer without a person, which
// questions she handles most (the lender's product backlog), and which she hands
// over most (the next knowledge entries somebody should write).
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, Sparkles, ThumbsUp, UserRound, CheckCircle2 } from "lucide-react";
import { RiriAvatar } from "@/components/riri/RiriAvatar";

type Data = {
  success: boolean;
  days: number;
  totals: { resolved: number; offered: number; escalated: number; helpful: number; unhelpful: number };
  asked: number;
  deflectionRate: number | null;
  answered: { question: string; count: number; source: string | null }[];
  escalated: { question: string; count: number }[];
};

export function FirstResponsePanel() {
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(7);

  useEffect(() => {
    let live = true;
    const t = window.setTimeout(() => {
      fetch(`/api/console/riri/first-response?days=${days}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d: Data) => live && d.success && setData(d))
        .catch(() => {});
    }, 0);
    return () => { live = false; window.clearTimeout(t); };
  }, [days]);

  if (!data) return null;
  const rated = data.totals.helpful + data.totals.unhelpful;

  return (
    <section className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50/80 to-white">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left">
        <span className="h-9 w-9 shrink-0 overflow-hidden rounded-full ring-2 ring-white shadow">
          <RiriAvatar size={36} animated={false} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[13.5px] font-semibold text-ash-900">
            <Sparkles className="h-3.5 w-3.5 text-violet-600" /> Riri · first response
          </p>
          <p className="text-[12px] text-ash-600">
            {data.asked === 0
              ? `No customer questions in the last ${data.days} days yet. Customers ask Riri first from the app; what she can't resolve lands in this queue, triaged.`
              : `${data.asked} customer question${data.asked === 1 ? "" : "s"} in ${data.days} days — ${data.deflectionRate}% answered without reaching this queue.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Stat icon={<CheckCircle2 className="h-3 w-3" />} label="Answered" value={data.totals.resolved + data.totals.offered} tone="emerald" />
          <Stat icon={<UserRound className="h-3 w-3" />} label="Handed to you" value={data.totals.escalated} tone="violet" />
          {rated > 0 && <Stat icon={<ThumbsUp className="h-3 w-3" />} label="Helpful" value={`${Math.round((data.totals.helpful / rated) * 100)}%`} tone="sky" />}
        </div>
        <ChevronDown className={`h-4 w-4 shrink-0 text-ash-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="grid gap-4 border-t border-violet-100 px-4 py-3 md:grid-cols-2">
          <List title="What she answers most" hint="Your customers' real questions — the product backlog." items={data.answered.map((a) => ({ q: a.question, n: a.count, sub: a.source }))} />
          <List title="What she hands over most" hint="Write a knowledge entry for these and watch this list shrink." items={data.escalated.map((a) => ({ q: a.question, n: a.count, sub: null }))} />
          <div className="flex items-center gap-1.5 md:col-span-2">
            {[7, 30, 90].map((d) => (
              <button key={d} type="button" onClick={() => setDays(d)} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${days === d ? "bg-violet-600 text-white" : "bg-ash-900/5 text-ash-600 hover:bg-ash-900/10"}`}>
                {d} days
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Stat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number | string; tone: "emerald" | "violet" | "sky" }) {
  const cls = { emerald: "bg-emerald-50 text-emerald-700", violet: "bg-violet-100 text-violet-800", sky: "bg-sky-50 text-sky-700" }[tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${cls}`}>
      {icon} {value} <span className="font-medium opacity-80">{label}</span>
    </span>
  );
}

function List({ title, hint, items }: { title: string; hint: string; items: { q: string; n: number; sub: string | null }[] }) {
  return (
    <div>
      <p className="text-[12px] font-semibold text-ash-900">{title}</p>
      <p className="text-[11px] text-ash-500">{hint}</p>
      {items.length === 0 ? (
        <p className="mt-2 text-[12px] text-ash-500">Nothing yet.</p>
      ) : (
        <ol className="mt-2 space-y-1">
          {items.map((it, i) => (
            <li key={i} className="flex items-start gap-2 text-[12.5px]">
              <span className="w-5 shrink-0 text-right font-semibold tabular-nums text-ash-400">{it.n}</span>
              <span className="min-w-0 flex-1">
                <span className="text-ash-800">{it.q}</span>
                {it.sub && <span className="block truncate text-[10.5px] text-ash-400">{it.sub}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
