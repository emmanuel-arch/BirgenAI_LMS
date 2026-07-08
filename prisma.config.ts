// Prisma 7 config — connection URLs live here, not in schema.prisma.
// Migrations use the DIRECT (session-mode) URL; the app's PrismaClient uses the
// pooled DATABASE_URL via the pg driver adapter (src/lib/prisma.ts).
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: env("DIRECT_URL") },
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});
