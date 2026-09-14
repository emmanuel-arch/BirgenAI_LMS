// ─────────────────────────────────────────────────────────────────────────────
// RIRI KNOWLEDGE — a lender trains Riri on their own facts.
//
// Riri Ecosystem AI plan, Sprint 4. The document lives in the `riri` config
// namespace (lib/config/riri.ts), published through the generic versioned
// /api/config/[namespace] route; validate, preview and rollback live in
// /api/console/riri/knowledge. The gate is the ordinary settings one.
// ─────────────────────────────────────────────────────────────────────────────
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import RiriKnowledgeClient from "./RiriKnowledgeClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function RiriKnowledgePage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login?callbackUrl=/console/settings/riri");
  if (await requireRight(session, "settings.view")) redirect("/console");
  return <RiriKnowledgeClient />;
}
