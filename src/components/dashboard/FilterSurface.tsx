"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE FILTER SURFACE — one button, and everything behind it.
//
// Replaces the two rows of chips that used to sit above the dashboard ("Whole
// book · My region · My customers" and "1D 7D 30D QTD YTD 12M"), which spent the
// whole command bar on controls most people never touched and still could not
// express "Kitale East, Nancy's book, Micro Business, this quarter".
//
// What makes it better than the modal it is answering (ServiceSuite's four native
// <select>s, one of them a 40-item unsearchable scroll box):
//
//   · IT IS NOT OFFERED TO PEOPLE IT CANNOT SERVE. A field officer has one possible
//     answer on every axis, so they get no button at all (see lib/dashboard/filters).
//   · EVERY AXIS IS SEARCHABLE and multi-select, with the branch tree indented so a
//     region reads as a region.
//   · WHAT IS APPLIED IS ALWAYS ON SCREEN as removable chips — you never have to
//     reopen a dialog to find out what you are looking at.
//   · PRESETS do the four clicks people actually repeat.
//   · It commits on Apply, so a slow re-cut never fires four times on the way to
//     the cut you wanted.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { SlidersHorizontal, X, Search, Check, RotateCcw, CalendarRange, Zap, ChevronDown } from "lucide-react";
import { RANGES, type RangeKey } from "@/lib/dashboard/model";
import {
  activeCount, EMPTY_SELECTION,
  type FilterAxis, type FilterCapability, type FilterSelection,
} from "@/lib/dashboard/filters";

type Props = {
  capability: FilterCapability;
  value: FilterSelection;
  onChange: (next: FilterSelection) => void;
  accent: string;
};

const AXIS_KEY = { branch: "branchIds", officer: "officerIds", product: "productIds" } as const;

