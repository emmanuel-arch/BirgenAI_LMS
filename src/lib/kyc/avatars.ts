// ─────────────────────────────────────────────────────────────────────────────
// BORROWER PORTRAITS — the face beside the name.
//
// The white-background portrait a customer stands for at the end of KYC is the one
// identity artifact that is USEFUL to have on screen. An officer scanning a loans
// list is looking for a person, and a person is a face, not a phone number. It is
// also the cheapest fraud control there is: the officer who registered Mwangi will
// notice, instantly and without being asked to, when the face beside his name is
// someone else's.
//
// SO WHY IS THIS NOT AUDIT-LOGGED, when /api/console/kyc/asset logs every view?
// Because they are different things, and conflating them would wreck the log that
// matters. Opening someone's NATIONAL ID SCAN is an event: rare, deliberate,
// accountable — that is what the DPA expects a lender to be able to account for, and
// each one gets a row. A portrait rendering next to a name in a list an officer has
// open all day is not an event; logging it would write thousands of rows a day and
// bury the handful that mean something. The portrait is the least sensitive artifact
// KYC produces and the most operationally necessary. The documents stay behind the
// click, the audit row and the two-minute link. The face does not.
//
// Signed in one batch (see signedUrls): fifty faces must not cost fifty round trips.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { signedUrls } from "@/lib/storage/provider";

/**
 * Longer than a document's two minutes: a portrait sits in a list the officer keeps
 * open, and a face that turns into a broken image after two minutes is worse than no
 * face at all. Still short enough that a copied URL is worthless by the time it is
 * pasted anywhere.
 */
export const PORTRAIT_TTL_SEC = 600;

export type PortraitMap = Record<string, string>;

/**
 * borrowerId → signed portrait URL, for those that have one.
 *
 * RLS scopes the read, so this cannot return a face from another lender however the
 * ids were obtained. A borrower with no portrait simply has no entry — the caller
 * falls back to initials, which is the normal state for a lender who has not yet
 * connected object storage.
 */
export async function portraitsFor(borrowerIds: string[]): Promise<PortraitMap> {
  const ids = [...new Set(borrowerIds.filter(Boolean))];
  if (ids.length === 0) return {};

  const rows = await prisma.borrower.findMany({
    where: { id: { in: ids }, portraitKey: { not: null } },
    select: { id: true, portraitKey: true },
  });
  if (rows.length === 0) return {};

  const signed = await signedUrls(rows.map((r) => r.portraitKey!), PORTRAIT_TTL_SEC);

  const out: PortraitMap = {};
  for (const r of rows) {
    const url = signed.get(r.portraitKey!);
    if (url) out[r.id] = url;
  }
  return out;
}
