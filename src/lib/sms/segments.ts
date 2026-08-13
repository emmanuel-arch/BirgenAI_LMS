// ─────────────────────────────────────────────────────────────────────────────
// HOW MANY SMS IS THIS, REALLY?
//
// Every screen that composes a message needs the same answer, and the naive one
// — `Math.ceil(len / 160)` — is wrong in three separate ways, each of which
// silently doubles what a lender pays per recipient.
//
//   1. THE ALPHABET DECIDES THE LIMIT. A message is 160 characters only while
//      every character is in the GSM 03.38 alphabet. One character outside it and
//      the whole message is re-encoded as UCS-2, where a segment holds SEVENTY.
//      The usual culprit is invisible: a curly apostrophe from Word or a phone
//      keyboard. "Don't" with U+2019 costs 70 per segment; with a plain ' it
//      costs 160. Same words on screen, less than half the room.
//
//   2. SOME GSM CHARACTERS COST TWO. The extension table — { } [ ] ~ ^ \ | and
//      the euro sign — is escaped, so each one eats two of the 160.
//
//   3. CONCATENATION HAS OVERHEAD. Past one segment, each part gives up header
//      space: 153 per part in GSM, 67 in UCS-2. So 161 GSM characters is not
//      "160 + 1", it is two segments of 153 — and 306 characters still fits in
//      two while 307 needs three.
//
// Micromart's own reminder SQL is written to the same discipline: each template
// was trimmed word by word to stay inside one segment, because 17,017 borrowers
// billed twice is a real line on a real invoice. This module is how our template
// editor gives a lender that discipline without making them count.
// ─────────────────────────────────────────────────────────────────────────────

/** GSM 03.38 basic set. Anything outside this (plus EXTENDED) forces UCS-2. */
const GSM_BASIC = new Set(
  ("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
   "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà")
    .split(""),
);

/** GSM characters that are ESCAPED on the wire, and so cost two units each. */
const GSM_EXTENDED = new Set(["\f", "^", "{", "}", "\\", "[", "~", "]", "|", "€"]);

export type SmsEncoding = "GSM_7BIT" | "UCS2";

export type SmsCost = {
  encoding: SmsEncoding;
  /** Billable units used — extension characters already counted twice. */
  units: number;
  /** Units available before another segment is billed. */
  remaining: number;
  /** Segments this message will be split into. */
  segments: number;
  /** Units one segment holds at the current segment count. */
  perSegment: number;
  /** Plain character count, for a "you typed N" readout. */
  length: number;
  /**
   * The characters that forced UCS-2, de-duplicated and in the order found.
   * Empty for a GSM message. This is what lets the UI say WHICH character cost
   * them the room, rather than just reporting a smaller budget.
   */
  offenders: string[];
};

/** Single-segment / multi-segment capacity per encoding (GSM 03.40). */
const CAPACITY = {
  GSM_7BIT: { single: 160, multi: 153 },
  UCS2: { single: 70, multi: 67 },
} as const;

export function smsCost(text: string): SmsCost {
  // Astral characters (emoji) are two UTF-16 code units and must be counted as
  // the pair they are billed as, so iterate code units, not code points.
  let units = 0;
  const offenders: string[] = [];

  for (const ch of Array.from(text)) {
    if (GSM_EXTENDED.has(ch)) { units += 2; continue; }
    if (GSM_BASIC.has(ch)) { units += 1; continue; }
    if (!offenders.includes(ch)) offenders.push(ch);
    // Cost under UCS-2 is per UTF-16 unit: an emoji outside the BMP costs 2.
    units += ch.length;
  }

  const encoding: SmsEncoding = offenders.length > 0 ? "UCS2" : "GSM_7BIT";
  if (encoding === "UCS2") {
    // Re-count: under UCS-2 nothing is escaped, so the extension characters that
    // cost two above cost one here. Counting them twice would over-report.
    units = Array.from(text).reduce((n, ch) => n + ch.length, 0);
  }

  const cap = CAPACITY[encoding];
  const segments = units === 0 ? 1 : units <= cap.single ? 1 : Math.ceil(units / cap.multi);
  const perSegment = segments <= 1 ? cap.single : cap.multi;

  return {
    encoding,
    units,
    remaining: segments * perSegment - units,
    segments,
    perSegment,
    length: Array.from(text).length,
    offenders,
  };
}

/**
 * What a lender should be told, in their words.
 *
 * Deliberately leads with what is LEFT rather than what is used: a composer's
 * question is always "can I fit one more clause", and "12 left" answers it while
 * "148/160" makes them do the subtraction.
 */
export function smsCostLabel(cost: SmsCost): string {
  const unit = cost.segments === 1 ? "SMS" : `${cost.segments} SMS`;
  if (cost.remaining === 1) return `1 character remaining · ${unit}`;
  if (cost.remaining === 0) return `full · ${unit}`;
  return `${cost.remaining} characters remaining · ${unit}`;
}

/** How close to the edge — drives the colour, not the words. */
export type SmsCostTone = "ok" | "close" | "over";

export function smsCostTone(cost: SmsCost): SmsCostTone {
  if (cost.segments > 1) return "over";
  if (cost.remaining <= 20) return "close";
  return "ok";
}

/**
 * A template's WORST CASE, which is the number that actually matters.
 *
 * A template is not what gets billed — the rendered message is, and a
 * placeholder is a hole of unknown width. `{name}` is six characters on screen
 * and up to fifteen on the wire, so a template measuring 158 can still send two
 * segments to a third of the book. Micromart hit exactly this: 1,830 of their
 * 17,017 borrowers carry a first name longer than twelve characters, and the
 * longest is twenty-four.
 *
 * So the editor measures the template with every placeholder expanded to a
 * realistic maximum, and reports THAT. Widths are deliberately generous; a
 * template that fits the worst case fits everything.
 */
export const PLACEHOLDER_WIDTH: Record<string, number> = {
  name: 15,        // first token of a name, capped — matches the ServiceSuite rule
  borrower: 15,
  org: 24,         // "Micromart Africa Limited"
  amount: 9,       // "1,250,000"
  principal: 9,
  repayable: 9,
  balance: 9,
  phone: 12,       // 254712345678
  ref: 8,
  code: 6,
  pin: 4,
  date: 11,        // "13 Aug 2026"
  due: 11,
  clearDate: 11,
  link: 28,        // a shortened URL
};

/** Unknown placeholders get this — wide enough to be safe, not absurd. */
const DEFAULT_WIDTH = 12;

/** Expand `{placeholders}` to their worst-case width, then cost the result. */
export function templateWorstCase(body: string): SmsCost {
  const filled = body.replace(/\{(\w+)\}/g, (_, key: string) =>
    "X".repeat(PLACEHOLDER_WIDTH[key] ?? DEFAULT_WIDTH));
  return smsCost(filled);
}
