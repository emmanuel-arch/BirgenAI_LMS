"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE QUEUE — 93,000 cases, forty at a time, in the order worth calling.
//
// ── WHAT AN AGENT NEEDS TO SEE BEFORE DIALLING ───────────────────────────────
// Not the debt. The CONVERSATION. Every row carries four things that a
// collections list normally omits and that change how the call opens:
//
//   · what they have paid in the last thirty days — so nobody demands money
//     that arrived yesterday
//   · when anyone last spoke to them, and how many times — so a customer who
//     has been called four times this week is not called a fifth
//   · the promise already on file, if there is one
//   · their relationship officer's name — because "let me get Collins to call
//     you" is a real option and no collections system ever offers it
//
// ── THE SORTS ARE THE PRODUCT ────────────────────────────────────────────────
// "Highest value" is the default and the obvious one. "Longest since anyone
// spoke to them" is the one that matters: it is the only sort that stops a book
// going quietly cold while every agent works the same familiar names.
// ─────────────────────────────────────────────────────────────────────────────

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Search, Phone, X, ChevronLeft, ChevronRight } from "lucide-react";
import { Card, PageHead, Chip, Tag, Btn, KES, N, ago, Empty } from "@/components/suite/kit";

type Row = {
  trackerId: number; loanId: number; borrowerId: number; name: string; phone: string; dpd: number;
  band: { id: number; short: string; name: string; accent: string };
  olb: number; amountDue: number; product: string; branch: string;
  officer: string | null; agentName: string | null; agentId: number | null;
  actioned: boolean; lastActionAt: string | null; lastComment: string;
  lastCallAt: string | null; callCount: number; recovered30d: number;
  ptpDate: string | null; ptpAmount: number; entityId: number;
};

const SORTS = [
  { key: "value", label: "Highest value", hint: "The biggest balances first. A finite day against an infinite book." },
  { key: "oldest-touch", label: "Longest untouched", hint: "Nobody has spoken to these in the longest. The anti-neglect sort." },
  { key: "dpd", label: "Most overdue", hint: "Deepest in arrears first." },
  { key: "promise", label: "Promise due", hint: "Promises landing soonest — chase before they lapse." },
] as const;

