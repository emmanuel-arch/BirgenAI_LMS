// ─────────────────────────────────────────────────────────────────────────────
// THE CUSTOMER'S JOURNEY — the lender's rules, and where this person stands in them.
//
// The counter renders the ONBOARDING CONTRACT (lib/config/onboarding-contract.ts)
// from /api/console/onboarding/contract. The customer app now renders the SAME
// contract, built by the SAME function from the SAME three documents, for the
// "portal" channel. So a lender who switches OCR off, puts IPRS first, demands a
// live selfie or a business pin changes both screens at once, and neither can
// drift from the other — which is the promise Borrower settings makes on its
// own header.
//
// On top of the contract, three things only the app needs:
//
//   FLAGS    the parts of the lender's identity policy that decide which STEPS
//            exist — face match, liveness, human sign-off, referees.
//   ABILITY  which vendor legs are genuinely live, so a simulated read is never
//            presented as a real one.
//   STATUS   what this customer has already done, so the app opens on the next
//            thing to do rather than at the top of a wizard.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { readBorrowerConfig, readAttachmentConfig, readDetailsConfig } from "@/lib/config/store";
import { buildOnboardingContract, type OnboardingContract } from "@/lib/config/onboarding-contract";
import { kycCapabilities, type KycCapabilities } from "@/lib/kyc/provider";
import { MERGED_CRB_ONLY } from "@/lib/crb/rows";
import type { ResolvedOrg } from "@/lib/tenancy";

export type PortalFlags = {
  /** The selfie is compared with the portrait on the card. */
  faceMatch: boolean;
  /** A challenge-response proves the selfie was taken live. */
  liveness: boolean;
  /** A person signs off every new customer's identity before they transact. */
  requireReview: boolean;
  /** People who vouch for the borrower. Null when the lender asks for none. */
  referees: { min: number; max: number } | null;
  /** What to do when the ID is already on this book. */
  onDuplicate: "block" | "warn" | "open_existing";
  /** The ID photograph is required even when the rail does not read it. */
  idPhotoRequired: boolean;
  /** One live loan per borrower. */
  oneActiveLoan: boolean;
  /** A pin must be on file before disbursement — asked for here so it is. */
  requireGeoPin: boolean;
  /** The lender's ceiling on any limit, whatever a score derives. */
  maxLimit: number;
  /** Below this internal score no product may be offered. */
  minScoreToBorrow: number;
};

export type PortalContract = OnboardingContract & { flags: PortalFlags; capabilities: KycCapabilities };

export async function portalContract(org: ResolvedOrg): Promise<PortalContract> {
  const [borrower, attachments, details, integrations, capabilities] = await Promise.all([
    readBorrowerConfig(org.id),
    readAttachmentConfig(org.id),
    readDetailsConfig(org.id),
    prisma.orgIntegration.findMany({ where: { orgId: org.id }, select: { kind: true, status: true } }),
    kycCapabilities(org.id, { forceSimulation: org.isDemo }),
  ]);

  const connectedVaults = integrations
    .filter((i) => i.status !== "UNCONFIGURED" && i.status !== "DISABLED")
    .map((i) => String(i.kind));

  const b = borrower.value;
  const contract = buildOnboardingContract(b, attachments.value, details.value, "portal", { connectedVaults });
  const o = b.onboarding;

  return {
    ...contract,
    flags: {
      faceMatch: o.selfie.required && (o.selfie.faceMatch || b.kyc.faceMatch),
      liveness: o.selfie.required && o.selfie.liveness,
      requireReview: o.requireReview || b.kyc.manualReview,
      referees: b.rules.referees.enabled ? { min: b.rules.referees.min, max: b.rules.referees.max } : null,
      onDuplicate: o.onDuplicate,
      idPhotoRequired: b.kyc.idPhoto.required,
      oneActiveLoan: b.rules.oneActiveLoan,
      requireGeoPin: b.rules.requireGeoPin,
      maxLimit: b.limit.maxLimit,
      minScoreToBorrow: b.scoring.minToBorrow,
    },
    capabilities,
  };
}

const LIVE_APPS = ["SUBMITTED", "AI_PRESCREEN", "OFFICER_REVIEW", "REFERRED"] as const;
/** A crunch older than this is a picture of somebody who may have moved on. */
export const CRUNCH_FRESH_DAYS = 90;

export type JourneyStatus = {
  borrower: {
    id: string;
    firstName: string | null;
    otherName: string | null;
    nationalId: string | null;
    dob: string | null;
    gender: string | null;
    email: string | null;
    kycStatus: string;
    loanLimit: number | null;
    creditScore: number | null;
    hasGeo: boolean;
    /** Linked to a record on the lender's own book — identified by the lender, limit held there. */
    lenderLinked: boolean;
  } | null;
  /** The most recent identity session on this phone, and which legs it has done. */
  kyc: {
    sessionId: string;
    status: string;
    nationalId: string | null;
    name: string | null;
    idRead: boolean;
    registry: boolean | null;
    selfie: boolean;
    liveness: boolean | null;
    flags: string[];
  } | null;
  crunch: {
    at: string;
    score: number;
    band: string | null;
    startingLimit: number | null;
    eligible: boolean;
    fresh: boolean;
  } | null;
  crb: { at: string; score: number | null; verdict: string | null; band: string | null } | null;
  application: { id: string; status: string; stageTitle: string | null; amount: number; product: string | null } | null;
  activeLoan: boolean;
  /** Any stage on this lender's product workflows needs a bureau file before it can act. */
  crbRequired: boolean;
  next: "kyc" | "crunch" | "apply" | "track";
};

