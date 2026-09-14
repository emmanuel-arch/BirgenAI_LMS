// ─────────────────────────────────────────────────────────────────────────────
// The signed-in customer's Borrower row — found, or for an existing lender
// customer, resolved from the lender's own book.
//
// A new customer gets their row from /api/portal/register at the end of KYC. A
// Micromart customer of ten years has no row here at all, and nothing that hangs
// off a borrower — a crunch, a bureau file, an application — can be recorded for
// them until they do. So the row is created from the lender's live record, the
// same resolution the console performs when an officer opens a live customer.
//
// Which record: the id the password door put on the session when there is one
// (and only when the book that answered is this org's own entity), otherwise the
// phone the session proved, matched on this org's entity. A phone that matches
// two records resolves to nobody — see lib/portal/micromart-book.ts.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import type { ResolvedOrg } from "@/lib/tenancy";
import type { BorrowerSession } from "./session";
import { resolveLiveBorrower } from "@/lib/lms/resolve-live-borrower";
import { findBookBorrower } from "./micromart-book";

export async function portalBorrowerId(org: ResolvedOrg, session: BorrowerSession): Promise<string | null> {
  const found = await prisma.borrower.findFirst({
    where: { orgId: org.id, phone: { endsWith: session.phone.slice(-9) }, erasedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (found) return found.id;

  let ssId = Number(session.ssBorrowerId);
  if (!(Number.isInteger(ssId) && ssId > 0 && session.ssEntityId === org.entityId)) {
    ssId = 0;
    if (org.mode !== "NATIVE" && org.registry && org.entityId) {
      const who = await findBookBorrower(org.registry, org.entityId, session.phone).catch(() => null);
      if (who?.kind === "found") ssId = who.borrowerId;
    }
  }
  if (ssId > 0) {
    const r = await resolveLiveBorrower(org, ssId, { id: "portal" }).catch(() => null);
    if (r?.ok) return r.borrowerId;
  }
  return null;
}
