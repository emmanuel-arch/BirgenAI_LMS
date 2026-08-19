"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE OFFICER BOOK.
//
// The sort is the argument. "Largest book" is the obvious default and it is the
// least useful one — it ranks officers by how long they have been employed. The
// column that changes a conversation is COVERAGE: of the money the collections
// floor is tracking against this officer's borrowers, how much came back last
// month. An officer with a small book and no coverage is a problem the roster
// has never been able to show, because the roster and the recovery have always
// lived in different systems.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import { Search, X, TriangleAlert, Users } from "lucide-react";
import { Card, CardHead, PageHead, Stat, Tag, BarRow, KES, N, PCT, ago, Empty } from "@/components/suite/kit";

type Officer = {
  id: number;
  name: string;
  role: string;
  branch: string;
  entityId: number;
  active: boolean;
  phone: string;
  email: string;
  borrowers: number;
  loansOpen: number;
  olb: number;
  tracked: number;
  nplLoans: number;
  nplAmount: number;
  arrears: number;
  recovered30d: number;
  payments30d: number;
  lastLoginAt: string | null;
};

type Sort = "olb" | "borrowers" | "npl" | "coverage" | "recovered";

const ACCENT = "#6d28d9";

/** Of the arrears sitting against this officer's book, what came back in 30 days. */
const coverageOf = (o: Officer) => (o.arrears > 0 ? (o.recovered30d / o.arrears) * 100 : 0);

