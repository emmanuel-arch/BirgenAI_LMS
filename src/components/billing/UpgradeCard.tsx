import Link from "next/link";
import { Lock, ArrowRight, Crown } from "lucide-react";
import { cheapestPlanWith, type Feature } from "@/lib/billing/plans";

/**
 * Shown in place of a feature the org's package doesn't include.
 *
 * Names the exact plan and price that would unlock it — a paywall that says only
 * "upgrade" makes the reader go hunting, and a lender deciding whether to spend
 * KES 10,000 a month deserves the number in front of them.
 */
export function UpgradeCard({ feature, title, blurb }: { feature: Feature; title: string; blurb: string }) {
  const plan = cheapestPlanWith(feature);
  return (
    <div className="glass p-8 text-center max-w-lg mx-auto">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-900/5">
        <Lock className="h-7 w-7 text-zinc-400" />
      </div>
      <h2 className="mt-4 text-xl font-bold">{title}</h2>
      <p className="mt-2 text-sm text-zinc-500">{blurb}</p>

      {plan && (
        <div className="mt-5 rounded-2xl border border-zinc-900/10 bg-white/70 p-4">
          <p className="flex items-center justify-center gap-1.5 text-sm font-semibold">
            <Crown className="h-4 w-4" style={{ color: "var(--brand)" }} /> {plan.name}
          </p>
          <p className="mt-1 text-2xl font-bold">
            KES {plan.monthlyKes.toLocaleString()}
            <span className="text-sm font-normal text-zinc-400">/month</span>
          </p>
          <p className="mt-1.5 text-xs text-zinc-500">{plan.blurb}</p>
        </div>
      )}

      <Link href="/console/billing"
        className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800">
        See packages <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
