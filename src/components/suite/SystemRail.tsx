"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE SYSTEM RAIL — the launcher's centrepiece.
//
// ── WHY A RAIL AND NOT THE GRID IT REPLACES ──────────────────────────────────
// The grid was three-across and honest and completely inert. Six equal
// rectangles is a menu; it tells you the systems exist and nothing about what
// they are. The brief was to make this page move, and a rail is the version of
// that which does not cost anything:
//
//   · each card is BIG enough to carry its own front-door artwork, so the
//     colour code is being taught by the picture rather than by a 2px stripe;
//   · the one in the middle is LIVE — its figure counts up, its light tracks
//     your pointer — so the page demonstrates rather than lists;
//   · and it is a scroll container, so the systems a lender holds decide the
//     length instead of the layout deciding how many fit.
//
// ── WHAT IT REFUSES TO DO ────────────────────────────────────────────────────
// It does NOT auto-advance. This is a launcher: somebody is reaching for a door
// with a mouse, and a carousel that moves while you aim at it is the single most
// hated pattern on the web. Movement here is always something the visitor asked
// for — a drag, an arrow, a keypress, a wheel.
//
// It is also not a carousel in the sense of hiding things. Every card is in the
// DOM, in order, reachable by Tab, and the container scrolls rather than
// swapping — so a keyboard user and a screen reader get a plain list of links
// and lose nothing at all.
//
// ── THE POINTER LIGHT ────────────────────────────────────────────────────────
// Borrowed from the reference library's 3-D card, minus the 3-D. A tilt on a
// card carrying a photograph and a live number reads as a toy; a specular that
// follows the pointer reads as glass. One `--mx`/`--my` pair written on the
// hovered card only, so there is no per-frame React state anywhere in here.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, ArrowUpRight, ChevronLeft, ChevronRight, Database, Lock, ShieldCheck } from "lucide-react";
import type { SuiteApp } from "@/lib/suite/apps";
import type { ResolvedSuiteApp } from "@/lib/suite/hosts";
import type { SuiteTelemetry } from "@/lib/suite/telemetry";

export type RailArt = { id: string; file: string; gradient: string; hasFile: boolean };