export default function FilterSurface({ capability, value, onChange, accent }: Props) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  // The panel edits a DRAFT; the dashboard only re-cuts on Apply.
  const [draft, setDraft] = useState<FilterSelection>(value);
  const ref = useRef<HTMLDivElement>(null);

  // Opening seeds the draft from what is currently applied. Done in the handler
  // rather than an effect: the draft is only ever stale between renders if we let
  // a render decide it, and a chip removed while the panel is shut must not be
  // silently re-added by a sync pass on the next open.
  const toggle = () => {
    setOpen((v) => {
      if (!v) setDraft(value);
      return !v;
    });
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const n = activeCount(value);

  const apply = () => { onChange(draft); setOpen(false); };
  const clearAll = () => { onChange({ ...EMPTY_SELECTION, range: value.range }); setOpen(false); };

  // Chips reflect APPLIED state, and removing one re-cuts immediately — the chip is
  // the control, not a readout of it.
  const chips = useMemo(() => {
    const out: { key: string; label: string; remove: () => void }[] = [];
    for (const axis of capability.axes) {
      const field = AXIS_KEY[axis.key];
      for (const id of value[field]) {
        const opt = axis.options.find((o) => o.id === id);
        if (!opt) continue;
        out.push({
          key: `${axis.key}:${id}`,
          label: opt.label,
          remove: () => onChange({ ...value, [field]: value[field].filter((x) => x !== id) }),
        });
      }
    }
    return out;
  }, [capability.axes, value, onChange]);

  // Scope-only people (no axes) still need the date range. They get the compact
  // range control alone rather than a filter button that opens on nothing.
  if (!capability.canFilter) {
    return <RangePills value={value} onChange={onChange} accent={accent} />;
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <AnimatePresence initial={false}>
        {chips.map((c) => (
          <motion.button
            key={c.key}
            type="button"
            onClick={c.remove}
            initial={reduce ? false : { opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduce ? undefined : { opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.15 }}
            className="group inline-flex max-w-[11rem] items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold ring-1 transition-colors"
            style={{ backgroundColor: `${accent}12`, color: accent, ["--tw-ring-color" as never]: `${accent}30` }}
          >
            <span className="truncate">{c.label}</span>
            <X className="h-3 w-3 shrink-0 opacity-50 transition-opacity group-hover:opacity-100" />
          </motion.button>
        ))}
      </AnimatePresence>

      <RangePills value={value} onChange={onChange} accent={accent} />

      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={toggle}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ring-1 transition-colors"
          style={
            n > 0 || open
              ? { backgroundColor: accent, color: "#fff", ["--tw-ring-color" as never]: accent }
              : {
                  color: "var(--ink-muted)",
                  backgroundColor: "rgba(255,255,255,0.6)",
                  ["--tw-ring-color" as never]: "rgba(15,15,25,0.10)",
                }
          }
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filter
          {n > 0 && (
            <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-white/25 px-1 text-[10px] font-bold">
              {n}
            </span>
          )}
        </button>

        <AnimatePresence>
          {open && (
            <motion.div
              role="dialog"
              aria-label="Filter dashboard"
              initial={reduce ? false : { opacity: 0, y: -6, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? undefined : { opacity: 0, y: -6, scale: 0.985 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="absolute right-0 top-full z-50 mt-2 w-[min(30rem,calc(100vw-2rem))] origin-top-right overflow-hidden rounded-2xl border border-[color:var(--ink)]/10 bg-white text-left shadow-2xl"
            >
              {/* Header — states the widest cut this person is entitled to, so the
                  "no filters" state is never ambiguous between "everything" and
                  "everything I am allowed to see". */}
              <div className="flex items-start justify-between gap-3 border-b border-[color:var(--ink)]/[0.07] px-4 py-3">
                <div>
                  <p className="text-[13px] font-bold text-[color:var(--ink)]">Filter dashboard</p>
                  <p className="mt-0.5 text-[11px] text-[color:var(--ink-muted)]">
                    Your view is <span className="font-semibold" style={{ color: accent }}>{capability.scopeLabel}</span>
                    {" · "}narrow it below
                  </p>
                </div>
                <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1 text-[color:var(--ink-faint)] hover:bg-[color:var(--ink)]/5">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="max-h-[min(60vh,26rem)] overflow-y-auto px-4 py-3">
                <Presets capability={capability} draft={draft} setDraft={setDraft} accent={accent} />

                <Section icon={CalendarRange} title="Period">
                  <div className="grid grid-cols-3 gap-1.5">
                    {RANGES.map((r) => {
                      const on = draft.range === r.key;
                      return (
                        <button
                          key={r.key}
                          type="button"
                          onClick={() => setDraft((d) => ({ ...d, range: r.key }))}
                          className="rounded-lg px-2 py-1.5 text-[11px] font-semibold ring-1 transition-colors"
                          style={
                            on
                              ? { backgroundColor: `${accent}14`, color: accent, ["--tw-ring-color" as never]: `${accent}38` }
                              : { color: "var(--ink-muted)", ["--tw-ring-color" as never]: "rgba(15,15,25,0.09)" }
                          }
                        >
                          {r.label}
                        </button>
                      );
                    })}
                  </div>
                  <label className="mt-2 flex cursor-pointer items-center gap-2 text-[11px] text-[color:var(--ink-muted)]">
                    <input
                      type="checkbox"
                      checked={draft.compare}
                      onChange={(e) => setDraft((d) => ({ ...d, compare: e.target.checked }))}
                      className="h-3.5 w-3.5 rounded accent-[color:var(--brand)]"
                    />
                    Overlay the previous period
                  </label>
                </Section>

                {capability.axes.map((axis) => (
                  <AxisPicker
                    key={axis.key}
                    axis={axis}
                    selected={draft[AXIS_KEY[axis.key]]}
                    onToggle={(id) =>
                      setDraft((d) => {
                        const field = AXIS_KEY[axis.key];
                        const cur = d[field];
                        return { ...d, [field]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
                      })
                    }
                    onClear={() => setDraft((d) => ({ ...d, [AXIS_KEY[axis.key]]: [] }))}
                    accent={accent}
                  />
                ))}
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-[color:var(--ink)]/[0.07] bg-[color:var(--ink)]/[0.02] px-4 py-2.5">
                <button
                  type="button"
                  onClick={clearAll}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-[color:var(--ink-muted)] transition-colors hover:text-[color:var(--ink)]"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Reset
                </button>
                <button
                  type="button"
                  onClick={apply}
                  className="rounded-lg px-4 py-1.5 text-[11px] font-bold text-white shadow-sm transition-transform active:scale-[0.98]"
                  style={{ backgroundColor: accent }}
                >
                  Apply
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Presets ───────────────────────────────────────────────────────────────────
// The four clicks people repeat, as one. Only offered when the axes they need
// actually exist for this person.
function Presets({
  capability, draft, setDraft, accent,
}: {
  capability: FilterCapability;
  draft: FilterSelection;
  setDraft: (fn: (d: FilterSelection) => FilterSelection) => void;
  accent: string;
}) {
  const hasBranch = capability.axes.some((a) => a.key === "branch");
  const items: { label: string; apply: (d: FilterSelection) => FilterSelection }[] = [
    { label: "Today", apply: (d) => ({ ...d, range: "today" as RangeKey }) },
    { label: "This quarter vs last", apply: (d) => ({ ...d, range: "qtd" as RangeKey, compare: true }) },
    { label: "Year to date", apply: (d) => ({ ...d, range: "ytd" as RangeKey }) },
  ];
  if (hasBranch) {
    const roots = capability.axes.find((a) => a.key === "branch")!.options.filter((o) => (o.depth ?? 0) === 0);
    if (roots.length === 1) {
      items.push({ label: `Only ${roots[0].label}`, apply: (d) => ({ ...d, branchIds: [roots[0].id] }) });
    }
  }

  return (
    <div className="mb-3">
      <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.085em] text-[color:var(--ink-faint)]">
        <Zap className="h-3 w-3" /> Quick cuts
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => setDraft(p.apply)}
            className="rounded-lg px-2 py-1 text-[11px] font-medium text-[color:var(--ink-body)] ring-1 ring-[color:var(--ink)]/10 transition-colors hover:bg-[color:var(--ink)]/[0.04]"
            style={{ ["--tw-ring-color" as never]: `${accent}22` }}
          >
            {p.label}
          </button>
        ))}
      </div>
      {draft.compare && (
        <p className="mt-1.5 text-[10px] text-[color:var(--ink-faint)]">Comparison overlay is on.</p>
      )}
    </div>
  );
}

// ── One axis ──────────────────────────────────────────────────────────────────
// Searchable, multi-select, indented for the branch tree, collapsed once it is
// long enough to be worth collapsing.
function AxisPicker({
  axis, selected, onToggle, onClear, accent,
}: {
  axis: FilterAxis;
  selected: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  accent: string;
}) {
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState(false);
  const searchable = axis.options.length > 7;

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return axis.options;
    return axis.options.filter(
      (o) => o.label.toLowerCase().includes(needle) || (o.hint ?? "").toLowerCase().includes(needle),
    );
  }, [axis.options, q]);

  // Long lists show a window until asked for more — but a search or an active
  // selection always reveals everything relevant.
  const collapsedLimit = 6;
  const shown = expanded || q ? matches : matches.slice(0, collapsedLimit);
  const hidden = matches.length - shown.length;

  return (
    <Section
      title={axis.label}
      right={
        selected.length > 0 ? (
          <button type="button" onClick={onClear} className="text-[10px] font-semibold text-[color:var(--ink-faint)] hover:text-[color:var(--ink)]">
            Clear {selected.length}
          </button>
        ) : null
      }
    >
      {axis.options.length === 0 ? (
        <p className="text-[11px] text-[color:var(--ink-faint)]">{axis.emptyHint}</p>
      ) : (
        <>
          {searchable && (
            <div className="relative mb-1.5">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--ink-faint)]" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={`Search ${axis.label.toLowerCase()}…`}
                className="w-full rounded-lg border border-[color:var(--ink)]/10 bg-white py-1.5 pl-8 pr-2.5 text-[12px] outline-none placeholder:text-[color:var(--ink-faint)] focus:border-transparent focus:ring-2"
                style={{ ["--tw-ring-color" as never]: `${accent}55` }}
              />
            </div>
          )}

          <div className="space-y-0.5">
            {shown.map((o) => {
              const on = selected.includes(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => onToggle(o.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[color:var(--ink)]/[0.04]"
                  style={{ paddingLeft: `${0.5 + (o.depth ?? 0) * 0.75}rem` }}
                >
                  <span
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded ring-1 transition-colors"
                    style={
                      on
                        ? { backgroundColor: accent, ["--tw-ring-color" as never]: accent }
                        : { ["--tw-ring-color" as never]: "rgba(15,15,25,0.18)" }
                    }
                  >
                    {on && <Check className="h-3 w-3 text-white" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium text-[color:var(--ink)]">{o.label}</span>
                    {o.hint && <span className="block truncate text-[10px] text-[color:var(--ink-faint)]">{o.hint}</span>}
                  </span>
                </button>
              );
            })}
            {matches.length === 0 && (
              <p className="px-2 py-1.5 text-[11px] text-[color:var(--ink-faint)]">Nothing matches “{q}”.</p>
            )}
          </div>

          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="mt-1 inline-flex items-center gap-1 px-2 text-[11px] font-semibold"
              style={{ color: accent }}
            >
              <ChevronDown className="h-3 w-3" /> Show {hidden} more
            </button>
          )}
        </>
      )}
    </Section>
  );
}

