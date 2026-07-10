import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/billing/entitlements";
import { UpgradeCard } from "@/components/billing/UpgradeCard";
import { FieldClient } from "./FieldClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The RO Route Planner is what Advanced charges for over Enterprise. Gate it on the
// server: rendering the client and letting its fetches 402 would still ship the
// roster and the map to a package that has not paid for them.
export default async function FieldPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login");

  if (!(await hasFeature(session.user.orgId, "route-planner"))) {
    return (
      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-10">
          <UpgradeCard
            feature="route-planner"
            title="Field & Route Planner"
            blurb="Drop a verification visit anywhere, and the nearest available officer is allocated automatically — then their stops are ordered into the shortest route they can walk or ride."
          />
        </main>
    );
  }

  return <FieldClient />;
}
