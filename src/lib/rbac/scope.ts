// ─────────────────────────────────────────────────────────────────────────────
// DATA SCOPE — not "may you open this screen", but "whose rows are on it".
//
// Rights (rights.ts) and scope are orthogonal, and conflating them is how lending
// systems leak a book. A Loan Officer and a Branch Manager hold almost the same
// rights — both may view borrowers, both may take an application — yet they must
// not see the same rows. Before this file, `borrowers.view` meant EVERY borrower in
// the lender: a one-branch officer could read the whole book, and a regional manager
// could not be given a region because a region was not a thing the system knew about.
//
// Four scopes, set per Role:
//
//   OWN          only what this person originated — an officer's own portfolio
//   BRANCH       everything booked at their branch
//   BRANCH_TREE  their branch and every branch beneath it — a region
//   ORG          the whole lender — head office, admins, auditors
//
// THE TREE IS THE ORG. One self-referencing Branch table, root = head office
// (parentId null), and the lender names their own levels ("Region", "Branch",
// "Sub-branch"), exactly as ServiceSuite's units tree does. BRANCH_TREE is what makes
// a regional manager expressible without a second hierarchy: their scope is the
// subtree under the node they sit at.
//
// THREE RULES THAT KEEP THIS HONEST:
//
//   1. It DEFAULTS TO ORG. Adding scope changed nothing for roles that existed before
//      it: a lender narrows deliberately, rather than discovering after a deploy that
//      their officers went blind.
//   2. An IMPERSONATOR and a scope-less staff member get ORG — the pre-existing
//      behaviour, never a lockout. Failing closed on *visibility* would mean an
//      officer's screen silently empties, which reads as "the system lost my
//      customers" and is worse than the thing it prevents. (Failing closed on RIGHTS
//      is a different question, and there we do.)
//   3. It is ENFORCED IN THE QUERY, never in the page. A filtered list that still
//      shipped the rows in the HTML is the bug the billing work already caught once.
//      These helpers return Prisma `where` fragments so the rows never load.
//
// This is NOT a tenancy boundary — RLS is (prisma/rls.sql), and it is a database
// guarantee. This is a *within*-lender visibility boundary: the blast radius of
// getting it wrong is one lender's officer seeing another branch's customers, not
// one lender seeing another lender's book.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { runWithOrg } from "@/lib/db/context";
import type { Session } from "@/lib/auth";

export type DataScopeKind = "OWN" | "BRANCH" | "BRANCH_TREE" | "ORG";

export type ResolvedScope = {
  kind: DataScopeKind;
  orgId: string;
  /** The staff member whose eyes these are. Null for an impersonator/platform view. */
  staffId: string | null;
  /** Their own branch, if they have one. */
  branchId: string | null;
  /** Every branch this scope may see. Empty for OWN and ORG (neither filters by branch). */
  branchIds: string[];
  /** True when this scope sees everything — lets call sites skip the filter entirely. */
  unrestricted: boolean;
};

export const SCOPE_LABELS: Record<DataScopeKind, { label: string; help: string }> = {
  OWN: { label: "Only their own customers", help: "They see the borrowers, applications and loans they personally registered. What a loan officer should have." },
  BRANCH: { label: "Their whole branch", help: "Everything booked at the branch they belong to, whoever registered it. What a branch manager should have." },
  BRANCH_TREE: { label: "Their branch and everything under it", help: "Their branch plus every branch beneath it in the structure. What a regional manager should have." },
  ORG: { label: "The entire organisation", help: "Every branch, every officer, the whole book. Head office, admins and auditors." },
};

// Branch trees are small (tens of nodes) and change rarely, but the descendant walk
// runs on every scoped request — so it is cached briefly, off globalThis for the same
// reason the entitlements cache had to be: Next compiles each route and page into its
// own server bundle, and a module-level Map is instantiated once PER BUNDLE.
const TTL_MS = 30_000;
const globalForScope = globalThis as unknown as {
  branchTreeCache?: Map<string, { at: number; parentOf: Map<string, string | null> }>;
};
const treeCache = (globalForScope.branchTreeCache ??= new Map());

async function branchParents(orgId: string): Promise<Map<string, string | null>> {
  const hit = treeCache.get(orgId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.parentOf;

  const rows = await runWithOrg(orgId, () =>
    prisma.branch.findMany({ where: { orgId }, select: { id: true, parentId: true } }),
  );
  const parentOf = new Map(rows.map((r) => [r.id, r.parentId]));
  treeCache.set(orgId, { at: Date.now(), parentOf });
  return parentOf;
}

export function invalidateBranchTree(orgId: string): void {
  treeCache.delete(orgId);
}

/**
 * A branch and everything beneath it.
 *
 * Walks children rather than recursing in SQL because the tree is tiny, and guards
 * against a cycle: a branch tree with a loop in it (A's parent is B, B's parent is A —
 * one bad edit away) would otherwise hang the request rather than render a screen.
 */
export async function descendantBranchIds(orgId: string, rootId: string): Promise<string[]> {
  const parentOf = await branchParents(orgId);
  const childrenOf = new Map<string, string[]>();
  for (const [id, parent] of parentOf) {
    if (!parent) continue;
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), id]);
  }

  const out: string[] = [];
  const seen = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue; // a cycle must not become an infinite loop
    seen.add(id);
    out.push(id);
    stack.push(...(childrenOf.get(id) ?? []));
  }
  return out;
}

