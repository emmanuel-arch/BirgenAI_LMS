// ─────────────────────────────────────────────────────────────────────────────
// REPORT BUILDER — compose your own report from the metric catalogue.
//
// Riri knows every published measure and the exact SQL behind it (item 17's
// catalogue); this page is that knowledge with checkboxes. Pick the measures,
// pick a period and a slice, and the analyst engine runs each one through the
// SAME compiled-SQL read path the dock uses — then the result renders as a
// paper document (white sheet, letterhead discipline) that window.print()
// turns into the PDF, exactly like the loan statement does.
// ─────────────────────────────────────────────────────────────────────────────
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/billing/entitlements";
import { UpgradeCard } from "@/components/billing/UpgradeCard";
import { runAsPlatform } from "@/lib/db/context";
import { prisma } from "@/lib/prisma";
import { METRICS } from "@/lib/riri/catalog";
import { ReportBuilderClient } from "./ReportBuilderClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ReportBuilderPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login");
  const orgId = session.user.orgId;

  if (!(await hasFeature(orgId, "riri"))) {
    return (
      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-8">
        <UpgradeCard
          feature="riri"
          title="Report Builder"
          blurb="Compose your own report from every measure Riri knows — each one runs the same audited SQL the dock shows, and prints to a branded PDF."
        />
      </main>
    );
  }

  const org = await runAsPlatform(() =>
    prisma.org.findUnique({ where: { id: orgId }, select: { name: true, logoUrl: true, accent: true } }),
  );

  return (
    <ReportBuilderClient
      org={{ name: org?.name ?? "", logoUrl: org?.logoUrl ?? null, accent: org?.accent ?? "#18181b" }}
      metrics={METRICS.map((m) => ({ id: m.id, label: m.label, description: m.description }))}
    />
  );
}
