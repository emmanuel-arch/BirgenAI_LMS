"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE BRANCH TREE.
//
// Three numbers per branch that have always lived in three departments: staff
// (HR), book outstanding (lending), arrears and recovery (collections). Put side
// by side, the interesting column is the last one — BOOK PER OFFICER. A branch
// with forty-eight staff and twelve officers carrying 8,252 borrowers is a
// different management problem from one with twenty-nine staff and two officers
// carrying 6,062, and neither of those sentences can be written today without
// opening two systems and a spreadsheet.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import { Search, X, Building2 } from "lucide-react";
import { Card, CardHead, PageHead, Stat, BarRow, KES, N, PCT, Empty } from "@/components/suite/kit";

type Branch = {
  id: number;
  name: string;
  staff: number;
  officers: number;
  borrowers: number;
  loansOpen: number;
  olb: number;
  tracked: number;
  nplLoans: number;
  arrears: number;
  recovered30d: number;
};

type Sort = "olb" | "borrowers" | "staff" | "arrears" | "load";

const ACCENT = "#6d28d9";

/** Borrowers per relationship officer at this branch. Zero officers = no answer, not infinity. */
const loadOf = (b: Branch) => (b.officers > 0 ? b.borrowers / b.officers : 0);

export default function BranchBoard({
  branches,
  totals,
}: {
  branches: Branch[];
  totals: { branches: number; staff: number; borrowers: number; olb: number; arrears: number; recovered30d: number };
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("olb");

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = needle ? branches.filter((b) => b.name.toLowerCase().includes(needle)) : branches;
    const by: Record<Sort, (a: Branch, b: Branch) => number> = {
      olb: (a, b) => b.olb - a.olb,
      borrowers: (a, b) => b.borrowers - a.borrowers,
      staff: (a, b) => b.staff - a.staff,
      arrears: (a, b) => b.arrears - a.arrears,
      load: (a, b) => loadOf(b) - loadOf(a),
    };
    return rows.slice().sort(by[sort]);
  }, [branches, q, sort]);

  const maxArrears = Math.max(...branches.map((b) => b.arrears), 1);
  const worst = useMemo(
    () => branches.filter((b) => b.arrears > 0).slice().sort((a, b) => b.arrears - a.arrears).slice(0, 8),
    [branches],
  );
  const unstaffed = branches.filter((b) => b.borrowers > 0 && b.officers === 0);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <PageHead
        eyebrow="PeopleHub"
        title="Branches"
        sub="The org tree with the staff, the book and the collections floor at every node. Three numbers that have always lived in three different departments."
        right={
          <div className="flex items-center gap-1.5 rounded-lg border border-ash-900/10 bg-paper px-2 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-ash-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Branch"
              className="w-40 bg-transparent text-[12px] outline-none placeholder:text-ash-400"
            />
            {q && (
              <button type="button" onClick={() => setQ("")} aria-label="Clear">
                <X className="h-3.5 w-3.5 text-ash-400 hover:text-ash-700" />
              </button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Branches carrying something" value={N(totals.branches)} accent={ACCENT} />
        <Stat label="Staff" value={N(totals.staff)} accent={ACCENT} />
        <Stat label="Borrowers" value={N(totals.borrowers)} accent={ACCENT} />
        <Stat label="Book outstanding" value={KES(totals.olb, { compact: true })} accent={ACCENT} />
        <Stat
          label="In arrears"
          value={KES(totals.arrears, { compact: true })}
          accent="#be123c"
          foot={`${KES(totals.recovered30d, { compact: true })} recovered in 30 days`}
        />
      </div>

      {unstaffed.length > 0 && (
        <Card className="mt-3 border-amber-500/25 bg-amber-500/[0.045]">
          <p className="text-[12.5px] font-semibold text-amber-900">
            {unstaffed.length} branch{unstaffed.length === 1 ? "" : "es"} hold a book with no relationship officer on the roster
          </p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-amber-800/80">
            {unstaffed
              .slice(0, 6)
              .map((b) => `${b.name} (${N(b.borrowers)})`)
              .join(", ")}
            {unstaffed.length > 6 ? ", …" : ""}. Either the borrowers are carried by an officer booked elsewhere, or nobody is
            named on them at all. Both are worth knowing and neither is visible in a staff list.
          </p>
        </Card>
      )}

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card pad={false}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ash-900/[0.06] px-4 py-3">
            <div>
              <h2 className="text-[13px] font-semibold text-ash-800">Every branch</h2>
              <p className="mt-0.5 text-[11px] text-ash-500">
                {N(shown.length)} shown{q ? ` of ${N(branches.length)}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  ["olb", "Book"],
                  ["borrowers", "Borrowers"],
                  ["staff", "Staff"],
                  ["arrears", "Arrears"],
                  ["load", "Book per officer"],
                ] as [Sort, string][]
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSort(k)}
                  className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                    sort === k ? "bg-invert text-invert-fg" : "text-ash-500 hover:bg-ash-900/[0.05]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {shown.length === 0 ? (
            <div className="p-4">
              <Empty title="No branch matches that" detail="Clear the search." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-ash-900/[0.06] text-[10px] uppercase tracking-wide text-ash-400">
                    <th className="px-4 py-2 text-left font-bold">Branch</th>
                    <th className="px-3 py-2 text-right font-bold">Staff</th>
                    <th className="px-3 py-2 text-right font-bold">Officers</th>
                    <th className="px-3 py-2 text-right font-bold">Borrowers</th>
                    <th className="px-3 py-2 text-right font-bold">Per officer</th>
                    <th className="px-3 py-2 text-right font-bold">Outstanding</th>
                    <th className="px-3 py-2 text-right font-bold">Arrears</th>
                    <th className="px-3 py-2 text-right font-bold">Recovered 30d</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((b) => (
                    <tr key={b.id} className="border-b border-ash-900/[0.04] last:border-0 hover:bg-ash-900/[0.02]">
                      <td className="px-4 py-2">
                        <span className="block truncate font-medium text-ash-800">{b.name}</span>
                        {b.tracked > 0 && (
                          <span className="block truncate text-[10.5px] text-ash-400">
                            {N(b.tracked)} on the floor · {N(b.nplLoans)} in NPL
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-ash-600">{N(b.staff)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ash-600">{b.officers || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ash-700">{N(b.borrowers)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ash-500">
                        {b.officers > 0 ? Math.round(loadOf(b)).toLocaleString("en-KE") : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-ash-800">
                        {KES(b.olb, { compact: true })}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-ash-600">
                        {b.arrears > 0 ? KES(b.arrears, { compact: true }) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-ash-700">
                        {b.recovered30d > 0 ? KES(b.recovered30d, { compact: true }) : <span className="text-ash-300">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-3">
          <Card>
            <CardHead title="Where the arrears are" sub="Across every band, not only NPL." accent="#be123c" />
            <div className="space-y-0.5">
              {worst.map((b) => (
                <BarRow
                  key={b.id}
                  label={b.name}
                  value={b.arrears}
                  max={maxArrears}
                  accent="#be123c"
                  right={KES(b.arrears, { compact: true })}
                />
              ))}
            </div>
          </Card>

          <Card>
            <CardHead title="Recovery against arrears" sub="Thirty days, by branch." accent="#0f766e" />
            <div className="space-y-0.5">
              {worst.map((b) => (
                <BarRow
                  key={b.id}
                  label={b.name}
                  value={b.arrears > 0 ? (b.recovered30d / b.arrears) * 100 : 0}
                  max={100}
                  accent="#0f766e"
                  right={b.arrears > 0 ? PCT((b.recovered30d / b.arrears) * 100) : "—"}
                />
              ))}
            </div>
            <p className="mt-3 border-t border-ash-900/[0.06] pt-2 text-[10.5px] leading-relaxed text-ash-400">
              The same eight branches in both charts, so the pair reads as one picture: the top bar is what is owed, the bottom
              bar is how much of it came back.
            </p>
          </Card>

          <Card>
            <div className="flex items-start gap-2">
              <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-ash-400" />
              <p className="text-[11.5px] leading-relaxed text-ash-500">
                Staff are placed by <code className="text-[10px]">UserMaster.OrganizationUnit</code> and borrowers by{" "}
                <code className="text-[10px]">Borrowers.EntityUnit</code>. They are separate columns and they do not always
                agree, so a branch&rsquo;s officer count and its book are two independent facts rather than one derived from the
                other.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