export async function journeyStatus(org: ResolvedOrg, phone: string): Promise<JourneyStatus> {
  const last9 = phone.replace(/\D/g, "").slice(-9);

  const [borrower, session, workflows] = await Promise.all([
    prisma.borrower.findFirst({
      where: { orgId: org.id, phone: { endsWith: last9 }, erasedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, firstName: true, otherName: true, nationalId: true, dob: true, gender: true, email: true,
        kycStatus: true, loanLimit: true, creditScore: true, lat: true, lng: true, serviceSuiteBorrowerId: true,
      },
    }),
    prisma.kycSession.findFirst({
      where: { orgId: org.id, phone: { endsWith: last9 } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.product.findMany({
      where: { orgId: org.id, isActive: true },
      select: { newWorkflowId: true, repeatWorkflowId: true },
    }),
  ]);

  const workflowIds = [...new Set(workflows.flatMap((p) => [p.newWorkflowId, p.repeatWorkflowId]).filter((x): x is string => !!x))];
  const crbStage = workflowIds.length
    ? await prisma.workflowStage.findFirst({ where: { workflowId: { in: workflowIds }, crbRequired: true }, select: { id: true } })
    : null;

  let crunch: JourneyStatus["crunch"] = null;
  let crb: JourneyStatus["crb"] = null;
  let application: JourneyStatus["application"] = null;
  let activeLoan = false;

  if (borrower) {
    const [snap, check, app, loans] = await Promise.all([
      prisma.scoreSnapshot.findFirst({
        where: { orgId: org.id, borrowerId: borrower.id, modelKind: "thin-file" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, score: true, riskBand: true, features: true },
      }),
      prisma.kycCheck.findFirst({
        where: { orgId: org.id, borrowerId: borrower.id, kind: "CRB", ...MERGED_CRB_ONLY },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, score: true, payload: true },
      }),
      prisma.loanApplication.findFirst({
        where: { orgId: org.id, borrowerId: borrower.id, status: { in: [...LIVE_APPS] } },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, stageTitle: true, amountRequested: true, productName: true },
      }),
      prisma.loan.count({ where: { orgId: org.id, borrowerId: borrower.id, status: { in: ["ACTIVE", "PENDING_DISBURSEMENT", "RESTRUCTURED"] } } }),
    ]);

    if (snap && snap.score != null) {
      const q =((snap.features as Record<string, unknown> | null)?._qualification ?? null) as
        | { startingLimit?: number; eligible?: boolean }
        | null;
      crunch = {
        at: snap.createdAt.toISOString(),
        score: snap.score,
        band: snap.riskBand,
        startingLimit: q?.startingLimit != null ? Number(q.startingLimit) : null,
        eligible: q?.eligible === true,
        fresh: Date.now() - snap.createdAt.getTime() < CRUNCH_FRESH_DAYS * 86_400_000,
      };
    }
    if (check) {
      const p = (check.payload ?? {}) as { verdict?: string; band?: string };
      crb = { at: check.createdAt.toISOString(), score: check.score, verdict: p.verdict ?? null, band: p.band ?? null };
    }
    if (app) {
      application = {
        id: app.id, status: app.status, stageTitle: app.stageTitle,
        amount: Number(app.amountRequested), product: app.productName,
      };
    }
    activeLoan = loans > 0;
  }

  const kycFlags = Array.isArray(session?.riskFlags) ? (session!.riskFlags as unknown[]).map(String) : [];
  const kycState = borrower?.kycStatus && borrower.kycStatus !== "NONE" ? borrower.kycStatus : session?.status ?? "NONE";
  // A customer on the lender's own book was identified when that account opened
  // and borrows against the limit held there: neither KYC nor a statement read
  // stands between them and an application.
  const lenderLinked = org.mode !== "NATIVE" && borrower?.serviceSuiteBorrowerId != null;
  const kycDone = lenderLinked || kycState === "VERIFIED" || kycState === "PENDING_REVIEW";

  const next: JourneyStatus["next"] =
    !kycDone ? "kyc"
    : application ? "track"
    : !lenderLinked && (!crunch || !crunch.fresh) ? "crunch"
    : "apply";

  return {
    borrower: borrower
      ? {
          id: borrower.id,
          firstName: borrower.firstName,
          otherName: borrower.otherName,
          nationalId: borrower.nationalId,
          dob: borrower.dob ? borrower.dob.toISOString().slice(0, 10) : null,
          gender: borrower.gender,
          email: borrower.email,
          kycStatus: borrower.kycStatus,
          loanLimit: borrower.loanLimit != null ? Number(borrower.loanLimit) : null,
          creditScore: borrower.creditScore,
          hasGeo: borrower.lat != null && borrower.lng != null,
          lenderLinked,
        }
      : null,
    kyc: session
      ? {
          sessionId: session.id,
          status: kycState,
          nationalId: session.nationalId,
          name: session.iprsName ?? session.idOcrName,
          idRead: Boolean(session.idOcrNumber || session.idFrontKey),
          registry: session.iprsMatched,
          selfie: Boolean(session.selfieKey || session.faceMatchScore != null),
          liveness: session.livenessPassed,
          flags: kycFlags,
        }
      : null,
    crunch,
    crb,
    application,
    activeLoan,
    crbRequired: Boolean(crbStage),
    next,
  };
}
