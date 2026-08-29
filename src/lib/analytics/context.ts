// ─────────────────────────────────────────────────────────────────────────────
// THE PER-PAGE PRELUDE.
//
// Every studio screen needs the same things before it can draw anything: who is
// asking, WHICH BOOK they are asking about, what they filtered to, what the
// filter surface should offer, and where the book starts. Doing that in each
// page would be fifteen copies of the same auth check — and the fifteenth copy
// is the one that forgets it.
//
// ── THE BOOK IS RESOLVED HERE, ONCE ──────────────────────────────────────────
// This is the fix for the studio reading the wrong database. A native lender's
// book is in Postgres; a bridged lender's is on their own SQL Server, reached
// through the relay. That decision cannot live in a page, because there are
// fifteen pages and they would drift. `ctx.scope` is the resolved answer and
// every engine call takes it.
//
// The book a manager lands in follows the CONSOLE REALM — the same cookie the
// realm switch writes (lib/suite/realm-server.ts). Morris, who works in the SME
// book, opens the studio on 3002. Geoffrey, who runs fintech collections, opens
// on 3005. Neither has to choose something they already chose.
// ─────────────────────────────────────────────────────────────────────────────
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { filterOptions, inceptionDate, type StudioFilters } from "./engine";
import { parseParams, type SearchParams, type ParsedParams } from "./params";
import { resolveScope, lensesFor, type StudioScope, type EntityLens } from "./scope";
import { activeRealm } from "@/lib/suite/realm-server";
import type { FilterAxes } from "@/components/analytics/StudioFilterBar";

export type StudioContext = ParsedParams & {
  orgId: string;
  orgName: string;
  orgMode: string;
  bridged: boolean;
  filters: StudioFilters;
  axes: FilterAxes;
  /** WHICH BOOK. Every engine call takes this. */
  scope: StudioScope;
  /** Every book this lender has — the entity control's options. Empty for one-book lenders. */
  lenses: EntityLens[];
  /** The books actually in this cut. */
  active: EntityLens[];
  /** True when each measure is broken out per book. */
  split: boolean;
  /**
   * Set when the lender's book is known to live elsewhere and is unreachable.
   * A page seeing this must SAY so — drawing an empty chart instead is exactly
   * the failure this whole change exists to remove.
   */
  unavailable: string | null;
};

export async function studioContext(searchParams: Promise<SearchParams>): Promise<StudioContext> {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login?callbackUrl=/analytics");
  const orgId = session.user.orgId;

  const [org, sp] = await Promise.all([
    prisma.org.findUnique({ where: { id: orgId }, select: { name: true, slug: true, mode: true } }),
    searchParams,
  ]);
  if (!org) redirect("/login");

  // The realm cookie decides the default book. Resolved before the scope, since
  // the scope falls back to it when the URL names no entity.
  const realm = await activeRealm(org.slug).catch(() => null);
  const pre = parseParams(sp);

  const scope = resolveScope({
    orgId,
    orgSlug: org.slug,
    orgMode: org.mode,
    entityIds: pre.entityIds,
    fallbackRealmId: realm?.id ?? null,
    split: pre.split,
  });

  // "Since inception" means the first loan on THIS book, not an arbitrary ten
  // years back — and on the live path that is a different date per book, which
  // is why it is resolved from the scope rather than from the org.
  const inception = await inceptionDate(scope).catch(() => null);
  const parsed = parseParams(sp, { inceptionFrom: inception });
  const axes = await filterOptions(scope).catch(() => ({ branches: [], officers: [], products: [] }));

  const lenses = lensesFor(org.slug);
  const activeIds = new Set(scope.live?.lenses.map((l) => l.id) ?? []);

  return {
    ...parsed,
    orgId,
    orgName: org.name,
    orgMode: org.mode,
    bridged: org.mode === "BRIDGED",
    axes,
    scope,
    // A one-book lender gets an empty list, so the entity control renders
    // nothing rather than a switch with a single setting.
    lenses: lenses.length > 1 ? lenses : [],
    active: lenses.filter((l) => activeIds.has(l.id)),
    split: scope.live?.split ?? false,
    unavailable: scope.unavailable,
  };
}
