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

// ─────────────────────────────────────────────────────────────────────────────
// A THIRD PACKAGE THAT MUST NOT BE BUNDLED — FOR A DIFFERENT REASON.
//
// mssql does not read files off disk. It breaks on REFERENCE IDENTITY. Every
// parameter we bind travels through mssql/lib/tedious/request.js:
//
//   switch (type) { case TYPES.Int: return tds.TYPES.Int
//                   … default: return type }
//
// a `switch` on object identity, matching the type we passed against the TYPES
// object from mssql's own lib/datatypes.js. Bundled, that module is instantiated
// twice — the `mssql.Int` our code imports is no longer the `TYPES.Int` the
// switch closes over, so every case misses, `default` hands the mssql type
// straight to tedious, and tedious calls `.validate()` on an object that has
// never had one:
//
//   Validation failed for parameter 'entityId'.
//   parameter.type.validate is not a function
//
// Which is why the message names the FIRST parameter of whatever query ran, and
// says nothing about SQL Server: the connection is fine, the credentials are
// fine, the query never left Node. Read through the real package and the two
// TYPES are one object again.
//
// This breaks EVERY live read at once — the borrower book, field ops, products,
// eligibility — so it reads like "the lender's database is down" rather than a
// build setting. Note the tell: the same queries pass from `npx tsx` scripts,
// which never go through the bundler.
//
// mssql is imported statically (src/lib/enterprise/mssql.ts), so unlike the PDF
// packages above the dependency tracer follows it and no outputFileTracingIncludes
// entry is needed to ship it.
// ─────────────────────────────────────────────────────────────────────────────

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfjs-dist", "pdfkit", "fontkit", "mssql"],
  outputFileTracingIncludes: {
    ...Object.fromEntries(PDF_READERS.map((r) => [r, pdfjsFiles])),
    ...Object.fromEntries(PDF_WRITERS.map((r) => [r, pdfkitFiles])),
  },

  // ───────────────────────────────────────────────────────────────────────────
  // THE SERVICE WORKER'S OWN HEADERS.
  //
  // A worker is cached like any other script, and a stale one is not a stale
  // asset — it is stale CODE sitting in front of every request the customer
  // makes, for up to 24 hours, with no way for us to reach it. `no-store` plus
  // `updateViaCache: "none"` at registration is what makes a shipped fix arrive.
  //
  // WHAT IS DELIBERATELY NOT HERE: `X-Frame-Options: DENY`. The Next PWA guide
  // recommends it globally, and it would break this product — blueprint §2.4 has
  // the Hub launching Micro Eazy with `launchMode: EMBEDDED`, inside the Hub's
  // /app/[slug] iframe shell, which is what keeps the Home button. Denying all
  // framing would turn the Hub tile into a blank rectangle. Framing policy for
  // this app belongs in a CSP `frame-ancestors` that names the Hub, which is a
  // deliberate decision and not a copied default.
  // ───────────────────────────────────────────────────────────────────────────
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
