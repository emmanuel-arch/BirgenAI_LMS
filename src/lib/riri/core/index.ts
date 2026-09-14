// ─────────────────────────────────────────────────────────────────────────────
// RIRI CORE — one brain, five contracts.
//
// Riri Ecosystem AI plan, §02 and Sprint 1. Everything Riri needs about the world
// arrives through these five, and a host implements them:
//
//   1 · Host         host.ts         who is asking, who they are looking at, memory
//   2 · Context      core/context    where she is standing — every field server-resolved
//   3 · Corpus       pack.ts         ours in code, theirs in JSON, one validator
//   4 · Tools        core/tools      the only route to a fact; the gate is in the body
//   5 · Destination  core/destination the federated map, and the signed hand-off
//
// ── THE BOUNDARY IS TESTED, NOT PROMISED ─────────────────────────────────────
// Nothing reachable from this file may import the application: no `@/`, no
// Prisma, no Next, no React. scripts/verify-riri-core.ts walks the import graph
// from here and fails the build the day somebody adds one. That is what makes
// the console a HOST of Riri rather than her owner — providers/lms.ts and
// providers/portal.ts implement these contracts over our database; a partner
// implements them over theirs, and nothing here changes.
//
// It is a folder boundary inside connected-suite rather than a published
// package, deliberately, for now: extracting to `@riri/core` is a move of this
// folder and the three pure files it re-exports, and the purity test is the
// proof that the move will not drag the application along with it.
// ─────────────────────────────────────────────────────────────────────────────
export * from "./context";
export * from "./tools";
export * from "./destination";
export type { RiriHost, RiriActor, RiriSubjectFacts, RiriMemoryNote } from "../host";
export {
  validatePack, appRouteProblem, sourceRef, embeddableText,
  type Pack, type PackEntry, type PackAudience, type PackAuthority, type PackIssue, type PackValidation, type SourceRef,
} from "../pack";
