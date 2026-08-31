"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE FLOOR.
//
// One component, six systems, both themes. Every wallpaper in the suite is
// painted here and nowhere else, which is the fix for the bug that produced the
// dark-mode screenshot: a background-image utility naming white-background.png
// was written as a class in three different shells, so the dark theme flipped
// every token and every surface and then painted a photograph of pale grey waves
// across the whole viewport behind them. A hard-coded string cannot have a
// second value.
//
// (And the utility is not even NAMED in these comments as it would be written in
// a className — Tailwind v4 scans source text for candidates, so quoting one in
// prose generates real CSS for it. Doing that here once cost a build.)
//
// ── THE THREE LAYERS, AND WHY THERE ARE THREE ────────────────────────────────
//   1. GROUND — a flat colour. It is what the picture is composited onto, so it
//      decides whether this floor is light or dark. Never transparent: if the
//      image 404s or has not been delivered yet, this is the finished-looking
//      surface that is left, rather than the browser's white.
//   2. PICTURE — the skin's photograph at the skin's opacity. Fixed, so it stays
//      still while the page scrolls; that is what makes it read as the surface
//      the product is printed on rather than a very tall image.
//   3. WASH — two radial bleeds of THIS SYSTEM'S accent from opposite corners.
//      The accent belongs to the system and the picture belongs to the theme, so
//      one shared photograph gives six distinctly-coloured floors that cannot
//      drift out of sync with the colour code, because there is nothing to keep
//      in sync.
//
// It is `fixed inset-0 z-0` and `pointer-events-none`. Everything else in the
// shell is a positioned sibling above it.
// ─────────────────────────────────────────────────────────────────────────────
import { useTheme } from "@/lib/theme/useTheme";
import { useSkin } from "@/lib/theme/useSkin";

export default function Backdrop({
  systemId,
  accent,
  accent2,
}: {
  /** Which system's floor this is — picks up that system's remembered skin. */
  systemId: string;
  accent: string;
  accent2?: string;
}) {
  const { resolved } = useTheme();
  const { skin } = useSkin(systemId);
  const face = resolved === "dark" ? skin.dark : skin.light;
  const b = accent2 ?? accent;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0" style={{ background: face.ground }}>
      {face.image && (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url('${face.image}')`, opacity: face.opacity }}
        />
      )}
      <div
        className="absolute inset-0"
        style={{
          opacity: face.wash,
          background: `radial-gradient(1100px 720px at 88% -6%, ${accent} 0%, transparent 62%),
                       radial-gradient(880px 620px at 4% 104%, ${b} 0%, transparent 58%)`,
        }}
      />
    </div>
  );
}
