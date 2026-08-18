// ─────────────────────────────────────────────────────────────────────────────
// THE PER-PAGE PRELUDE.
//
// Every studio screen needs the same four things before it can draw anything:
// who is asking, what they filtered to, what the filter surface should offer,
// and where the book starts. Doing that in each page would be five copies of the
// same auth check — and the fifth copy is the one that forgets it.
//
// So it happens here, once. A page calls `studioContext(searchParams)` and gets
// back everything it needs, already scoped.
// ─────────────────────────────────────────────────────────────────────────────
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { filterOptions, inceptionDate, type StudioFilters } from "./engine";
import { parseParams, type SearchParams, type ParsedParams } from "./params";
import type { FilterAxes } from "@/components/analytics/StudioFilterBar";

export type StudioContext = ParsedParams & {
  orgId: string;
  orgName: string;
  orgMode: string;
  bridged: boolean;
  filters: StudioFilters;
  axes: FilterAxes;
};

export async function studioContext(searchParams: Promise<SearchParams>): Promise<StudioContext> {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login?callbackUrl=/analytics");
  const orgId = session.user.orgId;

  const [org, sp] = await Promise.all([
    prisma.org.findUnique({ where: { id: orgId }, select: { name: true, mode: true } }),
    searchParams,
  ]);
  if (!org) redirect("/login");

  // "Since inception" means the first loan on THIS book, not an arbitrary ten
  // years back. Resolved before the range so the two agree.
  const inception = await inceptionDate(orgId).catch(() => null);
  const parsed = parseParams(sp, { inceptionFrom: inception });
  const axes = await filterOptions(orgId).catch(() => ({ branches: [], officers: [], products: [] }));

  return {
    ...parsed,
    orgId,
    orgName: org.name,
    orgMode: org.mode,
    bridged: org.mode === "BRIDGED",
    axes,
  };
}
