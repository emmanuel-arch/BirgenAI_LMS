"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE FILTER BAR — one row above the charts, and the same row on every screen.
//
// ServiceSuite ships a modal with four native <select>s, one of which is a
// forty-item unsearchable scroll box, and it opens identically for a field
// officer and the CEO. This is the opposite in three specific ways:
//
//   1. IT IS ALWAYS VISIBLE. A filter behind a button is a filter people forget
//      is applied — and a number read under a forgotten filter is worse than no
//      number. The active cut is stated across the top of every screen.
//
//   2. IT WRITES TO THE URL. Every change is a navigation, which makes the view
//      shareable and the back button meaningful. The page is a server component;
//      the filters arrive as searchParams and the aggregation runs in Postgres.
//
//   3. IT ONLY OFFERS WHAT YOU MAY SEE. The option lists come from the server,
//      already scoped. A filter surface built from a full org list is an
//      org-chart disclosure with a dropdown around it.
//
// `useTransition` keeps the previous numbers on screen, dimmed, while the new
// ones load. A filter that blanks the page on every click teaches people to stop
// clicking it.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { CalendarRange, Filter, X, Check, ChevronDown, Loader2, Link2, Clock } from "lucide-react";
import { RANGE_DEFS, type Bucket } from "@/lib/analytics/ranges";
import { buildQuery } from "@/lib/analytics/params";

export type FilterOption = { id: string; label: string; hint?: string };

export type FilterAxes = {
  branches: FilterOption[];
  officers: FilterOption[];
  products: FilterOption[];
};

const RISK_BANDS: FilterOption[] = [
  { id: "PRIME", label: "Prime" },
  { id: "STRONG", label: "Strong" },
  { id: "WATCH", label: "Watch" },
  { id: "HIGH", label: "High risk" },
];

const GRAINS: Array<{ key: Bucket; label: string }> = [
  { key: "day", label: "Daily" },
  { key: "week", label: "Weekly" },
  { key: "month", label: "Monthly" },
  { key: "quarter", label: "Quarterly" },
  { key: "year", label: "Yearly" },
];

