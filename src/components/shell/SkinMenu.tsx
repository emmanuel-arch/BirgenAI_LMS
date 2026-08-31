"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE APPEARANCE PICKER — which floor this system stands on.
//
// It sits beside the light/dark switch and is deliberately the same object: the
// `panel` shell, h-10, rounded-2xl. WHAT it looks like on the left, HOW light it
// is on the right — one pair of controls, one idea.
//
// The swatch on the button is not an icon of a paint pot. It is the skin itself,
// rendered at 20px in the theme currently applied, with this system's accent
// washing it — so the control is a live thumbnail of the decision it makes. That
// is the whole reason a person can tell the three apart without opening it.
//
// The choice is per SYSTEM (see lib/theme/useSkin), so dressing ConnectDesk does
// not dress Ledgerly. A lender who wants all six the same sets all six the same;
// the founder's ask was the other way round.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import { Check, Images } from "lucide-react";
import { useTheme } from "@/lib/theme/useTheme";
import { useSkin } from "@/lib/theme/useSkin";
import { SKINS, type SkinFace } from "@/lib/theme/skins";

/** The same three layers Backdrop paints, at thumbnail scale. */
function swatchStyle(face: SkinFace, accent: string): React.CSSProperties {
  const layers = [
    `radial-gradient(120% 120% at 88% 0%, ${accent}, transparent 62%)`,
    face.image ? `url('${face.image}')` : null,
    face.ground,
  ].filter(Boolean) as string[];
  return {
    background: layers.join(", "),
    backgroundSize: "cover",
    backgroundPosition: "center",
  };
}

export default function SkinMenu({ systemId, accent }: { systemId: string; accent: string }) {
  const { resolved } = useTheme();
  const { skinId, setSkin } = useSkin(systemId);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Outside click and Escape. Both, because a menu that only closes one way is
  // the kind of thing that traps somebody mid-demo.
  useEffect(() => {
    if (!open) return;
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
  }, [open]);

  const face = (id: string): SkinFace => {
    const s = SKINS.find((x) => x.id === id) ?? SKINS[0];
    return resolved === "dark" ? s.dark : s.light;
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Background"
        className="panel flex h-10 items-center gap-2 rounded-2xl px-2.5 text-[color:var(--ink-muted)] transition-colors hover:text-[color:var(--ink)]"
      >
        <span
          aria-hidden
          className="h-5 w-5 shrink-0 rounded-md ring-1 ring-[color:var(--ink)]/15"
          style={swatchStyle(face(skinId), accent)}
        />
        <Images className="h-3.5 w-3.5" />
        <span className="sr-only">Change the background</span>
      </button>

      {open && (
        <div
          role="menu"
          className="panel absolute right-0 top-12 z-50 w-64 overflow-hidden rounded-2xl p-1.5"
        >
          <p className="t-label px-2.5 pb-1.5 pt-1">Background</p>
          {SKINS.map((s) => {
            const on = s.id === skinId;
            return (
              <button
                key={s.id}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                onClick={() => {
                  setSkin(s.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors ${
                  on ? "bg-[color:var(--ink)]/[0.07]" : "hover:bg-[color:var(--ink)]/[0.045]"
                }`}
              >
                <span
                  aria-hidden
                  className="h-9 w-12 shrink-0 rounded-lg ring-1 ring-[color:var(--ink)]/12"
                  style={swatchStyle(face(s.id), accent)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-[color:var(--ink)]">{s.name}</span>
                  <span className="block truncate text-[10.5px] text-[color:var(--ink-faint)]">{s.blurb}</span>
                </span>
                {on && <Check className="h-3.5 w-3.5 shrink-0" style={{ color: accent }} />}
              </button>
            );
          })}
          {/* Where the next one comes from. An admin who has just been told they
              can add themes should not have to be told twice where. */}
          <p className="px-2.5 pb-1 pt-2 text-[10px] leading-snug text-[color:var(--ink-faint)]">
            Add your own in <code className="font-mono">public/themes/</code> — a light and a dark file each.
          </p>
        </div>
      )}
    </div>
  );
}
