import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/billing/entitlements";
import { UpgradeCard } from "@/components/billing/UpgradeCard";
import { MetricsClient } from "./MetricsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The catalogue describes what Riri knows and shows the SQL behind every number she
// quotes. It is hers, so it is gated on hers: an org without Riri should not browse
// her measures as though they had her.
export default async function MetricsPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login");

  if (!(await hasFeature(session.user.orgId, "riri"))) {
    return (
      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-10">
        <UpgradeCard
          feature="riri"
          title="Talk to your loan book"
          blurb="Riri reads your live book and answers in numbers — outstanding, PAR, collections, defaults — sliced by product, by borrower, by period. Every answer shows you the exact query it came from."
        />
      </main>
    );
  }

  return <MetricsClient />;
}
