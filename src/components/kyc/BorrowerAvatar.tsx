"use client";

// The face beside the name — and, when there isn't one, an honest stand-in.
//
// Three states, and the middle one is the one that carries the product:
//
//   VERIFIED, with a portrait  → their face, in a ring of the lender's own colour,
//     with a tick. This is the customer the officer is looking for.
//   VERIFIED, no portrait yet  → initials, same ring, same tick. (Object storage in
//     simulation: the row is real, the bytes were never written. Common, and not a
//     bug to hide.)
//   NOT VERIFIED               → initials in a muted, DASHED ring. Nothing is red and
//     nothing shouts; it just looks unfinished, because it is. The dash is doing the
//     work an "UNVERIFIED" label would do, without stealing a row's worth of attention
//     in a list of fifty.
//
// The ring is the brand frame the founder asked for: it makes a face and a set of
// initials the same shape and the same weight, so a list doesn't go ragged when half
// the customers have photographs and half don't.
import { useState } from "react";
import { Check } from "lucide-react";

export type AvatarSize = "sm" | "md" | "lg" | "xl";

// xl is the Customer-360 hero portrait — double lg, because the face IS the page.
const BOX: Record<AvatarSize, string> = { sm: "h-10 w-10", md: "h-12 w-12", lg: "h-16 w-16", xl: "h-32 w-32" };
const RADIUS: Record<AvatarSize, string> = { sm: "rounded-xl", md: "rounded-2xl", lg: "rounded-2xl", xl: "rounded-3xl" };
const TEXT: Record<AvatarSize, string> = { sm: "text-sm", md: "text-base", lg: "text-xl", xl: "text-4xl" };
const TICK: Record<AvatarSize, string> = { sm: "h-3.5 w-3.5 -bottom-0.5 -right-0.5", md: "h-4 w-4 -bottom-1 -right-1", lg: "h-5 w-5 -bottom-1 -right-1", xl: "h-7 w-7 -bottom-1 -right-1" };
const PAD: Record<AvatarSize, string> = { sm: "p-[2px]", md: "p-[2.5px]", lg: "p-[3px]", xl: "p-[4px]" };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function BorrowerAvatar({
  name,
  portraitUrl,
  verified = false,
  size = "sm",
  className = "",
}: {
  name: string;
  portraitUrl?: string | null;
  verified?: boolean;
  size?: AvatarSize;
  className?: string;
}) {
  // A signed URL outlives the page it was minted for by ten minutes and no longer.
  // When it lapses, fall back to initials rather than leaving a broken-image glyph.
  const [broken, setBroken] = useState(false);
  const showPhoto = Boolean(portraitUrl) && !broken;

  return (
    <div className={`relative shrink-0 ${className}`}>
      <div
        className={`${BOX[size]} ${RADIUS[size]} ${PAD[size]} ${verified ? "" : "border border-dashed border-zinc-900/20"}`}
        style={verified ? { background: "linear-gradient(140deg, var(--brand), var(--brand-soft))" } : undefined}
      >
        <div className={`flex h-full w-full items-center justify-center overflow-hidden ${RADIUS[size]} ${showPhoto ? "bg-white" : ""}`}
          style={showPhoto ? undefined : verified ? { backgroundColor: "var(--brand)" } : { backgroundColor: "rgba(24,24,27,0.05)" }}
        >
          {showPhoto ? (
            // A short-lived signed URL from a private bucket — next/image would want a
            // remotePatterns entry per project and would cache what is deliberately
            // ephemeral.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={portraitUrl!}
              alt={name}
              onError={() => setBroken(true)}
              className={`h-full w-full object-cover ${RADIUS[size]}`}
            />
          ) : (
            <span className={`${TEXT[size]} font-bold ${verified ? "text-white" : "text-zinc-500"}`}>{initials(name)}</span>
          )}
        </div>
      </div>

      {verified && (
        <span
          className={`absolute ${TICK[size]} flex items-center justify-center rounded-full bg-emerald-500 text-white ring-2 ring-white`}
          title="Identity verified"
        >
          <Check className={size === "xl" ? "h-4 w-4" : "h-2.5 w-2.5"} strokeWidth={4} />
        </span>
      )}
    </div>
  );
}
