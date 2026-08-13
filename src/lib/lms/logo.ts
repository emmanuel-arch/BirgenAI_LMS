// ─────────────────────────────────────────────────────────────────────────────
// The logo sizing system — one answer to "how big does the mark render HERE?".
//
// THE BUG THIS KILLS, and it had two halves.
//
// HALF ONE — THE CSS. Slots used to pin ONE dimension (`height: 132px`) and cap
// the other (`max-width: 280px`) with `object-contain`. Whenever the cap binds,
// object-contain letterboxes: the artwork shrinks inside a box that keeps its
// declared size, and the leftover is invisible padding the layout still pays for.
// The rule below removes the possibility: cap BOTH dimensions, pin NEITHER
// (`maxWidth` + `maxHeight`, width/height `auto`). The browser then scales the
// image to fit both caps with its aspect ratio intact, and the element's box IS
// the rendered artwork — for a 3:1 wordmark, a square crest, or anything else a
// lender uploads. There is no aspect ratio that can letterbox this.
//
// HALF TWO — THE FILE, which is where the real damage was. Mular's stored logo is
// a 300×200 PNG whose artwork occupies 290×82 in the middle: 26% clear above, 33%
// clear below. CSS cannot see that; it sizes the canvas. So 59% of every logo slot
// rendered empty and the copy beneath was pushed down by air. No stylesheet fixes
// a file that is mostly nothing — `scripts/trim-logo.ts` crops the gutter out of
// the asset and repoints the org, and every surface tightens at once.
//
// `bleed` remains for the residue: a small negative bottom margin that absorbs the
// last few percent of gutter a trimmed file still carries, so a mark can read big
// while the heading under it stays close.
//
// One asset, many slots. Nothing here needs a second export from the lender; if
// one ever ships a square "app icon", add a slot rather than squashing a wordmark
// into a tile.
// ─────────────────────────────────────────────────────────────────────────────

export type LogoSlot =
  /** The sign-in / OTP card — the biggest the mark ever gets in the product. */
  | "auth"
  /** Transactional email header (rendered as fixed px; inboxes ignore CSS units). */
  | "email"
  /** Console sidebar letterhead. */
  | "sidebar"
  /** Collapsed sidebar rail / favicon-sized tiles. */
  | "rail"
  /** Printed report + statement letterheads. */
  | "report"
  /** Inline chrome: dock headers, chips, breadcrumbs. */
  | "inline";

export type LogoSpec = {
  /** Widest the mark may render. Neither dimension is pinned — see the header. */
  maxWidth: number;
  /** Tallest the mark may render. Whichever cap binds first wins; aspect is kept. */
  maxHeight: number;
  /**
   * Share of the rendered height reclaimed as negative bottom margin, to cancel
   * transparent gutter still baked into the file. 0.06 = "pull the next element
   * up by 6% of the logo's height". Kept small — this absorbs residue, and is not
   * a substitute for trimming the asset (scripts/trim-logo.ts).
   */
  bleed: number;
};

export const LOGO_SLOTS: Record<LogoSlot, LogoSpec> = {
  // 344×152 inside a 384px content column — a wide wordmark lands at ~89% of the
  // column, which is what makes the sign-in card read as a PRODUCT'S front door
  // rather than a form with a small picture on it. A square crest gets 152px.
  //
  // Raised from 320×140 deliberately: the door is the one screen every user sees
  // before they have any other impression of the system, and the old cap left a
  // wide mark looking incidental. Any lender who wants it smaller has `logoScale`.
  auth: { maxWidth: 344, maxHeight: 152, bleed: 0.03 },
  email: { maxWidth: 200, maxHeight: 72, bleed: 0 },
  sidebar: { maxWidth: 210, maxHeight: 150, bleed: 0.03 },
  rail: { maxWidth: 40, maxHeight: 40, bleed: 0 },
  report: { maxWidth: 180, maxHeight: 76, bleed: 0 },
  inline: { maxWidth: 104, maxHeight: 32, bleed: 0 },
};

/** Clamp a lender's dial to something that can't break a layout. */
export function clampScale(scale?: number | null): number {
  const n = Number(scale);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(2, Math.max(0.5, n / 100));
}

export type LogoMetrics = { maxWidth: number; maxHeight: number; marginBottom: number };

/**
 * Resolved px for a slot at a lender's scale.
 *
 * Spread onto an <img> as `style` together with `width:auto; height:auto` — those
 * two are what make the caps behave as caps. `marginBottom` is the bleed, already
 * negative.
 */
export function logoMetrics(slot: LogoSlot, scale?: number | null): LogoMetrics {
  const spec = LOGO_SLOTS[slot];
  const k = clampScale(scale);
  const maxWidth = Math.round(spec.maxWidth * k);
  const maxHeight = Math.round(spec.maxHeight * k);
  // The aspect ratio is unknown server-side, so the bleed is computed against the
  // height cap — the honest upper bound on what the mark can occupy.
  return { maxWidth, maxHeight, marginBottom: -Math.round(maxHeight * spec.bleed) };
}
