// ─────────────────────────────────────────────────────────────────────────────
// PDF → text extraction for the M-Pesa Statement Cruncher.
//
// Official M-Pesa statements (emailed by Safaricom) are PASSWORD-PROTECTED. We
// use pdfjs-dist (legacy Node build) exclusively: it opens both encrypted and
// plain PDFs and reports password state precisely via PasswordException.
//
// NOTE: pdfjs-dist MUST stay out of the bundle (`serverExternalPackages` in
// next.config.ts). It resolves its worker with a runtime dynamic import; if the
// bundler rewrites that, pdfjs falls back to a "fake worker" and throws
// `Setting up fake worker failed`, which used to surface here as the misleading
// "Could not read this PDF" message.
//
// Server-only (Node runtime). Throws typed errors the route maps to friendly text.
// ─────────────────────────────────────────────────────────────────────────────

export class PdfPasswordRequiredError extends Error {
  constructor(msg = "This statement is password-protected. Enter the password to unlock it.") {
    super(msg);
    this.name = "PdfPasswordRequiredError";
  }
}
export class PdfPasswordIncorrectError extends Error {
  constructor(msg = "That password didn't unlock the statement. Check it and try again.") {
    super(msg);
    this.name = "PdfPasswordIncorrectError";
  }
}

// pdfjs PasswordResponses: NEED_PASSWORD = 1, INCORRECT_PASSWORD = 2
const NEED_PASSWORD = 1;
const INCORRECT_PASSWORD = 2;

type PdfTextItem = { str: string; transform: number[] };

/** Extract plain text from a PDF buffer. `password` unlocks encrypted statements. */
export async function extractPdfText(buffer: Buffer, password?: string): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    password: password || undefined,
    isEvalSupported: false,
    useSystemFonts: true,
    // No worker in Node — pdfjs runs on the main thread for text extraction.
  });

  let doc;
  try {
    doc = await loadingTask.promise;
  } catch (err) {
    const e = err as { name?: string; code?: number; message?: string };
    if (e?.name === "PasswordException") {
      if (e.code === INCORRECT_PASSWORD) throw new PdfPasswordIncorrectError();
      if (e.code === NEED_PASSWORD) throw new PdfPasswordRequiredError();
      throw password ? new PdfPasswordIncorrectError() : new PdfPasswordRequiredError();
    }
    console.error("[extract-pdf] could not open PDF:", err);
    throw new Error("Could not read this PDF. Make sure it's a valid M-Pesa statement.", { cause: err });
  }

  try {
    let text = "";
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      // Reconstruct rough lines: insert a newline when the y-position drops.
      let lastY: number | null = null;
      let line = "";
      for (const item of content.items as PdfTextItem[]) {
        const y = item.transform?.[5];
        if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2) {
          text += line.trimEnd() + "\n";
          line = "";
        }
        line += item.str + " ";
        if (y !== undefined) lastY = y;
      }
      if (line.trim()) text += line.trimEnd() + "\n";
      text += "\n";
    }
    if (!text.trim()) {
      throw new Error("This PDF has no readable text (it may be a scan). Upload the statement Safaricom emailed you.");
    }
    return text;
  } finally {
    await loadingTask.destroy().catch(() => {});
  }
}
