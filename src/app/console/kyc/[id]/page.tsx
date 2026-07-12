// Verify a customer at the counter — INSIDE the console.
//
// This page lives under /console, so it wears the console: the left nav, the top
// bar, the org's colours, and (because the nav item's href is a prefix of this
// route) the KYC Verification item stays lit the whole time. An officer never
// leaves the building to do the one thing that lets their customer be paid.
//
// It replaces a link that opened the borrower's own portal in a new tab. That tab
// had no idea which lender it was serving and guessed — see the long note in
// api/console/kyc/verify/route.ts for what that cost.
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRights } from "@/lib/rbac/authz";
import { resolveScope, canSeeBorrower } from "@/lib/rbac/scope";
import { VerifyClient } from "./VerifyClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function CounterVerifyPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login");
  const orgId = session.user.orgId;
  const { id } = await params;
  const { from } = await searchParams;

  const rights = await getRights(session);
  if (!rights.has("kyc.verify") && !rights.has("*")) redirect("/console/kyc");

  // The same fence the API holds. A page that renders anyone's face while the API
  // refuses to is not a boundary, it is an inconsistency.
  const scope = await resolveScope(session);
  if (!(await canSeeBorrower(scope, id))) redirect("/console/kyc");

  const b = await prisma.borrower.findFirst({
    where: { id, orgId },
    select: { id: true, firstName: true, otherName: true, phone: true, nationalId: true, kycStatus: true },
  });
  if (!b) redirect("/console/kyc");

  const name = `${b.firstName ?? ""} ${b.otherName ?? ""}`.trim() || b.phone;

  return (
    <VerifyClient
      borrower={{ id: b.id, name, firstName: b.firstName ?? name.split(" ")[0], phone: b.phone, nationalId: b.nationalId, kycStatus: b.kycStatus }}
      // Where the officer came from is where they go back to. Coming from the
      // customer's own page and being dumped in a list is a small betrayal.
      returnTo={from === "360" ? `/console/borrowers/${b.id}` : "/console/kyc"}
      returnLabel={from === "360" ? "their profile" : "the verification queue"}
    />
  );
}
