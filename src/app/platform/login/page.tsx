// ─────────────────────────────────────────────────────────────────────────────
// THE SECOND DOOR, CLOSED.
//
// There used to be two sign-in pages: /login for a lender's staff and this one
// for the founder. They asked the same two questions and differed only in which
// table they checked, which meant the person who owns the platform had to
// remember which URL made his password work.
//
// There is now ONE door. /api/auth/login checks the PlatformAdmin table first
// and, on a match, issues the platform session and answers `/platform`; every
// other credential is a staff sign-in and lands on `/suite`. See the comment in
// that route for why the platform check comes first even though the founder is
// also an Org Admin in six organisations.
//
// This path stays alive as a REDIRECT rather than a 404, because it is in
// bookmarks and in older credential emails, and because PlatformBoard bounces
// here on a 401. Deleting it would turn "your session expired" into "page not
// found" for exactly the person who cannot ask anyone for help.
// ─────────────────────────────────────────────────────────────────────────────
import { redirect } from "next/navigation";

export const dynamic = "force-static";

export default function PlatformLoginMoved() {
  redirect("/login");
}
