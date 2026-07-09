// Seed/tooling Prisma client.
//
// RLS (prisma/rls.sql) fences every tenant table on the `app.org_id` GUC, so a
// plain client would be unable to insert a single row. Seeds legitimately write
// across orgs, so they connect with `options=-c app.platform=on`: a startup
// parameter Postgres applies to EVERY connection this pool opens, which is what
// makes it safe under a connection pool (a one-off `SET` would only stick to
// whichever connection happened to run it).
//
// DIRECT_URL is used deliberately — it is the session pooler, which passes
// startup options through; the pgbouncer transaction pooler on DATABASE_URL does
// not reliably honour them.
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

export function platformPrisma(): PrismaClient {
  const base = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!base) throw new Error("DIRECT_URL (or DATABASE_URL) is required.");
  const url = new URL(base);
  url.searchParams.set("options", "-c app.platform=on");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
}
