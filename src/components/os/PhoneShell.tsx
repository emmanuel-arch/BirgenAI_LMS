"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE HANDSET — bezel, glass, status bar, home button.
//
// This file draws a device and nothing else. It holds no conversation, knows no
// engine, and makes no request; screens are handed to it as children. That
// separation is what lets the same chrome carry six apps without any of them
// having to render their own header — and, more importantly, it is why BACK CAN
// NEVER BE MISSING. The bar derives its own affordances from the nav stack's
// depth, so a screen cannot forget a back button, because a screen does not draw
// one.
//
// THE STATUS BAR IS THE HONEST STATEMENT OF WHERE YOU ARE. That was true of the
// old dock and it is more important now: with one conversation instead of three
// tiles, the bar and the per-answer stamp are the only things telling a lender
// which intelligence is standing in front of them.
//
// THE HOME BUTTON IS PHYSICAL, and that is a deliberate reversal of where phones
// went. A gesture bar is elegant on a device you hold; on a floating panel inside
// a browser, on a branch desktop, driven by a mouse, "swipe up from the bottom
// edge" is an instruction nobody receives. A button that looks pressable, travels
// when pressed, and always goes home is the affordance this context actually has.
// The gesture pill is still there above it, because the muscle memory is real —
// it just is not the only way out.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, X, Wifi, BatteryMedium, Signal } from "lucide-react";

// ── The clock ────────────────────────────────────────────────────────────────
//
// A device with a dead clock is a screenshot. It ticks on the MINUTE, not the
// second: a second hand costs sixty renders a minute for a digit nobody reads on
// a status bar.
//
// Subscribed with useSyncExternalStore rather than setState-in-an-effect, because
// that is what the wall clock is — an external system React is reading. The
// effect version costs an extra render on every mount and is banned by this
// project's hooks rules for exactly that reason.
//
// The snapshot must be a STABLE STRING. Returning a fresh Date would give a new
// reference on every read and loop forever, so the cache holds the formatted
// value and only replaces it when the minute has actually turned.
let clockCache = "--:--";
const formatClock = () => new Date().toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", hour12: false });

function subscribeClock(onChange: () => void) {
  const tick = () => {
    const next = formatClock();
    if (next !== clockCache) { clockCache = next; onChange(); }
  };
  tick();
  // Align to the top of the minute, then run on it — a naive 60s interval started
  // at a random moment shows the wrong minute for up to 59 seconds.
  let interval: ReturnType<typeof setInterval> | undefined;
  const timeout = setTimeout(() => { tick(); interval = setInterval(tick, 60_000); }, 60_000 - (Date.now() % 60_000));
  return () => { clearTimeout(timeout); if (interval) clearInterval(interval); };
}
function clockSnapshot() {
  const next = formatClock();
  if (next !== clockCache) clockCache = next;
  return clockCache;
}
// The server has a different minute than the browser; a placeholder on the server
// snapshot is how a clock avoids a hydration mismatch on every page load.
const clockServer = () => "--:--";

/**
 * The wall clock, as a stable "HH:MM" string.
 *
 * Exported because the lock screen needs the same tick: two independent minute
 * timers in one device is how a status bar and a lock screen end up a minute
 * apart on the same screenshot.
 */
export const useClock = () => useSyncExternalStore(subscribeClock, clockSnapshot, clockServer);

export type ShellProps = {
  /** Bottom-left of the status bar's title block. */
  title: string;
  subtitle?: ReactNode;
  /** Shown when the nav stack is deeper than home. */
  onBack?: (() => void) | null;
  backLabel?: string | null;
  onHome: () => void;
  onClose: () => void;
  /** Rendered at the right of the status bar — an app's own affordance. */
  action?: ReactNode;
  /** Left of the title at depth 0 — the avatar, usually. */
  leading?: ReactNode;
  /** True while a request is in flight; drives the working indicator. */
  busy?: boolean;
  /** Tint the chrome with the open app's artwork. */
  accent?: { from: string; to: string } | null;
  children: ReactNode;
  /** The composer or keypad, pinned below the screen. */
  footer?: ReactNode;
  atHome: boolean;
  /**
   * A layer that takes the whole glass — the lock screen, and nothing else so far.
   *
   * It REPLACES the chrome rather than sitting over it, because a locked phone has
   * no back button, no home button and no close affordance: those are things you
   * get after you have opened it. Rendering them underneath and hiding them with
   * opacity would leave a tab order that walks straight through a locked device.
   */
  cover?: ReactNode;
};

