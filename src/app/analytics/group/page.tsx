// ─────────────────────────────────────────────────────────────────────────────
// GROUP ROLL-UP — every entity a bridged lender runs, side by side.
//
// A view that does not exist anywhere in their world. ServiceSuite scopes its
// dashboard to whoever signed in, by UserMaster.EntityID, so Micromart run four
// entities on one server and have never once seen them on the same screen.
//
// This reads their OWN server, in their OWN metric definitions — the 90-day
// performing-book rule lifted from the MainDashboard stored procedure rather
// than guessed (see src/lib/analytics/group.ts for why that boundary decides
// whether outstanding reads KES 84.5m or KES 340.7m). A studio that reports a
// different OLB from the screen a GM already trusts is not a second opinion; it
// is a bug they will never stop pointing at.
//
// NATIVE lenders never reach this page — the nav entry is bridged-only — but the
// guard is repeated here because a nav filter is not an access control.
// ─────────────────────────────────────────────────────────────────────────────
import { redirect } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveOrg } from "@/lib/tenancy";
import { getGroupBook, getGroupTrend } from "@/lib/analytics/group";
import { studioContext } from "@/lib/analytics/context";
import { StudioPage } from "@/components/analytics/StudioPage";
import { GroupBoard } from "@/components/analytics/GroupBoard";
import type { SearchParams } from "@/lib/analytics/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function GroupPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [ctx, session] = await Promise.all([studioContext(searchParams), auth()]);
  if (!session?.user?.orgId) redirect("/login");

  const tenant = await resolveOrg(session.user.orgSlug ?? "");
  if (tenant?.mode !== "BRIDGED") redirect("/analytics");

  // The READ is wrapped, never the render. JSX inside a try/catch looks guarded
  // and is not — React renders after this function returns, by which time the
  // catch is long gone. So the data is fetched here and the markup is built
  // outside it.
  let data: { book: Awaited<ReturnType<typeof getGroupBook>>; trend: Awaited<ReturnType<typeof getGroupTrend>> } | null = null;
  let failure: string | null = null;

  if (tenant.bridgedReady && tenant.registry) {
    try {
      const [book, trend] = await Promise.all([
        getGroupBook(tenant.registry),
        getGroupTrend(tenant.registry, 12),
      ]);
      data = { book, trend };
    } catch (err) {
      failure = err instanceof Error ? err.message : "The connection to your server did not answer.";
    }
  } else {
    failure = "This lender is in bridged mode but the connection to their server is not configured.";
  }

  const orgName = (await prisma.org.findUnique({ where: { id: session.user.orgId }, select: { name: true } }))?.name ?? ctx.orgName;

  return (
    <StudioPage
      title="Group roll-up"
      blurb="Every entity on your own server, in one view, using the metric definitions your managers already read on their dashboard."
      range={ctx.filters.range}
      axes={{ branches: [], officers: [], products: [] }}
      showGrain={false}
    >
      {failure ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <p className="flex items-start gap-2 text-[13px] leading-snug text-amber-900">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>Your server did not answer.</strong> {failure} Nothing is shown rather than a partial figure — a
              group total missing an entity is worse than no group total, because it looks complete.
            </span>
          </p>
        </div>
      ) : data ? (
        <GroupBoard book={data.book} trend={data.trend} orgName={orgName} />
      ) : null}

      <p className="mt-6 text-[11px] leading-snug text-zinc-400">
        Read live from your ServiceSuite instance. Active loans, OLB, arrears, PQS and NPL are computed exactly as the
        MainDashboard procedure computes them, including the 90-day performing-book boundary — so the figures here
        reconcile against the screen your branch managers already use, entity by entity.
      </p>
    </StudioPage>
  );
}
