"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE REPORT BROWSER.
//
// ServiceSuite's version of this screen is a form: pick a category, pick a
// module, pick two dates, press Generate, and a file downloads. You cannot see
// what you asked for until it is in your Downloads folder, and if it is the
// wrong cut you do it again.
//
// This one runs the report ON SCREEN first. You read it, change the range, spot
// the branch you meant to exclude, and export only when it is the thing you
// actually wanted. The export then carries exactly what is on screen, because it
// is the same query with a higher row cap — a spreadsheet that disagrees with
// the table it came from is the fastest way to lose a finance team.
//
// EVERY REPORT SAYS WHAT IT IS. The ServiceSuite procedure it stands in for is
// printed under the title, and where our arithmetic deliberately differs from
// theirs, that sentence is printed too. A lender comparing the two must find the
// explanation here, not have to ask for it.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { AlertCircle, ChevronRight, Info, Loader2, Search } from "lucide-react";
import { buildQuery } from "@/lib/analytics/params";
import ExportMenu from "./ExportMenu";

type Column = { key: string; label: string; format: string; total?: boolean; secondary?: boolean };
type ReportMeta = {
  id: string; name: string; category: string; purpose: string;
  mirrors: string | null; divergence?: string | null; ranged: boolean;
};
type Row = Record<string, string | number | null>;

export type CatalogueEntry = ReportMeta;

const CATEGORY_BLURB: Record<string, string> = {
  OPERATIONS: "The daily book — what went out, what came in, who is on it.",
  RISK: "What is going wrong, and where.",
  COLLECTIONS: "What fell due against what was recovered.",
  FINANCE: "Income and the ledger.",
  EXECUTIVE: "The questions a board asks that no single screen answers.",
};

