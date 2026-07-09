import { redirect } from "next/navigation";
import Link from "next/link";
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
      <div className="min-h-screen relative text-zinc-900">
        <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />
        <main className="relative z-10 mx-auto max-w-5xl px-4 sm:px-6 py-10">
          <Link href="/console" className="mb-6 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800">
            <ArrowLeft className="h-4 w-4" /> Console
          </Link>
          <UpgradeCard
            feature="document-parser"
            title="Document Parser"
            blurb="Read a school fee structure, an invoice, a county permit or a bank statement into figures you can act on — the total, who to pay, and whether the parts add up."
          />
        </main>
      </div>
    );
  }

  return <DocumentsClient />;
}
