import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist resolves its worker with a dynamic import at runtime. If the
  // bundler rewrites that import into a chunk path, pdfjs falls back to a "fake
  // worker" and dies with: Setting up fake worker failed: "Cannot find module
  // '…/chunks/…_pdfjs-dist_legacy_build_pdf_mjs_….js'". Keeping it external lets
  // Node resolve the worker natively, which is what the M-Pesa Statement
  // Cruncher needs to open password-protected Safaricom statements.
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