export default function StudioFilterBar({
  axes,
  /** What the current cut resolves to, computed server-side. Printed as the truth. */
  rangeLabel,
  compareLabel,
  /** Set when a to-date period is being compared like-for-like. */
  partial,
  /** Offer the grain control (trend screens only — a leaderboard has no time axis). */
  showGrain = true,
}: {
  axes: FilterAxes;
  rangeLabel: string;
  compareLabel: string;
  partial: boolean;
  showGrain?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const current = useMemo(() => new URLSearchParams(sp.toString()), [sp]);
  const range = current.get("range") ?? "30d";
  const grain = current.get("grain") ?? "";

  const selected = (key: string): string[] => (current.get(key) ?? "").split(",").filter(Boolean);

  const go = (patch: Record<string, string | string[] | null>) => {
    startTransition(() => router.push(`${pathname}${buildQuery(current, patch)}`, { scroll: false }));
  };

  const toggle = (key: string, id: string) => {
    const now = selected(key);
    go({ [key]: now.includes(id) ? now.filter((x) => x !== id) : [...now, id] });
  };

  const activeCount =
    selected("branch").length + selected("officer").length + selected("product").length + selected("risk").length;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the URL is in the address bar either way */
    }
  };

  // ── WHERE THIS BAR PINS, AND WHAT IT PINS TO ───────────────────────────────
  // It stays at the top of the page as you scroll a long report. It used to do
  // that by bleeding to the full width (`-mx-4`) and painting `bg-studio` —
  // both of which assumed the shell's old opaque 56px header and a page that
  // ran edge to edge. The page is a rounded canvas now, so a square full-bleed
  // bar pokes out past its corners, and `bg-studio` is the FLOOR's colour,
  // which is behind the canvas rather than on it.
  //
  // So it is a rounded card ON the canvas instead, offset far enough down to
  // clear the shell's floating control row above it.
  return (
    <div className={`sticky top-[3.25rem] z-10 mb-4 rounded-xl border border-[color:var(--ink)]/[0.07] bg-paper/85 px-3 py-2.5 shadow-sm backdrop-blur-xl sm:px-4 ${pending ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        {/* ── Range ─────────────────────────────────────────────────────── */}
        <Popover
          id="range"
          open={open === "range"}
          onOpen={(v) => setOpen(v ? "range" : null)}
          trigger={
            <>
              <CalendarRange className="h-3.5 w-3.5" />
              <span className="font-semibold">{rangeLabel}</span>
              <ChevronDown className="h-3 w-3 opacity-50" />
            </>
          }
        >
          <div className="w-64 p-1.5">
            {(["recent", "calendar", "all"] as const).map((group) => (
              <div key={group}>
                <p className="px-2 pb-0.5 pt-2 text-[9px] font-bold uppercase tracking-wider text-ash-400">
                  {group === "recent" ? "Rolling windows" : group === "calendar" ? "Calendar periods" : "Everything"}
                </p>
                {RANGE_DEFS.filter((r) => r.group === group).map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => { go({ range: r.key, from: null, to: null }); setOpen(null); }}
                    className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[12px] transition-colors ${
                      range === r.key ? "bg-invert font-semibold text-invert-fg" : "text-ash-700 hover:bg-ash-900/5"
                    }`}
                  >
                    {r.label}
                    {range === r.key && <Check className="h-3 w-3" />}
                  </button>
                ))}
              </div>
            ))}
            {/* Custom. Two dates, and the range key flips the moment both are set. */}
            <div className="mt-2 border-t border-ash-900/[0.07] px-2 pt-2">
              <p className="pb-1 text-[9px] font-bold uppercase tracking-wider text-ash-400">Custom</p>
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  defaultValue={current.get("from") ?? ""}
                  onChange={(e) => go({ range: "custom", from: e.target.value })}
                  className="w-full rounded-md border border-ash-900/10 px-1.5 py-1 text-[11px]"
                />
                <span className="text-[11px] text-ash-400">to</span>
                <input
                  type="date"
                  defaultValue={current.get("to") ?? ""}
                  onChange={(e) => go({ range: "custom", to: e.target.value })}
                  className="w-full rounded-md border border-ash-900/10 px-1.5 py-1 text-[11px]"
                />
              </div>
            </div>
          </div>
        </Popover>

        {/* ── Grain ─────────────────────────────────────────────────────── */}
        {showGrain && (
          <Popover
            id="grain"
            open={open === "grain"}
            onOpen={(v) => setOpen(v ? "grain" : null)}
            trigger={
              <>
                <Clock className="h-3.5 w-3.5" />
                <span>{grain ? (GRAINS.find((g) => g.key === grain)?.label ?? "Grain") : "Auto grain"}</span>
                <ChevronDown className="h-3 w-3 opacity-50" />
              </>
            }
          >
            <div className="w-48 p-1.5">
              <button
                type="button"
                onClick={() => { go({ grain: null }); setOpen(null); }}
                className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[12px] ${!grain ? "bg-invert font-semibold text-invert-fg" : "text-ash-700 hover:bg-ash-900/5"}`}
              >
                Auto {!grain && <Check className="h-3 w-3" />}
              </button>
              {GRAINS.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => { go({ grain: g.key }); setOpen(null); }}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[12px] ${grain === g.key ? "bg-invert font-semibold text-invert-fg" : "text-ash-700 hover:bg-ash-900/5"}`}
                >
                  {g.label} {grain === g.key && <Check className="h-3 w-3" />}
                </button>
              ))}
              <p className="px-2 pb-1 pt-2 text-[10px] leading-snug text-ash-400">
                Auto picks a grain that lands between roughly 7 and 60 marks. Below that it is not a trend; above it, the
                marks are thinner than the gaps.
              </p>
            </div>
          </Popover>
        )}

        {/* ── Dimension filters ─────────────────────────────────────────── */}
        <MultiPicker label="Branch" paramKey="branch" options={axes.branches} selected={selected("branch")} open={open === "branch"} onOpen={(v) => setOpen(v ? "branch" : null)} onToggle={toggle} onClear={() => go({ branch: null })} />
        <MultiPicker label="Officer" paramKey="officer" options={axes.officers} selected={selected("officer")} open={open === "officer"} onOpen={(v) => setOpen(v ? "officer" : null)} onToggle={toggle} onClear={() => go({ officer: null })} />
        <MultiPicker label="Product" paramKey="product" options={axes.products} selected={selected("product")} open={open === "product"} onOpen={(v) => setOpen(v ? "product" : null)} onToggle={toggle} onClear={() => go({ product: null })} />
        <MultiPicker label="Risk" paramKey="risk" options={RISK_BANDS} selected={selected("risk")} open={open === "risk"} onOpen={(v) => setOpen(v ? "risk" : null)} onToggle={toggle} onClear={() => go({ risk: null })} />

        {activeCount > 0 && (
          <button
            type="button"
            onClick={() => go({ branch: null, officer: null, product: null, risk: null })}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-50"
          >
            <X className="h-3 w-3" /> Clear {activeCount}
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-ash-400" />}
          <button
            type="button"
            onClick={copyLink}
            title="Copy a link to exactly this view"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium text-ash-500 hover:bg-ash-900/5 hover:text-ash-700"
          >
            <Link2 className="h-3 w-3" /> {copied ? "Copied" : "Share this view"}
          </button>
        </div>
      </div>

      {/* The comparison, stated. A delta whose baseline is unnamed is a rumour. */}
      <p className="mt-1 text-[10px] text-ash-400">
        Compared against {compareLabel}
        {partial && " — truncated to the same elapsed days, so a part-month is not read against a whole one"}.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Popover({
  id, open, onOpen, trigger, children,
}: {
  id: string;
  open: boolean;
  onOpen: (v: boolean) => void;
  trigger: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onOpen(!open)}
        aria-expanded={open}
        aria-controls={`pop-${id}`}
        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] transition-colors ${
          open ? "bg-invert text-invert-fg" : "bg-paper text-ash-600 ring-1 ring-ash-900/10 hover:bg-ash-900/[0.04]"
        }`}
      >
        {trigger}
      </button>
      {open && (
        <>
          {/* A click anywhere else closes it. Cheaper and more reliable than a
              document listener, and it cannot leak past unmount. */}
          <div className="fixed inset-0 z-20" onClick={() => onOpen(false)} aria-hidden />
          <div id={`pop-${id}`} className="absolute left-0 top-full z-30 mt-1 max-h-[70vh] overflow-auto rounded-xl border border-ash-900/10 bg-paper shadow-xl">
            {children}
          </div>
        </>
      )}
    </div>
  );
}

function MultiPicker({
  label, paramKey, options, selected, open, onOpen, onToggle, onClear,
}: {
  label: string;
  paramKey: string;
  options: FilterOption[];
  selected: string[];
  open: boolean;
  onOpen: (v: boolean) => void;
  onToggle: (key: string, id: string) => void;
  onClear: () => void;
}) {
  const [q, setQ] = useState("");

  // AN AXIS WITH ONE POSSIBLE ANSWER IS NOT A FILTER. A lender with a single
  // branch gets no branch picker rather than a dropdown that can only tell them
  // what they already know.
  if (options.length < 2) return null;

  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options;
  const chosen = selected.length;

  return (
    <Popover
      id={paramKey}
      open={open}
      onOpen={(v) => { onOpen(v); if (!v) setQ(""); }}
      trigger={
        <>
          <Filter className="h-3 w-3" />
          <span>{label}</span>
          {chosen > 0 && (
            <span className="rounded bg-[color:var(--brand,#7c3aed)] px-1 text-[9px] font-bold text-white">{chosen}</span>
          )}
          <ChevronDown className="h-3 w-3 opacity-50" />
        </>
      }
    >
      <div className="w-64">
        {/* Search appears only when the list is long enough to need it — a search
            box over six branches is furniture. */}
        {options.length > 8 && (
          <div className="border-b border-ash-900/[0.07] p-2">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}…`}
              className="w-full rounded-md border border-ash-900/10 px-2 py-1.5 text-[12px] outline-none focus:ring-2 focus:ring-ash-900/20"
            />
          </div>
        )}
        <div className="max-h-64 overflow-auto p-1.5">
          {shown.length === 0 && <p className="px-2 py-3 text-center text-[11px] text-ash-400">Nothing matches.</p>}
          {shown.map((o) => {
            const on = selected.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => onToggle(paramKey, o.id)}
                className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-ash-900/5"
              >
                <span className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${on ? "border-ash-900 bg-invert" : "border-ash-300"}`}>
                  {on && <Check className="h-2.5 w-2.5 text-white" />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[12px] text-ash-700">{o.label}</span>
                  {o.hint && <span className="block truncate text-[10px] text-ash-400">{o.hint}</span>}
                </span>
              </button>
            );
          })}
        </div>
        {chosen > 0 && (
          <div className="border-t border-ash-900/[0.07] p-1.5">
            <button type="button" onClick={onClear} className="w-full rounded-md px-2 py-1.5 text-left text-[11px] font-semibold text-rose-600 hover:bg-rose-50">
              Clear {label.toLowerCase()}
            </button>
          </div>
        )}
      </div>
    </Popover>
  );
}
