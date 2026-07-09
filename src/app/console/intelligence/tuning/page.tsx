import { redirect } from "next/navigation";
import Link from "next/link";
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
      <div className="min-h-screen relative text-zinc-900">
        <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />
        <main className="relative z-10 mx-auto max-w-5xl px-4 sm:px-6 py-10">
          <Link href="/console" className="mb-6 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800">
            <ArrowLeft className="h-4 w-4" /> Console
          </Link>
          <UpgradeCard
            feature={scan ? "model-tuning" : "portfolio-scan"}
            title="Your own risk policy"
            blurb="Every book behaves differently. A ten-day delinquency is normal breathing at a market-stall lender and an alarm at a payroll lender. Tune what counts as risk on your book — and see exactly which borrowers move before you commit."
          />
        </main>
      </div>
    );
  }

  return <TuningClient />;
}
