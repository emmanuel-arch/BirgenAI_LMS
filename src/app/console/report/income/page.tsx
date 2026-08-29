// Moved — see ../page.tsx. Income now lives in Analytics & Reporting, under the
// FINANCE category, scoped to the book you are standing in.
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function MovedToAnalytics() {
  redirect("/analytics/reports");
}
