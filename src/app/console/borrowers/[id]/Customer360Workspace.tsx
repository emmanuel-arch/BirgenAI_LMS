"use client";

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER 360 — THE ORBIT.
//
// ── WHAT WAS WRONG WITH THE OLD PAGE ─────────────────────────────────────────
// It was eleven cards stacked in a two-column grid, every one of them expanded,
// forever. Loans sat beside score history sat beside field visits, all shouting
// at the same volume, and the answer to "how is this customer doing" was
// somewhere in a page you had to scroll to the bottom of to be sure you had seen
// all of. Meanwhile the sixteen things you could actually DO to the account were
// behind a three-dot button the size of a fingernail. The lender's own
// twenty-year-old Borrower 360 — nine plain tabs across the top — was easier to
// use, and everybody who saw both said so.
//
// ── THE RAIL IS THE SUMMARY ──────────────────────────────────────────────────
// So: sections, across the top, like theirs. And then the thing theirs does not
// do, which is the whole idea here — EVERY SECTION CARRIES ITS OWN NUMBER.
//
//   Money 14 · Risk 98.5 · Identity ✓ · People 3 · Places 2 · Timeline 47
//
// Read that row and you have already read the customer: fourteen loans, a score
// of 98.5, verified, three people standing behind them, two pins on the map,
// forty-seven recorded touches. Nothing is opened, nothing is scrolled. The
// navigation IS the three-hundred-and-sixty-degree view, and choosing a section
// is choosing which of those facts to open — which is exactly what a lender means
// when they say they want one place with everything about a customer in it.
//
// A tab with nothing behind it is not shown at all. An empty "Places" tab teaches
// an officer to stop trusting the row, and the row only works if every number on
// it is true.
//
// ── WHY THE SECTION IS IN THE URL ────────────────────────────────────────────
// ?s=money survives a refresh, a router.refresh() after a save, and being pasted
// into a WhatsApp group — "look at his repayment history" is a link now, not an
// instruction. It is written with history.replaceState rather than the router on
// purpose: useSearchParams would force a Suspense boundary onto a page whose
// entire body is server-rendered, and the section is a view preference, not a
// navigation event worth a history entry each time somebody browses across.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { navIcon } from "@/components/shell/icons";

export type Section = {
  key: string;
  label: string;
  /** A lucide name — resolved through the console's own icon map. */
  icon: string;
  /**
   * The number this section is worth looking at for. Kept SHORT — it sits in a
   * chip, and "125,642" in a tab is a figure nobody can read at that size; the
   * section itself is where a full number belongs.
   */
  badge?: string | null;
  /** Draws the badge as a warning rather than a count. */
  tone?: "brand" | "good" | "warn" | "bad";
  content: ReactNode;
};

const TONE: Record<string, { bg: string; fg: string }> = {
  good: { bg: "rgba(5,150,105,0.12)", fg: "#047857" },
  warn: { bg: "rgba(217,119,6,0.14)", fg: "#b45309" },
  bad: { bg: "rgba(225,29,72,0.12)", fg: "#be123c" },
};

export function Customer360Workspace({
  masthead,
  sections,
  initial,
}: {
  /** Server-rendered. Always on screen — the identity never scrolls out of the story. */
  masthead: ReactNode;
  sections: Section[];
  /** Where to open when the URL says nothing. */
  initial?: string;
}) {
  const first = sections[0]?.key ?? "overview";
  // Lazy initial state, not an effect: the correct section renders on the first
  // paint, so a deep link never flashes the overview before switching.
  const [active, setActive] = useState<string>(() => {
    if (typeof window === "undefined") return initial ?? first;
    const p = new URLSearchParams(window.location.search);
    // ?drop=location is the field worklist saying "they came here to pin this
    // customer". Honouring it here means the officer lands on Places with the
    // map already open, instead of on a page they have to navigate out of.
    if (p.get("drop") === "location" && sections.some((s) => s.key === "places")) return "places";
    const s = p.get("s");
    return s && sections.some((x) => x.key === s) ? s : initial ?? first;
  });

  const railRef = useRef<HTMLDivElement>(null);

  const go = useCallback((key: string) => {
    setActive(key);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("s", key);
      window.history.replaceState(null, "", url);
    } catch { /* a URL we cannot rewrite is not a reason to refuse the click */ }
  }, []);

  // Left/right walk the rail, the way a real tablist does. An officer working a
  // queue keeps their hands on the keyboard, and a tab strip that can only be
  // clicked is a tab strip that gets used once.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = sections.findIndex((s) => s.key === active);
    const next = e.key === "ArrowRight" ? (i + 1) % sections.length : (i - 1 + sections.length) % sections.length;
    go(sections[next].key);
  };

  // Keep the selected chip in view when the rail overflows — on a laptop the last
  // two sections sit off the right edge, and a section you cannot see selected is
  // a section you assume did not respond.
  useEffect(() => {
    const el = railRef.current?.querySelector<HTMLElement>(`[data-key="${active}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [active]);

  const current = sections.find((s) => s.key === active) ?? sections[0];

  return (
    <>
      {masthead}

      {/* THE RAIL. Sticky, so the customer's summary follows you down a long
          section — the top of this page is the only place the whole customer is
          stated at once, and losing it while reading their ledger is losing the
          context the ledger is evidence for. */}
      <div
        ref={railRef}
        role="tablist"
        aria-label="Customer sections"
        onKeyDown={onKey}
        className="sticky top-2 z-20 -mx-1 mt-4 flex gap-1.5 overflow-x-auto rounded-xl border border-ash-900/[0.07] bg-paper/85 px-1.5 py-1.5 backdrop-blur-md [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {sections.map((s) => {
          const Icon = navIcon(s.icon);
          const on = s.key === current?.key;
          const tone = s.tone && s.tone !== "brand" ? TONE[s.tone] : null;
          return (
            <button
              key={s.key}
              data-key={s.key}
              role="tab"
              aria-selected={on}
              tabIndex={on ? 0 : -1}
              onClick={() => go(s.key)}
              className={`group flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors ${
                on ? "text-white shadow-sm" : "text-[color:var(--ink-body)] hover:bg-ash-900/[0.055] hover:text-[color:var(--ink)]"
              }`}
              style={on ? { backgroundColor: "var(--brand)" } : undefined}
            >
              <Icon className={`h-4 w-4 shrink-0 ${on ? "" : "text-[color:var(--ink-faint)] group-hover:text-[color:var(--ink-body)]"}`} aria-hidden />
              <span className="whitespace-nowrap">{s.label}</span>
              {s.badge && (
                <span
                  className="rounded px-1.5 py-px text-[10px] font-bold tabular-nums"
                  style={
                    on
                      ? { backgroundColor: "rgba(255,255,255,0.22)", color: "#fff" }
                      : tone
                        ? { backgroundColor: tone.bg, color: tone.fg }
                        : { backgroundColor: "var(--brand-soft)", color: "var(--brand)" }
                  }
                >
                  {s.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* A key on the panel remounts it on every switch, which is what makes the
          fade read as a change of subject rather than a flicker. */}
      <div key={current?.key} role="tabpanel" className="mt-4 animate-[c360-in_180ms_ease-out]">
        {current?.content}
      </div>

      <style>{`@keyframes c360-in { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }`}</style>
    </>
  );
}
