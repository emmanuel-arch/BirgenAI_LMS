import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/billing/entitlements";
import { UpgradeCard } from "@/components/billing/UpgradeCard";
import { NeedsLocationClient } from "./NeedsLocationClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function NeedsLocationPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login");

  if (!(await hasFeature(session.user.orgId, "route-planner"))) {
    return (
      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-10">
        <UpgradeCard
          feature="route-planner"
          title="Needs Location"
          blurb="See every customer on your book with no location on file — the ones missing from your routes and blocked from disbursement until their pin is dropped."
        />
      </main>
    );
  }

  return <NeedsLocationClient />;
}
