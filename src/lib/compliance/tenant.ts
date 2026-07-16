// ─────────────────────────────────────────────────────────────────────────────
// TENANT DELETION — a lender leaves, and takes their book with them.
//
// This is the most destructive operation in the product. It is therefore:
//
//   • NOT AVAILABLE FROM THE LENDER'S OWN CONSOLE. An org admin may raise the
//     request (ComplianceRequest ORG_DELETION); only BirgenAI executes it, from
//     /platform. A console that can delete its own tenant is one compromised admin
//     session away from deleting a tenant.
//
//   • REFUSED WHILE MONEY IS OUTSTANDING. A lender with live loans has borrowers
//     who owe them money and repayment schedules those borrowers are following.
//     Destroying that book does not end those obligations, it just means nobody
//     can prove them. Close the loans first.
//
//   • REFUSED UNTIL THEY HOLD A COPY. We will not be the reason a lender loses
//     seven years of records they are legally required to keep. An ORG_EXPORT must
//     exist in their register before the book can be destroyed — they leave with
//     their data, not without it.
//
// The audit row survives the org. Everything else goes.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { deleteObjects, deleteBrandLogo, KYC_BUCKET, DOCS_BUCKET } from "@/lib/storage/provider";

export type TenantDeletionBlocker = { code: "OPEN_LOANS" | "NO_EXPORT"; message: string };

/** Why this org may NOT be deleted right now. Empty ⇒ it may. */
export async function tenantDeletionBlockers(orgId: string): Promise<TenantDeletionBlocker[]> {
  const blockers: TenantDeletionBlocker[] = [];

  const openLoans = await prisma.loan.count({
    where: { orgId, status: { in: ["ACTIVE", "PENDING_DISBURSEMENT"] } },
  });
  if (openLoans > 0) {
    blockers.push({
      code: "OPEN_LOANS",
      message: `This lender still has ${openLoans} open loan${openLoans === 1 ? "" : "s"}. Borrowers owe money against them. Close or write them off before the book can be destroyed.`,
    });
  }

  const exported = await prisma.complianceRequest.count({ where: { orgId, kind: "ORG_EXPORT", status: "COMPLETED" } });
  if (exported === 0) {
    blockers.push({
      code: "NO_EXPORT",
      message:
        "This lender has never exported their book. They are legally required to keep these records for seven years — they must take a copy before we destroy ours. Ask them to run the export from Compliance & Data.",
    });
  }

  return blockers;
}

export type TenantDeletionOutcome = {
  slug: string;
  objectsDeleted: number;
  rowsDeleted: Record<string, number>;
  deletedAt: string;
};

/**
 * Destroy a tenant. Call under runAsPlatform().
 *
 * ORDER IS THE WHOLE JOB. Postgres will refuse a delete that orphans a foreign key,
 * so children come before parents; the storage objects come FIRST, because a row is
 * the only pointer we have to the bytes it owns, and deleting the row first would
 * strand a national ID photograph in a bucket that nothing will ever clean up again.
 */
