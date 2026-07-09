// ─────────────────────────────────────────────────────────────────────────────
// Attach a completed KYC session to a Borrower.
//
// The elite KYC funnel runs BEFORE a Borrower row exists — an applicant verifies
// their identity at /verify while they are still anonymous, so the session (and
// each KycCheck) is keyed by phone, not borrowerId. The moment the borrower is
// created (at apply-time, or if they re-verify later), we reconcile: the session
// and its audit trail are linked to the borrower, and the verified artifacts —
// face-match score, liveness, IPRS, the white-background portrait — are promoted
// onto the Borrower record where officers and the risk engine read them.
//
// Phone formats differ across surfaces (07…, 2547…, +254…), so we match on the
// last 9 digits, the same normalisation the borrower search uses.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import type { KycStatus } from "@prisma/client";

const STATUS_MAP: Record<string, KycStatus> = {
  VERIFIED: "VERIFIED",
  PENDING_REVIEW: "PENDING_REVIEW",
  FAILED: "FAILED",
  IN_PROGRESS: "IN_PROGRESS",
};

export type KycAttachResult = { sessionId: string; status: KycStatus } | null;

/**
 * Link the borrower's most recent COMPLETED KYC session (a verified one wins
 * over a failed/review one) and promote its artifacts onto the Borrower.
 * Returns null when the applicant never ran KYC. Never throws on "no match".
 */
export async function attachKycSession(
  orgId: string,
  borrowerId: string,
  phone: string,
  nationalId?: string | null,
): Promise<KycAttachResult> {
  const last9 = phone.replace(/\D/g, "").slice(-9);
  if (last9.length < 9) return null;

  const sessions = await prisma.kycSession.findMany({
    where: { orgId, phone: { endsWith: last9 }, status: { in: ["VERIFIED", "PENDING_REVIEW", "FAILED"] } },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  if (sessions.length === 0) return null;

  // Prefer a verified session; otherwise take the most recent completed one.
  const s = sessions.find((x) => x.status === "VERIFIED") ?? sessions[0];
  const status = STATUS_MAP[s.status] ?? "IN_PROGRESS";

  // Only FILL identity gaps — never overwrite what the applicant typed.
  const existing = await prisma.borrower.findUnique({
    where: { id: borrowerId },
    select: { nationalId: true, firstName: true },
  });
  const ocrNames = (s.idOcrName ?? "").split(/\s+/).filter(Boolean);

  await prisma.borrower.update({
    where: { id: borrowerId },
    data: {
      kycStatus: status,
      ...(status === "VERIFIED" ? { kycVerifiedAt: s.completedAt ?? new Date() } : {}),
      ...(s.faceMatchScore != null ? { faceMatchScore: s.faceMatchScore } : {}),
      ...(s.livenessPassed != null ? { livenessPassed: s.livenessPassed } : {}),
      ...(s.iprsMatched != null ? { iprsVerified: s.iprsMatched } : {}),
      // Private-bucket object keys, not URLs. The images themselves stay behind
      // signed URLs minted per view (GET /api/console/kyc/asset).
      ...(s.portraitKey ? { portraitKey: s.portraitKey } : {}),
      ...(s.idFrontKey ? { idFrontKey: s.idFrontKey } : {}),
      ...(s.idBackKey ? { idBackKey: s.idBackKey } : {}),
      ...(s.selfieKey ? { selfieKey: s.selfieKey } : {}),
      ...(!existing?.nationalId && (nationalId || s.idOcrNumber) ? { nationalId: nationalId || s.idOcrNumber } : {}),
      ...(!existing?.firstName && ocrNames.length
        ? { firstName: ocrNames[0], otherName: ocrNames.slice(1).join(" ") || null }
        : {}),
    },
  });

  // Link the session and backfill its audit trail onto the borrower.
  await prisma.kycSession.update({ where: { id: s.id }, data: { borrowerId } });
  await prisma.kycCheck.updateMany({ where: { sessionId: s.id, borrowerId: null }, data: { borrowerId } });

  return { sessionId: s.id, status };
}
