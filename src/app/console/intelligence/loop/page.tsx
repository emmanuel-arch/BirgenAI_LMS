// The Closed ML Loop module.
//
// Gated on `intelligence.view` and nothing else — deliberately NOT behind a plan
// feature. This screen is the argument for the platform's existence, and a lender
// on the smallest package who cannot see why their own data is worth collecting
// is a lender who will never grow into a bigger one.
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRights } from "@/lib/rbac/authz";
import { loopReport } from "@/lib/intelligence/loop";
import { LoopClient } from "./LoopClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ClosedLoopPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login");
  const orgId = session.user.orgId;

  const rights = await getRights(session);
  if (!rights.has("intelligence.view")) redirect("/console");

  const [report, org] = await Promise.all([
    loopReport(orgId),
    prisma.org.findUnique({ where: { id: orgId }, select: { name: true } }),
  ]);

  return <LoopClient report={report} orgName={org?.name ?? "this lender"} />;
}
