"use client";

import { Printer } from "lucide-react";

/**
 * Hands the document to the browser's print pipeline, where "Save as PDF" is a
 * first-class destination. No PDF library, no server rendering, no font
 * embedding — and the output is always current with what the officer sees.
 */
export function PrintButton({ label = "Download PDF" }: { label?: string }) {
  return (
    <button
      onClick={() => window.print()}
      className="no-print inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white shadow-sm"
      style={{ backgroundColor: "var(--brand)" }}
    >
      <Printer className="h-3.5 w-3.5" /> {label}
    </button>
  );
}
