// ─────────────────────────────────────────────────────────────────────────────
// A SYSTEM'S FRONT DOOR.
//
// One component, six systems, six artworks. The card is identical everywhere —
// same geometry, same type, same controls — and the ONLY things that change are
// the artwork behind it, the accent, and the name. That is the suite's whole
// design argument stated at the moment of arrival: these are separate products,
// and they are obviously the same family.
//
// ── THE SCRIM IS NOT DECORATION ──────────────────────────────────────────────
// The artwork is a photograph. Its contrast in the top-left corner is whatever
// the generator decided that day, and the sign-in card has to be legible on it
// regardless. So the card never sits on the image: it sits on a scrim over the
// image, and the scrim is a known quantity. Same rule as the console canvas.
//
// ── SSO IS THE POINT, AND IT IS NOT THE ONLY DOOR ────────────────────────────
// When a BirgenAI ID session already exists there is no password to type — one
// button carrying the person's own first name, and they are through. That is
// what makes "a front door per system, one identity" a demonstration rather
// than a claim, and it is why the signed-in state is the larger of the two.
//
// But it is NOT the only state, and treating it as one was the flaw in the
// first version of this page. Somebody who was simply sent
// connectdesk.servicesuitecloud.com — the collections supervisor who has never
// opened the lending console — arrives here with no session, and bouncing them
// to a generic /login that has forgotten which system they asked for is how a
// suite of products comes to feel like one product wearing several names. They
// get the real email-and-password form, on this system's own artwork, in this
// system's own colour. See SuiteDoorForm, which holds both states.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Artwork } from "@/lib/suite/artwork";
import type { SuiteApp } from "@/lib/suite/apps";
import SuiteDoorForm from "./SuiteDoorForm";

export default function SuiteDoor({
  app, art, who, firstName, orgName, orgSlug, logoUrl, continueHref, hasArtwork,
}: {
  app: Pick<SuiteApp, "id" | "name" | "tagline" | "accent" | "modules"> & { icon: SuiteApp["icon"] };
  art: Artwork;
  /** Signed-in person, or null. */
  who: string | null;
  /** Their first name — what the SSO button says. Null when nobody is signed in. */
  firstName: string | null;
  orgName: string | null;
  /** Pins a sign-in to one lender when the door was reached through their host. */
  orgSlug: string | null;
  logoUrl: string | null;
  continueHref: string;
  /** Has the artwork file actually been generated yet? */
  hasArtwork: boolean;
}) {
  const Icon = app.icon;

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden px-5 py-10">
      {/* ── The artwork, or the gradient standing in for it ─────────────── */}
      <div
        aria-hidden
        className="absolute inset-0 z-0 bg-cover bg-center"
        style={hasArtwork ? { backgroundImage: `url('${art.file}')` } : { background: art.gradient }}
      />
      {/* The scrim. Darker on the left, where the card lives. */}
      <div
        aria-hidden
        className="absolute inset-0 z-[1]"
        style={{ background: "linear-gradient(100deg, rgba(9,8,13,0.94) 0%, rgba(9,8,13,0.82) 34%, rgba(9,8,13,0.42) 66%, rgba(9,8,13,0.30) 100%)" }}
      />
      {/* A wash of the system's own colour, so the door is unmistakably its own. */}
      <div
        aria-hidden
        className="absolute inset-0 z-[2] opacity-70"
        style={{ background: `radial-gradient(900px 620px at 88% 14%, ${app.accent}30 0%, transparent 62%)` }}
      />

      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col items-start gap-8 lg:flex-row lg:items-center lg:justify-between">
        {/* ── The card ─────────────────────────────────────────────────── */}
        <div className="w-full max-w-[380px]">
          <div className="flex items-center gap-3">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl bg-paper p-1 shadow-sm">
                <img src={logoUrl} alt={orgName ?? "logo"} className="max-h-full max-w-full object-contain" />
              </span>
            ) : (
              <span
                className="flex h-11 w-11 items-center justify-center rounded-xl ring-1 ring-white/15"
                style={{ backgroundColor: `${app.accent}2e`, color: app.accent }}
              >
                <Icon className="h-5 w-5" />
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-[15px] font-bold leading-tight text-white">{app.name}</p>
              {orgName && <p className="truncate text-[11.5px] text-white/45">{orgName}</p>}
            </div>
          </div>

          <h1 className="mt-6 text-[27px] font-bold leading-[1.12] tracking-[-0.022em] text-white">
            {who ? "Welcome back." : "Sign in."}
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-white/55">{app.tagline}</p>

          {/* The sign-in half is a client island — see SuiteDoorForm. The artwork,
              the scrim and the lockup above stay server-rendered, so the door is
              legible from the HTML alone before any JavaScript arrives. */}
          <div className="mt-6">
            <SuiteDoorForm
              systemName={app.name}
              accent={app.accent}
              continueHref={continueHref}
              who={who}
              firstName={firstName}
              orgSlug={orgSlug}
            />
          </div>

          {who && (
            <Link
              href="/api/auth/logout"
              className="mt-3 block text-center text-[11px] text-white/35 transition-colors hover:text-white/70"
            >
              Sign out of BirgenAI ID entirely
            </Link>
          )}

          <div className="mt-4 flex flex-wrap gap-1.5">
            {app.modules.map((m) => (
              <span key={m} className="rounded-md bg-paper/[0.07] px-2 py-1 text-[10px] font-medium text-white/45">
                {m}
              </span>
            ))}
          </div>
        </div>

        {/* ── The mark, on the artwork side ────────────────────────────── */}
        <div className="hidden max-w-[300px] lg:block">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: app.accent }}>
            The connected suite
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-white/45">{art.mood}</p>
          <Link href="/suite" className="mt-4 inline-flex items-center gap-1.5 text-[12px] font-semibold text-white/60 hover:text-white">
            All six systems <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </main>
  );
}
