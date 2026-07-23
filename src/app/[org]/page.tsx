// lms.birgenai.com/<org-slug> — the lender's own front door.
//
// Every staff credential email links here: Micromart staff sign in under the
// Micromart logo at /micromart, Buy Simu staff under theirs at /buysimu. The
// slug pins the org for /api/auth/login, which is what lets ONE email hold an
// admin seat at several lenders and still land in the right book.
//
// Static siblings (/console, /login, /platform, /demo, /onboard, /myloan,
// /guarantee, /verify) win over this dynamic segment, so only real org slugs
// reach it; anything the DB doesn't know 404s.
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import StaffLoginCard from "@/components/auth/StaffLoginCard";
import { resolveOrg } from "@/lib/tenancy";
import { resolveLenderBrand } from "@/lib/lms/brand-server";

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
  return <StaffLoginCard brand={brand} />;
}
