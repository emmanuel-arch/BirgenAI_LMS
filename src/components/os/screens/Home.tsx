"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE HOME SCREEN.
//
// A wallpaper, a grid, a dock. What it is NOT, deliberately: a menu of our three
// engines. The old home screen made a lender choose between "Support", "Assistant"
// and "Analytics" before they had asked anything — three tiles named after our
// architecture, each demanding that the user classify their own question into our
// taxonomy first. That is the thing the router replaced.
//
// The wallpaper carries the lender's own brand as a slow aurora. It is the one
// place in the OS that follows --brand, precisely so the app icons do not have to:
// a white-label lender's colour belongs on the desk, not on every icon standing on
// it.
//
// The top of the screen is a LIVE LINE, not a greeting. "Good morning, Faith" is
// pleasant and says nothing; the first thing an officer sees is the single most
// urgent counted fact on their book, and tapping it goes to the work. If there is
// nothing urgent, it says so — which is also information.
// ─────────────────────────────────────────────────────────────────────────────
import { motion } from "framer-motion";
import {
  MessageCircle, BellRing, Phone, History, UserSearch, Settings,
  CalendarClock, TrendingDown, Handshake,
  ChevronRight, ShieldCheck, type LucideIcon,
} from "lucide-react";
import { GRID_APPS, DOCK_APPS, type OsApp } from "../apps";
import type { Route } from "../nav";
import type { Signal } from "@/lib/riri/signals";
import { SPRING } from "../kit";
import { ASSISTANT_NAME } from "@/lib/riri/brand";

const ICONS: Record<string, LucideIcon> = {
  MessageCircle, BellRing, Phone, History, UserSearch, Settings,
  CalendarClock, TrendingDown, Handshake,
};

const SEV_DOT: Record<Signal["severity"], string> = {
  critical: "bg-rose-500",
  attention: "bg-amber-500",
  opportunity: "bg-emerald-500",
  info: "bg-sky-500",
};

