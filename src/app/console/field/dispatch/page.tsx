import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/billing/entitlements";
import { UpgradeCard } from "@/components/billing/UpgradeCard";
import { DispatchClient } from "./DispatchClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DispatchPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login");

  if (!(await hasFeature(session.user.orgId, "route-planner"))) {
    return (
      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-10">
        <UpgradeCard
          feature="route-planner"
          title="Dispatch Inbox"
          blurb="Dispatch requests from Customer-360 and Collections land here — the nearest agent accepts, sees the distance, and rides the route."
        />
      </main>
    );
  }

  return <DispatchClient />;
}