export function PhoneShell({
  title, subtitle, onBack, backLabel, onHome, onClose, action, leading,
  busy, accent, children, footer, atHome, cover,
}: ShellProps) {
  const clock = useClock();
  const [pressed, setPressed] = useState(false);

  const press = () => {
    setPressed(true);
    window.setTimeout(() => setPressed(false), 260);
    onHome();
  };

  return (
    // THE BODY. Two nested radii — the outer band and the screen — with the inner
    // one smaller by exactly the band's width, which is the detail that separates
    // a drawn phone from a rounded rectangle.
    <div className="os-frame relative flex h-full w-full flex-col overflow-hidden rounded-[42px] p-[9px]">
      {/* Side buttons, drawn on the band. Decorative — but a phone without them
          reads as a mock-up, and this one is meant to read as a device. */}
      <span aria-hidden className="pointer-events-none absolute -left-[2px] top-[112px] h-9 w-[3px] rounded-l-sm bg-zinc-500/70" />
      <span aria-hidden className="pointer-events-none absolute -left-[2px] top-[158px] h-14 w-[3px] rounded-l-sm bg-zinc-500/70" />
      <span aria-hidden className="pointer-events-none absolute -right-[2px] top-[136px] h-20 w-[3px] rounded-r-sm bg-zinc-500/70" />

      <div className="os-glass relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[34px] bg-white">
        {cover ? (
          cover
        ) : (
          <>
        {/* ── STATUS BAR ─────────────────────────────────────────────────────
            Carrier, clock, radios. The carrier is the lender's own assistant
            name, because on this device that is who is providing service. */}
        <div className="relative z-20 flex h-[26px] shrink-0 items-center justify-between px-4 pt-1.5 text-[10px] font-semibold text-zinc-500">
          <span className="tabular-nums">{clock}</span>
          <span className="flex items-center gap-1">
            <Signal className="h-2.5 w-2.5" />
            <Wifi className="h-2.5 w-2.5" />
            <BatteryMedium className="h-3 w-3" />
          </span>
        </div>

        {/* ── NAVIGATION BAR ─────────────────────────────────────────────────
            Back exists exactly when there is somewhere to go back TO, and it is
            labelled with the destination rather than a bare arrow — "Home",
            "Conversations" — so nobody has to remember how they got here. */}
        <div
          className="relative z-10 flex shrink-0 items-center gap-2 px-3 pb-2 pt-1"
          style={{
            background: accent
              ? `linear-gradient(135deg, ${accent.from}16, transparent 70%)`
              : "linear-gradient(135deg, var(--brand-soft), transparent 70%)",
          }}
        >
          {onBack ? (
            <button
              onClick={onBack}
              className="-ml-1 flex h-8 shrink-0 items-center gap-0.5 rounded-full pl-1 pr-2 text-[11.5px] font-semibold text-zinc-500 transition-colors hover:bg-zinc-900/5 hover:text-zinc-900"
              aria-label={`Back to ${backLabel ?? "the previous screen"}`}
            >
              <ChevronLeft className="h-4.5 w-4.5" />
              <span className="max-w-[76px] truncate">{backLabel ?? "Back"}</span>
            </button>
          ) : (
            leading
          )}

          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-bold leading-tight text-zinc-900">{title}</p>
            <p className="flex items-center gap-1 truncate text-[10.5px] leading-tight text-zinc-500">
              {busy ? (
                <>
                  Working
                  <span className="riri-think-dot">.</span>
                  <span className="riri-think-dot" style={{ animationDelay: ".2s" }}>.</span>
                  <span className="riri-think-dot" style={{ animationDelay: ".4s" }}>.</span>
                </>
              ) : (
                <>
                  <span className="os-live inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                  {subtitle}
                </>
              )}
            </p>
          </div>

          {action}
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-900/5 hover:text-zinc-900"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── SCREEN ─────────────────────────────────────────────────────────
            The only scrolling region. Everything above and below is chrome. */}
        <div className="relative min-h-0 flex-1 overflow-hidden">{children}</div>

        {footer}

        {/* ── HOME ───────────────────────────────────────────────────────────
            The gesture pill for the people who reach for it, and under it the
            button for everyone else. Disabled at home, because a control that
            does nothing should look like it. */}
        <div className="relative z-10 flex shrink-0 flex-col items-center gap-1.5 border-t border-zinc-900/[0.06] bg-white/60 pb-2 pt-1.5">
          <button
            onClick={press}
            disabled={atHome}
            aria-label="Home"
            className="h-1 w-24 rounded-full bg-zinc-900/20 transition-colors enabled:hover:bg-zinc-900/40 disabled:opacity-30"
          />
          <motion.button
            onClick={press}
            disabled={atHome}
            aria-label="Home"
            title="Home"
            whileTap={atHome ? undefined : { scale: 0.9 }}
            className={`relative flex h-8 w-8 items-center justify-center rounded-full transition-all ${pressed ? "os-home-press" : ""} ${
              atHome ? "opacity-40" : "hover:shadow-md"
            }`}
            style={{
              background: "linear-gradient(160deg, #f8fafc, #e2e8f0)",
              boxShadow: "0 0 0 1px rgba(15,23,42,0.12), 0 1px 2px rgba(15,23,42,0.12), 0 1px 0 rgba(255,255,255,0.9) inset",
            }}
          >
            <span
              className="h-3.5 w-3.5 rounded-[5px]"
              style={{ boxShadow: "0 0 0 1.5px rgba(15,23,42,0.28)" }}
            />
          </motion.button>
        </div>
          </>
        )}
      </div>
    </div>
  );
}
