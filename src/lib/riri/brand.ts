// ─────────────────────────────────────────────────────────────────────────────
// THE ASSISTANT'S OUTWARD NAME.
//
// One string, shown on every screen a user reads. The internal identifiers stay
// `riri` on purpose — component names, `lib/riri/*`, `/api/console/riri`, the
// `riri.use` right, the `riri:open` event, CSS classes — renaming those is churn
// with zero user-visible payoff and a lot of ways to break.
//
// ── DECIDED 11 SEP 2026: SHE IS RIRI ─────────────────────────────────────────
//
// She wore "ServiceSuite AI" for a while, and the reasoning then was sound: this
// console was being sold into ServiceSuite's world and the name matched the
// vocabulary the buyer already had. What changed is the ambition. She is now being
// built to live in OTHER PEOPLE'S systems — a lender's own console, a partner's
// app — and a product named after one host cannot be installed in another. Nobody
// puts "ServiceSuite AI" in their own software.
//
// So the product name is **Riri**, and the host may white-label it. Those are not
// in tension: Riri is what she is called by default and what we sell; a lender who
// wants her badged as theirs overrides the string and gets the same assistant in
// their own clothes. The internal ids never move either way, which is the whole
// reason this indirection is worth having.
//
// THE VOICE DOES NOT CHANGE, EVER. persona.ts is the warm Kenyan colleague from
// Westlands whatever the nameplate says. White-labelling renames the product; it
// does not hand a lender a personality dial. An assistant whose character varies
// per deployment is one nobody can be trained on, supported, or held to a standard.
//
// ── AND THE FACTS ARE NOT OURS ───────────────────────────────────────────────
// Decided in the same breath: her voice is ours, the FACTS are the tenant's, and
// the pack id is on every answer. See lib/riri/pack.ts — `sourceRef()` is that
// decision in code. It is what makes white-labelling honest rather than a way to
// launder whose fee was quoted wrong.
// ─────────────────────────────────────────────────────────────────────────────

/** The product name. What she is called unless a host says otherwise. */
export const ASSISTANT_NAME = "Riri";

/** A short form for tight chrome (avatars, single-word chips). */
export const ASSISTANT_SHORT = "Riri";

/**
 * What a given host calls her.
 *
 * The seam for white-labelling, deliberately a function rather than a second
 * constant: a host that has no opinion gets Riri, and a host with one gets exactly
 * one string's worth of override. Everything else about her — the voice, the
 * refusals, the evidence stamp, the pack ids on her answers — is identical.
 *
 * Kept trivial on purpose. When this becomes per-lender configuration it reads the
 * org's branding row and nothing else in the codebase has to move, because every
 * caller already goes through here or through ASSISTANT_NAME.
 */
export function assistantName(host?: { assistantName?: string | null }): string {
  const override = host?.assistantName?.trim();
  return override && override.length > 0 ? override : ASSISTANT_NAME;
}
