// ─────────────────────────────────────────────────────────────────────────────
// The Analytics & Reporting moved out of the console.
//
// It is its own system now — /analytics inside this deployment, and
// analytics.birgenai.com in production (src/lib/suite/apps.ts, src/proxy.ts).
//
// This file stays as a REDIRECT rather than being deleted, because the route was
// live: it is in the nav registry's history, in Riri's system map, in the
// subdomain rewrite, and in whatever bookmarks and shared links people already
// have. Deleting a route that other people are holding a link to is a 404 the
// author never sees and the user cannot diagnose.
//
// Query strings are carried across so a link to a filtered view lands filtered.
// ─────────────────────────────────────────────────────────────────────────────
import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function MovedToStudio({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") qs.set(k, v);
    else if (Array.isArray(v) && v[0]) qs.set(k, v[0]);
  }
  const q = qs.toString();
  redirect(q ? `/analytics?${q}` : "/analytics");
}
