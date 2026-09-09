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
import { useEffect, useState } from "react";
import { useTheme } from "@/lib/theme/useTheme";
import { useSkin } from "@/lib/theme/useSkin";
import { metaFor } from "@/lib/theme/media.generated";

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
  const meta = metaFor(face.image);

  // ── WHY THE PICTURE IS NOT PAINTED UNTIL IT HAS DECODED ────────────────────
  // A background-image that appears the moment its bytes land hands the
  // compositor a partly-decoded 2560px photograph to scale across the whole
  // viewport — a visible hitch, on the largest and calmest layer on screen, at
  // the exact moment a system is opening. Decoding first costs nothing that
  // anybody waits for, because the LQIP below is already standing in.
  //
  // The state is WHICH picture has decoded, not whether one has. Storing a
  // boolean forces a `setLoaded(false)` at the top of the effect to reset it
  // when the skin changes — a synchronous setState in an effect body, which is a
  // cascading render and which React's own lint rejects. Deriving `loaded` by
  // comparison resets it for free: the moment `face.image` changes, the stored
  // src no longer matches and the blur is showing again, in the same render
  // rather than one after it.
  const [decoded, setDecoded] = useState<string | null>(null);
  const loaded = decoded !== null && decoded === face.image;
  useEffect(() => {
    const src = face.image;
    if (!src) return;
    let live = true;
    const im = new Image();
    im.src = src;
    im.decode?.().then(
      () => live && setDecoded(src),
      // A decode failure is not worth surfacing: the ground and the accent wash
      // are already a finished-looking floor. That is the whole promise this
      // file makes about a skin whose artwork has not been delivered.
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [face.image]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0" style={{ background: face.ground }}>
      {/* The blur. A ~20px WebP inlined at build time, so it is not a request
          and cannot be late — the floor is never a flat rectangle waiting for a
          photograph. */}
      {meta && (
        <div
          className="absolute inset-0 bg-cover bg-center transition-opacity duration-500"
          style={{
            backgroundImage: `url('${meta.lqip}')`,
            opacity: loaded ? 0 : face.opacity,
            filter: "blur(28px)",
            transform: "scale(1.06)",
          }}
        />
      )}
      {face.image && (
        <div
          className="absolute inset-0 bg-cover bg-center transition-opacity duration-700"
          style={{ backgroundImage: `url('${face.image}')`, opacity: loaded ? face.opacity : 0 }}
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