export default function SystemRail({
  apps, hosts, entered, telemetry, art,
}: {
  apps: SuiteApp[];
  hosts: ResolvedSuiteApp[];
  entered: string[];
  telemetry: SuiteTelemetry;
  /** Resolved server-side — whether each plate is actually on disk. */
  art: RailArt[];
}) {
  const reduce = useReducedMotion();
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    // 2px of slack: sub-pixel layout means scrollLeft never lands exactly on
    // scrollWidth - clientWidth, so an exact comparison leaves the right-hand
    // arrow enabled forever at the end of the rail.
    setEdges({
      start: el.scrollLeft <= 2,
      end: el.scrollLeft >= el.scrollWidth - el.clientWidth - 2,
    });
  }, []);

  useEffect(() => {
    measure();
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  // One card plus its gap. Read from the DOM rather than hard-coded, so the
  // arrows still travel exactly one card after any change to the card width.
  const page = (dir: 1 | -1) => {
    const el = scroller.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>("[data-card]");
    const step = card ? card.offsetWidth + 16 : el.clientWidth * 0.8;
    el.scrollBy({ left: dir * step, behavior: reduce ? "auto" : "smooth" });
  };

  const hostOf = (id: string) => hosts.find((h) => h.id === id);
  const pulseOf = (id: string) => telemetry.systems.find((s) => s.id === id);
  const artOf = (id: string) => art.find((a) => a.id === id);

  return (
    <div className="relative">
      {/* ── The controls ────────────────────────────────────────────────── */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/35">
          Your systems
        </p>
        <div className="flex items-center gap-1.5">
          <RailButton onClick={() => page(-1)} disabled={edges.start} label="Previous systems">
            <ChevronLeft className="h-4 w-4" />
          </RailButton>
          <RailButton onClick={() => page(1)} disabled={edges.end} label="More systems">
            <ChevronRight className="h-4 w-4" />
          </RailButton>
        </div>
      </div>

      {/* ── The rail ────────────────────────────────────────────────────────
          `snap-x` with `snap-start` on each card, so a drag or a flick always
          settles with a card's left edge against the gutter rather than halfway
          through one. The scrollbar is hidden and the arrows above are the
          visible affordance — but the container is still a real scroller, so a
          trackpad, a touch drag and Tab all work without any of this code. */}
      <div
        ref={scroller}
        onScroll={measure}
        className="-mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-1 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {apps.map((app, i) => {
          const host = hostOf(app.id);
          const pulse = pulseOf(app.id);
          const plate = artOf(app.id);
          const inside = entered.includes(app.id);
          const external = host?.external ?? !!app.external;
          const Icon = app.icon;

          // EVERY TILE OPENS ON THAT SYSTEM'S OWN FRONT DOOR, not straight into
          // the system. It costs a click and it buys the thing this product is
          // actually selling: you see ConnectDesk's name, ConnectDesk's artwork
          // and ConnectDesk's colour before you are inside it, and the button
          // you press says "Continue as Faith" rather than nothing at all.
          const target = host?.door ?? host?.href ?? app.href;

          return (
            <motion.div
              key={app.id}
              data-card
              initial={reduce ? false : { opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * i, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="w-[280px] shrink-0 snap-start sm:w-[320px]"
            >
              <Link
                href={target}
                {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                onPointerMove={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
                  e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
                }}
                className="group relative flex h-[400px] flex-col overflow-hidden rounded-3xl border border-white/[0.09] transition-all duration-300 hover:-translate-y-1 hover:border-white/20"
              >
                {/* ── The plate ────────────────────────────────────────────
                    That system's own front-door artwork, so the launcher and
                    the door it opens are visibly the same product. Where the
                    plate has not been generated yet, its gradient stands in —
                    same rule the door itself follows, so a half-delivered asset
                    set never looks like a half-built launcher. */}
                <span
                  aria-hidden
                  className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-105"
                  style={
                    plate?.hasFile
                      ? { backgroundImage: `url('${plate.file}')` }
                      : { background: plate?.gradient ?? "#0b0a10" }
                  }
                />
                <span
                  aria-hidden
                  className="absolute inset-0"
                  style={{ background: "linear-gradient(180deg, rgba(9,8,13,0.42) 0%, rgba(9,8,13,0.78) 52%, rgba(9,8,13,0.96) 100%)" }}
                />
                {/* The specular. Only visible on hover, and it costs one custom
                    property write per pointer move — no React state, no rAF. */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                  style={{
                    background: `radial-gradient(260px circle at var(--mx, 50%) var(--my, 50%), ${app.accent}2e, transparent 70%)`,
                  }}
                />
                <span aria-hidden className="absolute inset-x-0 top-0 h-[3px]" style={{ backgroundColor: app.accent }} />

                <div className="relative flex flex-1 flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ring-1 ring-inset ring-white/15 backdrop-blur"
                      style={{ backgroundColor: `${app.accent}33` }}
                    >
                      <Icon className="h-5 w-5" style={{ color: app.accent }} />
                    </span>
                    {external ? (
                      // A separate deployment with its own member gate. Claiming
                      // "signed in" here would be a lie the next click exposes.
                      <span className="inline-flex items-center gap-1 rounded-md bg-white/[0.09] px-1.5 py-1 text-[9.5px] font-bold uppercase tracking-wide text-white/50 backdrop-blur">
                        <ArrowUpRight className="h-2.5 w-2.5" /> Separate sign-in
                      </span>
                    ) : inside ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-400/15 px-1.5 py-1 text-[9.5px] font-bold uppercase tracking-wide text-emerald-300 backdrop-blur">
                        <ShieldCheck className="h-2.5 w-2.5" /> Signed in
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-md bg-white/[0.09] px-1.5 py-1 text-[9.5px] font-bold uppercase tracking-wide text-white/45 backdrop-blur">
                        <Lock className="h-2.5 w-2.5" /> Request access
                      </span>
                    )}
                  </div>

                  <h2 className="mt-auto text-[19px] font-bold leading-tight text-white">{app.name}</h2>
                  <p className="mt-1 text-[12px] leading-relaxed text-white/55">{app.purpose}</p>

                  {/* The live figure — the thing that makes this a
                      demonstration rather than a menu. */}
                  <div className="mt-3 border-t border-white/[0.1] pt-3">
                    {pulse?.value ? (
                      <>
                        <p className="text-[24px] font-bold leading-none tabular-nums" style={{ color: app.accent }}>
                          {pulse.value}
                        </p>
                        <p className="mt-1 text-[11px] font-medium text-white/60">{pulse.label}</p>
                        <p className="mt-1.5 flex items-center gap-1 text-[9.5px] text-white/30">
                          <Database className="h-2.5 w-2.5 shrink-0" />
                          <span className="truncate">{pulse.source}</span>
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-[24px] font-bold leading-none text-white/20">—</p>
                        <p className="mt-1 text-[11px] text-white/35">
                          {telemetry.offline ? "server unreachable" : "no live probe for this system yet"}
                        </p>
                      </>
                    )}
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="truncate text-[10px] text-white/30">{app.subdomain}</span>
                    <span
                      className="inline-flex items-center gap-1 text-[12px] font-semibold transition-transform group-hover:translate-x-0.5"
                      style={{ color: app.accent }}
                    >
                      Open <ArrowRight className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </div>
              </Link>
            </motion.div>
          );
        })}
      </div>

      {/* The fade at the right edge says "there is more this way" without
          needing a scrollbar. It is pointer-events-none so it never eats a
          click on the card underneath it. */}
      {!edges.end && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-16 rounded-r-3xl"
          style={{ background: "linear-gradient(to left, #0b0a10, transparent)" }}
        />
      )}
    </div>
  );
}

function RailButton({
  onClick, disabled, label, children,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.05] text-white/70 transition-colors hover:border-white/25 hover:bg-white/[0.11] hover:text-white disabled:pointer-events-none disabled:opacity-25"
    >
      {children}
    </button>
  );
}
