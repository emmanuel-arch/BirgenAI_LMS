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
          title="Route Map"
          blurb="Real Nairobi streets: pick where you are and which customer you're riding to, get the actual route, the time it takes, and what the ride should cost."
        />
      </main>
    );
  }

  return <MapClient />;
}
