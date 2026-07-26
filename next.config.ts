import type { NextConfig } from "next";

// ─────────────────────────────────────────────────────────────────────────────
// TWO PACKAGES THAT MUST NOT BE BUNDLED — AND MUST STILL BE SHIPPED.
//
// pdfjs-dist and pdfkit both read files off disk relative to their own module
// path: pdfjs resolves its worker with a runtime dynamic import, pdfkit reads its
// built-in AFM font metrics at construction. Bundled, both paths get rewritten to
// the build root and both fail —
//   pdfjs :  Setting up fake worker failed: Cannot find module '…/chunks/…'
//            → surfaced to the officer as "Could not read this PDF."
//   pdfkit:  ENOENT … 'C:\ROOT\node_modules\pdfkit\js\data\Helvetica.afm'
// So they are declared external, and Node resolves the real package directory.
//
// THE SECOND HALF, which is the one that bites only in production. `external`
// means "do not bundle" — it does NOT mean "upload it". Vercel builds each route
// into its own serverless function and includes only the files its dependency
// TRACER found. The tracer follows static imports; `await import("pdfjs-dist/…")`
// inside a route is a dynamic specifier it cannot always follow. Locally that is
// invisible because the whole node_modules tree is sitting there on disk. In
// production the package is simply absent, the dynamic import throws, and the
// cruncher reports a bad statement for what is really a missing file.
//
// outputFileTracingIncludes is the fix: it force-includes those packages in the
// functions that actually parse or generate PDFs. Scoped to those routes rather
// than applied globally, because pdfjs-dist is large and every other function
// would carry it for nothing.
// ─────────────────────────────────────────────────────────────────────────────

/** Every route that opens an M-Pesa statement. */
const PDF_READERS = [
  "/api/v1/crunch",
  "/api/enterprise/statement-cruncher",
  "/api/portal/recrunch/run",
  "/api/console/borrowers/[id]/limit-check",
  "/api/console/applications",
  "/api/lms/limit",
];

/** Every route that builds a PDF. */
const PDF_WRITERS = ["/api/console/riri/export"];

const pdfjsFiles = [
  "./node_modules/pdfjs-dist/legacy/build/**",
  "./node_modules/pdfjs-dist/package.json",
];
const pdfkitFiles = [
  "./node_modules/pdfkit/js/**",
  "./node_modules/pdfkit/package.json",
  "./node_modules/fontkit/**",
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfjs-dist", "pdfkit", "fontkit"],
  outputFileTracingIncludes: {
    ...Object.fromEntries(PDF_READERS.map((r) => [r, pdfjsFiles])),
    ...Object.fromEntries(PDF_WRITERS.map((r) => [r, pdfkitFiles])),
  },
};

export default nextConfig;
