// ─────────────────────────────────────────────────────────────────────────────
// THE STAFF DOOR — a lender's own photograph behind their sign-in card.
//
// ── WHY THIS IS KEYED BY LENDER AND NOT BY SYSTEM ────────────────────────────
// The artwork on a door is a picture of THAT LENDER'S OWN PEOPLE — Micromart's
// loan officer at her counter, Micromart's collections floor. That is what makes
// the door feel like the company's rather than like a software product's. It
// also makes the obvious shortcut wrong: one photograph per SYSTEM would put
// Micromart's staff behind Axe Capital's sign-in page, in Micromart's branded
// office, under Axe's logo. A lender seeing a competitor's premises on their own
// front door is not a small cosmetic bug.
//
// So the key is (org, system), and a lender with no photograph of their own gets
// the plain card on the ambient background — which is what every lender had
// until 19 Sep 2026 and is a perfectly good door. Missing artwork degrades to
// the previous design, never to a broken image and never to somebody else's
// office.
//
// ── WHERE THE CARD SITS, AND WHY IT IS PER-PHOTOGRAPH ────────────────────────
// The card is not centred and it is not flush right. It sits in a lane the
// photograph decides, because the subject of the photograph decides it: the card
// must cover the least important part of the frame and must not cover a face.
//
//   micromart · lms          the officer is at ~35% of the frame and the
//                            customer's back fills the right third. The card
//                            goes just right of centre, over the customer.
//   micromart · callcenter   the agent is at ~56% and a monitor fills the right
//                            quarter. The card goes further right, over the
//                            monitor, clear of her face.
//
// `lead` and `trail` are grid fractions either side of the card's column, so the
// lane holds its proportion at any window width instead of being a percentage
// that drifts as the card hits its min-width. Below `lg` none of it applies: the
// photograph goes behind a heavy scrim and the card centres, because a phone has
// no lane to put anything in.
// ─────────────────────────────────────────────────────────────────────────────

export type DoorArt = {
  /** Public path to the built derivative. See scripts/build-door-art.ts. */
  file: string;
  /**
   * CSS object-position for the photograph under `object-fit: cover`.
   *
   * Cover crops the long axis, and which end it crops decides whether the
   * subject survives. Tuned per photograph against the real frame rather than
   * left at `center`, which on the 2.5:1 counter shot pushes the officer toward
   * the card and cuts the branded wall behind her.
   */
  focal: string;
  /** Grid fraction to the LEFT of the card's column. */
  lead: number;
  /** Grid fraction to the RIGHT of it. */
  trail: number;
  /** Alt text. It describes the lender's room, so it is written per photograph. */
  alt: string;
  /** One line set over the photograph, under the lender's mark. */
  line: string;
};

const DOORS: Record<string, DoorArt> = {
  "micromart:lms": {
    file: "/images/doors/micromart/lms.webp",
    // Bias left: keeps the branded wall and the officer in frame on a window
    // narrower than the 2.5:1 source, and lets the crop eat the customer's side.
    focal: "32% 50%",
    lead: 1.25,
    trail: 0.62,
    alt: "A Micromart loan officer going through an application with a customer at her counter",
    line: "Flexible loans. Stronger communities.",
  },
  "micromart:callcenter": {
    file: "/images/doors/micromart/callcenter.webp",
    focal: "38% 46%",
    // Further right than the lending door: the agent sits nearer the middle of
    // this frame, and the card has to clear her.
    lead: 1.7,
    trail: 0.38,
    alt: "A Micromart ConnectDesk agent on a call at the collections floor",
    line: "Better livelihoods. Brighter futures.",
  },
};

/**
 * The photograph for this lender's door into this system, or null.
 *
 * Null is a first-class answer — see the note above. Callers render the plain
 * centred card for it.
 */
export function doorArt(orgSlug: string | null | undefined, systemId: string | null | undefined): DoorArt | null {
  if (!orgSlug || !systemId) return null;
  return DOORS[`${orgSlug.toLowerCase()}:${systemId}`] ?? null;
}

/** Every door that has artwork — used by the asset check. */
export function allDoorArt(): { key: string; art: DoorArt }[] {
  return Object.entries(DOORS).map(([key, art]) => ({ key, art }));
}
