// ─────────────────────────────────────────────────────────────────────────────
// Turn a BRIDGED lender's live customer reference into a local Borrower row.
//
// A bridged lender's book is read through to their ServiceSuite, so every row
// the console lists carries `ss:<id>` rather than an LMS uuid. Nothing that
// hangs off a borrower — Customer 360, KYC, limits, applications, pins — can be
// rendered from such a ref, because none of it exists for somebody who has never
// been through our funnel.
//
// This was written once, inline, inside the /console/borrowers/resolve/[ref]
// PAGE. That was fine while opening Customer 360 was the only way to reach a
// live customer, and it stopped being fine the moment a SECOND screen — Apply
// for a Borrower — started listing the same rows: that screen took the `ss:<id>`
// straight from the search result and asked /api/console/borrowers/<ref>/profile
// for it, which is a Postgres lookup on a string that is not a uuid. The officer
// picked a customer who was plainly there on screen and got "Borrower not found."
//
// So the resolution lives here now, callable from a page or a route handler, and
// there is exactly one description of what resolving a live customer means.
//
// WHY A WRITE HAPPENS AT ALL, AND WHY IT IS NOT A MIRROR: we deliberately do not
// copy 17,000 borrowers into Postgres — the book is read live so it can never go
// stale. A record is created only for a customer an officer actually opens to
// work, the same bargain `ensureBorrower` strikes in the other direction when it
// registers OUR customer in THEIR ledger. Browsing costs nothing; working a
// customer creates the record.
//
// Idempotent, keyed on (orgId, phone): re-opening finds the existing record and
// refreshes the LENDER-owned fields rather than duplicating anyone. Fields WE own
// (KYC state, pins, consent) are never touched here.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { originStamp } from "@/lib/rbac/scope";
import { getLiveBorrowerById } from "@/lib/lms/servicesuite";
import { normaliseBandName } from "@/lib/risk/bands";
import type { ResolvedOrg } from "@/lib/tenancy";

/** Digits-only, the way the Borrower table stores them (2547XXXXXXXX). */
const cleanPhone = (p: string) => p.replace(/\D/g, "");

/** "ss:168346" ⇒ 168346. Anything else is not a live ref. */
export function parseLiveRef(ref: string): number | null {
  const m = decodeURIComponent(ref ?? "").match(/^ss:(\d+)$/);
  return m ? Number(m[1]) : null;
}

/** True for a reference that must be resolved before it can be used as an id. */
export const isLiveRef = (ref: string | null | undefined): boolean => parseLiveRef(ref ?? "") != null;

export type ResolveOutcome =
  | { ok: true; borrowerId: string; created: boolean }
  | { ok: false; title: string; detail: string };

export async function resolveLiveBorrower(
  org: ResolvedOrg,
  serviceSuiteId: number,
  actor: { id: string },
): Promise<ResolveOutcome> {
  if (!org.registry || !org.bridgedReady || !org.entityId) {
    return {
      ok: false,
      title: "This lender's book is not connected",
      detail: "Live customers can only be opened while the connection to the lender's own system is configured and reachable. Reconnect it, then try again.",
    };
  }

  const orgId = org.id;
  let seed: Awaited<ReturnType<typeof getLiveBorrowerById>>;
  try {
    seed = await getLiveBorrowerById(org.registry, org.entityId, serviceSuiteId);
  } catch (err) {
    return {
      ok: false,
      title: "Could not read that customer from the lender's system",
      detail: err instanceof Error ? err.message : "The lender's database did not answer. Try again in a moment.",
    };
  }

  if (!seed) {
    return {
      ok: false,
      title: "That customer is no longer in the lender's book",
      detail: `Customer ${serviceSuiteId} was not found in entity ${org.entityId}. They may have been moved to another entity or removed since the list was loaded.`,
    };
  }

  const phone = cleanPhone(seed.phone ?? "");
  if (phone.length < 9) {
    return {
      ok: false,
      title: "This customer has no usable phone number",
      detail: "Their record in the lender's system has no valid mobile number, and a customer is identified by phone here. Correct it in ServiceSuite first — every message, OTP and repayment depends on it.",
    };
  }

  const lenderOwned = {
    firstName: seed.firstName,
    otherName: seed.otherName,
    nationalId: seed.nationalId,
    email: seed.email,
    dob: seed.dob ? new Date(seed.dob) : null,
    gender: seed.gender,
    // ── THE SCORE GOES IN THE COLUMN THAT MATCHES ITS SCALE ──────────────────
    // ServiceSuite's `CreditScore` is a points field running into the millions on
    // entity 3005 (mean 4,271), while every band function here reads `creditScore`
    // as 300–900. Writing one into the other told officers that people 47 days in
    // arrears "pay on time, every time". Their RiskScore is the 0–100 figure our
    // `behaviouralScore` already uses; `creditScore` stays NULL until the statement
    // cruncher puts a real 900-scale number in it.
    behaviouralScore: seed.riskScore,
    riskBand: seed.riskCategory ? normaliseBandName(seed.riskCategory) : null,
    lastScoredAt: seed.riskScore != null ? new Date() : null,
    loanLimit: seed.loanLimit,
    previousLoanLimit: seed.previousLoanLimit,
    graduationCount: seed.graduationCount,
    // The id we just looked them up by. Storing it is what lets every later read
    // go straight to the right row instead of matching on a phone number two
    // customers can share.
    serviceSuiteBorrowerId: seed.serviceSuiteId,
  };

  const existing = await prisma.borrower.findUnique({
    where: { orgId_phone: { orgId, phone } },
    select: { id: true },
  });

  if (existing) {
    await prisma.borrower.update({ where: { id: existing.id }, data: lenderOwned });
    return { ok: true, borrowerId: existing.id, created: false };
  }

  // The officer who opens them owns them, so an OWN-scoped officer keeps seeing
  // their own book (lib/rbac/scope.ts).
  const me = await prisma.staffUser.findFirst({
    where: { id: actor.id, orgId },
    select: { id: true, branchId: true },
  });
  const origin = await originStamp(orgId, me);
  const created = await prisma.borrower.create({
    data: { orgId, createdById: origin.staffId, branchId: origin.branchId, phone, language: "en", ...lenderOwned },
    select: { id: true },
  });

  await prisma.auditLog.create({
    data: {
      orgId,
      actorId: actor.id,
      actorType: "staff",
      action: "borrower.resolve",
      entity: "Borrower",
      entityId: created.id,
      meta: {
        channel: "console",
        source: "servicesuite",
        entityId: org.entityId,
        serviceSuiteBorrowerId: serviceSuiteId,
        accountNo: seed.accountNo,
        phone,
      },
    },
  }).catch(() => {});

  return { ok: true, borrowerId: created.id, created: true };
}
