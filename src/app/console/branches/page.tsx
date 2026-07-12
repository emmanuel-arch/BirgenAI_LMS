import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { StructureClient } from "./StructureClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The lender's own organisational structure. Every plan gets this — an org chart is
// not a premium feature, it is what makes a staff member, a borrower and a loan belong
// somewhere, and everything downstream (who sees whose book) reads it.
export default async function BranchesPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login");
  return <StructureClient />;
}