export function HomeScreen({
  orgName, userName, signals, badge, counts, onOpen, onSignal, lastRoute,
}: {
  orgName: string;
  userName?: string | null;
  signals: Signal[];
  badge: number;
  /** Live counts behind the morning three, so their icons carry a number. */
  counts?: { due: number; arrears: number; promises: number } | null;
  onOpen: (r: Route) => void;
  onSignal: (s: Signal) => void;
  lastRoute: Route["name"] | null;
}) {
  const first = userName?.split(" ")[0];
  const hour = new Date().getHours();
  const salutation = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const lead = signals[0] ?? null;

  // A badge is a count of things waiting, so the morning three carry theirs for
  // the same reason Alerts does: an icon that has to be opened to find out whether
  // it needed opening is an icon that gets opened out of anxiety, or not at all.
  const badgeFor = (app: OsApp) =>
    app.route === "alerts" ? badge
      : app.route === "due" ? counts?.due ?? 0
        : app.route === "arrears" ? counts?.arrears ?? 0
          : app.route === "promises" ? counts?.promises ?? 0
            : 0;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.03 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className="relative flex h-full flex-col overflow-hidden"
    >
      {/* WALLPAPER — the lender's colour, moving slowly enough to be felt. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="os-aurora absolute -inset-[30%]"
          style={{
            background:
              "radial-gradient(40% 40% at 30% 25%, var(--brand) 0%, transparent 62%), radial-gradient(38% 38% at 72% 70%, var(--brand) 0%, transparent 60%)",
            opacity: 0.16,
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-white/40 via-white/70 to-white/90" />
      </div>

      <div className="relative flex h-full min-h-0 flex-col overflow-y-auto px-4 pb-2 pt-2">
        <div className="shrink-0">
          <p className="text-[10.5px] font-medium text-zinc-500">
            {salutation}{first ? `, ${first}` : ""}
          </p>
          <h2 className="mt-0.5 text-[19px] font-bold leading-tight tracking-tight text-zinc-900">{orgName}</h2>
        </div>

        {/* THE LIVE LINE. The most urgent counted fact, or the fact that there
            isn't one. Never a slogan. */}
        <motion.button
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, ...SPRING }}
          onClick={() => (lead ? onSignal(lead) : onOpen({ name: "alerts" }))}
          className="mt-2.5 flex shrink-0 items-center gap-2.5 rounded-2xl border border-zinc-900/[0.07] bg-white/80 px-3 py-2.5 text-left shadow-sm backdrop-blur transition-all hover:border-[color:var(--brand)] active:scale-[0.985]"
        >
          {lead ? (
            <>
              <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${SEV_DOT[lead.severity]}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-semibold leading-tight text-zinc-800">{lead.title}</span>
                <span className="mt-0.5 block truncate text-[10.5px] leading-tight text-zinc-500">{lead.actionLabel}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-zinc-300" />
            </>
          ) : (
            <>
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500" />
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-semibold leading-tight text-zinc-800">Nothing needs you right now</span>
                <span className="mt-0.5 block truncate text-[10.5px] leading-tight text-zinc-500">
                  No arrears spike, no unmatched money, no queue backing up.
                </span>
              </span>
            </>
          )}
        </motion.button>

        {/* THE GRID. FOUR across, two rows, eight apps — a full rectangle.
            It was three across when there were six apps; adding the morning three
            made nine, and nine at that size pushed the dock below the fold on a
            laptop. Four across is the same grid a phone actually uses, and it buys
            back the room the live line and the dock both need to stay visible
            without scrolling — which is the whole point of a home screen. */}
        <div className="mt-4 grid shrink-0 grid-cols-4 gap-x-2 gap-y-3">
          {GRID_APPS.map((app, i) => {
            const Glyph = ICONS[app.icon] ?? MessageCircle;
            const n = badgeFor(app);
            return (
              <motion.button
                key={app.route}
                layoutId={`os-icon-${app.route}`}
                onClick={() => onOpen({ name: app.route } as Route)}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.06 + i * 0.035, ...SPRING }}
                whileTap={{ scale: 0.9 }}
                className="group flex min-w-0 flex-col items-center gap-1.5"
                title={app.blurb}
              >
                <span
                  className="relative flex aspect-square w-full items-center justify-center rounded-[18px] shadow-lg shadow-zinc-900/20 ring-1 ring-inset ring-white/30"
                  style={{ background: `linear-gradient(147deg, ${app.tile.from}, ${app.tile.to})` }}
                >
                  {/* The specular sweep every real icon has across its top-left. */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 rounded-[18px]"
                    style={{ background: "linear-gradient(150deg, rgba(255,255,255,0.42), transparent 52%)" }}
                  />
                  <Glyph className="relative h-[22px] w-[22px] text-white drop-shadow-sm" />
                  {n > 0 && (
                    <span className="os-badge absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">
                      {n > 99 ? "99+" : n}
                    </span>
                  )}
                  {lastRoute === app.route && (
                    <span className="absolute -bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-zinc-900/30" />
                  )}
                </span>
                <span className="w-full truncate text-center text-[9.5px] font-semibold leading-tight text-zinc-700">{app.name}</span>
              </motion.button>
            );
          })}
        </div>

        <div className="flex-1" />

        {/* THE DOCK. The four you reach for without looking, on frosted glass so
            it reads as a layer above the wallpaper rather than a row in the grid. */}
        <div className="mt-3 shrink-0 rounded-[26px] border border-white/60 bg-white/60 p-2 shadow-lg shadow-zinc-900/5 backdrop-blur-xl">
          <div className="grid grid-cols-4 gap-2">
            {DOCK_APPS.map((app) => {
              const Glyph = ICONS[app.icon] ?? MessageCircle;
              const n = badgeFor(app);
              return (
                <motion.button
                  key={app.route}
                  onClick={() => onOpen({ name: app.route } as Route)}
                  whileTap={{ scale: 0.88 }}
                  className="relative flex aspect-square items-center justify-center rounded-[17px] shadow-md ring-1 ring-inset ring-white/30"
                  style={{ background: `linear-gradient(147deg, ${app.tile.from}, ${app.tile.to})` }}
                  aria-label={app.name}
                  title={app.name}
                >
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 rounded-[17px]"
                    style={{ background: "linear-gradient(150deg, rgba(255,255,255,0.4), transparent 52%)" }}
                  />
                  <Glyph className="relative h-5 w-5 text-white" />
                  {n > 0 && (
                    <span className="os-badge absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white ring-2 ring-white">
                      {n > 99 ? "99+" : n}
                    </span>
                  )}
                </motion.button>
              );
            })}
          </div>
        </div>

        <p className="mt-2 shrink-0 text-center text-[9px] leading-snug text-zinc-400">
          {ASSISTANT_NAME} can be wrong — verify figures before acting
        </p>
      </div>
    </motion.div>
  );
}
