import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/billing/entitlements";
import { UpgradeCard } from "@/components/billing/UpgradeCard";
import { TuningClient } from "./TuningClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Two gates, matching the API. Tuning is Premium's, but it tunes the early-warning
// engine, and a lapsed subscription revokes that — you cannot tune what you do not have.
export default async function TuningPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login");

  const [scan, tune] = await Promise.all([
    hasFeature(session.user.orgId, "portfolio-scan"),
    hasFeature(session.user.orgId, "model-tuning"),
  ]);

  if (!scan || !tune) {
    return (
      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-10">
          <UpgradeCard
            feature={scan ? "model-tuning" : "portfolio-scan"}
            title="Your own risk policy"
            blurb="Every book behaves differently. A ten-day delinquency is normal breathing at a market-stall lender and an alarm at a payroll lender. Tune what counts as risk on your book — and see exactly which borrowers move before you commit."
          />
        </main>
    );
  }

  return <TuningClient />;
}