export default function QueueBoard({
  rows, total, page, pageSize, bands, branches, agents,
}: {
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
  bands: { id: number; short: string; name: string; accent: string; posture: string; commission: number }[];
  branches: { name: string; loans: number; olb: number }[];
  agents: { id: number; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(sp.get("q") ?? "");

  const activeBands = (sp.get("band") ?? "").split(",").filter(Boolean).map(Number);
  const sort = sp.get("sort") ?? "value";
  const untouched = sp.get("untouched") === "1";
  const promise = sp.get("promise") === "1";
  const branch = sp.get("branch") ?? "";
  const agent = sp.get("agent") ?? "";

  /** Every filter change goes through here, so the URL is always the state. */
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") next.delete(k);
      else next.set(k, v);
    }
    if (!("p" in patch)) next.delete("p"); // any filter change returns to page 1
    start(() => router.push(`${pathname}?${next.toString()}`));
  };

  const toggleBand = (id: number) => {
    const next = activeBands.includes(id) ? activeBands.filter((b) => b !== id) : [...activeBands, id];
    set({ band: next.length ? next.join(",") : null });
  };

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const filtersOn = activeBands.length > 0 || untouched || promise || !!branch || !!agent || !!sp.get("q");

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6">
      <PageHead
        eyebrow="ConnectDesk"
        title="Work queue"
        sub={`${N(total)} cases match. Every row carries what was paid, what was said and who owns the relationship — before the call opens.`}
        right={
          <form
            onSubmit={(e) => { e.preventDefault(); set({ q: q.trim() || null }); }}
            className="flex items-center gap-1.5 rounded-lg border border-ash-900/10 bg-paper px-2 py-1.5"
          >
            <Search className="h-3.5 w-3.5 shrink-0 text-ash-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Name, phone, ID or loan number"
              className="w-56 bg-transparent text-[12px] outline-none placeholder:text-ash-400"
            />
            {q && (
              <button type="button" onClick={() => { setQ(""); set({ q: null }); }} aria-label="Clear">
                <X className="h-3.5 w-3.5 text-ash-400 hover:text-ash-700" />
              </button>
            )}
          </form>
        }
      />

      {/* ── Bands ─────────────────────────────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {bands.map((b) => {
          const on = activeBands.includes(b.id);
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => toggleBand(b.id)}
              title={`${b.posture}${b.commission ? `\n\nCommission on recovery: ${b.commission}%` : ""}`}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors ${
                on ? "border-transparent text-white" : "border-ash-900/10 bg-paper text-ash-600 hover:bg-ash-900/[0.03]"
              }`}
              style={on ? { backgroundColor: b.accent } : undefined}
            >
              <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: on ? "rgba(255,255,255,0.8)" : b.accent }} />
              {b.name}
            </button>
          );
        })}

        <span className="mx-1 h-4 w-px bg-ash-900/10" aria-hidden />

        <button
          type="button"
          onClick={() => set({ untouched: untouched ? null : "1" })}
          className={`rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors ${
            untouched ? "border-transparent bg-invert text-invert-fg" : "border-ash-900/10 bg-paper text-ash-600 hover:bg-ash-900/[0.03]"
          }`}
        >
          Untouched today
        </button>
        <button
          type="button"
          onClick={() => set({ promise: promise ? null : "1" })}
          className={`rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors ${
            promise ? "border-transparent bg-invert text-invert-fg" : "border-ash-900/10 bg-paper text-ash-600 hover:bg-ash-900/[0.03]"
          }`}
        >
          Has a promise
        </button>

        <select
          value={branch}
          onChange={(e) => set({ branch: e.target.value || null })}
          className="rounded-lg border border-ash-900/10 bg-paper px-2 py-1 text-[11px] font-medium text-ash-600 outline-none"
        >
          <option value="">All branches</option>
          {branches.map((b) => <option key={b.name} value={b.name}>{b.name} ({N(b.loans)})</option>)}
        </select>

        <select
          value={agent}
          onChange={(e) => set({ agent: e.target.value || null })}
          className="rounded-lg border border-ash-900/10 bg-paper px-2 py-1 text-[11px] font-medium text-ash-600 outline-none"
        >
          <option value="">All agents</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>

        {filtersOn && (
          <button
            type="button"
            onClick={() => start(() => router.push(pathname))}
            className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-ash-500 hover:text-ash-800"
          >
            <X className="h-3 w-3" /> Clear
          </button>
        )}
      </div>

      {/* ── Sorts ─────────────────────────────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-center gap-1">
        <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.1em] text-ash-400">Order</span>
        {SORTS.map((s) => (
          <button
            key={s.key}
            type="button"
            title={s.hint}
            onClick={() => set({ sort: s.key })}
            className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${
              sort === s.key ? "bg-invert text-invert-fg" : "text-ash-500 hover:bg-ash-900/[0.05] hover:text-ash-800"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <Card pad={false} className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
        {rows.length === 0 ? (
          <div className="p-6">
            <Empty
              title="Nothing matches those filters"
              detail="The queue holds 93,000 cases; try widening the band selection or clearing the search."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-left">
              <thead>
                <tr className="border-b border-ash-900/[0.07] text-[9.5px] font-bold uppercase tracking-[0.1em] text-ash-400">
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2">Band</th>
                  <th className="px-3 py-2 text-right">Balance</th>
                  <th className="px-3 py-2 text-right">Paid 30d</th>
                  <th className="px-3 py-2">Last contact</th>
                  <th className="px-3 py-2">Promise</th>
                  <th className="px-3 py-2">Owned by</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.trackerId} className="group border-b border-ash-900/[0.045] transition-colors last:border-0 hover:bg-ash-900/[0.022]">
                    <td className="px-3 py-2.5">
                      <Link href={`/desk/case/${r.loanId}`} className="block min-w-0">
                        <span className="block truncate text-[12.5px] font-semibold text-ash-800 group-hover:text-[color:var(--accent)]">
                          {r.name}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-ash-400">
                          <span className="tabular-nums">{r.phone || "no number"}</span>
                          <span aria-hidden>·</span>
                          <span className="truncate">{r.product}</span>
                          <span aria-hidden>·</span>
                          <span className="truncate">{r.branch}</span>
                        </span>
                      </Link>
                    </td>

                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-1.5">
                        <Chip label={r.band.short} accent={r.band.accent} title={r.band.name} />
                        <span className="text-[10.5px] tabular-nums text-ash-500">{r.dpd}d</span>
                      </span>
                    </td>

                    <td className="px-3 py-2.5 text-right">
                      <span className="block text-[12.5px] font-semibold tabular-nums text-ash-800">{KES(r.olb)}</span>
                      {r.amountDue > 0 && (
                        <span className="block text-[10px] tabular-nums text-ash-400">due {KES(r.amountDue)}</span>
                      )}
                    </td>

                    <td className="px-3 py-2.5 text-right">
                      {r.recovered30d > 0 ? (
                        <span className="text-[12px] font-semibold tabular-nums text-emerald-700">{KES(r.recovered30d)}</span>
                      ) : (
                        <span className="text-[12px] tabular-nums text-ash-300">—</span>
                      )}
                    </td>

                    <td className="px-3 py-2.5">
                      {r.lastCallAt || r.lastActionAt ? (
                        <span className="block">
                          <span className="block text-[11.5px] text-ash-600">{ago(r.lastCallAt ?? r.lastActionAt)}</span>
                          <span className="block text-[10px] text-ash-400">
                            {r.callCount > 0 ? `${N(r.callCount)} call${r.callCount === 1 ? "" : "s"} on file` : "no calls logged"}
                          </span>
                        </span>
                      ) : (
                        <Tag tone="warn">Never contacted</Tag>
                      )}
                    </td>

                    <td className="px-3 py-2.5">
                      {r.ptpDate ? (
                        <span className="block">
                          <span className="block text-[11.5px] font-medium tabular-nums text-ash-700">{KES(r.ptpAmount)}</span>
                          <span className="block text-[10px] tabular-nums text-ash-400">
                            {new Date(r.ptpDate).toLocaleDateString("en-KE", { day: "numeric", month: "short" })}
                          </span>
                        </span>
                      ) : (
                        <span className="text-[12px] text-ash-300">—</span>
                      )}
                    </td>

                    <td className="px-3 py-2.5">
                      <span className="block truncate text-[11.5px] text-ash-600">{r.agentName ?? "Unassigned"}</span>
                      {r.officer && <span className="block truncate text-[10px] text-ash-400">RO {r.officer}</span>}
                    </td>

                    <td className="px-3 py-2.5 text-right">
                      <Link
                        href={`/desk/case/${r.loanId}`}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-white transition-opacity"
                        style={{ backgroundColor: "var(--accent)" }}
                      >
                        <Phone className="h-3 w-3" /> Work
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {pages > 1 && (
        <nav className="mt-3 flex items-center justify-between" aria-label="Pagination">
          <p className="text-[11px] text-ash-500">
            {N((page - 1) * pageSize + 1)}–{N(Math.min(page * pageSize, total))} of {N(total)}
          </p>
          <div className="flex items-center gap-1">
            <Btn variant="outline" size="sm" disabled={page <= 1} onClick={() => set({ p: String(page - 1) })}>
              <ChevronLeft className="h-3 w-3" /> Previous
            </Btn>
            <span className="px-2 text-[11px] tabular-nums text-ash-500">{page} / {N(pages)}</span>
            <Btn variant="outline" size="sm" disabled={page >= pages} onClick={() => set({ p: String(page + 1) })}>
              Next <ChevronRight className="h-3 w-3" />
            </Btn>
          </div>
        </nav>
      )}
    </div>
  );
}
