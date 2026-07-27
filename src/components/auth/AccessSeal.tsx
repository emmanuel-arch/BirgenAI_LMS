"use client";

// ─────────────────────────────────────────────────────────────────────────────
// The Access Seal — the padlock in the step lockup.
//
// This replaces the Sentinel: a character with eyes that covered them with its
// hands while you typed. Charming, and wrong for the room. A lending console is
// bought by risk committees and IT, and the mark guarding the door has to read as
// instrumentation, not as a mascot. So the whole story is told by ONE padlock, at
// label scale, sitting beside the step name rather than parked at the far edge.
//
// It is a state machine, and the door is SHUT until it is earned:
//   locked     how you find the page. Shackle seated, keyhole cold. No email, no
//              password, no entry — the screen says so before it says anything.
//   open       the email field has the caret. The shackle lifts and pivots off its
//              left leg: we know who is knocking.
//   shielded   the password field has the caret. The shackle snaps shut and the
//              keyhole becomes three masked dots — the secret is not being watched.
//              The old promise, kept without a cartoon.
//   working    the credentials are with the server; the aura quickens. Deliberately
//              calm — the submit button already carries a spinner, and two progress
//              indicators for one wait is noise.
//   error      the body judders and the mark goes rose.
//   granted    second factor cleared — the shackle swings fully open, tick.
//
// Restraint is the brief. Nothing travels more than ~4px, there is no spinning
// machinery, and `prefers-reduced-motion` drops the idle loops entirely. Pure SVG,
// no asset to ship, and every colour is derived from the lender's accent — so
// Mular's seal is navy-and-green and Micromart's is brown.
//
// Decorative only: aria-hidden, and the form depends on none of its state.
// ─────────────────────────────────────────────────────────────────────────────

import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

export type SealState = "locked" | "open" | "shielded" | "working" | "error" | "granted";

const SPRING = { type: "spring" as const, stiffness: 300, damping: 22 };

export default function AccessSeal({
  state,
  accent,
  accent2,
  size = 34,
}: {
  state: SealState;
  accent: string;
  accent2?: string;
  size?: number;
}) {
  const reduce = useReducedMotion();
  const a2 = accent2 || accent;
  const tone = state === "error" ? "#e11d48" : accent;
  const tone2 = state === "error" ? "#fb7185" : a2;

  // The shackle is the sentence. It pivots on its LEFT leg, the one that stays
  // seated in the body — the way a real padlock opens, not a lid flipping up.
  const shackle =
    state === "granted" ? { y: -4.2, rotate: -26 }
      : state === "open" ? { y: -3.2, rotate: -17 }
        : { y: 0, rotate: 0 };

  // Aura: the only thing that moves while you read the label.
  const auraPeak =
    state === "granted" ? 0.4 : state === "open" ? 0.3 : state === "working" ? 0.34 : 0.15;

  const face = state === "granted" ? "tick" : state === "shielded" ? "dots" : "keyhole";

  return (
    <motion.span
      aria-hidden
      className="relative inline-block shrink-0 align-middle"
      style={{ width: size, height: size }}
      animate={state === "error" ? { x: [0, -3.5, 3.5, -2.5, 0] } : { x: 0 }}
      transition={{ duration: 0.4 }}
    >
      <motion.span
        className="absolute -inset-1 rounded-full blur-lg"
        style={{ background: tone }}
        animate={
          reduce
            ? { opacity: auraPeak * 0.7, scale: 1 }
            : { opacity: [auraPeak * 0.4, auraPeak, auraPeak * 0.4], scale: [0.85, 1.03, 0.85] }
        }
        transition={
          reduce
            ? { duration: 0.3 }
            : { duration: state === "working" ? 1.2 : 3.8, repeat: Infinity, ease: "easeInOut" }
        }
      />

      <svg viewBox="0 0 40 40" width={size} height={size} fill="none" className="relative">
        <defs>
          <linearGradient id="seal-body" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={tone} />
            <stop offset="100%" stopColor={tone2} />
          </linearGradient>
          <radialGradient id="seal-gloss" cx="0.3" cy="0.2" r="0.75">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.42" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Shackle — drawn first so the body covers where the legs enter it */}
        <motion.path
          d="M 13.6 19.2 V 13.6 a 6.4 6.4 0 0 1 12.8 0 V 19.2"
          fill="none"
          stroke={tone}
          strokeWidth="3.1"
          strokeLinecap="round"
          animate={shackle}
          transition={SPRING}
          style={{ originX: "13.6px", originY: "19.2px" }}
        />

        {/* Body */}
        <rect x="8.4" y="17.6" width="23.2" height="16.6" rx="5.6" fill="url(#seal-body)" />
        <rect x="8.4" y="17.6" width="23.2" height="16.6" rx="5.6" fill="url(#seal-gloss)" />
        <rect
          x="8.4" y="17.6" width="23.2" height="16.6" rx="5.6"
          fill="none" stroke="#fff" strokeOpacity="0.3" strokeWidth="0.9"
        />

        {/* Face — keyhole, masked dots, or the tick */}
        <AnimatePresence mode="wait">
          {face === "tick" ? (
            <motion.path
              key="tick"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.32, ease: "easeOut" }}
              d="M 15.4 25.9 l 3.1 3.1 l 5.9 -6.4"
              stroke="#fff" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" fill="none"
            />
          ) : face === "dots" ? (
            <motion.g key="dots" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
              {[14.6, 20, 25.4].map((cx, i) => (
                // `r` rather than scale: an SVG attribute animation needs no
                // transform-origin, so it cannot drift at odd sizes.
                <motion.circle
                  key={cx}
                  cx={cx} cy={25.9} fill="#fff"
                  initial={{ r: 0 }} animate={{ r: 1.6 }} exit={{ r: 0 }}
                  transition={{ ...SPRING, delay: i * 0.05 }}
                />
              ))}
            </motion.g>
          ) : (
            <motion.g key="keyhole" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
              <circle cx="20" cy="24.4" r="2.25" fill="#fff" />
              <rect x="19.15" y="26" width="1.7" height="4.1" rx="0.85" fill="#fff" />
            </motion.g>
          )}
        </AnimatePresence>
      </svg>
    </motion.span>
  );
}
