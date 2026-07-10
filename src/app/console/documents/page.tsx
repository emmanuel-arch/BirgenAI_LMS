import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/billing/entitlements";
import { UpgradeCard } from "@/components/billing/UpgradeCard";
import { DocumentsClient } from "./DocumentsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login");

  if (!(await hasFeature(session.user.orgId, "document-parser"))) {
    return (
      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-10">
          <UpgradeCard
            feature="document-parser"
            title="Document Parser"
            blurb="Read a school fee structure, an invoice, a county permit or a bank statement into figures you can act on — the total, who to pay, and whether the parts add up."
          />
        </main>
    );
  }

  return <DocumentsClient />;
}
