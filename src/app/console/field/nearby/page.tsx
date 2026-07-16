import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/billing/entitlements";
import { UpgradeCard } from "@/components/billing/UpgradeCard";
import { NearbyClient } from "./NearbyClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function NearbyPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login");

  if (!(await hasFeature(session.user.orgId, "route-planner"))) {
    return (
      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-10">
        <UpgradeCard
          feature="route-planner"
          title="Customers Near Me"
          blurb="Open your location and see every customer on your book by distance — who is five minutes away, and who has never pinned a location at all."
        />
      </main>
    );
  }

  return <NearbyClient />;
}
