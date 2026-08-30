"use client";

// ─────────────────────────────────────────────────────────────────────────────
// WHICH BOOK, ON EVERY STUDIO SCREEN.
//
// Micromart is two lenders wearing one name and Axe is another two. A number
// with no book attached is not a number a general manager can act on — "PAR is
// 66%" means something entirely different for the branch book than for the
// fintech one, and the two are 350.4M and 0.9M apart.
//
// So the cut is stated across the top of every screen, for the same reason the
// date range is: a figure read under a forgotten filter is worse than no figure.
//
// ── THREE THINGS IT CAN SAY ──────────────────────────────────────────────────
//   ONE BOOK    the ordinary read. Morris opens on 3002, Geoffrey on 3005,
//               because the studio follows the console realm they were already in.
//   COMBINED    both books summed — the group's position.
//   SIDE BY SIDE  every measure broken out per book. Not more expensive: it is
//               `GROUP BY EntityId` on the query that was already running.
//
// It writes to the URL like every other filter, so a comparison is a LINK. That
// is the whole point — "here is our fintech book against our branch book, last
// quarter" has to be something you can send to somebody.
//
// A lender with one book gets nothing at all: `lenses` is empty and this renders
// null. A control with a single setting is an invitation to wonder what the
// other one does.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Columns2, Layers, Loader2, TriangleAlert } from "lucide-react";
import { buildQuery } from "@/lib/analytics/params";

export type LensOption = {
  id: number;
  label: string;
  name: string;
  accent: string;
  /** "tracker" | "derived" — how this book's arrears are measured. */
  basis: string;
};

export default function EntityLensBar({
  lenses,
  active,
  split,
  canSplit = false,
  unavailable,
}: {
  lenses: LensOption[];
  /** EntityIds currently in the cut. */
  active: number[];
  split: boolean;
  /**
   * Does THIS screen draw the per-book breakdown?
   *
   * The engine returns it for every surface, but a control that changes nothing
   * a reader can see is worse than an absent one — it teaches people the feature
   * is broken. So the button appears only where the charts render it, and the
   * flag is what makes rolling it out screen by screen honest at each step.
   */
  canSplit?: boolean;
  /** Set when the book lives elsewhere and cannot be reached. */
  unavailable?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const current = useMemo(() => new URLSearchParams(sp.toString()), [sp]);

  const go = (patch: Record<string, string | null>) =>
    startTransition(() => router.push(`${pathname}${buildQuery(current, patch)}`, { scroll: false }));

  if (unavailable) {
    return (
      <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <p className="text-[12px] leading-snug text-amber-900">
          <span className="font-semibold">This book is not connected.</span> {unavailable}
          {" "}Nothing on this screen is an estimate — it is simply not being read.
        </p>
      </div>
    );
  }

  if (lenses.length < 2) return null;

  const on = new Set(active);
  const bothOn = lenses.every((l) => on.has(l.id));

  /** Clicking a book selects it alone; ⌘/ctrl-click adds it to the cut. */
  const choose = (id: number, additive: boolean) => {
    const next = additive ? new Set(on) : new Set<number>();
    if (additive && on.has(id) && on.size > 1) next.delete(id);
    else next.add(id);
    const ids = lenses.filter((l) => next.has(l.id)).map((l) => l.id);
    go({ ent: ids.join(",") || null, split: ids.length > 1 && split ? "1" : null });
  };

  const mixedBasis = lenses.filter((l) => on.has(l.id)).some((l) => l.basis !== lenses.find((x) => on.has(x.id))?.basis);

  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-ash-400">Book</span>

        {lenses.map((l) => {
          const sel = on.has(l.id);
          return (
            <button
              key={l.id}
              type="button"
              onClick={(e) => choose(l.id, e.metaKey || e.ctrlKey)}
              aria-pressed={sel}
              title={`${l.name} — ServiceSuite entity ${l.id}${sel ? "" : "  ·  ⌘-click to add to the comparison"}`}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition-colors ${
                sel
                  ? "border-ash-900/15 bg-paper text-ash-900 shadow-sm"
                  : "border-transparent text-ash-500 hover:bg-ash-900/[0.04] hover:text-ash-800"
              }`}
            >
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: sel ? l.accent : "transparent", boxShadow: sel ? "none" : `inset 0 0 0 1.5px ${l.accent}` }}
              />
              {l.label}
            </button>
          );
        })}

        <span className="mx-1 h-4 w-px bg-ash-900/10" aria-hidden />

        <button
          type="button"
          onClick={() => go({ ent: lenses.map((l) => l.id).join(","), split: null })}
          aria-pressed={bothOn && !split}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition-colors ${
            bothOn && !split
              ? "border-ash-900/15 bg-paper text-ash-900 shadow-sm"
              : "border-transparent text-ash-500 hover:bg-ash-900/[0.04] hover:text-ash-800"
          }`}
          title="Both books summed into one figure"
        >
          <Layers className="h-3.5 w-3.5" />
          Combined
        </button>

        {canSplit && (
        <button
          type="button"
          onClick={() => go({ ent: lenses.map((l) => l.id).join(","), split: split ? null : "1" })}
          aria-pressed={split}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition-colors ${
            split
              ? "border-ash-900/15 bg-paper text-ash-900 shadow-sm"
              : "border-transparent text-ash-500 hover:bg-ash-900/[0.04] hover:text-ash-800"
          }`}
          title="Every measure broken out per book, drawn beside each other"
        >
          <Columns2 className="h-3.5 w-3.5" />
          Side by side
        </button>
        )}

        {pending && <Loader2 className="ml-1 h-3.5 w-3.5 animate-spin text-ash-400" />}
      </div>

      {/* The one caveat that must never be buried. Two books whose arrears are
          measured differently can be compared — but only by somebody who knows
          that is what they are doing. */}
      {mixedBasis && (
        <p className="mt-1.5 text-[11px] leading-snug text-ash-500">
          These books measure arrears differently: one from the CollectBox tracker&apos;s own days-in-arrears, the other
          derived from the loan&apos;s expected clear date. PAR is comparable in direction, not to the decimal.
        </p>
      )}
    </div>
  );
}
