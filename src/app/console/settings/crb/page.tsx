// ─────────────────────────────────────────────────────────────────────────────
// BUREAU SCRUTINY — the door onto the CRB report plan.
//
// The server's whole job here is the gate. Everything the screen renders comes
// from GET /api/console/crb/plan, which masks the Metropol keys on the way out;
// no credential passes through this page.
// ─────────────────────────────────────────────────────────────────────────────
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import CrbPlanClient from "./CrbPlanClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function CrbSettingsPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login?callbackUrl=/console/settings/crb");
  if (await requireRight(session, "settings.view")) redirect("/console");
  return <CrbPlanClient />;
}
