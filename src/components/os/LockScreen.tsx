"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE LOCK SCREEN — the first thing a lending team sees, before they ask anything.
//
// Every other screen in this OS answers a question. This one answers the question
// nobody has typed yet: WHAT AM I DOING FIRST TODAY. A relationship officer, a
// regional manager and a call-centre agent wake up to three different first jobs,
// and until now all three had to open the device, find an app, and read a list
// before the system told them anything. A locked phone that briefs you through the
// glass is the difference between a tool you consult and a tool that reports to you.
//
// WHAT IS ON IT, in the order the eye takes it:
//
//   · The time, big. It is a phone; the clock earns the top third.
//   · The three figures of the morning — due today, in arrears, promised today —
//     as glass, tappable straight through the lock to the app behind them.
//   · The critical alerts, worst first, each with the button that goes to the work.
//
// ROLE-AWARE WITHOUT ASKING THE ROLE. It renders whatever the server was willing
// to answer for this session. An officer on OWN scope gets their own arrears, an
// agent with collections rights but no loans rights simply has no arrears card,
// and nobody sees a figure their role does not carry. The scope line at the bottom
// says which of those happened, in words, because "KES 0" and "not your book" look
// identical and mean opposite things.
//
// HOW IT OPENS. Swipe in any direction, double-tap, press Enter, or hit the pill.
// Four ways on purpose: this device is driven by a mouse on a branch desktop as
// often as by a thumb, and "swipe up from the bottom edge" is an instruction a
// mouse user never receives. The threshold is deliberately short — a lock screen
// is a briefing, not a security boundary. The security boundary is the session,
// and it is checked on the server for every figure printed here.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from "react";
import { motion, AnimatePresence, type PanInfo } from "framer-motion";
import {
  AlertTriangle, BatteryMedium, BellRing, CalendarClock, ChevronsUp, Handshake,
  Lock, Signal as SignalIcon, TrendingDown, TrendingUp, Wifi, type LucideIcon,
} from "lucide-react";
import { useClock } from "./PhoneShell";
import type { Route } from "./nav";
import type { Signal } from "@/lib/riri/signals";
import type { TodayPayload } from "@/app/api/console/riri/today/route";

/** Past this much travel in any direction, the phone is open. */
const UNLOCK_PX = 52;

const SCOPE_NOTE: Record<string, string> = {
  OWN: "Your own customers only",
  BRANCH: "Your branch",
  BRANCH_TREE: "Your branch and everything under it",
  ORG: "The whole book",
};

type Tile = { key: "due" | "arrears" | "promises"; label: string; icon: LucideIcon; value: string; sub: string; tint: string };