export default function OfficerBoard({
  totals,
  officers,
}: {
  totals: {
    officers: number;
    borrowers: number;
    olb: number;
    tracked: number;
    nplAmount: number;
    recovered30d: number;
    untouched: number;
  };
  officers: Officer[];
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("olb");
  const [riskOnly, setRiskOnly] = useState(false);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = officers.filter((o) => {
      if (riskOnly && !(o.tracked > 0 && o.payments30d === 0)) return false;
      if (!needle) return true;
      return (
        o.name.toLowerCase().includes(needle) ||
        o.branch.toLowerCase().includes(needle) ||
        o.role.toLowerCase().includes(needle) ||
        o.phone.includes(needle)
      );
    });
    const by: Record<Sort, (a: Officer, b: Officer) => number> = {
      olb: (a, b) => b.olb - a.olb,
      borrowers: (a, b) => b.borrowers - a.borrowers,
      npl: (a, b) => b.nplAmount - a.nplAmount,
      recovered: (a, b) => b.recovered30d - a.recovered30d,
      // Ascending: the officers who recovered least against what they owe the
      // floor come first. That is the whole point of offering this sort.
      coverage: (a, b) => coverageOf(a) - coverageOf(b),
    };
    return rows.slice().sort(by[sort]);
  }, [officers, q, sort, riskOnly]);

  const topBranches = useMemo(() => {
    const m = new Map<string, { branch: string; olb: number; officers: number }>();
    for (const o of officers) {
      const row = m.get(o.branch) ?? { branch: o.branch, olb: 0, officers: 0 };
      row.olb += o.olb;
      row.officers += 1;
      m.set(o.branch, row);
    }
    return [...m.values()].sort((a, b) => b.olb - a.olb).slice(0, 8);
  }, [officers]);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <PageHead
        eyebrow="PeopleHub"
        title="Relationship officers"
        sub="Every officer, the book they carry, and what the collections floor recovered against it last month. The roster lives in HR, the book lives in lending and the recovery lives in collections — this is the first screen that reads all three at once."
        right={
          <div className="flex items-center gap-1.5 rounded-lg border border-zinc-900/10 bg-white px-2 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Officer, branch or role"
              className="w-52 bg-transparent text-[12px] outline-none placeholder:text-zinc-400"
            />
            {q && (
              <button type="button" onClick={() => setQ("")} aria-label="Clear">
                <X className="h-3.5 w-3.5 text-zinc-400 hover:text-zinc-700" />
              </button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Officers carrying a book" value={N(totals.officers)} accent={ACCENT} foot="Anyone named on at least one borrower" />
        <Stat label="Borrowers carried" value={N(totals.borrowers)} accent={ACCENT} />
        <Stat label="Book outstanding" value={KES(totals.olb, { compact: true })} accent={ACCENT} />
        <Stat
          label="In NPL on the floor"
          value={KES(totals.nplAmount, { compact: true })}
          accent="#be123c"
          foot={`${PCT((totals.nplAmount / Math.max(totals.olb, 1)) * 100)} of the book outstanding`}
        />
        <Stat
          label="Recovered, 30 days"
          value={KES(totals.recovered30d, { compact: true })}
          accent="#0f766e"
          foot="Attributed through the loan, to the officer who owns the relationship"
        />
      </div>

      {/* The finding. Not a warning banner for its own sake — a count that could
          not previously be produced by any single system in the building. */}
      {totals.untouched > 0 && (
        <Card className="mt-3 border-amber-500/25 bg-amber-500/[0.045]">
          <div className="flex items-start gap-2.5">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="min-w-0">
              <p className="text-[12.5px] font-semibold text-amber-900">
                {totals.untouched} officer{totals.untouched === 1 ? " has" : "s have"} a book on the collections floor and took no
                payment at all in thirty days
              </p>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-amber-800/80">
                Their borrowers are being tracked, dispositions are being recorded against them, and nothing has come back. This is
                a question about coverage, not about effort — and answering it needs the roster, the book and the floor in the same
                query.
              </p>
              <button
                type="button"
                onClick={() => setRiskOnly((v) => !v)}
                className="mt-2 rounded-md bg-amber-600/90 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-600"
              >
                {riskOnly ? "Show every officer" : "Show me only those"}
              </button>
            </div>
          </div>
        </Card>
      )}

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card pad={false}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-900/[0.06] px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-[13px] font-semibold text-zinc-800">
                {riskOnly ? "Officers with no recovery" : "The officer book"}
              </h2>
              <p className="mt-0.5 text-[11px] text-zinc-500">
                {N(shown.length)} shown{q || riskOnly ? ` of ${N(officers.length)}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  ["olb", "Largest book"],
                  ["borrowers", "Most borrowers"],
                  ["npl", "Most in NPL"],
                  ["recovered", "Most recovered"],
                  ["coverage", "Weakest coverage"],
                ] as [Sort, string][]
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSort(k)}
                  className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                    sort === k ? "bg-zinc-900 text-white" : "text-zinc-500 hover:bg-zinc-900/[0.05]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {shown.length === 0 ? (
            <div className="p-4">
              <Empty title="No officer matches that" detail="Clear the search, or turn the filter off." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-zinc-900/[0.06] text-[10px] uppercase tracking-wide text-zinc-400">
                    <th className="px-4 py-2 text-left font-bold">Officer</th>
                    <th className="px-3 py-2 text-right font-bold">Borrowers</th>
                    <th className="px-3 py-2 text-right font-bold">Outstanding</th>
                    <th className="px-3 py-2 text-right font-bold">On the floor</th>
                    <th className="px-3 py-2 text-right font-bold">In NPL</th>
                    <th className="px-3 py-2 text-right font-bold">Recovered 30d</th>
                    <th className="px-3 py-2 text-right font-bold">Coverage</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.slice(0, 250).map((o) => {
                    const cov = coverageOf(o);
                    const dead = o.tracked > 0 && o.payments30d === 0;
                    return (
                      <tr key={o.id} className="border-b border-zinc-900/[0.04] last:border-0 hover:bg-zinc-900/[0.02]">
                        <td className="px-4 py-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-zinc-800">{o.name}</span>
                              <span className="block truncate text-[10.5px] text-zinc-400">
                                {o.branch} · {o.role}
                                {o.entityId === 3005 && " · Fintech"}
                              </span>
                            </span>
                            {!o.active && <Tag tone="neutral">inactive</Tag>}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-zinc-700">{N(o.borrowers)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-zinc-800">
                          {KES(o.olb, { compact: true })}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-zinc-600">{N(o.tracked)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-zinc-600">
                          {o.nplAmount > 0 ? KES(o.nplAmount, { compact: true }) : "—"}
                          {o.nplLoans > 0 && <span className="ml-1 text-[10px] text-zinc-400">({N(o.nplLoans)})</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-zinc-700">
                          {o.recovered30d > 0 ? KES(o.recovered30d, { compact: true }) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {dead ? (
                            <Tag tone="bad">nothing</Tag>
                          ) : cov > 0 ? (
                            <span
                              className="tabular-nums font-semibold"
                              style={{ color: cov >= 20 ? "#0f766e" : cov >= 8 ? "#a16207" : "#be123c" }}
                            >
                              {PCT(cov)}
                            </span>
                          ) : (
                            <span className="text-zinc-300">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {shown.length > 250 && (
                <p className="px-4 py-2 text-[11px] text-zinc-400">
                  Showing the first 250 of {N(shown.length)}. Narrow it with the search.
                </p>
              )}
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-3">
          <Card>
            <CardHead
              title="Where the book sits"
              sub="Officers' outstanding balances, gathered by the branch the officer belongs to."
              accent={ACCENT}
            />
            <div className="space-y-0.5">
              {topBranches.map((b) => (
                <BarRow
                  key={b.branch}
                  label={b.branch}
                  value={b.olb}
                  max={topBranches[0]?.olb ?? 1}
                  accent={ACCENT}
                  right={KES(b.olb, { compact: true })}
                />
              ))}
            </div>
            <p className="mt-3 border-t border-zinc-900/[0.06] pt-2 text-[10.5px] leading-relaxed text-zinc-400">
              An officer&rsquo;s branch and their borrowers&rsquo; branch are two different columns
              (<code className="text-[10px]">UserMaster.OrganizationUnit</code> and{" "}
              <code className="text-[10px]">Borrowers.EntityUnit</code>), and they do not always agree — several officers carry
              borrowers booked to another branch. That is a finding about the data, so it is shown rather than smoothed over.
            </p>
          </Card>

          <Card>
            <CardHead title="How coverage is computed" accent={ACCENT} />
            <p className="text-[11.5px] leading-relaxed text-zinc-500">
              Coverage is what the floor recovered in thirty days as a share of everything in arrears against that officer&rsquo;s
              borrowers — every band, not only NPL. The recovery is attributed by joining{" "}
              <code className="text-[10px]">PayedAmount.LoanId</code> back through{" "}
              <code className="text-[10px]">Loans</code> to <code className="text-[10px]">Borrowers.EntityAgent</code>, so it
              follows the relationship rather than the agent who happened to take the call.
            </p>
          </Card>

          <Card>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 shrink-0 text-zinc-400" />
              <p className="text-[11.5px] leading-relaxed text-zinc-500">
                Officers whose sign-in has lapsed still appear — they still carry a book, and that is exactly the case worth
                seeing. The most recent sign-in is on each person&rsquo;s row in the directory.
              </p>
            </div>
          </Card>
        </div>
      </div>

      <p className="mt-4 text-[10.5px] text-zinc-400">
        Read live from Serviceconnect and CollectBox when this page rendered
        {officers.length > 0 && officers.some((o) => o.lastLoginAt)
          ? ` — most recent officer sign-in ${ago(
              officers.map((o) => o.lastLoginAt).filter(Boolean).sort().reverse()[0] as string,
            )}`
          : ""}
        . Nothing on this screen is stored by this platform.
      </p>
    </div>
  );
}
