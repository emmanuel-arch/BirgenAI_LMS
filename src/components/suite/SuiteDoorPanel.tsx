"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE OTHER HALF OF A SYSTEM'S FRONT DOOR.
//
// ── WHAT WAS WRONG, IN ONE SENTENCE ──────────────────────────────────────────
// The door was a sign-in card in the top-left corner of a 2560px photograph, and
// the founder's mark-up of it was two enormous question marks drawn across the
// middle of the screen. They were the right question. Two thirds of the widest
// surface in the product was doing nothing but being dark, on the first screen
// anybody sees of a system they are being sold.
//
// ── THE FIX IS A SPLIT, NOT A BIGGER CARD ────────────────────────────────────
// Ported from the BirgenAI front door (BirgenAI/birgen-ai-frontend/src/app/login
// and its right-panel component), which solves exactly this: the viewport is cut
// in half, the left half does the WORK and the right half does the ARGUING. The
// left is a form on the theme's own paper; the right is a plate — the system's
// artwork, its colour, its name, and a line that changes.
//
// What is deliberately NOT ported is the content. BirgenAI's panel spins a globe
// and cycles marketing copy. This one carries the ONE thing a person standing at
// a system's door needs and cannot get anywhere else: what this system is, what
// it does, and that their existing sign-in already opens it.
//
// ── THE PLATE IS DARK IN BOTH THEMES, ON PURPOSE ─────────────────────────────
// Everything else in this suite flips with the theme. This does not, and the
// reason is that it is not a surface — it is a picture with a frame round it,
// the same way a photograph on an office wall does not get repainted when
// somebody turns the lights on. The six artworks are near-black by construction
// (see lib/suite/artwork.ts's HOUSE_STYLE), so a "light" version of this panel
// would mean either a different set of six photographs or the same six washed
// out to grey. The left half carries the theme; this half carries the identity.
//
// ── EVERY MOVING THING HERE STOPS ────────────────────────────────────────────
// The glow breathes and the line changes. Nothing else moves, the rotation stops
// while the tab is hidden, and under `prefers-reduced-motion` the whole panel is
// one still frame with the first line showing. A sign-in page that keeps moving
// is a sign-in page people mistrust.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { metaFor } from "@/lib/theme/media.generated";

const ROTATE_MS = 4600;

export default function SuiteDoorPanel({
  name,
  accent,
  icon,
  lines,
  modules,
  artFile,
  gradient,
  hasArtwork,
}: {
  name: string;
  accent: string;
  /** Rendered by the server component — a client boundary cannot take a
   *  component type, but it can take an element. */
  icon: ReactNode;
  /** The lines that rotate. First one shows under reduced motion. */
  lines: string[];
  /** What this system contains. Static — a list that moved would be unreadable. */
  modules: string[];
  artFile: string;
  gradient: string;
  hasArtwork: boolean;
}) {
  const [i, setI] = useState(0);
  const [reduced, setReduced] = useState(false);
  const meta = metaFor(artFile);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (reduced || lines.length < 2) return;
    const t = setInterval(() => {
      // Not while nobody is looking. A forgotten tab on a branch machine should
      // not be repainting a panel every four seconds all afternoon.
      if (document.visibilityState !== "visible") return;
      setI((n) => (n + 1) % lines.length);
    }, ROTATE_MS);
    return () => clearInterval(t);
  }, [reduced, lines.length]);

  return (
    <div className="relative hidden overflow-hidden bg-[#09080d] md:flex">
      {/* ── The plate ───────────────────────────────────────────────────────
          Blur first, photograph over it. The blur is inlined (no request), so
          this half is never a black rectangle waiting for 40 KB — which matters
          more here than anywhere, because it is the half that is supposed to be
          doing the persuading. */}
      {meta && (
        <div
          aria-hidden
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url('${meta.lqip}')`, filter: "blur(30px)", transform: "scale(1.08)" }}
        />
      )}
      <div
        aria-hidden
        className="suite-drift absolute inset-0 bg-cover bg-center"
        style={hasArtwork ? { backgroundImage: `url('${artFile}')` } : { background: gradient }}
      />
      {/* Held back so the lockup on top of it is never at the mercy of whatever
          the generator put in that corner. Same discipline as the console
          canvas: type never touches artwork whose contrast nobody has checked. */}
      <div aria-hidden className="absolute inset-0 bg-[#09080d]/55" />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ background: `radial-gradient(120% 90% at 50% 42%, ${accent}2e 0%, transparent 62%)` }}
      />

      <div className="relative z-10 flex h-full w-full flex-col items-center justify-center px-10 text-center">
        {/* ── The mark ─────────────────────────────────────────────────── */}
        <div className="relative">
          {!reduced && (
            <motion.span
              aria-hidden
              className="absolute inset-0 rounded-full"
              style={{
                background: `radial-gradient(circle, ${accent}88 0%, transparent 66%)`,
                filter: "blur(38px)",
              }}
              animate={{ scale: [1, 1.14, 1], opacity: [0.5, 0.82, 0.5] }}
              transition={{ duration: 4.4, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
          <span
            className="relative grid h-20 w-20 place-items-center rounded-[26px] ring-1 ring-white/15"
            style={{ backgroundColor: `${accent}2e`, color: accent }}
          >
            {icon}
          </span>
        </div>

        <h2 className="mt-7 text-[30px] font-bold leading-[1.1] tracking-[-0.028em] text-white lg:text-[36px]">
          {name}
        </h2>

        {/* ── The line that changes ────────────────────────────────────────
            A fixed-height box. Without it the panel jogs vertically every time
            a longer sentence arrives, and a page that twitches while somebody
            is typing a password is the definition of untrustworthy. */}
        <div className="relative mt-4 h-14 w-full max-w-[42ch]">
          <AnimatePresence mode="wait">
            <motion.p
              key={reduced ? 0 : i}
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.45 }}
              className="absolute inset-0 text-[14px] leading-relaxed text-white/62"
            >
              {lines[reduced ? 0 : i]}
            </motion.p>
          </AnimatePresence>
        </div>

        {lines.length > 1 && !reduced && (
          <div className="mt-1 flex items-center gap-2">
            {lines.map((line, n) => (
              <span
                key={line}
                className="h-1 rounded-full transition-all duration-500"
                style={{
                  width: n === i ? 22 : 6,
                  backgroundColor: n === i ? accent : "rgb(255 255 255 / 0.2)",
                }}
              />
            ))}
          </div>
        )}

        {/* ── What is inside ───────────────────────────────────────────────
            The module chips came OFF the sign-in card, where they were a
            feature list under a password field and pushed the sign-out link
            below the fold on a phone. They belong here: this half of the door
            is exactly where "what is this system" is the question being asked,
            and this half does not exist on a phone at all. */}
        <div className="mt-10 flex max-w-[40ch] flex-wrap items-center justify-center gap-1.5">
          {modules.map((m) => (
            <span
              key={m}
              className="rounded-full border border-white/12 bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-white/60"
            >
              {m}
            </span>
          ))}
        </div>
      </div>

      <p className="absolute inset-x-0 bottom-6 z-10 text-center text-[10.5px] uppercase tracking-[0.18em] text-white/25">
        One identity · every system
      </p>
    </div>
  );
}
