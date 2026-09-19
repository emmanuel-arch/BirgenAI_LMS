// lms.birgenai.com/<org-slug> — the lender's own front door.
//
// Every staff credential email links here: Micromart staff sign in under the
// Micromart logo at /micromart, Buy Simu staff under theirs at /buysimu. The
// slug pins the org for /api/auth/login, which is what lets ONE email hold an
// admin seat at several lenders and still land in the right book.
//
// ── IT ALSO PINS THE SYSTEM, FROM THE HOST ───────────────────────────────────
// The same path is served on every staff subdomain, and the subdomain says which
// system the person came for:
//
//   lms.servicesuitecloud.com/micromart          → the lending console
//   connectdesk.servicesuitecloud.com/micromart  → the collections floor
//
// That answer does two things. It chooses the PHOTOGRAPH behind the card (this
// lender's own counter, or this lender's own call floor — lib/suite/doors.ts),
// and it is passed to sign-in as the door that was knocked on, so a successful
// code lands the person in that system rather than on a menu (lib/suite/
// landing.ts). A lender or a system with no photograph falls back to the plain
// centred card, which is what this page has always rendered.
//
// Static siblings (/console, /login, /platform, /demo, /onboard, /myloan,
// /guarantee, /verify, /no-access) win over this dynamic segment, so only real
// org slugs reach it; anything the DB doesn't know 404s.
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import StaffLoginCard from "@/components/auth/StaffLoginCard";
import { resolveOrg } from "@/lib/tenancy";
import { resolveLenderBrand } from "@/lib/lms/brand-server";
import { hostLabel, systemIdForLabel } from "@/lib/suite/labels";
import { suiteApp } from "@/lib/suite/apps";
import { doorArt } from "@/lib/suite/doors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ org: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org } = await params;
  const resolved = await resolveOrg(org);
  if (!resolved) return { title: "Sign in — LMS", icons: { icon: "/images/logo.png" } };
  const { brand } = await resolveLenderBrand(resolved.slug);
  return {
    title: `${resolved.name} — Staff sign in`,
    description: `Sign in to the ${resolved.name} lending console.`,
    // The lender's own logo in the browser tab, from the first click.
    icons: { icon: brand.logo },
  };
}

export default async function OrgLogin({ params }: Props) {
  const { org } = await params;
  const resolved = await resolveOrg(org);
  // Unknown or switched-off lenders don't get a branded door. SUSPENDED still
  // renders (sign-in itself answers with the suspension message) — but only
  // for slugs the platform actually knows.
  if (!resolved) notFound();

  const { brand } = await resolveLenderBrand(resolved.slug);

  // Which system's door this is. Defaults to the lending console: it is the
  // anchor of the suite, it is what lms.servicesuitecloud.com serves, and it is
  // the right answer on localhost and on a preview deployment where the host
  // names nothing.
  const system = systemIdForLabel(hostLabel((await headers()).get("host"))) ?? "lms";
  const art = doorArt(resolved.slug, system);

  return <StaffLoginCard brand={brand} art={art} systemName={suiteApp(system)?.name ?? null} />;
}
