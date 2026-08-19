// ─────────────────────────────────────────────────────────────────────────────
// THE PER-STAGE CRB GATE — may this stage be actioned, and if not, what pull
// would unblock it?
//
// Extracted from the stage-action route because the interesting part is not the
// query, it is the FORCE decision, and that has a failure mode worth pinning
// down in a test rather than rediscovering in production:
//
//   The gate's freshness window (30 days) and the CRB endpoint's REUSE window
//   (Settings → Bureau scrutiny, `reuseHours`) are two different numbers set by
//   two different people for two different reasons. If a lender widens reuse
//   past 30 days, an officer clicking "Run CRB check" gets a pull that
//   "succeeds" by handing back the very file the gate just rejected — and the
//   stage refuses again. The officer loops, and every loop looks like a bug in
//   the button.
//
//   So when the newest file is too old for the gate, the pull must be FORCED.
//   Forcing costs money, which is exactly why it is not the default: it is
//   requested only when a cheaper pull provably cannot clear the gate.
// ─────────────────────────────────────────────────────────────────────────────

/** How long a bureau file satisfies a `crbRequired` stage. */
export const CRB_FRESH_DAYS = 30;

export type CrbGateDecision =
  | { blocked: false }
  | {
      blocked: true;
      /** A file exists but predates the window — it must be replaced, not re-served. */
      stale: boolean;
      /** Pass to POST /api/console/crb so the pull can actually clear this gate. */
      force: boolean;
      lastCheckedAt: Date | null;
    };

/**
 * @param lastCheckedAt newest stored CRB pull for the borrower, or null if none
 * @param now           injected so the test does not depend on the wall clock
 */
export function crbGateDecision(
  lastCheckedAt: Date | null,
  now: Date = new Date(),
  freshDays: number = CRB_FRESH_DAYS,
): CrbGateDecision {
  if (!lastCheckedAt) return { blocked: true, stale: false, force: false, lastCheckedAt: null };
  const freshAfter = new Date(now.getTime() - freshDays * 24 * 60 * 60 * 1000);
  if (lastCheckedAt >= freshAfter) return { blocked: false };
  return { blocked: true, stale: true, force: true, lastCheckedAt };
}
