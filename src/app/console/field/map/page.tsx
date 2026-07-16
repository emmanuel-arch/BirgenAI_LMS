import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/billing/entitlements";
import { UpgradeCard } from "@/components/billing/UpgradeCard";
import { MapClient } from "./MapClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function RouteMapPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login");

  if (!(await hasFeature(session.user.orgId, "route-planner"))) {
    return (
      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-10">
        <UpgradeCard
          feature="route-planner"
          title="Route Planner"
          blurb="Search a customer, pick the road, press start — turn-by-turn navigation to their door on real Nairobi streets and live traffic, with what the ride should cost."
        />
      </main>
    );
  }

  return <MapClient />;
}