function Section({
  icon: Icon, title, right, children,
}: {
  icon?: typeof Search;
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-[color:var(--ink)]/[0.07] py-3 first:border-t-0 first:pt-0">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.085em] text-[color:var(--ink-faint)]">
          {Icon && <Icon className="h-3 w-3" />} {title}
        </p>
        {right}
      </div>
      {children}
    </div>
  );
}

// ── The always-visible range control ──────────────────────────────────────────
// The period is the one axis everybody changes constantly, so it stays out on the
// bar as a compact pill rather than living two clicks deep.
function RangePills({
  value, onChange, accent,
}: {
  value: FilterSelection;
  onChange: (next: FilterSelection) => void;
  accent: string;
}) {
  return (
    <div className="inline-flex rounded-lg p-0.5 ring-1 ring-[color:var(--ink)]/10" style={{ backgroundColor: "rgba(255,255,255,0.6)" }}>
      {RANGES.map((r) => {
        const on = value.range === r.key;
        return (
          <button
            key={r.key}
            type="button"
            onClick={() => onChange({ ...value, range: r.key })}
            title={r.label}
            className="rounded-[7px] px-2 py-1 text-[11px] font-semibold transition-colors"
            style={on ? { backgroundColor: accent, color: "#fff" } : { color: "var(--ink-muted)" }}
          >
            {r.short}
          </button>
        );
      })}
    </div>
  );
}
