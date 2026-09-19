// Generic staff sign-in (BirgenAI branding). Staff of a specific lender get
// their branded door at /<org-slug> — the link their credential email carries —
// where the same card wears the lender's logo and accent and pins the org.
//
// ── THIS IS ALSO WHAT EVERY BARE STAFF HOST SERVES ───────────────────────────
// connectdesk.servicesuitecloud.com, lms.servicesuitecloud.com and the rest all
// rewrite their root here (lib/suite/labels.ts → proxy.ts). Each used to serve
// its own /suite/<id>/login; those were deleted with the launcher. So this page
// reads which system it is standing in — from the host, or from ?system= when a
// link inside the app points at a door on this same origin — and says so on the
// card. Sign-in then lands the person in that system.
//
// No lender is pinned here: without a slug the card is un-branded and the org is
// resolved from the credentials. Which is why there is no photograph either —
// the artwork belongs to a lender (lib/suite/doors.ts) and this page does not
// know which one is about to type.
import { headers } from "next/headers";
import StaffLoginCard from "@/components/auth/StaffLoginCard";
import { hostLabel, systemIdForLabel } from "@/lib/suite/labels";
import { suiteApp } from "@/lib/suite/apps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function StaffLogin({
  searchParams,
}: {
  searchParams: Promise<{ system?: string }>;
}) {
  const [{ system: asked }, h] = await Promise.all([searchParams, headers()]);
  const system = systemIdForLabel(hostLabel(h.get("host"))) ?? (asked ? suiteApp(asked)?.id ?? null : null);

  return <StaffLoginCard systemName={system ? suiteApp(system)?.name ?? null : null} />;
}
