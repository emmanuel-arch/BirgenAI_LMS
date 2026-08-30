"use client";

// ─────────────────────────────────────────────────────────────────────────────
// MICRO EAZY — the install door.
//
// The first screen of the consumer app, and the one the board watches on stage
// (blueprint §10 step 2: "Install it on a real Android phone, on stage").
//
// FOUR STATES, because "install" is four different things depending on who is
// holding the phone, and guessing wrong is the difference between a tap and a
// dead end:
//
//   standalone  Already installed — never coach an installed user. Straight in.
//   android     Chrome fired `beforeinstallprompt`; we captured it and can open
//               the real OS sheet from our own button.
//   ios         Safari has NO programmatic install, at all. The only honest move
//               is to draw the Share → Add to Home Screen path and get out of
//               the way. A button here would be a lie.
//   browser     Desktop, Firefox Android, an in-app webview, or Chrome before
//               the event lands. No install offered; the app still works.
//
// COLOUR, and the one rule this screen is built around: the brand green is
// 3.90:1 against white — it fails AA as a bed for white type. So the primary
// action is a LIME fill carrying NAVY text (6.65:1), which is the relationship
// the logo itself draws. See src/lib/microeazy/brand.ts.
//
// Mobile-first per the house rule: composed at 360px, every target ≥44px, and
// nothing here needs a second hand.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { Share, Plus, Download, ArrowRight, ShieldCheck, Eye, Smartphone } from "lucide-react";
import { MICRO_EAZY, HERO_GRADIENT, coBrandLine } from "@/lib/microeazy/brand";

/**
 * The `beforeinstallprompt` event. Not in lib.dom — Chromium-only and never
 * standardised — so it is typed here rather than cast away at the call site.
 */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Mode = "standalone" | "android" | "ios" | "browser";

const C = MICRO_EAZY.colors;

// ── Platform facts, read as EXTERNAL STORES rather than in an effect ─────────
// Both of these are properties of the browser, not of React, and both must
// differ between the server render and the client. useSyncExternalStore is the
// API built for exactly that: it renders `getServerSnapshot` during SSR and
// swaps to the real value on hydration WITHOUT a mismatch — where setting state
// from inside an effect would cause the cascading re-render that
// react-hooks/set-state-in-effect exists to catch.

const STANDALONE_QUERY = "(display-mode: standalone)";

function subscribeStandalone(onChange: () => void) {
  const mq = window.matchMedia(STANDALONE_QUERY);
  mq.addEventListener("change", onChange);
  // `appinstalled` is the other way this can flip during a session.
  window.addEventListener("appinstalled", onChange);
  return () => {
    mq.removeEventListener("change", onChange);
    window.removeEventListener("appinstalled", onChange);
  };
}

