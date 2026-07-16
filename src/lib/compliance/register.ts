// Shared machinery for the compliance register. Lives here rather than in the
// route because a Next `route.ts` may only export HTTP verbs and route config —
// anything else fails the build's route-type check.
import { prisma } from "@/lib/prisma";

/**
 * One active staff member ⇒ there is nobody else who COULD check their work.
 *
 * The same accommodation the disbursement queue makes. Maker-checker on erasure
 * protects a customer from one careless (or malicious) officer; it must not stop a
 * one-person lender from honouring a lawful request at all, which would be a worse
 * failure than the one it prevents. The solo path is still fully audited — it just
 * has the same person on both lines, and the register says so.
 */
export async function isSoloOperator(orgId: string): Promise<boolean> {
  return (await prisma.staffUser.count({ where: { orgId, status: "ACTIVE" } })) <= 1;
}

export async function auditCompliance(
  orgId: string,
  actorId: string | undefined,
  action: string,
  entityId: string,
  meta: object,
): Promise<void> {
  await prisma.auditLog
    .create({ data: { orgId, actorId, actorType: "staff", action, entity: "ComplianceRequest", entityId, meta } })
    .catch(() => {});
}
