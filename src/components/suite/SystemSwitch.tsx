"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE SYSTEM SWITCH — on the front doors, where there is no session yet.
//
// ── WHAT IT REPLACES ─────────────────────────────────────────────────────────
// The doors used to end with a paragraph in the far corner: a label reading THE
// CONNECTED SUITE, a line of mood copy about the artwork, and a text link saying
// "All six systems". Three problems with it, in order of how much they cost:
//
//   1. It counted. "All six systems" is a hard-coded number on a page served to
//      a lender who may have bought four. The launcher already learned this
//      lesson and computes its count; the doors had not.
//   2. It was prose where a control belonged. Somebody who lands on the
//      ConnectDesk door because a colleague forwarded a link and actually wants
//      Ledgerly does not want to read about voices moving through the dark. They
//      want the other door, and a sentence is not a door.
//   3. It sat bottom-right, which on a phone is below the fold, under the form.
//
// So it is a real switcher, in the corner every product in the world puts one:
// TOP RIGHT. It says which system you are standing in, and it opens onto every
// other one — each entry going to that system's OWN front door, so switching
// keeps the property being demonstrated rather than short-circuiting it.
//
// ── WHY IT SHOWS EVERY SYSTEM AND GATES NOTHING ──────────────────────────────
// This renders BEFORE anybody is known. There is no session, therefore no
// organisation, therefore no entitlement to filter by — and guessing would be
// worse than not filtering, because the guess is wrong for every visitor whose
// lender bought a different four. Each door gates itself on arrival (see
// suite/[app]/login/page.tsx, which bounces a signed-in visitor whose lender
// does not hold that system). A door is the right place to be turned away; a
// menu is not.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, ChevronDown, Grid2x2 } from "lucide-react";
import { SUITE_APPS } from "@/lib/suite/apps";
import type { ResolvedSuiteApp } from "@/lib/suite/hosts";

export default function SystemSwitch({
  currentId,
  hosts,
}: {
  currentId: string;
  /** Resolved server-side: where each system lives and which door it opens. */
  hosts: ResolvedSuiteApp[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, []);

  const rows = SUITE_APPS.map((a) => ({ app: a, host: hosts.find((h) => h.id === a.id) })).filter((r) => r.host);
  const here = SUITE_APPS.find((a) => a.id === currentId);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-2xl border border-white/[0.14] bg-white/[0.07] px-3 py-2 text-[12px] font-semibold text-white/85 backdrop-blur-xl transition-colors hover:border-white/25 hover:bg-white/[0.12] hover:text-white"
      >
        <Grid2x2 className="h-3.5 w-3.5 shrink-0" />
        <span className="hidden sm:inline">{here?.short ?? "Systems"}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 opacity-60 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-[min(21rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/[0.12] bg-[#0d0c12]/95 p-1.5 shadow-2xl backdrop-blur-2xl"
        >
          <p className="px-2.5 pb-1.5 pt-1 text-[9.5px] font-bold uppercase tracking-[0.16em] text-white/35">
            Switch system
          </p>
          {rows.map(({ app, host }) => {
            const on = app.id === currentId;
            const Icon = app.icon;
            // A system's own front door where it has one; its href where it does
            // not. The Customer Portal belongs to borrowers and the Interchange
            // authenticates by node certificate — neither can honour a staff
            // sign-in card, so neither is sent to one.
            const target = host!.door ?? host!.href;
            return (
              <Link
                key={app.id}
                href={target}
                {...(host!.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                onClick={() => setOpen(false)}
                aria-current={on ? "page" : undefined}
                className={`group flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors ${
                  on ? "bg-white/[0.09]" : "hover:bg-white/[0.06]"
                }`}
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ring-white/10"
                  style={{ backgroundColor: `${app.accent}2e` }}
                >
                  <Icon className="h-4 w-4" style={{ color: app.accent }} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-white/90">{app.name}</span>
                  <span className="block truncate text-[10.5px] text-white/40">{app.purpose}</span>
                </span>
                {on ? (
                  <Check className="h-3.5 w-3.5 shrink-0" style={{ color: app.accent }} />
                ) : (
                  <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-white/20 transition-colors group-hover:text-white/60" />
                )}
              </Link>
            );
          })}
          {/* The launcher, as the last row rather than as a sentence in the
              corner. No count: the number of systems is a property of the
              lender, and this page does not know which lender is looking. */}
          <Link
            href="/suite"
            onClick={() => setOpen(false)}
            className="mt-1 flex items-center justify-between gap-2 rounded-xl border-t border-white/[0.08] px-2.5 py-2.5 text-[11.5px] font-semibold text-white/50 transition-colors hover:text-white"
          >
            See every system you hold
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
      )}
    </div>
  );
}
