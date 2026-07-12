import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { KycQueueClient } from "./KycQueueClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The gate between a registered customer and their money. Every plan gets it — an
// unverified borrower being paid out is not a premium problem.
export default async function KycQueuePage({ searchParams }: { searchParams: Promise<{ borrower?: string }> }) {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login");
  const { borrower } = await searchParams;
  return <KycQueueClient focusId={borrower ?? null} />;
}
