// Prisma 7 config — connection URLs live here, not in schema.prisma.
// Migrations use the DIRECT (session-mode) URL; the app's PrismaClient uses the
// pooled DATABASE_URL via the pg driver adapter (src/lib/prisma.ts).
//
// `prisma generate` runs in Vercel's postinstall but never CONNECTS — the URL only
// has to RESOLVE. Migrations (db push / migrate) run locally or in CI, where
// DIRECT_URL is set; Vercel's build env only carries DATABASE_URL. So resolve
// tolerantly rather than with prisma's strict `env()`, which throws
// PrismaConfigEnvError on a missing DIRECT_URL and fails the whole install.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: process.env.DIRECT_URL || process.env.DATABASE_URL || "postgresql://unused:unused@localhost:5432/unused" },
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});