function getStandalone(): boolean {
  return (
    window.matchMedia(STANDALONE_QUERY).matches ||
    // iOS Safari implements none of display-mode; this legacy flag is the only
    // way it ever admits to running from the home screen.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** The user agent never changes mid-session, so there is nothing to subscribe to. */
function subscribeNever() {
  return () => {};
}

function getIsIOS(): boolean {
  const ua = window.navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports itself as a Mac; the touch count is what separates an
    // iPad from an actual desktop Safari.
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  );
}

export default function InstallDoor({ lenderName }: { lenderName?: string | null }) {
  const isStandalone = useSyncExternalStore(subscribeStandalone, getStandalone, () => false);
  const isIOS = useSyncExternalStore(subscribeNever, getIsIOS, () => false);
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [installing, setInstalling] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    // Chrome fires this only when the manifest, the icons and HTTPS all check
    // out — so its arrival is also our installability test passing. Setting
    // state from an event callback is the pattern the lint rule permits.
    const onPrompt = (e: Event) => {
      e.preventDefault(); // stop Chrome's own mini-infobar; we present it ourselves
      setDeferred(e as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  // Server and first paint resolve to "browser", which offers "Get started" —
  // the option that is correct for everyone. Hydration then narrows it.
  const mode: Mode = isStandalone
    ? "standalone"
    : deferred
      ? "android"
      : isIOS
        ? "ios"
        : "browser";

  async function install() {
    if (!deferred) return;
    setInstalling(true);
    try {
      await deferred.prompt();
      await deferred.userChoice;
      // Accepted installs arrive back through `appinstalled`, which the
      // standalone store already subscribes to. A dismissed prompt cannot be
      // re-fired — the event is spent — so it is dropped either way rather than
      // left behind a button that would silently do nothing on a second tap.
      setDeferred(null);
    } finally {
      setInstalling(false);
    }
  }

  const fade = reduce
    ? {}
    : {
        initial: { opacity: 0, y: 14 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const },
      };

  return (
    <main
      // overflow-x-CLIP, not -hidden. Both contain the blooms, but `hidden` on one
      // axis forces the other to `auto` per spec, which turns this into a scroll
      // container; `clip` contains them without that side effect, so a viewport
      // too short for the content still scrolls the page normally.
      className="relative flex min-h-dvh flex-col overflow-x-clip px-5"
      style={{
        background: HERO_GRADIENT,
        // Safe-area insets, as style props rather than arbitrary Tailwind classes:
        // the value contains a comma, which is the shape most likely to be dropped
        // silently by arbitrary-value parsing.
        paddingTop: "max(2rem, env(safe-area-inset-top))",
        paddingBottom: "max(2rem, env(safe-area-inset-bottom))",
      }}
    >
      {/* Atmosphere: two green blooms, felt rather than seen — the same restraint
          as the sign-in door's, tuned to this brand's palette. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className={reduce ? "" : "auth-bloom"}
          style={{
            position: "absolute", top: "-22%", right: "-28%",
            width: "78vw", height: "78vw", borderRadius: "9999px",
            background: `radial-gradient(circle, ${C.lime}40 0%, transparent 68%)`,
            filter: "blur(46px)",
          }}
        />
        <div
          className={reduce ? "" : "auth-bloom auth-bloom-b"}
          style={{
            position: "absolute", bottom: "-26%", left: "-32%",
            width: "86vw", height: "86vw", borderRadius: "9999px",
            background: `radial-gradient(circle, ${C.green}38 0%, transparent 70%)`,
            filter: "blur(52px)",
          }}
        />
      </div>

      {/* 20rem is a measure, not a fix for anything: at the 360px viewport the
          house rule targets (blueprint §7.3) the column already fills the gutters,
          and on a 430px handset this keeps the line length comfortable instead of
          letting the body copy run to ~24rem. Verified with no document overflow
          at any width — scrollWidth tracks clientWidth exactly. */}
      <div className="relative mx-auto flex w-full max-w-[20rem] flex-1 flex-col">
        {/* ── The tile ──────────────────────────────────────────────────────
            Not the wordmark: the ACTUAL icon that is about to land on the home
            screen, at the radius Android will give it. The screen's promise and
            its result are the same picture. */}
        <motion.div {...fade} className="flex flex-1 flex-col items-center justify-center text-center">
          <div
            className="relative grid h-[92px] w-[92px] place-items-center rounded-[22px] bg-paper"
            style={{ boxShadow: "0 22px 50px -12px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.14)" }}
          >
            <Image
              src={MICRO_EAZY.icons.any512}
              alt=""
              width={92}
              height={92}
              priority
              className="h-[92px] w-[92px] rounded-[22px]"
            />
          </div>

          <h1 className="mt-7 text-[2rem] font-bold leading-[1.1] tracking-[-0.022em] text-white">
            {MICRO_EAZY.name}
          </h1>
          <p className="mt-2 text-[0.95rem] font-semibold tracking-[-0.006em]" style={{ color: C.lime }}>
            {MICRO_EAZY.tagline}
          </p>
          <p className="mt-4 text-[0.875rem] leading-relaxed text-balance text-white/70">
            {MICRO_EAZY.description}
          </p>
        </motion.div>

        {/* ── The three proofs ──────────────────────────────────────────────
            What the Trust Contract (§6.2) actually promises, in the customer's
            words. Not features — commitments, and each one is a screen that
            exists or is being built. */}
        <motion.ul
          {...fade}
          transition={{ ...(fade.transition ?? {}), delay: reduce ? 0 : 0.08 }}
          className="mb-7 space-y-3"
        >
          <Proof icon={<Smartphone size={15} strokeWidth={2.4} />} text="A decision in minutes, from your phone" />
          <Proof icon={<Eye size={15} strokeWidth={2.4} />} text="Every decision explained — never a silent no" />
          <Proof icon={<ShieldCheck size={15} strokeWidth={2.4} />} text="Your data, your report, your consent" />
        </motion.ul>

        {/* ── The action ────────────────────────────────────────────────────*/}
        <motion.div {...fade} transition={{ ...(fade.transition ?? {}), delay: reduce ? 0 : 0.14 }}>
          {mode === "android" && (
            <PrimaryButton onClick={install} disabled={installing}>
              <Download size={18} strokeWidth={2.6} />
              {installing ? "Opening…" : "Install Micro Eazy"}
            </PrimaryButton>
          )}

          {mode === "ios" && <IosCoaching />}

          {(mode === "standalone" || mode === "browser") && (
            <PrimaryButton href="/">
              Get started
              <ArrowRight size={18} strokeWidth={2.6} />
            </PrimaryButton>
          )}

          {(mode === "android" || mode === "ios") && (
            <Link
              href="/"
              className="mt-3 flex min-h-[44px] items-center justify-center rounded-2xl text-[0.875rem] font-medium text-white/65 transition-colors hover:text-white"
            >
              Continue in the browser
            </Link>
          )}
        </motion.div>

        {/* ── D2: the lender-of-record, named. ──────────────────────────────*/}
        <p className="mt-6 text-balance text-center text-[0.6875rem] leading-relaxed text-white/45">
          {coBrandLine(lenderName)}
        </p>
      </div>
    </main>
  );
}

function Proof({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <li className="flex items-center gap-3">
      <span
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full"
        style={{ background: "rgba(255,255,255,0.10)", color: C.lime }}
      >
        {icon}
      </span>
      <span className="text-[0.8125rem] leading-snug text-white/80">{text}</span>
    </li>
  );
}

/**
 * The one call to action. Lime on navy text — the only pairing on this ground
 * that clears AA (6.65:1); white on green would be 3.90:1.
 */
function PrimaryButton({
  children, onClick, href, disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
}) {
  const style: CSSProperties = {
    background: `linear-gradient(135deg, ${C.lime} 0%, ${C.green} 100%)`,
    color: C.navy,
    boxShadow: `0 14px 32px -10px ${C.green}80`,
  };
  const cls =
    "flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl px-6 text-[1rem] font-bold tracking-[-0.01em] transition-transform active:scale-[0.985] disabled:opacity-70";

  if (href) {
    return (
      <Link href={href} className={cls} style={style}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls} style={style}>
      {children}
    </button>
  );
}

/**
 * iOS has no install API and never has. Safari only installs through the share
 * sheet, so the honest interface is the two taps, drawn — with the same glyphs
 * iOS uses, so the customer is matching pictures rather than parsing a sentence.
 */
function IosCoaching() {
  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: "rgba(255,255,255,0.09)", border: "1px solid rgba(255,255,255,0.16)" }}
    >
      <p className="mb-3 text-[0.8125rem] font-semibold text-white">Add Micro Eazy to your Home Screen</p>
      <ol className="space-y-2.5">
        <Step n={1} icon={<Share size={15} strokeWidth={2.4} />}>
          Tap <span className="font-semibold text-white">Share</span> in the Safari toolbar
        </Step>
        <Step n={2} icon={<Plus size={15} strokeWidth={2.8} />}>
          Choose <span className="font-semibold text-white">Add to Home Screen</span>
        </Step>
      </ol>
    </div>
  );
}

function Step({ n, icon, children }: { n: number; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[0.6875rem] font-bold"
        style={{ background: C.lime, color: C.navy }}
      >
        {n}
      </span>
      <span className="flex items-center gap-1.5 text-[0.8125rem] leading-snug text-white/80">
        {children}
        <span className="grid h-6 w-6 place-items-center rounded-md" style={{ background: "rgba(255,255,255,0.14)", color: "#fff" }}>
          {icon}
        </span>
      </span>
    </li>
  );
}
