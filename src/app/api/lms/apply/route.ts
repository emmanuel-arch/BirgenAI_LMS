// POST /api/lms/apply — submit a loan application through the lms portal.
//
// This is where the training pipeline is born: every application stores the
// M-Pesa featuresSnapshot (X) and is later backfilled with an outcome (y). The
// thin-file score is recomputed SERVER-SIDE (never trusted from the client).
// If posting is enabled and the borrower is graduated, the loan is posted to
// ServiceSuite via sp_InsertLoan into the BirgenAI workflow.

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getOrg, getEntityId, isOrgConfigured } from "@/lib/enterprise/connections";
import { scoreThinFileAuto } from "@/lib/statement/score-thinfile";
import type { CashflowFeatures } from "@/lib/statement/features";
import { LMS_STAGES, stageFromDecision, type LmsStageKey } from "@/lib/lms/workflow";
import { postLoan, isPostingEnabled, checkGraduation } from "@/lib/lms/servicesuite";
import { scoreBorrowerBehavioral } from "@/lib/scoring/behavioral";
import { scoreOrigination, isOriginationConfigured } from "@/lib/scoring/origination";
import { fuseScores } from "@/lib/scoring/fusion";

export const runtime = "nodejs";

const CONSENT_VERSION = "2026-06-30";

type Body = {
  lenderSlug?: string;
  phone?: string;
  nationalId?: string;
  borrowerName?: string;
  serviceSuiteBorrowerId?: number;
  graduated?: boolean;
  priorLoanCount?: number;
  productRef?: string;
  productName?: string;
  amountRequested?: number;
  features?: CashflowFeatures;
  consent?: {
    mpesaAnalysis?: boolean;
    automatedScoring?: boolean;
    crbCheck?: boolean;
    modelImprovement?: boolean;
    crossBorder?: boolean;
    geoTagging?: boolean;
  };
  // Consented, one-time location capture (never tracked).
  location?: { lat?: number; lng?: number; accuracy?: number };
  locationType?: "business" | "home";
  locationAddress?: string;
};

const validCoord = (lat: unknown, lng: unknown): lat is number =>
  Number.isFinite(lat) && Math.abs(lat as number) <= 90 && Number.isFinite(lng) && Math.abs(lng as number) <= 180;