export function LockScreen({
  orgName, userName, signals, today, scope, loading, onUnlock, onOpen, onSignal,
}: {
  orgName: string;
  userName?: string | null;
  signals: Signal[];
  today: TodayPayload | null;
  scope: string | null;
  loading: boolean;
  /** Plain open — the swipe, the double-tap, the pill. */
  onUnlock: () => void;
  /** Open and land somewhere: a figure tapped through the glass. */
  onOpen: (r: Route) => void;
  /** Open and follow an alert to the console screen behind it. */
  onSignal: (s: Signal) => void;
}) {
  const clock = useClock();
  const [dragging, setDragging] = useState(false);

  // Derived from the same tick as the clock, so the date turns over at midnight
  // without a second timer. Recomputed once a minute, which is free.
  const dateLine = useMemo(
    () => new Date().toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long" }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the clock string IS the tick
    [clock],
  );

  const first = userName?.split(" ")[0];
  const hour = new Date().getHours();
  const salutation = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  // The alerts worth waking somebody for. Four is the cap: a lock screen that
  // scrolls is a screen, and a screen is the thing behind the lock.
  const urgent = signals.filter((s) => s.severity === "critical" || s.severity === "attention").slice(0, 4);
  const lead = urgent[0] ?? signals[0] ?? null;

  const tiles: Tile[] = [];
  if (today?.due.available) {
    tiles.push({
      key: "due", label: "Due today", icon: CalendarClock, value: today.due.amount,
      sub: `${today.due.count} installment${today.due.count === 1 ? "" : "s"}`, tint: "text-teal-700",
    });
  }
  if (today?.arrears.available) {
    tiles.push({
      key: "arrears", label: "In arrears", icon: TrendingDown, value: today.arrears.amount,
      sub: `${today.arrears.count} account${today.arrears.count === 1 ? "" : "s"}`, tint: "text-orange-700",
    });
  }
  if (today?.promises.available) {
    tiles.push({
      key: "promises", label: "Promised today", icon: Handshake, value: today.promises.amount,
      sub: `${today.promises.count} customer${today.promises.count === 1 ? "" : "s"}`, tint: "text-violet-700",
    });
  }

  const onDragEnd = (_: unknown, info: PanInfo) => {
    setDragging(false);
    if (Math.abs(info.offset.y) > UNLOCK_PX || Math.abs(info.offset.x) > UNLOCK_PX || Math.abs(info.velocity.y) > 420) {
      onUnlock();
    }
  };

  return (
    <motion.div
      drag
      dragConstraints={{ top: -90, bottom: 24, left: -60, right: 60 }}
      dragElastic={0.22}
      dragMomentum={false}
      onDragStart={() => setDragging(true)}
      onDragEnd={onDragEnd}
      onDoubleClick={onUnlock}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onUnlock(); } }}
      tabIndex={0}
      role="button"
      aria-label={`Locked. ${orgName}. Swipe or press Enter to open.`}
      className="relative flex h-full w-full cursor-grab flex-col overflow-hidden outline-none active:cursor-grabbing"
      style={{ touchAction: "none" }}
    >
      {/* THE WALLPAPER. Light silk — which is why every card on it is dark ink on
          frosted white rather than the other way round. A dark glass card on a
          near-white photograph is a hole punched in the phone. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {/* eslint-disable-next-line @next/next/no-img-element -- fills a fixed 382px panel; the loader would cost more than the 14KB file */}
        <img src="/images/iphone13pro.avif" alt="" className="h-full w-full object-cover" draggable={false} />
        {/* Two washes: one overall to lift text contrast off the busiest part of
            the silk, one at the foot so the unlock pill never lands on a dark fold. */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/45 via-white/25 to-white/70" />
      </div>

      <div className="relative flex h-full min-h-0 flex-col px-4 pb-3 pt-2">
        {/* STATUS ROW. The carrier is the lender, because on this device that is
            who is providing service. */}
        <div className="flex shrink-0 items-center justify-between text-[10px] font-semibold text-zinc-600">
          <span className="max-w-[60%] truncate">{orgName}</span>
          <span className="flex items-center gap-1">
            <SignalIcon className="h-2.5 w-2.5" />
            <Wifi className="h-2.5 w-2.5" />
            <BatteryMedium className="h-3 w-3" />
          </span>
        </div>

        {/* THE CLOCK. The one piece of type on this device allowed to be large. */}
        <div className="mt-3 shrink-0 text-center">
          <p className="text-[12px] font-semibold tracking-wide text-zinc-600">{dateLine}</p>
          <p
            className="mt-0.5 tabular-nums text-zinc-900"
            style={{
              fontFamily: '"SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI Variable Display", "Segoe UI", Inter, system-ui, sans-serif',
              fontSize: "66px",
              fontWeight: 250,
              lineHeight: 1,
              letterSpacing: "-0.045em",
            }}
          >
            {clock}
          </p>
          <p className="mt-1.5 flex items-center justify-center gap-1.5 text-[11px] font-medium text-zinc-600">
            <Lock className="h-3 w-3 text-zinc-400" />
            {salutation}{first ? `, ${first}` : ""}
          </p>
        </div>

        {/* THE MORNING FIGURES. Tappable through the glass — the lock is a
            briefing, so anything it shows you is something you can act on from
            here rather than after a hunt through a home screen. */}
        {tiles.length > 0 && (
          <div className={`mt-3.5 grid shrink-0 gap-1.5 ${tiles.length === 3 ? "grid-cols-3" : tiles.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
            {tiles.map((t, i) => (
              <motion.button
                key={t.key}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 + i * 0.05, type: "spring", stiffness: 400, damping: 30 }}
                onClick={() => !dragging && onOpen({ name: t.key } as Route)}
                className="rounded-2xl border border-white/70 bg-white/55 px-2 py-2 text-left shadow-sm backdrop-blur-xl transition-all hover:bg-white/80 active:scale-[0.97]"
              >
                <span className={`flex items-center gap-1 text-[8.5px] font-bold uppercase tracking-[0.1em] ${t.tint}`}>
                  <t.icon className="h-2.5 w-2.5 shrink-0" />
                  <span className="truncate">{t.label}</span>
                </span>
                <span className="mt-0.5 block truncate text-[12.5px] font-bold leading-tight tabular-nums text-zinc-900">
                  {t.value.replace("KES ", "")}
                </span>
                <span className="block truncate text-[8.5px] leading-tight text-zinc-500">{t.sub}</span>
              </motion.button>
            ))}
          </div>
        )}

        {/* THE NOTIFICATIONS. Frosted, stacked, worst first — and each one carries
            the button that goes to the work rather than to a list of work. */}
        {/* pan-y so a thumb can SCROLL this list instead of dragging the whole
            lock screen open. The container above sets touch-action:none for the
            unlock gesture, and without this exception the one place with more
            content than height would be the one place you cannot reach. */}
        <div className="mt-2.5 min-h-0 flex-1 space-y-1.5 overflow-y-auto pb-1" style={{ touchAction: "pan-y" }}>
          <AnimatePresence initial={false}>
            {urgent.map((s, i) => (
              <motion.div
                key={s.id}
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ delay: 0.12 + i * 0.05, type: "spring", stiffness: 400, damping: 30 }}
                className="rounded-2xl border border-white/70 bg-white/60 px-3 py-2 shadow-sm backdrop-blur-xl"
              >
                <div className="flex items-start gap-2">
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-lg ${
                    s.severity === "critical" ? "bg-rose-500/15 text-rose-600" : "bg-amber-500/15 text-amber-600"
                  }`}>
                    {s.severity === "critical" ? <AlertTriangle className="h-3 w-3" /> : <BellRing className="h-3 w-3" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-1.5">
                      <p className="min-w-0 flex-1 text-[11.5px] font-semibold leading-tight text-zinc-900">{s.title}</p>
                      {s.amount && <p className="shrink-0 text-[10px] font-bold tabular-nums text-zinc-700">{s.amount}</p>}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[9.5px] leading-snug text-zinc-600">{s.body}</p>
                  </div>
                  <button
                    onClick={() => !dragging && onSignal(s)}
                    className="shrink-0 self-center rounded-full bg-zinc-900/85 px-2.5 py-1 text-[9.5px] font-bold text-white transition-colors hover:bg-zinc-900"
                  >
                    Open
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {!urgent.length && !loading && (
            <div className="rounded-2xl border border-white/70 bg-white/55 px-3 py-2.5 text-center shadow-sm backdrop-blur-xl">
              <p className="flex items-center justify-center gap-1.5 text-[11.5px] font-semibold text-zinc-800">
                <TrendingUp className="h-3.5 w-3.5 text-emerald-600" /> Nothing needs you first
              </p>
              <p className="mt-0.5 text-[9.5px] leading-snug text-zinc-600">
                No arrears spike, no unmatched money, no queue backing up.
              </p>
            </div>
          )}

          {lead && urgent.length > 0 && (
            <p className="px-1 text-center text-[9px] leading-snug text-zinc-500">
              First thing today: {lead.actionLabel.toLowerCase()}.
              {scope ? ` ${SCOPE_NOTE[scope] ?? ""}.` : ""}
            </p>
          )}
        </div>

        {/* THE WAY IN. A pill that says what to do, a chevron that shows it, and a
            button under both for whoever would rather press than swipe. */}
        <button
          onClick={onUnlock}
          className="group mt-1 flex shrink-0 flex-col items-center gap-1 pb-1 pt-0.5 outline-none"
          aria-label="Open"
        >
          <motion.span
            animate={{ y: [0, -4, 0], opacity: [0.45, 0.95, 0.45] }}
            transition={{ duration: 2.1, repeat: Infinity, ease: "easeInOut" }}
            className="text-zinc-500"
          >
            <ChevronsUp className="h-4 w-4" />
          </motion.span>
          <span className="text-[9.5px] font-semibold tracking-wide text-zinc-500 transition-colors group-hover:text-zinc-800">
            Swipe or double-tap to open
          </span>
          <span aria-hidden className="mt-1 h-1 w-24 rounded-full bg-zinc-900/25 transition-colors group-hover:bg-zinc-900/45" />
        </button>
      </div>
    </motion.div>
  );
}