export async function deleteTenant(orgId: string): Promise<TenantDeletionOutcome> {
  const org = await prisma.org.findUniqueOrThrow({ where: { id: orgId }, select: { slug: true, logoUrl: true } });

  // ── 1. The bytes. ──────────────────────────────────────────────────────────
  const [borrowers, sessions, documents] = await Promise.all([
    prisma.borrower.findMany({ where: { orgId }, select: { portraitKey: true, selfieKey: true, idFrontKey: true, idBackKey: true } }),
    prisma.kycSession.findMany({ where: { orgId }, select: { idFrontKey: true, idBackKey: true, selfieKey: true, portraitKey: true } }),
    prisma.document.findMany({ where: { orgId }, select: { storageKey: true } }),
  ]);
  const kycKeys = [...borrowers, ...sessions]
    .flatMap((r) => [r.portraitKey, r.selfieKey, r.idFrontKey, r.idBackKey])
    .filter((k): k is string => !!k);
  const docKeys = documents.map((d) => d.storageKey).filter(Boolean);

  const objectsDeleted = (await deleteObjects(kycKeys, KYC_BUCKET)) + (await deleteObjects(docKeys, DOCS_BUCKET));
  await deleteBrandLogo(org.logoUrl);

  // ── 2. The rows, children first. ───────────────────────────────────────────
  const rowsDeleted: Record<string, number> = {};
  const del = async (name: string, fn: () => Promise<{ count: number }>) => { rowsDeleted[name] = (await fn()).count; };

  await prisma.$transaction(async (tx) => {
    const loanIds = (await tx.loan.findMany({ where: { orgId }, select: { id: true } })).map((l) => l.id);
    const workflowIds = (await tx.workflow.findMany({ where: { orgId }, select: { id: true } })).map((w) => w.id);

    // Money leaves
    await del("installments", () => tx.installment.deleteMany({ where: { orgId } }));
    await del("disbursements", () => tx.disbursement.deleteMany({ where: { orgId } }));
    await del("paymentIntents", () => tx.paymentIntent.deleteMany({ where: { orgId } }));
    await del("receipts", () => tx.c2BReceipt.deleteMany({ where: { orgId } }));
    await del("floatLedger", () => tx.floatLedger.deleteMany({ where: { orgId } }));
    await del("reconExceptions", () => tx.reconciliationException.deleteMany({ where: { orgId } }));

    // Collections
    await del("promises", () => tx.promiseToPay.deleteMany({ where: { orgId } }));
    await del("calls", () => tx.collectionCall.deleteMany({ where: { orgId } }));
    await del("tickets", () => tx.collectionTicket.deleteMany({ where: { orgId } }));

    // Lending
    if (loanIds.length) await del("loans", () => tx.loan.deleteMany({ where: { orgId } }));
    await del("offers", () => tx.loanOffer.deleteMany({ where: { orgId } }));
    await del("guarantors", () => tx.guarantor.deleteMany({ where: { orgId } }));
    await del("collateral", () => tx.collateral.deleteMany({ where: { orgId } }));
    await del("applications", () => tx.loanApplication.deleteMany({ where: { orgId } }));

    // Borrower-side
    await del("documents", () => tx.document.deleteMany({ where: { orgId } }));
    await del("kycChecks", () => tx.kycCheck.deleteMany({ where: { orgId } }));
    await del("kycSessions", () => tx.kycSession.deleteMany({ where: { orgId } }));
    await del("consents", () => tx.consent.deleteMany({ where: { orgId } }));
    await del("scoreSnapshots", () => tx.scoreSnapshot.deleteMany({ where: { orgId } }));
    // Savings: the append-only ledger goes before the account it points at.
    await del("savingsTransactions", () => tx.savingsTransaction.deleteMany({ where: { orgId } }));
    await del("savingsAccounts", () => tx.savingsAccount.deleteMany({ where: { orgId } }));
    await del("graduations", () => tx.graduationEvent.deleteMany({ where: { orgId } }));
    await del("geoPins", () => tx.geoPin.deleteMany({ where: { orgId } }));
    await del("fieldVisits", () => tx.fieldVisit.deleteMany({ where: { orgId } }));
    await del("borrowers", () => tx.borrower.deleteMany({ where: { orgId } }));

    // Comms & intelligence
    await del("smsMessages", () => tx.smsMessage.deleteMany({ where: { orgId } }));
    await del("smsCampaigns", () => tx.smsCampaign.deleteMany({ where: { orgId } }));
    await del("smsTemplates", () => tx.smsTemplate.deleteMany({ where: { orgId } }));
    await del("smsTopUps", () => tx.smsTopUp.deleteMany({ where: { orgId } }));
    await del("smsWallet", () => tx.smsWallet.deleteMany({ where: { orgId } }));
    await del("emails", () => tx.emailMessage.deleteMany({ where: { orgId } }));
    await del("portfolioRuns", () => tx.portfolioRun.deleteMany({ where: { orgId } }));
    await del("ririQueries", () => tx.ririQueryLog.deleteMany({ where: { orgId } }));
    // Riri's notes about this lender's staff go before the staff themselves — they FK
    // back to StaffUser, and a memory of somebody who no longer exists is not a memory.
    await del("ririMemories", () => tx.ririMemory.deleteMany({ where: { orgId } }));
    await del("metricDefs", () => tx.metricDefinition.deleteMany({ where: { orgId } }));
    await del("tuning", () => tx.tuningProfile.deleteMany({ where: { orgId } }));

    // Billing
    await del("invoiceLines", () => tx.invoiceLine.deleteMany({ where: { invoice: { orgId } } }));
    await del("invoices", () => tx.invoice.deleteMany({ where: { orgId } }));
    await del("usageEvents", () => tx.usageEvent.deleteMany({ where: { orgId } }));
    await del("subscription", () => tx.orgSubscription.deleteMany({ where: { orgId } }));

    // Catalogue & process. Charges come AFTER PaymentIntent — every fee that was ever
    // paid points back at the Charge row it was for, and Postgres will (rightly) not
    // let us orphan them.
    await del("charges", () => tx.charge.deleteMany({ where: { orgId } }));
    await del("products", () => tx.product.deleteMany({ where: { orgId } }));
    if (workflowIds.length) await del("workflowStages", () => tx.workflowStage.deleteMany({ where: { workflowId: { in: workflowIds } } }));
    await del("workflows", () => tx.workflow.deleteMany({ where: { orgId } }));

    // People & access. Staff before roles and branches — both are their parents.
    await del("otpChallenges", () => tx.otpChallenge.deleteMany({ where: { orgId } }));
    await del("staff", () => tx.staffUser.deleteMany({ where: { orgId } }));
    await del("roles", () => tx.role.deleteMany({ where: { orgId } }));
    // Branches are a self-referencing tree: children must go before their parents,
    // so delete leaves-first rather than in one sweep.
    rowsDeleted.branches = await deleteBranchTree(tx, orgId);

    await del("integrations", () => tx.orgIntegration.deleteMany({ where: { orgId } }));
    await del("complianceRequests", () => tx.complianceRequest.deleteMany({ where: { orgId } }));
    // Leaving the org also leaves its sharing pool — the membership row, not the
    // pool itself (the surviving siblings' agreement stands without them).
    await del("poolMembership", () => tx.sharingPoolMember.deleteMany({ where: { orgId } }));

    await del("org", () => tx.org.deleteMany({ where: { id: orgId } }));
  }, { timeout: 120_000 });

  // THE AUDIT TRAIL OUTLIVES THE TENANT. AuditLog.orgId is a plain column, not a
  // foreign key, so the record that this lender existed — and that we destroyed
  // them, on whose say-so, and when — survives the org row itself. That is the
  // point of an audit trail.
  await prisma.auditLog
    .create({
      data: {
        orgId,
        actorType: "platform",
        action: "org.deleted",
        entity: "Org",
        entityId: orgId,
        meta: { slug: org.slug, objectsDeleted, rowsDeleted },
      },
    })
    .catch(() => {});

  return { slug: org.slug, objectsDeleted, rowsDeleted, deletedAt: new Date().toISOString() };
}

/** Leaves before parents — a self-referencing tree cannot be dropped in one statement. */
async function deleteBranchTree(
  tx: { branch: { findMany: (a: object) => Promise<{ id: string; parentId: string | null }[]>; deleteMany: (a: object) => Promise<{ count: number }> } },
  orgId: string,
): Promise<number> {
  const rows = await tx.branch.findMany({ where: { orgId }, select: { id: true, parentId: true } });
  let deleted = 0;
  let remaining = rows;

  while (remaining.length) {
    const parents = new Set(remaining.map((r) => r.parentId).filter(Boolean));
    const leaves = remaining.filter((r) => !parents.has(r.id));
    // A cycle in the tree would leave no leaves. Drop what is left in one go rather
    // than spinning forever — the org is being destroyed anyway.
    const batch = leaves.length ? leaves : remaining;
    deleted += (await tx.branch.deleteMany({ where: { id: { in: batch.map((b) => b.id) } } })).count;
    const gone = new Set(batch.map((b) => b.id));
    remaining = remaining.filter((r) => !gone.has(r.id));
  }
  return deleted;
}
