"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, Headphones, Link2, X } from "lucide-react";
import { Card, CardHead, PageHead, Stat, Tag, BarRow, KES, N, PCT, ago, Empty, Simulated } from "@/components/suite/kit";

type Person = {
  id: number; name: string; role: string; roleId: number;
  email: string; phone: string; branch: string; entityId: number;
  active: boolean; borrowers: number; bookOlb: number; lastLoginAt: string | null;
  desk: { agentId: number; recovered30d: number; payments30d: number; linkedBy: string } | null;
};

export default function PeopleBoard({
  totals, roles, branches, people, emptySources,
}: {
  totals: { staff: number; officers: number; onCallFloor: number; branches: number; entities: number[]; activeLast30d: number };
  roles: { id: number; name: string; n: number }[];
  branches: { id: number; name: string; staff: number; borrowers: number; olb: number }[];
  people: Person[];
  emptySources: { table: string; rows: number; wouldPower: string }[];
}) {
  const [q, setQ] = useState("");
  const [role, setRole] = useState<number | null>(null);
  const [deskOnly, setDeskOnly] = useState(false);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return people.filter((p) => {
      if (role != null && p.roleId !== role) return false;
      if (deskOnly && !p.desk) return false;
      if (!needle) return true;
      return p.name.toLowerCase().includes(needle)
        || p.email.toLowerCase().includes(needle)
        || p.phone.includes(needle)
        || p.branch.toLowerCase().includes(needle);
    });
  }, [people, q, role, deskOnly]);

  const maxBorrowers = Math.max(...branches.map((b) => b.borrowers), 1);
  const totalBook = people.reduce((s, p) => s + p.bookOlb, 0);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <PageHead
        eyebrow="PeopleHub"
        title="The roster"
        sub="Read from the systems that already know these people — the lending directory, the call floor, and the table that links them. Nobody is asked to re-enter anybody."
        right={
          <div className="flex items-center gap-1.5 rounded-lg border border-ash-900/10 bg-paper px-2 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-ash-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Name, email, phone or branch"
              className="w-56 bg-transparent text-[12px] outline-none placeholder:text-ash-400"
            />
            {q && <button type="button" onClick={() => setQ("")} aria-label="Clear"><X className="h-3.5 w-3.5 text-ash-400 hover:text-ash-700" /></button>}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="People on the roster" value={N(totals.staff)} foot={`across entities ${totals.entities.join(" and ")}`} />
        <Stat label="Relationship officers" value={N(totals.officers)} foot={`carrying KES ${KES(totalBook, { compact: true })} between them`} />
        <Stat label="On the collections floor" value={N(totals.onCallFloor)} foot="matched to a CollectBox seat" />
        <Stat label="Branches" value={N(totals.branches)} foot="org units with staff or borrowers" />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card pad={false}>
          <div className="p-4 pb-2">
            <CardHead
              title="Directory"
              sub={`${N(shown.length)} of ${N(people.length)} shown, largest book first.`}
              right={
                <button
                  type="button"
                  onClick={() => setDeskOnly((v) => !v)}
                  className={`rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors ${
                    deskOnly ? "border-transparent bg-invert text-invert-fg" : "border-ash-900/10 bg-paper text-ash-600 hover:bg-ash-900/[0.03]"
                  }`}
                >
                  On the call floor
                </button>
              }
            />
            <div className="mb-1 flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => setRole(null)}
                className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ${role == null ? "bg-invert text-invert-fg" : "text-ash-500 hover:bg-ash-900/[0.05]"}`}
              >
                All roles
              </button>
              {roles.slice(0, 7).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRole(role === r.id ? null : r.id)}
                  className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ${role === r.id ? "bg-invert text-invert-fg" : "text-ash-500 hover:bg-ash-900/[0.05]"}`}
                >
                  {r.name} ({N(r.n)})
                </button>
              ))}
            </div>
          </div>

          {shown.length === 0 ? (
            <div className="p-4"><Empty title="Nobody matches" /></div>
          ) : (
            <div className="max-h-[640px] overflow-auto">
              <table className="w-full min-w-[820px] text-left">
                <thead>
                  <tr className="border-y border-ash-900/[0.07] text-[9.5px] font-bold uppercase tracking-[0.1em] text-ash-400">
                    <th className="sticky top-0 bg-paper px-4 py-2">Person</th>
                    <th className="sticky top-0 bg-paper px-3 py-2">Role</th>
                    <th className="sticky top-0 bg-paper px-3 py-2">Branch</th>
                    <th className="sticky top-0 bg-paper px-3 py-2 text-right">Borrowers</th>
                    <th className="sticky top-0 bg-paper px-3 py-2 text-right">Book</th>
                    <th className="sticky top-0 bg-paper px-3 py-2">Call floor</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => (
                    <tr key={p.id} className="border-b border-ash-900/[0.045] last:border-0 hover:bg-ash-900/[0.022]">
                      <td className="px-4 py-2">
                        <span className="block truncate text-[12.5px] font-semibold text-ash-800">{p.name}</span>
                        <span className="block truncate text-[10px] text-ash-400">{p.email || p.phone || "—"}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="block truncate text-[11.5px] text-ash-600">{p.role}</span>
                        {p.entityId === 3005 && <Tag tone="good">Fintech</Tag>}
                      </td>
                      <td className="px-3 py-2 truncate text-[11.5px] text-ash-600">{p.branch}</td>
                      <td className="px-3 py-2 text-right text-[11.5px] tabular-nums text-ash-700">
                        {p.borrowers > 0 ? N(p.borrowers) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-[11.5px] tabular-nums text-ash-600">
                        {p.bookOlb > 0 ? KES(p.bookOlb, { compact: true }) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {p.desk ? (
                          <Link
                            href={`/desk/queue?agent=${p.desk.agentId}`}
                            className="inline-flex items-center gap-1 rounded-md bg-[#be123c]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#be123c] hover:bg-[#be123c]/15"
                            title={`Matched by ${p.desk.linkedBy} · KES ${KES(p.desk.recovered30d)} recovered in 30 days`}
                          >
                            <Headphones className="h-2.5 w-2.5" />
                            {p.desk.recovered30d > 0 ? KES(p.desk.recovered30d, { compact: true }) : "seated"}
                          </Link>
                        ) : (
                          <span className="text-[11px] text-ash-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-3">
          <Card>
            <CardHead title="Branches" sub="Borrowers carried at each org unit." />
            <div className="max-h-[300px] space-y-0.5 overflow-y-auto pr-1">
              {branches.map((b) => (
                <BarRow
                  key={b.id}
                  label={b.name}
                  value={b.borrowers}
                  max={maxBorrowers}
                  accent="var(--accent)"
                  right={N(b.borrowers)}
                />
              ))}
            </div>
          </Card>

          <Card>
            <CardHead title="What this cannot show" sub="And why, named table by named table." />
            <div className="space-y-2">
              {emptySources.map((s) => (
                <div key={s.table} className="rounded-lg border border-ash-900/[0.07] px-2.5 py-2">
                  <p className="flex items-center justify-between gap-2 text-[11px] font-semibold text-ash-700">
                    <code className="truncate rounded bg-ash-900/[0.05] px-1 text-[10px]">{s.table.split(".")[1]}</code>
                    <Tag tone="warn">{s.rows} rows</Tag>
                  </p>
                  <p className="mt-1 text-[10.5px] leading-snug text-ash-500">{s.wouldPower}</p>
                </div>
              ))}
            </div>
            <div className="mt-3">
              <Simulated why="Payroll, leave and appraisals are not shown because Micromart's systems hold none of it — the tables exist and are empty. They would be read the same way everything else here is the moment they carry rows; nothing is fabricated to fill the space." />
            </div>
          </Card>
        </div>
      </div>

      <p className="mt-3 text-[10.5px] leading-relaxed text-ash-400">
        Serviceconnect.UserMaster · Serviceconnect.Roles · Serviceconnect.OrganizationUnits · Serviceconnect.Borrowers ·
        CollectBox.UserMaster · CollectBox.PayedAmount. Call-floor matching goes through
        <code className="mx-1 rounded bg-ash-900/[0.05] px-1">Serviceconnect.CollectionAgents</code>
        where it is populated (1 row of 63) and falls back to phone, then email — the method is shown on every match.
      </p>
    </div>
  );
}
