// ─────────────────────────────────────────────────────────────────────────────
// PDF → text extraction for the M-Pesa Statement Cruncher.
//
// Official M-Pesa statements (emailed by Safaricom) are PASSWORD-PROTECTED, which
// pdf-parse cannot open. Strategy:
//   1. Try pdf-parse (fast, proven here) — handles already-unlocked PDFs.
//   2. On an encryption error, fall back to pdfjs-dist (legacy Node build), which
//      accepts a user password.
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

function looksEncrypted(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return m.includes("password") || m.includes("encrypt");
}

/** Extract plain text from a PDF buffer. `password` is used only if needed. */
export async function extractPdfText(buffer: Buffer, password?: string): Promise<string> {
  // 1. pdf-parse (no password support) — works for unlocked statements.
  if (!password) {
    try {
      const pdf = (await import("pdf-parse")).default;
      const data = await pdf(buffer);
      if (data.text && data.text.trim().length > 0) return data.text;
    } catch (err) {
      if (looksEncrypted(err)) throw new PdfPasswordRequiredError();
      // otherwise fall through to pdfjs (some PDFs just parse better there)
    }
  }

  // 2. pdfjs-dist legacy — supports a user password.
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      password: password || undefined,
      isEvalSupported: false,
      useSystemFonts: true,
      // No worker in Node — pdfjs runs on the main thread for text extraction.
    });
    const doc = await loadingTask.promise;

    let text = "";
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      // Reconstruct rough lines: insert a newline when the y-position drops.
      let lastY: number | null = null;
      let line = "";
      for (const item of content.items as Array<{ str: string; transform: number[] }>) {
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
    return text;
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    if (name === "PasswordException" || msg.includes("password")) {
      if (password) throw new PdfPasswordIncorrectError();
      throw new PdfPasswordRequiredError();
    }
    // Surface the real failure in server logs — bundler/module-load errors land
    // here too (not just corrupt PDFs) and the friendly message hides them.
    console.error("[extract-pdf] pdfjs extraction failed:", err);
    throw new Error("Could not read this PDF. Make sure it's a valid M-Pesa statement.", { cause: err });
  }
}