/** The root of the lender's structure — their head office. */
export async function headOfficeId(orgId: string): Promise<string | null> {
  const root = await runWithOrg(orgId, () =>
    prisma.branch.findFirst({ where: { orgId, parentId: null }, orderBy: { createdAt: "asc" }, select: { id: true } }),
  );
  return root?.id ?? null;
}

/**
 * What this session may see.
 *
 * Reads the scope from the staff member's ROLE on every request — the same live read
 * `getRights` does — so narrowing a role takes effect within seconds and without a
 * re-login. An impersonating platform admin sees everything, by design: they are there
 * to reproduce a problem across the lender.
 */
export async function resolveScope(session: Session): Promise<ResolvedScope> {
  // Every call site has already refused an anonymous request (`if (!session?.user?.orgId)
  // return 401`), so the tenant is known by the time we get here.
  const orgId = session!.user!.orgId!;
  const staffId = session!.user!.id ?? null;
  const impersonator = session!.user!.impersonator;
  const unrestrictedScope = (branchId: string | null): ResolvedScope =>
    ({ kind: "ORG", orgId, staffId, branchId, branchIds: [], unrestricted: true });

  if (impersonator) return unrestrictedScope(null);
  if (!staffId) return unrestrictedScope(null);

  const staff = await runWithOrg(orgId, () =>
    prisma.staffUser.findFirst({
      where: { id: staffId, orgId },
      select: { branchId: true, role: { select: { dataScope: true } } },
    }),
  );

  const kind = (staff?.role?.dataScope ?? "ORG") as DataScopeKind;
  const branchId = staff?.branchId ?? null;
  if (kind === "ORG") return unrestrictedScope(branchId);

  // A person with a branch-shaped scope but NO branch cannot be filtered by branch.
  // Widening them to ORG would leak the book; narrowing them to nothing would empty
  // their screen with no explanation. Neither is right — so they fall back to OWN,
  // which is always true of them and always safe, and the branch pages tell an admin
  // to assign them a branch.
  if ((kind === "BRANCH" || kind === "BRANCH_TREE") && !branchId) {
    return { kind: "OWN", orgId, staffId, branchId: null, branchIds: [], unrestricted: false };
  }

  // ORG returned above; only OWN / BRANCH / BRANCH_TREE reach here, so none is unrestricted.
  const branchIds =
    kind === "BRANCH" ? [branchId!]
      : kind === "BRANCH_TREE" ? await descendantBranchIds(orgId, branchId!)
        : [];

  return { kind, orgId, staffId, branchId, branchIds, unrestricted: false };
}

// ── The `where` fragments ─────────────────────────────────────────────────────
//
// Each returns a filter to AND into a query. `{}` means "no restriction" and is the
// ORG case. They are separate functions rather than one generic because the three
// tables name their owner differently (Borrower.createdById, LoanApplication.officerId,
// Loan.createdBy) — and a generic that took the column name as a string would be one
// typo away from silently filtering on nothing.

/** Borrowers this scope may see. */
export function borrowerScopeWhere(scope: ResolvedScope) {
  if (scope.unrestricted) return {};
  if (scope.kind === "OWN") return { createdById: scope.staffId };
  return { branchId: { in: scope.branchIds } };
}

/** Applications this scope may see. */
export function applicationScopeWhere(scope: ResolvedScope) {
  if (scope.unrestricted) return {};
  if (scope.kind === "OWN") return { officerId: scope.staffId };
  return { branchId: { in: scope.branchIds } };
}

/** Loans this scope may see. */
export function loanScopeWhere(scope: ResolvedScope) {
  if (scope.unrestricted) return {};
  if (scope.kind === "OWN") return { createdBy: scope.staffId };
  return { branchId: { in: scope.branchIds } };
}

/**
 * May this scope see this ONE borrower?
 *
 * Used by every drill-through (Customer-360, the KYC queue, a statement). A list that
 * filters correctly while the detail page happily renders any id you type is not a
 * boundary — it is a speed bump.
 */
export async function canSeeBorrower(scope: ResolvedScope, borrowerId: string): Promise<boolean> {
  if (scope.unrestricted) return true;
  const found = await prisma.borrower.findFirst({
    where: { id: borrowerId, orgId: scope.orgId, ...borrowerScopeWhere(scope) },
    select: { id: true },
  });
  return Boolean(found);
}

/**
 * The stamp put on a new borrower/application/loan: whose is it, and where.
 *
 * A borrower who arrived through the public portal has no officer. They are stamped to
 * the head office rather than left null — a null branch belongs to no one, would be
 * invisible to every scope except ORG, and would quietly accumulate a pile of leads
 * nobody was told about.
 */
export async function originStamp(
  orgId: string,
  staff: { id: string; branchId: string | null } | null,
): Promise<{ staffId: string | null; branchId: string | null }> {
  if (staff?.branchId) return { staffId: staff.id, branchId: staff.branchId };
  const root = await headOfficeId(orgId);
  return { staffId: staff?.id ?? null, branchId: staff?.branchId ?? root };
}
