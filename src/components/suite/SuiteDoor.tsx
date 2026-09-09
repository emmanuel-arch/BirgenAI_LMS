// ─────────────────────────────────────────────────────────────────────────────
// A SYSTEM'S FRONT DOOR.
//
// One component, seven systems, seven plates. The card is identical everywhere —
// same geometry, same type, same controls — and the ONLY things that change are
// the artwork, the accent and the name. That is the suite's whole design
// argument stated at the moment of arrival: these are separate products, and
// they are obviously the same family.
//
// ── THE SPLIT, AND WHY THE OLD LAYOUT HAD TO GO ──────────────────────────────
// This page used to be a sign-in card floating in the top-left corner of a
// full-bleed photograph. The founder marked it up with two enormous question
// marks drawn across the middle of the screen, and they were the right question:
// two thirds of the widest surface in the product was doing nothing at all,
// on the first screen anybody sees of a system they are being sold.
//
// The layout is now the one BirgenAI's own front door uses (see
// BirgenAI/birgen-ai-frontend/src/app/login/page.tsx and its right-panel
// component), because it is the correct answer to exactly this problem:
//
//   LEFT   does the WORK. The lockup, the form, the legal line. It sits on the
//          theme's own paper and it is the half that exists on a phone.
//   RIGHT  does the ARGUING. The system's plate, its mark, its name, a line
//          that changes and the list of what is inside it. It is `hidden md:flex`
//          — on a handset the door is the form and nothing else, which is right,
//          because a phone-sized version of a persuasion panel is a phone-sized
//          version of an advertisement.
//
// ── WHAT THE THEME DOES AND DOES NOT TOUCH ───────────────────────────────────
// The left half is fully themed: /suite is a staff route (see the STAFF_ROUTE
// regex in lib/theme/useTheme), so a person who has set the suite to light gets
// a light door, and this page was the last dark-only surface in the staff realm.
// The right half stays dark in both — the reasoning is in SuiteDoorPanel, and it
// comes down to the plate being a picture rather than a surface.
//
// ── SSO IS THE POINT, AND IT IS NOT THE ONLY DOOR ────────────────────────────
// When a BirgenAI ID session already exists there is no password to type — one
// button carrying the person's own first name, and they are through. That is
// what makes "a front door per system, one identity" a demonstration rather than
// a claim.
//
// But it is NOT the only state. Somebody who was simply sent
// connectdesk.servicesuitecloud.com — the collections supervisor who has never
// opened the lending console — arrives with no session, and bouncing them to a
// generic /login that has forgotten which system they asked for is how a suite
// of products comes to feel like one product wearing several names. They get the
// real email-and-password form, on this system's own plate, in this system's own
// colour, and it lands them in THIS system rather than on the launcher. See
// SuiteDoorForm, which holds both states and posts to the one credential check
// this application has.
// ─────────────────────────────────────────────────────────────────────────────

import { Fragment } from "react";
import Link from "next/link";
import type { Artwork } from "@/lib/suite/artwork";
import type { SuiteApp } from "@/lib/suite/apps";
import type { ResolvedSuiteApp } from "@/lib/suite/hosts";
import SuiteDoorForm from "./SuiteDoorForm";
import SuiteDoorPanel from "./SuiteDoorPanel";
import SystemSwitch from "./SystemSwitch";

/**
 * A heading that arrives one word at a time, out of focus.
 *
 * Kept to exactly one element on the page. The temptation with an effect this
 * cheap is to put it on the subtitle too, and then on the card; at that point
 * the door has a loading animation rather than a moment of arrival.
 *
 * It is CSS, not a client component. The whole point of this heading is that it
 * is legible from the server-rendered HTML before any JavaScript arrives, and a
 * word-splitting effect that needed React to run would have thrown that away for
 * a flourish.
 */
function Arriving({ text, className }: { text: string; className?: string }) {
  const words = text.split(" ");
  return (
    <h1 className={className}>
      {words.map((word, i) => (
        // ── THE SPACE GOES BETWEEN THE SPANS, NOT INSIDE ONE ────────────────
        // `.suite-word-in` is `display: inline-block`, and CSS removes a
        // trailing space at the end of an inline-block's content. Putting the
        // separator inside the span therefore rendered the heading as
        // "Signin." — the largest type on the door, with a word join in it, on
        // the first screen anybody sees of the product. A text node BETWEEN two
        // inline-blocks is a real space and still breaks normally.
        <Fragment key={`${word}-${i}`}>
          <span className="suite-word-in" style={{ animationDelay: `${0.18 + i * 0.07}s` }}>
            {word}
          </span>
          {i < words.length - 1 ? " " : null}
        </Fragment>
      ))}
    </h1>
  );
}

