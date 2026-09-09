// ─────────────────────────────────────────────────────────────────────────────
// IDENTITY POLICY — where the machine stops and a person starts.
//
// Everything this screen edits lives in the `kyc` config namespace
// (lib/config/kyc.ts) and is served by the generic /api/config/[namespace]
// route, so the gate here is the ordinary settings one and no bespoke endpoint
// exists to get wrong.
// ─────────────────────────────────────────────────────────────────────────────
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import IdentityPolicyClient from "./IdentityPolicyClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function IdentityPolicyPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login?callbackUrl=/console/settings/identity");
  if (await requireRight(session, "settings.view")) redirect("/console");
  return <IdentityPolicyClient />;
}
