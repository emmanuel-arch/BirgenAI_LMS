"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE REALM SWITCH — which of the lender's books you are standing in.
//
// It sits at the top of the console, floating on the artwork opposite the
// identity pill, because those two controls answer the two halves of the same
// question: the pill says WHO you are, this says WHERE you are. Neither is a
// page, so neither gets a bar.
//
// ── WHY IT IS A SEGMENTED CONTROL AND NOT A DROPDOWN ─────────────────────────
// ServiceSuite does this with a <select> and a Continue button (Views/Users/
// Switch.cshtml). That is correct and it is invisible: nothing on any other
// screen tells you which entity you are in, so the only way to know is to go
// back and look. A segment shows the answer permanently and costs one click to
// change. Both books stay legible at all times — you can see the one you are
// not in, which is what stops somebody posting into the wrong ledger.
//
// ── THE MOMENT ───────────────────────────────────────────────────────────────
// Switching book re-colours the entire console, and a re-colour that happens
// instantly reads as a glitch rather than as a change. So the thumb slides at
// once (the control answers before the server does), a veil closes over the
// page with the incoming book named on it, and the console is revealed already
// wearing its new colours. The veil is not decoration — it is the thing that
// makes a whole-screen palette change feel deliberate. It holds for a beat even
// on a fast connection, because a flash of white is not reassuring.
//
// Colour is carried by the SERVER, not by this component: the console layout
// resolves the realm and sets --brand. This one only paints its own thumb, so
// there is no second source of truth for what a book looks like.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Smartphone, Store } from "lucide-react";
import type { RealmBrand } from "@/lib/suite/realms";

/** The minimum time the veil stays up. Shorter than this and it strobes. */
const MIN_VEIL_MS = 850;

export type SwitchRealm = {
  id: string;
  label: string;
  name: string;
  blurb: string;
  entityId: number;
  brand: RealmBrand;
};

/** SME is a place you walk into; fintech is a thing in your hand. */
function RealmIcon({ id, className }: { id: string; className?: string }) {
  return id === "sme" ? <Store className={className} /> : <Smartphone className={className} />;
}

export default function RealmSwitch({ realms, active }: { realms: SwitchRealm[]; active: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // What the CONTROL shows. Runs ahead of `active`, which only catches up once
  // the server has re-rendered underneath us.
  const [selected, setSelected] = useState(active);
  const [failed, setFailed] = useState(false);

  // The server is the authority: when a refresh lands, take its answer.
  //
  // Adjusted DURING RENDER rather than in an effect, which is the supported
  // shape for "reset state when a prop changes" — an effect would paint the
  // stale book for one frame first, and React's own lint rejects it. The guard
  // is what makes the optimistic slide survive: while the request is in flight
  // `active` has not moved yet, so nothing here fires.
  const [lastActive, setLastActive] = useState(active);
  if (active !== lastActive) {
    setLastActive(active);
    setSelected(active);
  }

  if (realms.length < 2) return null;

  const index = Math.max(0, realms.findIndex((r) => r.id === selected));
  const current = realms[index] ?? realms[0];
  const incoming = realms.find((r) => r.id === selected) ?? current;

  function choose(next: SwitchRealm) {
    if (pending || next.id === selected) return;
    setFailed(false);
    setSelected(next.id); // the thumb moves now; the server catches up
    startTransition(async () => {
      const startedAt = Date.now();
      const res = await fetch("/api/console/realm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ realm: next.id }),
      }).catch(() => null);

      if (!res || !res.ok) {
        // Put the thumb back where it was. A control that lies about where you
        // are is worse than one that refuses to move.
        setSelected(active);
        setFailed(true);
        return;
      }

      router.refresh();
      const left = MIN_VEIL_MS - (Date.now() - startedAt);
      if (left > 0) await new Promise((r) => setTimeout(r, left));
    });
  }

  return (
    <>
      <div
        role="group"
        aria-label="Which book you are working in"
        className="panel relative inline-flex h-10 items-center rounded-2xl p-1"
      >
        {/* The thumb. One element, moved by transform, so the slide is composited
            and never reflows the labels it passes under. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-1 left-1 rounded-xl shadow-sm transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
          style={{
            width: `calc((100% - 0.5rem) / ${realms.length})`,
            transform: `translateX(calc(${index} * 100%))`,
            background: `linear-gradient(135deg, ${current.brand.accent}, ${current.brand.accent2})`,
          }}
        />
        {realms.map((r) => {
          const on = r.id === selected;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => choose(r)}
              disabled={pending}
              aria-pressed={on}
              title={`${r.name} — ServiceSuite entity ${r.entityId}`}
              className={`relative z-10 flex h-8 items-center justify-center gap-1.5 rounded-xl px-3 text-[12px] font-semibold transition-colors duration-300 disabled:cursor-wait ${
                on ? "text-white" : "text-[color:var(--ink-muted)] hover:text-[color:var(--ink)]"
              }`}
              style={{ width: `calc((100% - 0.5rem) / ${realms.length})`, minWidth: "5.25rem" }}
            >
              <RealmIcon id={r.id} className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{r.label}</span>
            </button>
          );
        })}
      </div>

      {failed && (
        <span role="status" className="panel hidden items-center rounded-xl px-2.5 py-1.5 text-[11px] font-semibold text-amber-700 sm:inline-flex">
          Could not switch book
        </span>
      )}

      {/* ── THE VEIL ───────────────────────────────────────────────────────────
          Fixed, above everything, and pointer-events-none once it is on its way
          out so a fast second click is never swallowed by a fading overlay. */}
      <div
        aria-hidden={!pending}
        className={`no-print fixed inset-0 z-[70] flex items-center justify-center transition-opacity duration-300 ${
          pending ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        style={{ backdropFilter: pending ? "blur(14px) saturate(115%)" : "none", background: "rgba(250,250,251,0.72)" }}
      >
        <div className="panel flex min-w-[16rem] flex-col items-center gap-3 rounded-2xl px-8 py-7 text-center">
          {/* A ring in the INCOMING book's colour — the palette change starts
              before the page underneath has caught up. */}
          <span
            className="h-9 w-9 animate-spin rounded-full border-[3px] motion-reduce:animate-none"
            style={{
              borderColor: incoming.brand.accentSoft,
              borderTopColor: incoming.brand.accent,
              animationDuration: "0.7s",
            }}
          />
          <span className="flex flex-col gap-1">
            <span className="t-section">{incoming.name}</span>
            <span className="t-meta max-w-[22rem]">{incoming.blurb}</span>
          </span>
          <span
            className="rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wide"
            style={{ background: incoming.brand.accentSoft, color: incoming.brand.accent }}
          >
            ENTITY {incoming.entityId}
          </span>
        </div>
      </div>

      {/* Announced for anyone not watching the colours change. */}
      <span aria-live="polite" className="sr-only">
        {pending ? `Switching to ${incoming.name}` : `Working in ${current.name}`}
      </span>
    </>
  );
}
