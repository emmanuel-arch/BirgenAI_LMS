// ─────────────────────────────────────────────────────────────────────────────
// MOVED — reporting is its own system now.
//
// This page built a portfolio report from POSTGRES, which is correct for a
// native lender and silently wrong for a bridged one: Micromart's Postgres row
// holds 199 loans against a real book of 275,605, so this screen showed a
// lender their own business at 0.07% of its size and gave no hint it was doing
// so. That is the same defect the Analytics Studio had, and it is fixed the same
// way — by asking the lender's own server, scoped to the book they are in.
//
// A redirect rather than a rewrite: the reports live at /analytics/reports now,
// where they are read on screen, exported with provenance, and entity-scoped.
// Anything still linking here lands in the right place instead of on a 404.
// ─────────────────────────────────────────────────────────────────────────────
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function MovedToAnalytics() {
  redirect("/analytics/reports");
}
