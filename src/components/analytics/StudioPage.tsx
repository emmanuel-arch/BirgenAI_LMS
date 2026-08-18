// ─────────────────────────────────────────────────────────────────────────────
// THE PAGE FRAME — a title, the filter bar, and the content.
//
// A server component on purpose: it renders the heading and then mounts the one
// client island the page needs (the filter bar). Everything below it stays on
// the server, so no aggregate is ever shipped to the browser to be recomputed.
// ─────────────────────────────────────────────────────────────────────────────
import type { ReactNode } from "react";
import StudioFilterBar, { type FilterAxes } from "./StudioFilterBar";
import type { Range } from "@/lib/analytics/ranges";

export function StudioPage({
  title,
  blurb,
  range,
  axes,
  showGrain = true,
  actions,
  children,
}: {
  title: string;
  /** The question this screen answers. One line, and it earns its place. */
  blurb: string;
  range: Range;
  axes: FilterAxes;
  showGrain?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6 sm:py-6">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-zinc-900 sm:text-2xl">{title}</h1>
          <p className="mt-0.5 max-w-2xl text-[13px] leading-snug text-zinc-500">{blurb}</p>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>

      <StudioFilterBar
        axes={axes}
        rangeLabel={range.label}
        compareLabel={range.compareLabel}
        partial={range.partial}
        showGrain={showGrain}
      />

      {children}
    </div>
  );
}

/** A titled band between groups of panels. Keeps a long board navigable. */
export function Band({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="mb-3 mt-6 flex items-baseline gap-3">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500">{label}</h2>
      {hint && <p className="truncate text-[11px] text-zinc-400">{hint}</p>}
      <span className="h-px flex-1 bg-zinc-900/[0.08]" aria-hidden />
    </div>
  );
}
