"use client";

// ─────────────────────────────────────────────────────────────────────────────
// The Sentinel — the small creature that guards the door.
//
// It is the one warm thing on an otherwise institutional screen, and it exists to
// make a security ritual feel like it is being performed BY someone rather than TO
// you. It reacts to the form, never to the mouse:
//
//   idle      eyes open, blinks on an irregular timer, floats
//   email     looks DOWN-LEFT, at the field you are filling
//   password  claps both hands over its eyes — it is not watching you type
//   error     winces, and the pupils shrink
//   working   eyes shut, leaning in
//   sealed    eyes shut, smiling (OTP verified)
//
// The password behaviour is the whole point of the character: it is a promise
// rendered as an animation. Everything is SVG + framer-motion — no sprite sheet,
// no asset to ship, and it re-colours itself from the lender's accent, so Mular's
// sentinel is navy-and-green and Micromart's is brown.
//
// Purely decorative: aria-hidden, and it carries no state the form depends on.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export type SentinelMood = "idle" | "email" | "password" | "error" | "working" | "sealed";

const EASE = [0.16, 1, 0.3, 1] as const;

export default function AuthSentinel({
  mood,
  accent,
  accent2,
  size = 68,
}: {
  mood: SentinelMood;
  accent: string;
  accent2?: string;
  size?: number;
}) {
  const a2 = accent2 || accent;
  const [blink, setBlink] = useState(false);

  // An irregular blink. A fixed interval reads as a machine; humans blink in
  // clusters, so the next one is scheduled from the last, at a random distance.
  useEffect(() => {
    if (mood === "password" || mood === "working" || mood === "sealed") return;
    let live = true;
    let t: ReturnType<typeof setTimeout>;
    const cycle = () => {
      t = setTimeout(() => {
        if (!live) return;
        setBlink(true);
        setTimeout(() => { if (live) setBlink(false); }, 130);
        cycle();
      }, 2200 + Math.random() * 3600);
    };
    cycle();
    return () => { live = false; clearTimeout(t); setBlink(false); };
  }, [mood]);

  const eyesShut = blink || mood === "working" || mood === "sealed";
  const hiding = mood === "password";
  // Where the pupils sit. Email → down and toward the field (which is to its left).
  const look = mood === "email" ? { x: -2.6, y: 2.4 } : mood === "error" ? { x: 0, y: -1.2 } : { x: 0, y: 0 };
  const pupil = mood === "error" ? 2.1 : 2.9;

  return (
    <motion.div
      aria-hidden
      animate={
        mood === "error"
          ? { x: [0, -4, 4, -3, 0], y: 0 }
          : mood === "working"
            ? { y: [0, -3, 0], x: 0 }
            : { y: [0, -3.5, 0], x: 0 }
      }
      transition={
        mood === "error"
          ? { duration: 0.42 }
          : { duration: mood === "working" ? 1.1 : 4.2, repeat: Infinity, ease: "easeInOut" }
      }
      style={{ width: size, height: size }}
      className="relative shrink-0 select-none"
    >
      <svg viewBox="0 0 64 64" width={size} height={size} fill="none">
        <defs>
          <linearGradient id="sentinel-shell" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={accent} />
            <stop offset="100%" stopColor={a2} />
          </linearGradient>
          <radialGradient id="sentinel-gloss" cx="0.34" cy="0.24" r="0.62">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.42" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Shell — a squircle, not a circle: it reads as a device, not a smiley */}
        <rect x="6" y="6" width="52" height="52" rx="19" fill="url(#sentinel-shell)" />
        <rect x="6" y="6" width="52" height="52" rx="19" fill="url(#sentinel-gloss)" />
        <rect x="6" y="6" width="52" height="52" rx="19" fill="none" stroke="#fff" strokeOpacity="0.28" strokeWidth="1" />

        {/* Face plate */}
        <rect x="13" y="16" width="38" height="30" rx="13" fill="#0b0b0f" fillOpacity="0.9" />

        {/* Eyes */}
        <g>
          {(["left", "right"] as const).map((side) => {
            const cx = side === "left" ? 24.5 : 39.5;
            return (
              <g key={side}>
                <AnimatePresence initial={false} mode="wait">
                  {eyesShut ? (
                    <motion.path
                      key="shut"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.06 }}
                      d={
                        mood === "sealed"
                          ? `M ${cx - 4.4} 31.6 q 4.4 -5 8.8 0`   // happy arc, curving up
                          : `M ${cx - 4.4} 30.4 q 4.4 4.2 8.8 0`  // relaxed lid
                      }
                      stroke="#fff"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      fill="none"
                    />
                  ) : (
                    <motion.g key="open" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.06 }}>
                      <circle cx={cx} cy={30.5} r={5.1} fill="#fff" />
                      <motion.circle
                        cx={cx}
                        cy={30.5}
                        r={pupil}
                        fill="#0b0b0f"
                        animate={{ cx: cx + look.x, cy: 30.5 + look.y, r: pupil }}
                        transition={{ type: "spring", stiffness: 320, damping: 22 }}
                      />
                      <motion.circle
                        cx={cx + 1.5}
                        cy={28.8}
                        r={1.1}
                        fill="#fff"
                        animate={{ cx: cx + 1.5 + look.x, cy: 28.8 + look.y }}
                        transition={{ type: "spring", stiffness: 320, damping: 22 }}
                      />
                    </motion.g>
                  )}
                </AnimatePresence>
              </g>
            );
          })}
        </g>

        {/* Mouth — a hairline that only shows when there is something to say */}
        <AnimatePresence>
          {(mood === "sealed" || mood === "error") && (
            <motion.path
              key={mood}
              initial={{ opacity: 0, pathLength: 0 }}
              animate={{ opacity: 1, pathLength: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: EASE }}
              d={mood === "sealed" ? "M 27.5 39.5 q 4.5 4 9 0" : "M 27.5 41 q 4.5 -3.2 9 0"}
              stroke="#fff"
              strokeOpacity="0.75"
              strokeWidth="1.8"
              strokeLinecap="round"
              fill="none"
            />
          )}
        </AnimatePresence>

        {/* Hands — swing up over the eyes the instant the password field is live */}
        <AnimatePresence>
          {hiding && (
            <>
              <motion.rect
                key="hand-l"
                initial={{ y: 26, rotate: -34, opacity: 0 }}
                animate={{ y: 0, rotate: 0, opacity: 1 }}
                exit={{ y: 26, rotate: -34, opacity: 0 }}
                transition={{ type: "spring", stiffness: 420, damping: 24 }}
                style={{ originX: "20px", originY: "44px" }}
                x="12.5" y="23" width="19" height="15" rx="7.2"
                fill={accent}
                stroke="#fff" strokeOpacity="0.5" strokeWidth="1"
              />
              <motion.rect
                key="hand-r"
                initial={{ y: 26, rotate: 34, opacity: 0 }}
                animate={{ y: 0, rotate: 0, opacity: 1 }}
                exit={{ y: 26, rotate: 34, opacity: 0 }}
                transition={{ type: "spring", stiffness: 420, damping: 24, delay: 0.03 }}
                style={{ originX: "44px", originY: "44px" }}
                x="32.5" y="23" width="19" height="15" rx="7.2"
                fill={a2}
                stroke="#fff" strokeOpacity="0.5" strokeWidth="1"
              />
            </>
          )}
        </AnimatePresence>
      </svg>

      {/* Thinking halo — only while the network has the credentials */}
      <AnimatePresence>
        {mood === "working" && (
          <motion.span
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: [0.5, 0, 0.5], scale: [1, 1.28, 1] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
            className="pointer-events-none absolute inset-0 rounded-[22px]"
            style={{ boxShadow: `0 0 0 2px ${accent}` }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
