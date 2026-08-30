"use client";

// ─────────────────────────────────────────────────────────────────────────────
// IN AND OUT.
//
// Two series, one baseline, opposite directions. Money out (disbursement) is
// drawn upward and money in (collection) downward from the same axis, because
// the reader's real question is "did more leave than came back", and that is a
// question about which side of a line is bigger — not about two lines that need
// to be mentally subtracted.
//
// THE NET IS DELIBERATELY NOT CALLED PROFIT. A book that grows shows a negative
// net here and that is usually good news; a book that shrinks shows a positive
// one and may be very bad news. The label says what it is — collected minus
// disbursed — and refuses to editorialise.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Card, CardHead, PageHead, Stat, KES, N, shortDate, Empty } from "@/components/suite/kit";

type Day = {
  day: string;
  disbursed: number;
  disbursedN: number;
  collected: number;
  collectedN: number;
  postings: number;
};

const OUT = "#be123c";
const IN = "#0f766e";
const WINDOWS = [7, 30, 90, 365];

export default function FlowsBoard({
  days,
  totals,
  windowDays,
  peak,
}: {
  days: Day[];
  totals: { disbursed: number; disbursedN: number; collected: number; collectedN: number; postings: number; net: number };
  windowDays: number;
  peak: Day | null;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [hover, setHover] = useState<number | null>(null);

  const setWindow = (d: number) => {
    const next = new URLSearchParams(sp.toString());
    if (d === 30) next.delete("days");
    else next.set("days", String(d));
    router.push(`/books/flows?${next.toString()}`);
  };

  // One shared scale for both directions, so a bar above the line and a bar
  // below it are directly comparable. Scaling each half to its own maximum would
  // make a quiet collection day look like a busy one.
  const max = useMemo(() => Math.max(...days.map((d) => Math.max(d.disbursed, d.collected)), 1), [days]);
  const active = hover != null ? days[hover] : null;

  const avgCollected = days.length ? totals.collected / days.length : 0;
  const avgDisbursed = days.length ? totals.disbursed / days.length : 0;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <PageHead
        eyebrow="Ledgerly"
        title="In and out"
        sub="What was lent and what came back, day by day. The two series are read from two different databases — the lending ledger and the collections money table — and nobody has ever put them on one axis."
        right={
          <div className="flex items-center gap-1">
            {WINDOWS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setWindow(d)}
                className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                  windowDays === d ? "bg-invert text-invert-fg" : "text-ash-500 hover:bg-ash-900/[0.05]"
                }`}
              >
                {d === 365 ? "1 year" : `${d} days`}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Disbursed"
          value={KES(totals.disbursed, { compact: true })}
          accent={OUT}
          foot={`${N(totals.disbursedN)} loans · Serviceconnect.Loans`}
        />
        <Stat
          label="Collected"
          value={KES(totals.collected, { compact: true })}
          accent={IN}
          foot={`${N(totals.collectedN)} payments · CollectBox.PayedAmount`}
        />
        <Stat
          label="Collected less disbursed"
          value={KES(totals.net, { compact: true })}
          accent={totals.net >= 0 ? IN : OUT}
          foot={totals.net < 0 ? "More was lent than came back — the book grew" : "More came back than was lent — the book shrank"}
        />
        <Stat
          label="Postings written"
          value={N(totals.postings)}
          accent="#0f766e"
          foot="Double-entry lines behind the movement above"
        />
      </div>

      <Card className="mt-3">
        <CardHead
          title={`Day by day, ${windowDays} days`}
          sub="Out above the line, in below it. One scale for both, so the two halves are comparable."
          accent={IN}
          right={
            active ? (
              <div className="text-right">
                <p className="text-[11px] font-semibold text-ash-700">{shortDate(active.day)}</p>
                <p className="text-[10.5px] tabular-nums" style={{ color: OUT }}>
                  out {KES(active.disbursed, { compact: true })} ({N(active.disbursedN)})
                </p>
                <p className="text-[10.5px] tabular-nums" style={{ color: IN }}>
                  in {KES(active.collected, { compact: true })} ({N(active.collectedN)})
                </p>
              </div>
            ) : (
              <p className="text-[10.5px] text-ash-400">Hover a day</p>
            )
          }
        />

        {days.length === 0 ? (
          <Empty title="Nothing moved in this window" detail="Widen it." />
        ) : (
          <>
            <div className="flex h-[220px] items-stretch gap-[2px]" onMouseLeave={() => setHover(null)}>
              {days.map((d, i) => (
                <button
                  key={d.day}
                  type="button"
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  aria-label={`${d.day}: out ${Math.round(d.disbursed)}, in ${Math.round(d.collected)}`}
                  className={`group relative flex min-w-0 flex-1 flex-col justify-center rounded-sm transition-colors ${
                    hover === i ? "bg-ash-900/[0.04]" : ""
                  }`}
                >
                  {/* out — grows upward from the centre line */}
                  <span className="flex h-1/2 w-full items-end justify-center">
                    <span
                      className="w-full rounded-t-[2px] transition-[height] duration-300"
                      style={{ height: `${(d.disbursed / max) * 100}%`, backgroundColor: OUT, opacity: hover == null || hover === i ? 0.9 : 0.4 }}
                    />
                  </span>
                  <span aria-hidden className="h-px w-full bg-ash-900/15" />
                  {/* in — grows downward */}
                  <span className="flex h-1/2 w-full items-start justify-center">
                    <span
                      className="w-full rounded-b-[2px] transition-[height] duration-300"
                      style={{ height: `${(d.collected / max) * 100}%`, backgroundColor: IN, opacity: hover == null || hover === i ? 0.9 : 0.4 }}
                    />
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between text-[10.5px] text-ash-400">
              <span>{shortDate(days[0]?.day)}</span>
              <span className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1">
                  <ArrowUpRight className="h-3 w-3" style={{ color: OUT }} /> disbursed
                </span>
                <span className="inline-flex items-center gap-1">
                  <ArrowDownLeft className="h-3 w-3" style={{ color: IN }} /> collected
                </span>
              </span>
              <span>{shortDate(days[days.length - 1]?.day)}</span>
            </div>
          </>
        )}
      </Card>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHead title="The shape of it" accent={IN} />
          <dl className="space-y-2 text-[12px]">
            <Row label="Average disbursed a day" value={KES(avgDisbursed, { compact: true })} />
            <Row label="Average collected a day" value={KES(avgCollected, { compact: true })} />
            <Row
              label="Busiest collection day"
              value={peak ? `${shortDate(peak.day)} · ${KES(peak.collected, { compact: true })}` : "—"}
            />
            <Row
              label="Payments a loan disbursed"
              value={totals.disbursedN > 0 ? (totals.collectedN / totals.disbursedN).toFixed(1) : "—"}
            />
          </dl>
        </Card>

        <Card>
          <CardHead title="Why these two sources" accent={IN} />
          <p className="text-[11.5px] leading-relaxed text-ash-500">
            Disbursement is read from <code className="text-[10px]">Loans.BorrowDate</code> and{" "}
            <code className="text-[10px]">Loans.LoanAmount</code>, collection from{" "}
            <code className="text-[10px]">PayedAmount.DatePaid</code> — not from the journal. The posting that represents a
            disbursement is not reliably typed across three years of data, whereas both of these are unambiguous. So this screen
            compares two authoritative sources rather than one inferred one.
          </p>
          <p className="mt-2 text-[11.5px] leading-relaxed text-ash-500">
            They also live in <strong className="font-semibold text-ash-700">different databases</strong>. Nobody has ever
            reconciled them, because nothing has ever read both. That they track each other day for day is the finding, not the
            assumption.
          </p>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-ash-900/[0.05] pb-1.5 last:border-0">
      <dt className="text-ash-500">{label}</dt>
      <dd className="shrink-0 font-semibold tabular-nums text-ash-800">{value}</dd>
    </div>
  );
}
