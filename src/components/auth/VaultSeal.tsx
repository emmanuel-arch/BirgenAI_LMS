"use client";

// ─────────────────────────────────────────────────────────────────────────────
// The Vault Seal — the OTP step's centrepiece.
//
// The old step said "Enter today's code", then explained itself in a sentence
// ("One code, good all day. Enter the six digits from your inbox."), then showed a
// green tick shield. Three pieces of furniture all saying the same small thing.
// This replaces the lot with ONE object that says it without words: a sealed vault
// door, locked, that unlocks when the six digits land.
//
// It is a state machine, not a decoration:
//   sealed    slow counter-rotating rings, six bolts seated, shackle closed.
//             The dial ticks over as digits arrive — one bolt lights per digit.
//   working   rings spin up; the dial hunts.
//   open      bolts retract, the shackle lifts, the ring flushes to the accent.
//   error     the door judders and the ring flashes rose.
//
// Rendered in SVG at 132px so it stays crisp on the 4K panel a boardroom demo
// runs on. No image asset, and it re-colours from the lender's accent.
// ─────────────────────────────────────────────────────────────────────────────

import { motion, AnimatePresence } from "framer-motion";

export type VaultState = "sealed" | "working" | "open" | "error";

const BOLTS = 6;

export default function VaultSeal({
  state,
  filled,
  accent,
  accent2,
  size = 132,
}: {
  state: VaultState;
  /** How many of the six digits are in. Seats one bolt each. */
  filled: number;
  accent: string;
  accent2?: string;
  size?: number;
}) {
  const a2 = accent2 || accent;
  const ring = state === "error" ? "#e11d48" : state === "open" ? a2 : accent;
  const spin = state === "working" ? 2.4 : state === "open" ? 0 : 26;

  return (
    <motion.div
      animate={state === "error" ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }}
      transition={{ duration: 0.45 }}
      style={{ width: size, height: size }}
      className="relative"
    >
      {/* Outer breathing aura — the only thing that moves while you read the heading */}
      <motion.span
        className="absolute inset-0 rounded-full blur-xl"
        style={{ background: ring }}
        animate={{ opacity: state === "open" ? [0.28, 0.5, 0.28] : [0.1, 0.2, 0.1], scale: [0.9, 1.04, 0.9] }}
        transition={{ duration: state === "open" ? 2.2 : 3.6, repeat: Infinity, ease: "easeInOut" }}
      />

      <svg viewBox="0 0 132 132" width={size} height={size} fill="none" className="relative">
        <defs>
          <linearGradient id="vault-door" x1="0.15" y1="0" x2="0.85" y2="1">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="55%" stopColor="#f4f4f5" />
            <stop offset="100%" stopColor="#e4e4e7" />
          </linearGradient>
          <linearGradient id="vault-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={accent} />
            <stop offset="100%" stopColor={a2} />
          </linearGradient>
          <radialGradient id="vault-core" cx="0.4" cy="0.32" r="0.7">
            <stop offset="0%" stopColor={a2} />
            <stop offset="100%" stopColor={accent} />
          </radialGradient>
        </defs>

        {/* Door plate */}
        <circle cx="66" cy="66" r="52" fill="url(#vault-door)" stroke="rgba(9,9,11,0.1)" strokeWidth="1" />
        <circle cx="66" cy="66" r="44" fill="none" stroke="rgba(9,9,11,0.06)" strokeWidth="1" />

        {/* Progress ring — one sixth per digit. This is the ONLY "you are here" */}
        <circle cx="66" cy="66" r="56" fill="none" stroke="rgba(9,9,11,0.07)" strokeWidth="2.5" />
        <motion.circle
          cx="66" cy="66" r="56" fill="none"
          stroke={ring} strokeWidth="2.5" strokeLinecap="round"
          transform="rotate(-90 66 66)"
          style={{ pathLength: 0 }}
          animate={{ pathLength: state === "open" ? 1 : Math.min(1, filled / 6) }}
          transition={{ type: "spring", stiffness: 140, damping: 22 }}
        />

        {/* Counter-rotating machinery: the tumbler cage */}
        <motion.g
          animate={{ rotate: 360 }}
          transition={{ duration: spin || 26, repeat: spin ? Infinity : 0, ease: "linear" }}
          style={{ originX: "66px", originY: "66px" }}
        >
          {Array.from({ length: 24 }).map((_, i) => (
            <rect
              key={i}
              x="65.2" y="16" width="1.6" height={i % 4 === 0 ? 7 : 4}
              rx="0.8"
              fill="rgba(9,9,11,0.16)"
              transform={`rotate(${i * 15} 66 66)`}
            />
          ))}
        </motion.g>
        <motion.g
          animate={{ rotate: -360 }}
          transition={{ duration: (spin || 26) * 1.6, repeat: spin ? Infinity : 0, ease: "linear" }}
          style={{ originX: "66px", originY: "66px" }}
        >
          <circle cx="66" cy="66" r="35" fill="none" stroke="rgba(9,9,11,0.09)" strokeWidth="1" strokeDasharray="3 7" />
        </motion.g>

        {/* Six bolts. One seats — and lights — per digit entered. */}
        {Array.from({ length: BOLTS }).map((_, i) => {
          const angle = (i * 360) / BOLTS - 90;
          const lit = state === "open" || i < filled;
          const rad = (angle * Math.PI) / 180;
          // Bolts RETRACT toward the hub when the door opens; they seat outward as
          // digits arrive. Same axis, opposite directions — the whole story in one prop.
          const r = state === "open" ? 30 : lit ? 44 : 40;
          return (
            <motion.rect
              key={i}
              width="9" height="5.4" rx="2.7"
              fill={lit ? ring : "rgba(9,9,11,0.16)"}
              animate={{ x: 66 + Math.cos(rad) * r - 4.5, y: 66 + Math.sin(rad) * r - 2.7 }}
              transition={{ type: "spring", stiffness: 260, damping: 20, delay: state === "open" ? i * 0.045 : 0 }}
              transform={`rotate(${angle} ${66 + Math.cos(rad) * r} ${66 + Math.sin(rad) * r})`}
            />
          );
        })}

        {/* Hub */}
        <circle cx="66" cy="66" r="25" fill="url(#vault-core)" />
        <circle cx="66" cy="66" r="25" fill="none" stroke="#fff" strokeOpacity="0.32" strokeWidth="1.2" />

        {/* The padlock inside the hub: shackle lifts and the body unlatches on open */}
        <g>
          <motion.path
            d="M 59.5 62 v -4.6 a 6.5 6.5 0 0 1 13 0 V 62"
            fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"
            animate={
              state === "open"
                ? { y: -5, x: 3.5, rotate: 16, opacity: 1 }
                : state === "error"
                  ? { y: 0, x: 0, rotate: 0, opacity: 1 }
                  : { y: 0, x: 0, rotate: 0, opacity: 1 }
            }
            transition={{ type: "spring", stiffness: 260, damping: 18 }}
            style={{ originX: "59.5px", originY: "62px" }}
          />
          <rect x="55.5" y="61.5" width="21" height="16" rx="4.4" fill="#fff" fillOpacity="0.95" />
          <AnimatePresence mode="wait">
            {state === "open" ? (
              <motion.path
                key="tick"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.34, ease: "easeOut" }}
                d="M 60.5 69.5 l 3.6 3.6 l 7.4 -7.6"
                stroke={a2} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none"
              />
            ) : (
              <motion.circle
                key="keyhole"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                cx="66" cy="68.4" r="2.5" fill={accent}
              />
            )}
          </AnimatePresence>
          {state !== "open" && <rect x="65" y="68.4" width="2" height="5.4" rx="1" fill={accent} />}
        </g>
      </svg>
    </motion.div>
  );
}
