"use client";

// ─────────────────────────────────────────────────────────────────────────────
// MODAL — the one popup shell.
//
// Founder rule, verbatim: every popup is CENTRED — on phones too, never a
// bottom sheet — and the close button can NEVER scroll away. The old shells
// broke this by making the card itself the scroll container, so a long
// profile pushed its own X off the screen.
//
// The shape that fixes it for good: the panel is a COLUMN. A pinned header
// (title, subtitle, X), an optional pinned subheader (steppers, tabs), the
// body as the ONLY thing that scrolls, and an optional pinned footer for the
// primary actions — so Back/Next on a wizard are as unlosable as the X.
// Escape closes it, pressing the backdrop closes it, and the page behind
// stops scrolling while it is up.
//
// Every popup in the console goes through here. Do not hand-roll another
// fixed-inset shell; add the slot you're missing to this one instead.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";

const WIDTH = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg", xl: "max-w-xl" } as const;

export function Modal({ title, sub, onClose, children, subheader, footer, width = "md" }: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  /** Pinned between the header and the scroll region — steppers, tabs, filters. */
  subheader?: React.ReactNode;
  /** Pinned below the scroll region — the primary actions of a long form. */
  footer?: React.ReactNode;
  width?: keyof typeof WIDTH;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    // The page behind must not scroll out from under an open dialog.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 26 }}
        role="dialog" aria-modal="true"
        // Solid white, not glass: these stack over drawers and busy pages, and
        // a translucent card over a translucent drawer reads as mud.
        className={`flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-3xl border border-zinc-900/10 bg-white shadow-2xl ${WIDTH[width]}`}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5">
          <div className="min-w-0">
            <h2 className="text-base font-bold">{title}</h2>
            {sub && <p className="mt-0.5 text-xs text-zinc-500">{sub}</p>}
          </div>
          <button onClick={onClose} aria-label="Close"
            className="shrink-0 rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-900/5 hover:text-zinc-700">
            <X className="h-4 w-4" />
          </button>
        </div>
        {subheader && <div className="shrink-0 px-5 pt-3">{subheader}</div>}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {footer && <div className="shrink-0 border-t border-zinc-900/10 px-5 py-4">{footer}</div>}
      </motion.div>
    </motion.div>
  );
}
