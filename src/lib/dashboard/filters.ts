// ─────────────────────────────────────────────────────────────────────────────
// THE FILTER MODEL — who may re-cut the dashboard, and along which axes.
//
// ServiceSuite ships ONE filter modal to everybody: four raw <select>s
// (Organization Level, Office, Product, Agent), the Office list a ~40-item
// unsearchable native scroll box, and the same dialog opens for a field officer,
// a branch manager and the CEO alike. Scoping is whatever the stored proc decides
// afterwards. There is no notion of "this filter is not yours to open".
//
// Ours derives the filter surface from the caller's DataScope (src/lib/rbac/scope.ts),
// which is the same thing that already decides whose rows they may read. Two rules
// make it coherent:
//
//   1. YOU MAY ONLY FILTER WITHIN WHAT YOU MAY ALREADY SEE. A regional manager's
//      branch picker contains their subtree and nothing else — not because the UI
//      hides the rest, but because the server never sends it. A filter surface built
//      from a full org list is an org-chart disclosure with a dropdown around it.
//
//   2. A FILTER WITH ONE POSSIBLE ANSWER IS NOT A FILTER. A field officer sees only
//      their own customers, so every axis would collapse to a single value — and the
//      button itself is withheld rather than opening onto a dialog that can only tell
//      them what they already know. `canFilter` is false and the dashboard renders
//      clean, which is the founder's ask stated exactly.
//
// The AXES a person gets are therefore a function of scope, not of job title:
//
//   ORG          region · branch · officer · product     ("whole book" + everything)
//   BRANCH_TREE  branch (own subtree) · officer · product ("my region")
//   BRANCH       officer (own branch) · product           ("my branch")
//   OWN          — none; no filter button
// ─────────────────────────────────────────────────────────────────────────────
import type { DataScopeKind } from "@/lib/rbac/scope-kind";
import type { RangeKey } from "./model";

/** One selectable value on an axis. */
export type FilterOption = {
  id: string;
  label: string;
  /** Secondary line — a branch's parent, an officer's branch. Disambiguates duplicates. */
  hint?: string;
  /** Depth in the branch tree, for indentation. Absent on flat axes. */
  depth?: number;
};

export type FilterAxis = {
  key: "branch" | "officer" | "product";
  /** The lender's own word for it where one exists ("Region", "Office"). */
  label: string;
  /** Shown when the axis is empty rather than rendering a dead control. */
  emptyHint: string;
  multi: boolean;
  options: FilterOption[];
};

/** What the server tells the client it is allowed to offer. */
export type FilterCapability = {
  canFilter: boolean;
  /** The widest cut this person may take — labels the "reset" state honestly. */
  scopeLabel: string;
  scopeKind: DataScopeKind;
  axes: FilterAxis[];
};

/** What the client sends back. Every field optional; absent = unfiltered. */
export type FilterSelection = {
  range: RangeKey;
  branchIds: string[];
  officerIds: string[];
  productIds: string[];
  compare: boolean;
};

export const EMPTY_SELECTION: FilterSelection = {
  range: "30d",
  branchIds: [],
  officerIds: [],
  productIds: [],
  compare: false,
};

export const SCOPE_HEADLINE: Record<DataScopeKind, string> = {
  ORG: "Whole book",
  BRANCH_TREE: "My region",
  BRANCH: "My branch",
  OWN: "My customers",
};

/** How many axes are actually narrowed — drives the badge on the filter button. */
export function activeCount(sel: FilterSelection): number {
  return (
    (sel.branchIds.length ? 1 : 0) +
    (sel.officerIds.length ? 1 : 0) +
    (sel.productIds.length ? 1 : 0)
  );
}
