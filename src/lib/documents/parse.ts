// ─────────────────────────────────────────────────────────────────────────────
// The Document Parser — blueprint §9, "IDs, fee structures, invoices, permits,
// bank statements → structured data".
//
// What is real today: PDFs. `extractPdfText` reads them with pdfjs (the same
// engine the M-Pesa cruncher uses), and the rules in extract.ts turn that text
// into fields. Most Kenyan fee structures, invoices, permits and bank statements
// arrive as PDFs, so this is the common case, and it costs nothing per document.
//
// What is NOT real yet: photographs. Reading a phone snapshot of a permit needs
// OCR, and OCR needs a licensed provider. Rather than pretend — a wrong number
// lifted from a fee structure becomes a wrong disbursement — an image without an
// OCR provider is stored UNPARSED and says so on screen. `parserMode()` is the
// seam, matching kycMode/crbMode/llmMode: the day a key exists, images start
// parsing through the same call sites.
//
// Raw text never leaves this function. Fields are structured and reviewable; the
// text itself is PII we have no reason to keep.
// ─────────────────────────────────────────────────────────────────────────────
import { extractPdfText, PdfPasswordRequiredError, PdfPasswordIncorrectError } from "@/lib/statement/extract-pdf";
import { extractDocument, isComplete, type DocumentKind, type Extraction } from "./extract";

export type ParserMode = "simulation" | "live";

/** Live once an OCR provider exists. Until then, images cannot be read. */
export function parserMode(): ParserMode {
  return process.env.OCR_API_KEY?.trim() ? "live" : "simulation";
}

export type ParseStatus = "PARSED" | "NEEDS_REVIEW" | "UNPARSED" | "FAILED";

export type ParseResult = {
  status: ParseStatus;
  extraction: Extraction | null;
  pages: number | null;
  mode: ParserMode;
  /** Why a human is needed, in words an officer can act on. */
  note?: string;
};

export const MAX_DOCUMENT_BYTES = 3 * 1024 * 1024;

export class UnsupportedDocumentError extends Error {}
export { PdfPasswordRequiredError, PdfPasswordIncorrectError };

const SNIFFERS: { type: string; test: (b: Buffer) => boolean }[] = [
  { type: "application/pdf", test: (b) => b.subarray(0, 5).toString("ascii") === "%PDF-" },
  { type: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: "image/png", test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { type: "image/webp", test: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP" },
];

/**
 * What is this file, really? The declared MIME type is a claim; the magic bytes
 * are a fact, and this content is about to be read and stored.
 */
export function sniff(buffer: Buffer): string {
  const hit = SNIFFERS.find((s) => s.test(buffer));
  if (!hit) throw new UnsupportedDocumentError("Upload a PDF, JPEG, PNG or WebP.");
  return hit.type;
}

export function decodeUpload(dataUrl: string): { buffer: Buffer; contentType: string } {
  const m = /^data:([a-z0-9/+.-]+);base64,(.+)$/i.exec((dataUrl ?? "").trim());
  if (!m) throw new UnsupportedDocumentError("Expected a base64 data URL.");
  const buffer = Buffer.from(m[2], "base64");
  if (buffer.length === 0) throw new UnsupportedDocumentError("That file is empty.");
  if (buffer.length > MAX_DOCUMENT_BYTES) throw new UnsupportedDocumentError("That file is too large — keep it under 3 MB.");
  return { buffer, contentType: sniff(buffer) };
}

/** Rough page count without a second parse: PDFs announce their page objects. */
function countPages(buffer: Buffer): number | null {
  const head = buffer.toString("latin1");
  const matches = head.match(/\/Type\s*\/Page[^s]/g);
  return matches?.length ?? null;
}

/**
 * Read a document. Never throws for content reasons — a file we cannot read is a
 * result (UNPARSED), not an exception, because the officer still wants it stored
 * and attached to the borrower. It throws only for a wrong password, which the
 * caller can fix by asking for one.
 */
export async function parseDocument(
  buffer: Buffer,
  contentType: string,
  kind: DocumentKind,
  password?: string,
): Promise<ParseResult> {
  const mode = parserMode();

  if (contentType !== "application/pdf") {
    if (mode === "simulation") {
      return {
        status: "UNPARSED",
        extraction: null,
        pages: null,
        mode,
        note: "Photographs need optical character recognition, which is not connected yet. Upload the PDF, or type the figures in by hand.",
      };
    }
    // The live OCR path lands here the day a provider key exists. Until then this
    // branch is unreachable, and it is honest about that rather than half-built.
    return { status: "UNPARSED", extraction: null, pages: null, mode, note: "OCR provider configured but not yet wired." };
  }

  let text: string;
  try {
    text = await extractPdfText(buffer, password);
  } catch (err) {
    if (err instanceof PdfPasswordRequiredError || err instanceof PdfPasswordIncorrectError) throw err;
    return { status: "FAILED", extraction: null, pages: null, mode, note: "This PDF could not be read." };
  }

  const pages = countPages(buffer);

  // A scanned PDF is an image in a PDF wrapper: it opens, and it holds no text.
  if (text.replace(/\s/g, "").length < 40) {
    return {
      status: "UNPARSED",
      extraction: null,
      pages,
      mode,
      note: "This PDF is a scan, so it has no text to read. Optical character recognition is not connected yet.",
    };
  }

  const extraction = extractDocument(kind, text);
  const status: ParseStatus = isComplete(extraction) ? "PARSED" : "NEEDS_REVIEW";

  return {
    status,
    extraction,
    pages,
    mode,
    note: status === "PARSED"
      ? undefined
      : extraction.missing.length
        ? `Could not find ${extraction.missing.join(", ")}. Check the figures before relying on them.`
        : "Nothing here needs a particular field, so nobody has checked these figures. Read them before acting on them.",
  };
}
