// ─────────────────────────────────────────────────────────────────────────────
// ID OCR via Google Cloud Vision — the first LIVE leg of the KYC pipeline.
//
// Same simulation-first discipline as kycMode/crbMode/storageMode: with no
// GOOGLE_CLOUD_API_KEY (or OCR_API_KEY) set, callers fall back to the seeded
// simulation and nothing here runs. With a key, the captured ID-front image goes
// to Vision's TEXT_DETECTION and the fields are parsed out of the raw text.
//
// Parsing follows the document-parser lesson: a label's FIRST occurrence is not
// the answer ("SERIAL NUMBER" sits directly above "ID NUMBER" on the card, and
// OCR happily interleaves them) — every candidate is tried until one yields the
// right SHAPE, and a field with the wrong shape is a miss, not a value.
// Confidence is completeness, not a verdict: it counts fields found, and the
// caller decides what to do about gaps.
//
// Vision failing — quota, network, unreadable card — returns null, and the
// caller falls back to simulation rather than sinking the verification. The
// borrower at the counter is not the right person to show a Google error to.
// ─────────────────────────────────────────────────────────────────────────────
import type { IdOcrResult } from "./provider";

export type OcrEngine = "google-vision" | "simulation";

export function ocrKey(): string | null {
  return process.env.GOOGLE_CLOUD_API_KEY?.trim() || process.env.OCR_API_KEY?.trim() || null;
}

export function ocrMode(): "live" | "simulation" {
  return ocrKey() ? "live" : "simulation";
}

/** Raw text from Vision TEXT_DETECTION, or null on any failure. */
export async function visionText(imageDataUrl: string): Promise<string | null> {
  const key = ocrKey();
  if (!key) return null;
  const content = imageDataUrl.replace(/^data:image\/\w+;base64,/, "");
  if (!content || content.length < 100) return null;

  try {
    const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [{ image: { content }, features: [{ type: "TEXT_DETECTION" }] }],
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { responses?: { fullTextAnnotation?: { text?: string } }[] };
    return data.responses?.[0]?.fullTextAnnotation?.text ?? null;
  } catch {
    return null;
  }
}

// ── Kenyan national ID (front) field extraction ──────────────────────────────

const LABEL_WORDS = /^(JAMHURI|REPUBLIC|KENYA|SERIAL|NUMBER|ID|FULL|NAMES?|DATE|OF|BIRTH|SEX|MALE|FEMALE|DISTRICT|PLACE|ISSUE|HOLDER'?S?|SIGN(ATURE)?|SPECIMEN)$/;

function isLabelLine(line: string): boolean {
  const words = line.split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => LABEL_WORDS.test(w.replace(/[.:]/g, "")));
}

function toIsoDate(raw: string): string | null {
  const m = raw.match(/(\d{1,2})[.\-/\s]+(\d{1,2})[.\-/\s]+(\d{4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const year = Number(y);
  if (year < 1900 || year > new Date().getFullYear()) return null;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/**
 * Parse the fields off a Kenyan ID front from OCR text. Every value must have
 * the right shape or it is not that field:
 *   · ID number — 7–9 digits (serial numbers run longer, which is how the two
 *     are told apart when the labels interleave)
 *   · full name — 2+ words, letters only, on a non-label line (Kenyan IDs print
 *     names in CAPITALS; case is normalised, never trusted)
 *   · dates — dd.mm.yyyy in any of the separators OCR mangles them into
 */
export function parseKenyanIdText(text: string): IdOcrResult | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim().toUpperCase()).filter(Boolean);
  if (!lines.length) return null;

  let idNumber: string | null = null;
  let serial: string | null = null;
  let fullName: string | null = null;
  let dob: string | null = null;

  const numberAfter = (labelRe: RegExp, shape: RegExp): string | null => {
    for (let i = 0; i < lines.length; i++) {
      if (!labelRe.test(lines[i])) continue;
      // The value may share the label's line or sit on the next one or two.
      for (const cand of [lines[i], lines[i + 1] ?? "", lines[i + 2] ?? ""]) {
        const m = cand.replace(labelRe, "").match(shape);
        if (m) return m[0];
      }
    }
    return null;
  };

  idNumber = numberAfter(/ID\s*NUMBER[.:]?/, /\b\d{7,9}\b/);
  serial = numberAfter(/SERIAL\s*NUMBER[.:]?/, /\b\d{8,12}\b/);

  // No labelled ID number? Any 7–8 digit token that is NOT the serial.
  if (!idNumber) {
    for (const l of lines) {
      const m = l.match(/\b\d{7,8}\b/);
      if (m && m[0] !== serial) { idNumber = m[0]; break; }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    if (/FULL\s*NAMES?/.test(lines[i])) {
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const cand = lines[j];
        if (isLabelLine(cand)) continue;
        if (/^[A-Z][A-Z'\- ]+$/.test(cand) && cand.split(/\s+/).length >= 2) {
          fullName = cand.split(/\s+/).map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(" ");
          break;
        }
      }
      if (fullName) break;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    if (/DATE\s*OF\s*BIRTH/.test(lines[i])) {
      for (const cand of [lines[i], lines[i + 1] ?? "", lines[i + 2] ?? ""]) {
        const iso = toIsoDate(cand);
        if (iso) { dob = iso; break; }
      }
      if (dob) break;
    }
  }

  const found = [idNumber, fullName, dob, serial].filter(Boolean).length;
  if (found === 0) return null;

  return {
    fullName,
    idNumber,
    dob,
    serial,
    // Completeness, not a verdict: 4 fields ≈ 92, 1 field ≈ 47.
    confidence: Math.min(95, 32 + found * 15),
  };
}

/** The live OCR path: Vision → Kenyan-ID parser. Null = fall back to simulation. */
export async function visionIdOcr(imageDataUrl: string): Promise<IdOcrResult | null> {
  const text = await visionText(imageDataUrl);
  if (!text) return null;
  return parseKenyanIdText(text);
}
