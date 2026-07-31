// The data-scope vocabulary on its own, with no imports.
//
// `scope.ts` reaches for Prisma, so anything that merely needs to NAME a scope —
// a client component, a shared type, a filter surface — would drag the whole
// database stack into the browser bundle by importing from there. The four names
// live here instead; `scope.ts` re-exports them, so existing imports are unchanged.
//
//   OWN          only what this person originated — an officer's own portfolio
//   BRANCH       everything booked at their branch
//   BRANCH_TREE  their branch and every branch beneath it — a region
//   ORG          the whole lender — head office, admins, auditors
export type DataScopeKind = "OWN" | "BRANCH" | "BRANCH_TREE" | "ORG";
