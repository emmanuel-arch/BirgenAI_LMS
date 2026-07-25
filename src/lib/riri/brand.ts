// ─────────────────────────────────────────────────────────────────────────────
// THE ASSISTANT'S OUTWARD NAME.
//
// One string, shown on every screen a user reads. The internal identifiers stay
// `riri` on purpose — component names, `lib/riri/*`, `/api/console/riri`, the
// `riri.use` right, the `riri:open` event, CSS classes — renaming those is churn
// with zero user-visible payoff and a lot of ways to break. This is the only name
// the product wears in public.
//
// The VOICE is unchanged: still the warm Kenyan-colleague persona (persona.ts) —
// she just introduces herself as ServiceSuite AI now. White-label later by making
// this brand-driven per lender; today it is one word to change.
// ─────────────────────────────────────────────────────────────────────────────
export const ASSISTANT_NAME = "ServiceSuite AI";

/** A short form for tight chrome (avatars, single-word chips) if ever needed. */
export const ASSISTANT_SHORT = "ServiceSuite AI";
