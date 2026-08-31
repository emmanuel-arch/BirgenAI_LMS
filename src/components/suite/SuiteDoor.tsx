// ─────────────────────────────────────────────────────────────────────────────
// A SYSTEM'S FRONT DOOR.
//
// One component, six systems, six artworks. The card is identical everywhere —
// same geometry, same type, same controls — and the ONLY things that change are
// the artwork behind it, the accent, and the name. That is the suite's whole
// design argument stated at the moment of arrival: these are separate products,
// and they are obviously the same family.
//
// ── WHAT CAME OFF THIS PAGE, AND WHY ─────────────────────────────────────────
// Three things were struck off the marked-up screenshot, and each was there for
// a reason that had stopped being true:
//
//   · "Signed in as Birgen Krosovic with BirgenAI ID." A green banner announcing
//     the session, sitting directly above a button that already says "Continue
//     as Birgen". The same fact, twice, in two sentences, one of them naming an
//     internal product a lender has no reason to know. The button carries it.
//     (See SuiteDoorForm — the banner is gone from there, not hidden here.)
//
//   · The module chips — "Live floor · Work queue · Promises · Recoveries". A
//     feature list under a password field. Nobody reads a menu of screens they
//     cannot open yet, and it pushed the sign-out link below the fold on a
//     phone.
//
//   · "THE CONNECTED SUITE / <mood copy> / All six systems →" in the far corner.
//     It hard-coded a count onto a page served to lenders who bought four; it
//     put prose where a control belonged; and it sat bottom-right, which on a
//     handset is underneath everything. It is now a real system switcher in the
//     TOP RIGHT — see SystemSwitch.
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
// than a claim.
//
// But it is NOT the only state. Somebody who was simply sent
// connectdesk.servicesuitecloud.com — the collections supervisor who has never
// opened the lending console — arrives here with no session, and bouncing them
// to a generic /login that has forgotten which system they asked for is how a
// suite of products comes to feel like one product wearing several names. They
// get the real email-and-password form, on this system's own artwork, in this
// system's own colour. See SuiteDoorForm, which holds both states.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import type { Artwork } from "@/lib/suite/artwork";
import type { SuiteApp } from "@/lib/suite/apps";
import type { ResolvedSuiteApp } from "@/lib/suite/hosts";
import SuiteDoorForm from "./SuiteDoorForm";
import SystemSwitch from "./SystemSwitch";

/**
 * A heading that arrives one word at a time, out of focus.
 *
 * Lifted from the pattern the reference library uses for its testimonial copy,
 * and kept to exactly one element on the page. The temptation with an effect
 * this cheap is to put it on the subtitle too, and then on the card; at that
 * point the door has a loading animation rather than a moment of arrival.
 *
 * It is CSS, not a client component. The whole point of this heading is that it
 * is legible from the server-rendered HTML before any JavaScript arrives, and a
 * word-splitting effect that needs React to run would have thrown that away for
 * a flourish.
 */
function Arriving({ text, className }: { text: string; className?: string }) {
  return (
    <h1 className={className}>
      {text.split(" ").map((word, i) => (
        <span key={`${word}-${i}`} className="suite-word-in" style={{ animationDelay: `${0.18 + i * 0.07}s` }}>
          {word}
          {i < text.split(" ").length - 1 ? " " : ""}
        </span>
      ))}
    </h1>
  );
}

export default function SuiteDoor({
  app, art, who, firstName, orgName, orgSlug, logoUrl, continueHref, hasArtwork, hosts,
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
  /** Every system's door, for the switcher in the corner. */
  hosts: ResolvedSuiteApp[];
}) {
  const Icon = app.icon;

  return (
    <main className="relative min-h-screen overflow-hidden px-5 py-5 sm:px-8">
      {/* ── The artwork, or the gradient standing in for it ─────────────── */}
      {/* `suite-drift` is a very slow parallax — 34 seconds for two percent of
          travel. It is what stops a static photograph reading as a screenshot
          of a sign-in page, and it is slow enough that nobody watching a demo
          ever consciously notices it move. */}
      <div
        aria-hidden
        className="suite-drift absolute inset-0 z-0 bg-cover bg-center"
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
      {/* The raking light. It drifts in once, over two seconds, and then stops —
          a sign-in page that keeps moving is a sign-in page people mistrust. */}
      <div
        aria-hidden
        className="suite-spotlight pointer-events-none absolute left-[62%] top-0 z-[2] h-[130%] w-[80%] rounded-full blur-[130px]"
        style={{ background: `radial-gradient(closest-side, ${app.accent}3d, transparent)` }}
      />

      <div className="relative z-10 flex min-h-[calc(100vh-2.5rem)] flex-col">
        {/* ── The corner bar ──────────────────────────────────────────────
            WHERE you are on the left, WHERE ELSE you could be on the right.
            The switcher replaces the paragraph that used to sit in the
            bottom-right corner of this page. */}
        <header className="flex shrink-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {logoUrl ? (
              <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white p-1 shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logoUrl} alt={orgName ?? "logo"} className="max-h-full max-w-full object-contain" />
              </span>
            ) : (
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-white/15"
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

          <SystemSwitch currentId={app.id} hosts={hosts} />
        </header>

        {/* ── The card ─────────────────────────────────────────────────── */}
        <div className="flex flex-1 items-center py-8">
          <div className="w-full max-w-[400px]">
            <Arriving
              text={who ? "Welcome back." : "Sign in."}
              className="text-[30px] font-bold leading-[1.1] tracking-[-0.024em] text-white"
            />
            {/* The tagline, not the stat line. What was here before was a
                sentence of live-sounding numbers — "93,000 cases, 26 agents" —
                which is a claim a sign-in page cannot stand behind: they were
                typed into a registry months ago and nothing re-reads them. The
                numbers belong on the launcher, where they are actually read
                from the server on render. */}
            <p className="mt-2.5 max-w-[34ch] text-[13px] leading-relaxed text-white/55">{app.tagline}</p>

            {/* The sign-in half is a client island — see SuiteDoorForm. The
                artwork, the scrim and the lockup above stay server-rendered, so
                the door is legible from the HTML alone before any JavaScript
                arrives. */}
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
                Sign out entirely
              </Link>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