function fmt(v: string | number | null, format: string): string {
  if (v == null || v === "") return "—";
  if (format === "text") return String(v);
  if (format === "date") {
    const d = new Date(String(v));
    return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (format === "percent") return `${n.toFixed(1)}%`;
  if (format === "money") return n.toLocaleString("en-KE", { maximumFractionDigits: 0 });
  if (format === "days") return `${Math.round(n)}d`;
  return n.toLocaleString("en-KE");
}

const numeric = (f: string) => f !== "text" && f !== "date";

export type RunResult = {
  meta: ReportMeta;
  columns: Column[];
  rows: Row[];
  truncated: boolean;
  elapsedMs: number;
  /** Set when the book could not be read. Named, never an empty table. */
  error: string | null;
};

export default function ReportBrowser({
  catalogue, org, books, from, to, result,
}: {
  catalogue: CatalogueEntry[];
  org: string;
  books: Array<{ id: number; label: string }>;
  from: string;
  to: string;
  /** Run on the server for the report named in ?r=. Null when nothing is picked. */
  result: RunResult | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const current = useMemo(() => new URLSearchParams(sp.toString()), [sp]);
  const selectedId = sp.get("r") ?? "";

  const [pending, startTransition] = useTransition();
  const [showAll, setShowAll] = useState(false);
  const [q, setQ] = useState("");

  const meta = result?.meta ?? null;
  const cols = result?.columns ?? [];
  // Memoised so the empty-array fallback is not a new identity every render,
  // which would re-run the totals for a table that has not changed.
  const rows = useMemo<Row[]>(() => result?.rows ?? [], [result]);
  const truncated = result?.truncated ?? false;
  const elapsed = result?.elapsedMs ?? 0;
  const message = result?.error ?? null;
  const state: "idle" | "loading" | "error" = pending ? "loading" : message ? "error" : "idle";

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set("from", from);
    p.set("to", to);
    const ent = sp.get("ent"); if (ent) p.set("ent", ent);
    const br = sp.get("branch"); if (br) p.set("branch", br);
    const of = sp.get("officer"); if (of) p.set("officer", of);
    return p.toString();
  }, [from, to, sp]);


  // Selecting a report is a NAVIGATION, so the view is shareable and the back
  // button works. useTransition keeps the previous report on screen while the
  // next one runs instead of blanking the page.
  const select = (id: string) =>
    startTransition(() => router.push(`${pathname}${buildQuery(current, { r: id })}`, { scroll: false }));

  const grouped = useMemo(() => {
    const filtered = q.trim()
      ? catalogue.filter((c) => `${c.name} ${c.purpose} ${c.mirrors ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))
      : catalogue;
    const map = new Map<string, CatalogueEntry[]>();
    for (const c of filtered) {
      if (!map.has(c.category)) map.set(c.category, []);
      map.get(c.category)!.push(c);
    }
    return [...map.entries()];
  }, [catalogue, q]);

  const shown = showAll ? cols : cols.filter((c) => !c.secondary);
  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const c of shown) if (c.total) t[c.key] = rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
    return t;
  }, [shown, rows]);

  return (
    <div className="grid gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
      {/* ── The catalogue ─────────────────────────────────────────────────── */}
      <aside className="lg:sticky lg:top-[4.5rem] lg:self-start">
        <div className="rounded-2xl border border-zinc-900/10 bg-white p-2.5">
          <label className="relative mb-2 block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a report"
              className="w-full rounded-lg border border-zinc-900/10 bg-zinc-900/[0.02] py-2 pl-8 pr-2.5 text-[12px] text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-zinc-900/25"
            />
          </label>

          <div className="max-h-[calc(100vh-13rem)] space-y-3 overflow-y-auto pr-0.5">
            {grouped.map(([cat, items]) => (
              <div key={cat}>
                <p className="px-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-400">{cat}</p>
                <p className="mb-1 px-1.5 text-[10.5px] leading-snug text-zinc-400">{CATEGORY_BLURB[cat] ?? ""}</p>
                {items.map((c) => {
                  const on = c.id === selectedId;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => select(c.id)}
                      className={`mb-0.5 flex w-full items-start gap-1.5 rounded-lg px-2 py-1.5 text-left transition-colors ${
                        on ? "bg-zinc-900 text-white" : "hover:bg-zinc-900/[0.045]"
                      }`}
                    >
                      <ChevronRight className={`mt-0.5 h-3 w-3 shrink-0 ${on ? "text-white/60" : "text-zinc-300"}`} />
                      <span className="min-w-0">
                        <span className={`block text-[12px] font-semibold ${on ? "text-white" : "text-zinc-800"}`}>{c.name}</span>
                        <span className={`block text-[10.5px] leading-snug ${on ? "text-white/60" : "text-zinc-500"}`}>{c.purpose}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
            {!grouped.length && <p className="px-1.5 py-4 text-[12px] text-zinc-500">No report matches “{q}”.</p>}
          </div>
        </div>
      </aside>

      {/* ── The report ────────────────────────────────────────────────────── */}
      <section className="min-w-0">
        {!selectedId ? (
          <div className="rounded-2xl border border-dashed border-zinc-900/15 bg-white/60 p-8 text-center">
            <p className="text-[13px] font-semibold text-zinc-700">Pick a report on the left.</p>
            <p className="mx-auto mt-1 max-w-md text-[12px] leading-snug text-zinc-500">
              It runs on screen against {books.map((b) => b.label).join(" + ") || "this book"} before you export
              anything, so you can change the cut without downloading it twice.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-zinc-900/10 bg-white">
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-900/[0.07] p-4">
              <div className="min-w-0">
                <h2 className="text-[15px] font-bold text-zinc-900">{meta?.name ?? "Report"}</h2>
                <p className="mt-0.5 max-w-2xl text-[12px] leading-snug text-zinc-500">{meta?.purpose}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-400">
                  <span>{books.map((b) => `${b.label} · entity ${b.id}`).join("   |   ")}</span>
                  {meta?.ranged
                    ? <span>{from} to {to}</span>
                    : <span>position as at today — a date range does not move it</span>}
                  {elapsed > 0 && <span>{elapsed} ms</span>}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {cols.some((c) => c.secondary) && (
                  <button
                    type="button"
                    onClick={() => setShowAll((v) => !v)}
                    className="rounded-lg border border-zinc-900/10 bg-white px-2.5 py-2 text-[11px] font-semibold text-zinc-600 hover:bg-zinc-900/[0.03]"
                  >
                    {showAll ? "Fewer columns" : `All ${cols.length} columns`}
                  </button>
                )}
                <ExportMenu
                  kind="table"
                  subject={meta?.name ?? "Report"}
                  org={org}
                  books={books.map((b) => b.label)}
                  period={meta?.ranged ? { from, to } : null}
                  downloadHref={`/api/analytics/reports/${encodeURIComponent(selectedId)}?${query}`}
                />
              </div>
            </header>

            {meta?.mirrors && (
              <div className="flex items-start gap-2 border-b border-zinc-900/[0.07] bg-zinc-900/[0.02] px-4 py-2.5">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />
                <p className="text-[11px] leading-snug text-zinc-600">
                  Stands in for ServiceSuite&apos;s <span className="font-mono text-[10.5px] text-zinc-700">{meta.mirrors}</span>.
                  {meta.divergence && <> <span className="font-semibold text-zinc-700">Where it differs:</span> {meta.divergence}</>}
                </p>
              </div>
            )}

            {state === "error" && (
              <div className="flex items-start gap-2 px-4 py-6">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <p className="text-[12px] leading-snug text-amber-900">{message}</p>
              </div>
            )}

            {state === "loading" && (
              <div className="flex items-center justify-center gap-2 py-16 text-[12px] text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Running against the live book…
              </div>
            )}

            {state === "idle" && rows.length === 0 && (
              <p className="px-4 py-12 text-center text-[12px] text-zinc-500">
                This report returned nothing for the current cut. Widen the range or clear a filter.
              </p>
            )}

            {state === "idle" && rows.length > 0 && (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[42rem] border-collapse text-[12px]">
                    <thead>
                      <tr className="border-b border-zinc-900/[0.09]">
                        {shown.map((c) => (
                          <th
                            key={c.key}
                            className={`whitespace-nowrap px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-zinc-500 ${
                              numeric(c.format) ? "text-right" : "text-left"
                            }`}
                          >
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} className="border-b border-zinc-900/[0.045] last:border-0 hover:bg-zinc-900/[0.02]">
                          {shown.map((c) => (
                            <td
                              key={c.key}
                              className={`whitespace-nowrap px-3 py-1.5 ${
                                numeric(c.format) ? "text-right font-mono tabular-nums text-zinc-700" : "text-zinc-700"
                              }`}
                            >
                              {fmt(r[c.key], c.format)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                    {Object.keys(totals).length > 0 && (
                      <tfoot>
                        <tr className="border-t-2 border-zinc-900/20 bg-zinc-900/[0.02] font-semibold">
                          {shown.map((c, i) => (
                            <td key={c.key} className={`px-3 py-2 ${numeric(c.format) ? "text-right font-mono tabular-nums" : ""}`}>
                              {i === 0 ? "Total" : c.total ? fmt(totals[c.key], c.format) : ""}
                            </td>
                          ))}
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>

                <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-900/[0.07] px-4 py-2.5 text-[11px] text-zinc-500">
                  <span>
                    {rows.length.toLocaleString()} rows
                    {/* Said out loud, because a total under a capped table is the
                        total of what is SHOWN and somebody will read it as the book. */}
                    {truncated && (
                      <span className="ml-1 font-medium text-amber-700">
                        — capped for the screen. The export carries the full set.
                      </span>
                    )}
                  </span>
                  {Object.keys(totals).length > 0 && truncated && (
                    <span className="text-amber-700">Totals above are for these {rows.length.toLocaleString()} rows only.</span>
                  )}
                </footer>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
