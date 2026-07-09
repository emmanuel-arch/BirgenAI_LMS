// ─────────────────────────────────────────────────────────────────────────────
// Pulling structured fields out of a Kenyan business document.
//
// Pure, deterministic, no I/O — hand it text, get fields back. That makes it
// testable against real documents without a database, a bucket or a vendor.
//
// These are rules, not a model. A school fee structure and a county business
// permit have shapes: labelled amounts, a total, an account to pay into, dates in
// a handful of formats. Rules read them well, explain themselves, and cost nothing
// per document — and when a rule misses, we say the confidence is low and put the
// document in front of a human rather than inventing a number. The LLM seam in
// parse.ts is for the documents that defeat the rules, not a replacement for them.
//
// Nothing here persists raw text. The caller keeps the fields; the text is PII and
// dies with the request.
// ─────────────────────────────────────────────────────────────────────────────

export type DocumentKind =
  | "FEE_STRUCTURE"
  | "INVOICE"
  | "PERMIT"
  | "BANK_STATEMENT"
  | "NATIONAL_ID"
  | "OTHER";

export type LineItem = { label: string; amountKes: number };

export type ExtractedFields = {
  /** Everything we could name. Kind-specific; absent keys were not found. */
  [k: string]: string | number | boolean | LineItem[] | undefined;
};

export type Extraction = {
  kind: DocumentKind;
  fields: ExtractedFields;
  /** 0..1 — the share of this kind's needed fields we actually found. Informational. */
  confidence: number;
  /** Fields this kind needs and we could not find. One of these ⇒ a human reads it. */
  missing: string[];
  /** How many fields this kind cannot do without. Zero ⇒ we don't know what this is. */
  expectedCount: number;
};

// ── Primitives ────────────────────────────────────────────────────────────────

/** Collapse whitespace but keep line structure — labels and amounts live on lines. */
export function normalize(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const MONEY = /(?:kes|ksh|kshs|sh)\.?\s*([0-9][0-9,\s]*(?:\.\d{1,2})?)|([0-9]{1,3}(?:,[0-9]{3})+(?:\.\d{1,2})?)/gi;

/** Parse "KES 12,500.00" / "12,500" → 12500. Returns null on nonsense. */
export function toAmount(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

/** Every money-looking figure in the text, in order of appearance. */
export function amounts(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(MONEY)) {
    const n = toAmount(m[1] ?? m[2] ?? "");
    if (n !== null) out.push(n);
  }
  return out;
}

const DATE_PATTERNS: RegExp[] = [
  /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/, // 09/07/2026
  /\b(\d{4})-(\d{2})-(\d{2})\b/, // 2026-07-09
  /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{4})\b/i,
];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** First date after `label`, as YYYY-MM-DD. Kenyan documents write day-first. */
export function findDate(text: string, label?: RegExp): string | null {
  const scope = label ? sliceAfter(text, label, 120) : text;
  if (!scope) return null;
  for (const p of DATE_PATTERNS) {
    const m = p.exec(scope);
    if (!m) continue;
    if (p === DATE_PATTERNS[1]) return `${m[1]}-${m[2]}-${m[3]}`;
    if (p === DATE_PATTERNS[2]) {
      const mm = String(MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1).padStart(2, "0");
      return `${m[3]}-${mm}-${m[1].padStart(2, "0")}`;
    }
    const [, d, mo, y] = m;
    // Day-first unless that is impossible (13/07 can only be month-second).
    const day = Number(d), mon = Number(mo);
    if (day > 12 && mon <= 12) return `${y}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (mon > 12 && day <= 12) return `${y}-${String(day).padStart(2, "0")}-${String(mon).padStart(2, "0")}`;
    return `${y}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}

/** Text following the first match of `label`, up to `chars`. */
function sliceAfter(text: string, label: RegExp, chars: number): string | null {
  const m = label.exec(text);
  if (!m) return null;
  const start = m.index + m[0].length;
  return text.slice(start, start + chars);
}

/**
 * Every window that follows a match of `label`.
 *
 * A label rarely appears once. "VAT" heads the supplier's VAT PIN long before it
 * labels an amount, and "Account" appears in "Statement of Account" above the
 * account number. Taking the first match and giving up is how a parser reports a
 * PIN as a tax figure — so we try each occurrence and keep the first that yields
 * something of the right shape.
 */
function slicesAfter(text: string, label: RegExp, chars: number): string[] {
  const re = new RegExp(label.source, label.flags.includes("g") ? label.flags : label.flags + "g");
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    const start = m.index + m[0].length;
    out.push(text.slice(start, start + chars));
  }
  return out;
}

