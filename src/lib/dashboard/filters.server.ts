// ─────────────────────────────────────────────────────────────────────────────
// SERVER HALF of the filter model — the part that reads the database.
//
// Split from filters.ts deliberately: CinematicDashboard is a client component and
// imports the types + activeCount from there. Keeping `capabilityFor` in the same
// module dragged `@/lib/prisma` (and with it `pg` and `node:async_hooks`) into the
// browser bundle, which the build refuses outright. Types and pure helpers are
// client-safe; anything that touches Prisma lives here.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { runWithOrg } from "@/lib/db/context";
import type { ResolvedScope } from "@/lib/rbac/scope";
import { SCOPE_HEADLINE, type FilterAxis, type FilterCapability } from "./filters";

/**
 * Build the filter surface this scope is entitled to.
 *
 * Every list is derived from `scope`, so narrowing a role narrows the pickers on the
 * next request — there is no second place to keep in sync. Runs inside `runWithOrg`
 * so RLS is in force even for the lookup lists: a filter dropdown is still a read.
 */
export async function capabilityFor(scope: ResolvedScope): Promise<FilterCapability> {
  const scopeLabel = SCOPE_HEADLINE[scope.kind];

  // An officer's own book cannot be re-cut. Withhold the control entirely.
  if (scope.kind === "OWN") {
    return { canFilter: false, scopeLabel, scopeKind: scope.kind, axes: [] };
  }

  const { orgId } = scope;
  // ORG sees every branch; a subtree scope sees exactly its own descendants (already
  // resolved and cycle-guarded by resolveScope).
  const branchWhere = scope.unrestricted ? { orgId } : { orgId, id: { in: scope.branchIds } };

  const [branches, staff, products] = await runWithOrg(orgId, () =>
    Promise.all([
      prisma.branch.findMany({
        where: branchWhere,
        select: { id: true, name: true, parentId: true },
        orderBy: { name: "asc" },
      }),
      prisma.staffUser.findMany({
        where: { orgId, status: "ACTIVE", ...(scope.unrestricted ? {} : { branchId: { in: scope.branchIds } }) },
        select: { id: true, firstName: true, otherName: true, branchId: true, role: { select: { title: true } } },
        orderBy: [{ firstName: "asc" }, { otherName: "asc" }],
      }),
      prisma.product.findMany({
        where: { orgId, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ]),
  );

  const nameOf = new Map(branches.map((b) => [b.id, b.name]));

  // Depth is computed against the branches we actually loaded: for a regional
  // manager the subtree root IS depth 0, so their picker reads as their own tree
  // rather than as a fragment indented under invisible ancestors.
  const loaded = new Set(branches.map((b) => b.id));
  const depthOf = (id: string): number => {
    let depth = 0;
    let cur = branches.find((b) => b.id === id)?.parentId ?? null;
    // Bounded by the number of branches — a malformed tree cannot spin here.
    while (cur && loaded.has(cur) && depth < branches.length) {
      depth += 1;
      cur = branches.find((b) => b.id === cur)?.parentId ?? null;
    }
    return depth;
  };

  const axes: FilterAxis[] = [];

  // A branch axis with one node tells you nothing — a branch manager gets officers,
  // not a picker containing their own branch.
  if (branches.length > 1) {
    axes.push({
      key: "branch",
      label: scope.unrestricted ? "Office / region" : "Branch",
      emptyHint: "No branches under you yet.",
      multi: true,
      options: branches
        .map((b) => ({
          id: b.id,
          label: b.name,
          hint: b.parentId ? nameOf.get(b.parentId) ?? undefined : "Head office",
          depth: depthOf(b.id),
        }))
        .sort((a, z) => (a.depth! - z.depth!) || a.label.localeCompare(z.label)),
    });
  }

  if (staff.length > 1) {
    axes.push({
      key: "officer",
      label: "Officer",
      emptyHint: "No active staff in your scope.",
      multi: true,
      options: staff.map((s) => ({
        id: s.id,
        label: [s.firstName, s.otherName].filter(Boolean).join(" "),
        hint: [s.role?.title, s.branchId ? nameOf.get(s.branchId) : null].filter(Boolean).join(" · ") || undefined,
      })),
    });
  }

  if (products.length > 0) {
    axes.push({
      key: "product",
      label: "Product",
      emptyHint: "No active products yet.",
      multi: true,
      options: products.map((p) => ({ id: p.id, label: p.name })),
    });
  }

  // Scope allowed a filter, but the lender has no structure worth filtering on yet
  // (a brand-new org: one branch, one person, no products). Withhold rather than
  // open an empty dialog.
  return { canFilter: axes.length > 0, scopeLabel, scopeKind: scope.kind, axes };
}
