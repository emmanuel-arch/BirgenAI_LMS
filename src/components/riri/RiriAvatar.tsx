// ─────────────────────────────────────────────────────────────────────────────
// Riri — the face of BirgenAI's lending intelligence.
//
// A hand-built SVG portrait (no raster asset to ship or theme). Her facial
// palette is FIXED so she reads as the same person on every white-label org;
// only her top picks up the org `--brand`, and the surrounding launcher adds the
// brand halo. She breathes and blinks (pure CSS, see globals.css) so the
// assistant feels alive rather than like a static icon.
//
// Coordinates are mirrored around x=48 for a symmetric, intentional face.
// ─────────────────────────────────────────────────────────────────────────────
"use client";

import { useId } from "react";

export type RiriState = "idle" | "listening" | "thinking";

export function RiriAvatar({
  size = 44,
  state = "idle",
  className = "",
  animated = true,
}: {
  size?: number;
  state?: RiriState;
  className?: string;
  animated?: boolean;
}) {
  // Unique gradient ids per instance — several avatars can share a page, and
  // duplicate SVG ids would let one instance's fill reference another's defs.
  const uid = "riri" + useId().replace(/:/g, "");
  const headClass = animated ? `riri-breathe${state === "thinking" ? " riri-thinking" : ""}` : "";
  const eyeClass = animated ? "riri-eye" : "";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      className={className}
      role="img"
      aria-label="Riri"
    >
      <defs>
        <radialGradient id={`${uid}-bg`} cx="42%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#FBEAD9" />
          <stop offset="100%" stopColor="#EAC3A0" />
        </radialGradient>
        <linearGradient id={`${uid}-skin`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#C89163" />
          <stop offset="100%" stopColor="#9E6A40" />
        </linearGradient>
        <linearGradient id={`${uid}-hair`} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor="#3A2718" />
          <stop offset="100%" stopColor="#1C120A" />
        </linearGradient>
        <linearGradient id={`${uid}-garment`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--brand, #F97316)" />
          <stop offset="100%" stopColor="var(--brand, #F97316)" stopOpacity="0.82" />
        </linearGradient>
        <clipPath id={`${uid}-disc`}>
          <circle cx="48" cy="48" r="48" />
        </clipPath>
      </defs>

      <g clipPath={`url(#${uid}-disc)`}>
        {/* Portrait medallion background */}
        <rect x="0" y="0" width="96" height="96" fill={`url(#${uid}-bg)`} />

        {/* Shoulders / garment (picks up the org brand) */}
        <path d="M16,96 C16,78 31,72 48,72 C65,72 80,78 80,96 Z" fill={`url(#${uid}-garment)`} />
        <path d="M40,73 Q48,78 56,73 L56,96 L40,96 Z" fill="#ffffff" opacity="0.10" />

        {/* Head assembly — breathes as one unit */}
        <g className={headClass}>
          {/* Hair behind the head, shoulder-length, framing the face */}
          <path
            d="M48,14 C33,14 23,26 23,44 C22,54 24,64 29,74 L37,72 C33,64 32,54 34,46 C36,34 41,28 48,28 C55,28 60,34 62,46 C64,54 63,64 59,72 L67,74 C72,64 74,54 73,44 C73,26 63,14 48,14 Z"
            fill={`url(#${uid}-hair)`}
          />

          {/* Neck */}
          <path d="M43,60 L53,60 L52,72 Q48,75 44,72 Z" fill="#9E6A40" />

          {/* Face */}
          <ellipse cx="48" cy="47" rx="16" ry="19" fill={`url(#${uid}-skin)`} />

          {/* Ears + earrings */}
          <ellipse cx="32.5" cy="48" rx="3" ry="4" fill="#A87249" />
          <ellipse cx="63.5" cy="48" rx="3" ry="4" fill="#A87249" />
          <circle cx="32.5" cy="53" r="1.4" fill="#E7B44B" />
          <circle cx="63.5" cy="53" r="1.4" fill="#E7B44B" />

          {/* Cheek blush — a whisper of the org brand */}
          <ellipse cx="39" cy="52" rx="3" ry="1.8" fill="var(--brand, #F97316)" opacity="0.13" />
          <ellipse cx="57" cy="52" rx="3" ry="1.8" fill="var(--brand, #F97316)" opacity="0.13" />

          {/* Brows */}
          <path d="M39,42 Q43,39.4 47,41.6" stroke="#20140B" strokeWidth="1.6" strokeLinecap="round" fill="none" />
          <path d="M49,41.6 Q53,39.4 57,42" stroke="#20140B" strokeWidth="1.6" strokeLinecap="round" fill="none" />

          {/* Eyes — the moving parts blink; the lid arc stays put for depth */}
          <g>
            <g className={eyeClass}>
              <ellipse cx="42" cy="46" rx="3.4" ry="2.5" fill="#FBF7F2" />
              <circle cx="42.4" cy="46" r="2.2" fill="#4A2E1C" />
              <circle cx="42.4" cy="46" r="1.0" fill="#160C06" />
              <circle cx="41.5" cy="45.2" r="0.7" fill="#ffffff" />
            </g>
            <path d="M38.4,45.4 Q42,42.7 45.6,45.4" stroke="#7A4E2E" strokeWidth="0.9" strokeLinecap="round" fill="none" />
          </g>
          <g>
            <g className={eyeClass}>
              <ellipse cx="54" cy="46" rx="3.4" ry="2.5" fill="#FBF7F2" />
              <circle cx="54.4" cy="46" r="2.2" fill="#4A2E1C" />
              <circle cx="54.4" cy="46" r="1.0" fill="#160C06" />
              <circle cx="53.5" cy="45.2" r="0.7" fill="#ffffff" />
            </g>
            <path d="M50.4,45.4 Q54,42.7 57.6,45.4" stroke="#7A4E2E" strokeWidth="0.9" strokeLinecap="round" fill="none" />
          </g>

          {/* Nose */}
          <path d="M48,47 L46.6,52.4 Q48,53.5 49.4,52.4" stroke="#8A5A36" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.75" />

          {/* Lips — a gentle, confident smile */}
          <path d="M43.5,58 Q46,56.5 48,57.1 Q50,56.5 52.5,58 Q48,58.6 43.5,58 Z" fill="#9E3F38" />
          <path d="M43.5,58 Q48,62 52.5,58 Q48,59.5 43.5,58 Z" fill="#C15A50" />
          <path d="M43.5,58 Q48,59 52.5,58" stroke="#822F2A" strokeWidth="0.6" strokeLinecap="round" fill="none" />

          {/* Side-swept fringe over the hairline */}
          <path d="M34,46 C36,35 41,29 48,29 C55,29 60,35 62,46 C58,38 53,36 48,37 C43,38 38,41 34,46 Z" fill={`url(#${uid}-hair)`} />
          <path d="M45,30 C40,32 36,37 34.6,44" stroke="#4A3220" strokeWidth="1" strokeLinecap="round" fill="none" opacity="0.6" />
        </g>
      </g>
    </svg>
  );
}