export async function POST(req: NextRequest) {
  // Session is OPTIONAL: white-label subdomain borrowers apply with phone +
  // national ID as their identity (userId stays null). Every loan-book write
  // below is already server-authoritative (re-matched + re-verified in the
  // lender's DB), so an anonymous application can never post on claimed facts.
  const session = await auth();

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 });
  }

  const org = getOrg(body.lenderSlug ?? "");
  if (!org || org.isAdmin) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });

  const phone = (body.phone ?? "").trim();
  const amount = Number(body.amountRequested);
  if (!phone) return NextResponse.json({ success: false, message: "Phone number is required." }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ success: false, message: "Enter a valid amount." }, { status: 400 });

  // Consent gate (DPA): the core processing consents are mandatory.
  const c = body.consent ?? {};
  if (!c.mpesaAnalysis || !c.automatedScoring) {
    return NextResponse.json({ success: false, message: "We need your consent for M-Pesa analysis and automated scoring to proceed." }, { status: 400 });
  }
  if (!body.features) {
    return NextResponse.json({ success: false, message: "Run the M-Pesa statement check first." }, { status: 400 });
  }

  // Server-authoritative thin-file (cashflow) score from the submitted features.
  const thinFile = scoreThinFileAuto(body.features);
  const entityId = getEntityId(org);

  // Resolve the tenant row — every funnel write hangs off orgId.
  const orgRow = await prisma.org.findUnique({ where: { slug: org.slug }, select: { id: true } });
  if (!orgRow) {
    return NextResponse.json(
      { success: false, message: `${org.name} is not provisioned in the LMS yet (run \`prisma db seed\`).` },
      { status: 500 },
    );
  }

  // FUSION: a matched ServiceSuite borrower (returning/graduated) also has a repayment
  // track record + the lender's product/agent as-of signal — blend it with cashflow for
  // a stronger decision. Brand-new applicants (no borrower id) stay on thin-file only.
  let originationPd: number | null = null;
  let hasHistory = !!body.graduated || (Number.isInteger(body.priorLoanCount) && (body.priorLoanCount ?? 0) > 0);
  if (Number.isInteger(body.serviceSuiteBorrowerId) && isOriginationConfigured() && isOrgConfigured(org)) {
    try {
      const o = await scoreOrigination(org, entityId, body.serviceSuiteBorrowerId!, { loanAmount: amount });
      originationPd = o.pd;
      hasHistory = o.hasHistory;
    } catch { /* best-effort — fall back to thin-file only */ }
  }
  const fused = fuseScores({ thinFilePd: thinFile.pd, originationPd, hasHistory });
  const scored = {
    ...thinFile,
    score: fused.score,
    pd: fused.pd,
    band: fused.band,
    tone: fused.tone,
    decision: fused.decision,
    modelVersion:
      fused.engine === "fused" ? `fused(${thinFile.modelVersion}+origination-v2)`
      : fused.engine === "origination" ? "origination-v2"
      : thinFile.modelVersion,
    fusionEngine: fused.engine,
    fusionComponents: fused.components,
  };

  // Consented location (optional). Coordinates only kept if valid; address always allowed.
  const geoConsented = !!c.geoTagging;
  const hasCoords = geoConsented && validCoord(body.location?.lat, body.location?.lng);
  const lat = hasCoords ? Number(body.location!.lat) : null;
  const lng = hasCoords ? Number(body.location!.lng) : null;
  const locationType = body.locationType === "home" ? "home" : body.locationType === "business" ? "business" : null;
  const locationAddress = body.locationAddress?.trim() || null;

  // Map the model decision to the BirgenAI workflow stage (human-in-the-loop on adverse).
  const stageKey: LmsStageKey = stageFromDecision(scored.decision);
  const stage = LMS_STAGES[stageKey];

  // Record borrower + consent + application (the application is the training row).
  const phoneKey = phone.replace(/\D/g, "");
  const nameParts = (body.borrowerName?.trim() || session?.user?.name || "").split(/\s+/).filter(Boolean);
  const ssBorrowerId = Number.isInteger(body.serviceSuiteBorrowerId) ? body.serviceSuiteBorrowerId! : null;
  let app;
  let borrowerRowId: string | null = null;
  try {
    const borrower = await prisma.borrower.upsert({
      where: { orgId_phone: { orgId: orgRow.id, phone: phoneKey } },
      update: {
        nationalId: body.nationalId?.trim() || undefined,
        firstName: nameParts[0] || undefined,
        otherName: nameParts.slice(1).join(" ") || undefined,
        serviceSuiteBorrowerId: ssBorrowerId ?? undefined,
        lat: lat ?? undefined,
        lng: lng ?? undefined,
        locationType: locationType ?? undefined,
        locationAddress: locationAddress ?? undefined,
        hubUserId: session?.user?.id ?? undefined,
      },
      create: {
        orgId: orgRow.id,
        phone: phoneKey,
        nationalId: body.nationalId?.trim() || null,
        firstName: nameParts[0] || null,
        otherName: nameParts.slice(1).join(" ") || null,
        serviceSuiteBorrowerId: ssBorrowerId,
        lat,
        lng,
        locationType,
        locationAddress,
        hubUserId: session?.user?.id ?? null,
      },
    });
    borrowerRowId = borrower.id;

    const consentRow = await prisma.consent.create({
      data: {
        orgId: orgRow.id,
        borrowerId: borrower.id,
        version: CONSENT_VERSION,
        grants: c as Prisma.InputJsonValue,
        ip: req.headers.get("x-forwarded-for") || null,
      },
    });

    app = await prisma.loanApplication.create({
      data: {
        orgId: orgRow.id,
        borrowerId: borrower.id,
        hubUserId: session?.user?.id ?? null,
        phone,
        nationalId: body.nationalId?.trim() || null,
        serviceSuiteBorrowerId: ssBorrowerId,
        borrowerName: body.borrowerName?.trim() || session?.user?.name || null,
        graduated: !!body.graduated,
        priorLoanCount: Number.isInteger(body.priorLoanCount) ? body.priorLoanCount! : 0,
        productRef: body.productRef || null,
        productName: body.productName || null,
        amountRequested: new Prisma.Decimal(amount),
        status: stageKey,
        stageTitle: stage.title,
        score: scored.score,
        pd: new Prisma.Decimal(scored.pd),
        scoreModelVersion: scored.modelVersion,
        decision: scored.decision,
        reasonCodes: scored.reasonCodes as unknown as Prisma.InputJsonValue,
        featuresSnapshot: body.features as unknown as Prisma.InputJsonValue,
        lat,
        lng,
        locationType,
        locationAddress,
        consentId: consentRow.id,
        consent: {
          ...c,
          version: CONSENT_VERSION,
          at: new Date().toISOString(),
          ip: req.headers.get("x-forwarded-for") || null,
        } as Prisma.InputJsonValue,
        consentVersion: CONSENT_VERSION,
        decidedAt: new Date(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not save your application.";
    return NextResponse.json({ success: false, message }, { status: 200 });
  }

  // Consented location → a geotag the lender's officers can route to (RO Route
  // Planner). Only when GPS coordinates were captured. Best-effort.
  if (hasCoords) {
    try {
      await prisma.geoPin.create({
        data: {
          orgId: orgRow.id,
          borrowerId: borrowerRowId,
          applicationId: app.id,
          label: (body.borrowerName?.trim() || phone) + (locationType ? ` (${locationType})` : ""),
          address: locationAddress,
          lat: lat!,
          lng: lng!,
          accuracyMeters: Number.isFinite(Number(body.location?.accuracy)) ? Math.round(Number(body.location!.accuracy)) : null,
          locationType,
          phone,
          source: "self-onboard",
          note: "Self-captured at onboarding",
          capturedBy: session?.user?.id ?? null,
        },
      });
    } catch {
      /* geotag persistence is best-effort */
    }
  }

  // Repeat/graduated borrower: also capture a BEHAVIOURAL score snapshot (training
  // datapoint from internal repayment history). Non-fatal — best effort.
  if (Number.isInteger(body.serviceSuiteBorrowerId) && isOrgConfigured(org)) {
    try {
      const beh = await scoreBorrowerBehavioral(org, entityId, body.serviceSuiteBorrowerId!);
      await prisma.scoreSnapshot.create({
        data: {
          orgId: orgRow.id,
          borrowerId: borrowerRowId,
          applicationId: app.id,
          serviceSuiteBorrowerId: body.serviceSuiteBorrowerId!,
          modelKind: "behavioral",
          modelVersion: beh.modelVersion,
          score: beh.score,
          pd: new Prisma.Decimal(beh.pd),
          riskBand: beh.riskBand,
          features: beh.features as unknown as Prisma.InputJsonValue,
          reasons: beh.factors as unknown as Prisma.InputJsonValue,
          loanContextAmount: new Prisma.Decimal(amount),
          capturedBy: "lms-apply",
        },
      });
    } catch {
      /* behavioural snapshot is best-effort; the thin-file score already decided the app */
    }
  }

  // Post to ServiceSuite (gated): only graduated borrowers with a matched borrower
  // id and product, and only when posting is enabled. Otherwise it stays in
  // BirgenAI's pipeline for an officer to action and the lender to enable later.
  //
  // SERVER-AUTHORITATIVE: a loan-book write never trusts the client's graduated
  // flag or borrower id — the borrower is re-matched by phone/ID in the lender's
  // DB and graduation recomputed there, right before posting.
  const posting: { attempted: boolean; ok: boolean; message: string } = { attempted: false, ok: false, message: "" };
  const wantsPost =
    isPostingEnabled() &&
    isOrgConfigured(org) &&
    !!body.productRef &&
    (scored.decision === "APPROVE" || scored.decision === "REFER");

  let verified: Awaited<ReturnType<typeof checkGraduation>> = null;
  if (wantsPost) {
    try {
      verified = await checkGraduation(org, entityId, phone, body.nationalId?.trim() || undefined);
    } catch {
      /* lender DB unreachable — application stays in the BirgenAI pipeline */
    }
    if (!verified?.graduated) {
      posting.message = verified
        ? "Not yet eligible for direct posting (needs 5+ cleared loans and no active loan) — an officer will review."
        : "No matching borrower record at the lender — an officer will review.";
    }
  }

  if (wantsPost && verified?.graduated) {
    posting.attempted = true;
    const res = await postLoan(org, {
      borrowerId: verified.borrowerId,
      principal: amount,
      productId: Number(body.productRef),
      applicationId: app.id,
    });
    posting.ok = res.ok;
    posting.message = res.message;
    await prisma.loanApplication.update({
      where: { id: app.id },
      data: res.ok
        ? { postedToServiceSuite: true, serviceSuiteLoanId: res.loanId, status: "OFFICER_REVIEW", stageTitle: LMS_STAGES.OFFICER_REVIEW.title }
        : { postError: res.message },
    });
  }

  return NextResponse.json({
    success: true,
    applicationId: app.id,
    status: posting.ok ? "OFFICER_REVIEW" : stageKey,
    stageTitle: posting.ok ? LMS_STAGES.OFFICER_REVIEW.title : stage.title,
    decision: scored.decision,
    score: scored.score,
    pd: scored.pd,
    band: scored.band,
    reasonCodes: scored.reasonCodes,
    posting,
  });
}