/** The amount that follows a label, trying each occurrence of the label in turn. */
export function amountNear(text: string, label: RegExp): number | null {
  for (const scope of slicesAfter(text, label, 80)) {
    const found = amounts(scope);
    if (found.length) return found[0];
  }
  return null;
}

/** The first token after a label — an account number, a permit number, an ID. */
export function tokenNear(text: string, label: RegExp, pattern = /[A-Z0-9][A-Z0-9/-]{3,}/i): string | null {
  for (const scope of slicesAfter(text, label, 60)) {
    const m = pattern.exec(scope);
    if (m) return m[0].trim();
  }
  return null;
}

/** Kenyan paybill / till: 5–7 digits announced by a payment word. */
export function findPaybill(text: string): string | null {
  const m = /\b(?:paybill|pay\s*bill|business\s*(?:no|number)|till)\D{0,20}(\d{5,7})\b/i.exec(text);
  return m ? m[1] : null;
}

/**
 * A bank or M-Pesa account number after "account".
 *
 * The token must contain a digit. Without that rule "Statement of Account" happily
 * yields the account number "Account".
 */
export function findAccount(text: string): string | null {
  return tokenNear(text, /\bacc(?:ount)?\.?\s*(?:no\.?|number|#)?\s*:?/i, /\b[A-Z0-9-]*\d[A-Z0-9-]{3,}\b/i);
}

/**
 * Labelled amounts, one per line: "Tuition ......... 18,500".
 * Rejects lines whose label is a total — those are captured separately, and
 * double-counting the total as a line item is how a fee structure stops summing.
 */
export function lineItems(text: string): LineItem[] {
  const out: LineItem[] = [];
  for (const line of text.split("\n")) {
    if (/\b(total|grand\s*total|sub\s*total|balance|amount\s+due)\b/i.test(line)) continue;
    const found = amounts(line);
    if (found.length !== 1) continue;
    const label = line
      .replace(MONEY, "")
      .replace(/[.·•\-_]{2,}/g, " ")
      .replace(/[:|]/g, " ")
      .trim();
    if (label.length < 3 || label.length > 60) continue;
    if (!/[a-z]/i.test(label)) continue;
    out.push({ label, amountKes: found[0] });
  }
  return out;
}

// ── Per-kind extractors ───────────────────────────────────────────────────────

const TOTAL = /\b(?:grand\s*total|total\s*(?:fees?|amount|payable)?|amount\s*(?:due|payable))\b\s*:?/i;

type Extractor = (t: string) => { fields: ExtractedFields; expected: string[] };

const EXTRACTORS: Record<DocumentKind, Extractor> = {
  FEE_STRUCTURE: (t) => {
    const items = lineItems(t);
    const total = amountNear(t, TOTAL) ?? (items.length ? round2(items.reduce((s, i) => s + i.amountKes, 0)) : undefined);
    const fields: ExtractedFields = {
      institution: firstHeadingLine(t),
      term: matchOne(t, /\b(term\s*[1-3]|first\s*term|second\s*term|third\s*term)\b/i),
      year: matchOne(t, /\b(20\d{2})\b/),
      totalKes: total,
      paybill: findPaybill(t) ?? undefined,
      account: findAccount(t) ?? undefined,
      items: items.length ? items : undefined,
      // Do the parts add up to the stated total? A fee structure that does not sum
      // is either misread or altered, and either way an officer should look.
      itemsSumMatchesTotal:
        total != null && items.length > 0
          ? Math.abs(round2(items.reduce((s, i) => s + i.amountKes, 0)) - total) < 1
          : undefined,
    };
    return { fields, expected: ["institution", "totalKes", "paybill"] };
  },

  INVOICE: (t) => {
    const fields: ExtractedFields = {
      invoiceNumber: tokenNear(t, /\binvoice\s*(?:no\.?|number|#)\s*:?/i) ?? undefined,
      supplier: firstHeadingLine(t),
      issuedOn: findDate(t, /\b(?:invoice\s*)?date\s*:?/i) ?? undefined,
      dueOn: findDate(t, /\bdue\s*(?:date)?\s*:?/i) ?? undefined,
      vatKes: amountNear(t, /\b(?:vat|v\.a\.t)\b\s*:?/i) ?? undefined,
      totalKes: amountNear(t, TOTAL) ?? undefined,
      items: lineItems(t).length ? lineItems(t) : undefined,
    };
    return { fields, expected: ["invoiceNumber", "supplier", "totalKes"] };
  },

  PERMIT: (t) => {
    const fields: ExtractedFields = {
      permitNumber: tokenNear(t, /\bpermit\s*(?:no\.?|number|#)\s*:?/i) ?? undefined,
      business: firstHeadingLine(t),
      county: matchOne(t, /\b([a-z' ]+?)\s+county\b/i)?.trim(),
      validFrom: findDate(t, /\b(?:valid\s*from|issued?\s*(?:on)?)\s*:?/i) ?? undefined,
      validTo: findDate(t, /\b(?:valid\s*(?:to|until)|expir\w*)\s*:?/i) ?? undefined,
      feeKes: amountNear(t, /\b(?:fee|amount\s*paid)\b\s*:?/i) ?? undefined,
    };
    return { fields, expected: ["permitNumber", "county", "validTo"] };
  },

  BANK_STATEMENT: (t) => {
    const fields: ExtractedFields = {
      bank: firstHeadingLine(t),
      accountNumber: findAccount(t) ?? undefined,
      periodStart: findDate(t, /\b(?:from|period\s*(?:from)?|statement\s*period)\s*:?/i) ?? undefined,
      periodEnd: findDate(t, /\b(?:to|through|ending)\s*:?/i) ?? undefined,
      openingBalanceKes: amountNear(t, /\bopening\s*balance\b\s*:?/i) ?? undefined,
      closingBalanceKes: amountNear(t, /\bclosing\s*balance\b\s*:?/i) ?? undefined,
    };
    return { fields, expected: ["accountNumber", "closingBalanceKes"] };
  },

  NATIONAL_ID: (t) => {
    const fields: ExtractedFields = {
      // Kenyan national ID numbers are 7–8 digits. Anchored on a label because a
      // bare 8-digit run is just as likely to be a date or a serial.
      idNumber: tokenNear(t, /\b(?:id\s*(?:no\.?|number)|identity\s*card\s*no\.?)\s*:?/i, /\d{7,8}/) ?? undefined,
      // Case-insensitive: Kenyan IDs print names in capitals, forms print them in title case.
      fullName: matchOne(t, /\b(?:full\s*names?|name)\s*:?[ \t]*([A-Za-z][A-Za-z' -]{4,60})/i),
      dateOfBirth: findDate(t, /\b(?:date\s*of\s*birth|d\.?o\.?b\.?)\s*:?/i) ?? undefined,
      serialNumber: tokenNear(t, /\bserial\s*(?:no\.?|number)\s*:?/i, /\d{6,12}/) ?? undefined,
    };
    return { fields, expected: ["idNumber", "fullName"] };
  },

  OTHER: (t) => {
    const found = amounts(t);
    return {
      fields: {
        heading: firstHeadingLine(t),
        largestAmountKes: found.length ? Math.max(...found) : undefined,
        amountsFound: found.length,
        dateSeen: findDate(t) ?? undefined,
      },
      expected: [],
    };
  },
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function matchOne(t: string, re: RegExp): string | undefined {
  const m = re.exec(t);
  return m ? (m[1] ?? m[0]).trim() : undefined;
}

/** The first substantial line — nearly always the issuer's name. */
function firstHeadingLine(t: string): string | undefined {
  for (const line of t.split("\n")) {
    const s = line.trim();
    if (s.length >= 4 && s.length <= 80 && /[a-z]/i.test(s) && !/^\d/.test(s)) return s;
  }
  return undefined;
}

/**
 * Read `text` as a document of `kind`.
 *
 * Confidence is the share of the fields this kind cannot do without. It is not a
 * probability and does not pretend to be. It does NOT decide the outcome either:
 * a document is only PARSED when nothing needed is missing. Two fields out of three
 * is not two-thirds of a fee structure — it is a fee structure with no paybill on
 * it, and an officer has to look at that before money moves anywhere.
 */
export function extractDocument(kind: DocumentKind, text: string): Extraction {
  const t = normalize(text);
  const { fields, expected } = EXTRACTORS[kind](t);

  for (const k of Object.keys(fields)) if (fields[k] === undefined) delete fields[k];

  const missing = expected.filter((k) => fields[k] === undefined);
  const confidence = expected.length === 0
    ? (Object.keys(fields).length > 0 ? 0.5 : 0)
    : round2((expected.length - missing.length) / expected.length);

  return { kind, fields, confidence, missing, expectedCount: expected.length };
}

/**
 * Is this reading good enough to act on? Only when every needed field was found —
 * and when the kind names some, which OTHER deliberately does not.
 */
export const isComplete = (e: Extraction): boolean => e.expectedCount > 0 && e.missing.length === 0;