export default function SuiteDoor({
  app, art, who, firstName, orgName, orgSlug, logoUrl, continueHref, hasArtwork, hosts,
}: {
  app: Pick<SuiteApp, "id" | "name" | "tagline" | "accent" | "modules"> & {
    icon: SuiteApp["icon"];
    purpose?: string;
    handoff?: string;
  };
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

  // ── WHAT THE PLATE SAYS WHILE SOMEBODY IS TYPING ───────────────────────────
  // Assembled from the registry rather than written here, so a system whose
  // purpose changes changes on its own door. The last line is the only one that
  // is about the SUITE rather than this system, and it earns its place: it is
  // the answer to "why am I being asked to sign in to a fourth thing", which is
  // the actual question in the head of somebody who has just been sent this
  // link.
  const lines = [
    app.tagline,
    app.purpose,
    app.handoff,
    "Your existing sign-in opens this. One identity across every system your lender holds.",
  ].filter((l): l is string => Boolean(l));

  return (
    <main className="grid min-h-dvh grid-cols-1 md:grid-cols-2">
      {/* ── LEFT: the work ─────────────────────────────────────────────────── */}
      <div className="relative flex min-h-dvh flex-col bg-[color:var(--studio)] px-5 py-5 sm:px-8 md:min-h-0">
        {/* A wash of the system's own colour, so even the plain half of the
            door is unmistakably ITS door. Held very low — this is the half with
            a form on it, and the form is the only thing that may be read. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{ background: `radial-gradient(900px 620px at 12% -10%, ${app.accent}1f 0%, transparent 60%)` }}
        />

        {/* ── The corner bar ──────────────────────────────────────────────
            WHERE you are on the left, WHERE ELSE you could be on the right. The
            switcher replaces the paragraph that used to sit in the bottom-right
            corner of this page and hard-code "All six systems" onto a screen
            served to lenders who bought four. */}
        <header className="relative z-10 flex shrink-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {logoUrl ? (
              <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white p-1 shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logoUrl} alt={orgName ?? "logo"} className="max-h-full max-w-full object-contain" />
              </span>
            ) : (
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-[color:var(--panel-border)]"
                style={{ backgroundColor: `${app.accent}24`, color: app.accent }}
              >
                <Icon className="h-5 w-5" />
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-[15px] font-bold leading-tight text-[color:var(--ink)]">{app.name}</p>
              {orgName && <p className="truncate text-[11.5px] text-[color:var(--ink-faint)]">{orgName}</p>}
            </div>
          </div>

          <SystemSwitch currentId={app.id} hosts={hosts} />
        </header>

        {/* ── The card ─────────────────────────────────────────────────── */}
        <div className="relative z-10 flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[400px]">
            <Arriving
              text={who ? "Welcome back." : "Sign in."}
              className="text-[30px] font-bold leading-[1.1] tracking-[-0.024em] text-[color:var(--ink)]"
            />
            {/* The tagline, not the stat line. What was here before was a
                sentence of live-sounding numbers — "93,000 cases, 26 agents" —
                which is a claim a sign-in page cannot stand behind: they were
                typed into a registry months ago and nothing re-reads them. The
                numbers belong on the launcher, where they are actually read from
                the server on render. */}
            <p className="mt-2.5 max-w-[34ch] text-[13px] leading-relaxed text-[color:var(--ink-muted)]">
              {app.tagline}
            </p>

            {/* The sign-in half is a client island — see SuiteDoorForm. The
                lockup above it stays server-rendered, so the door is legible
                from the HTML alone before any JavaScript arrives. */}
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
                className="mt-3 block text-center text-[11px] text-[color:var(--ink-faint)] transition-colors hover:text-[color:var(--ink-body)]"
              >
                Sign out entirely
              </Link>
            )}
          </div>
        </div>

        {/* The legal line. It belongs at the foot of the half that carries the
            form, which is also the only half that exists on a phone. */}
        <footer className="relative z-10 shrink-0 pb-1 pt-3">
          <p className="mx-auto max-w-[42ch] text-center text-[10.5px] leading-relaxed text-[color:var(--ink-faint)]">
            Staff access is monitored and logged. Signing in confirms you are authorised to use
            this system on behalf of {orgName ?? "your organisation"}.
          </p>
        </footer>
      </div>

      {/* ── RIGHT: the argument ────────────────────────────────────────────── */}
      <SuiteDoorPanel
        name={app.name}
        accent={app.accent}
        icon={<Icon className="h-9 w-9" />}
        lines={lines}
        modules={app.modules}
        artFile={art.file}
        gradient={art.gradient}
        hasArtwork={hasArtwork}
      />
    </main>
  );
}
