// POST /api/lms/apply — submit a loan application through the lms portal.
//
// This is where the training pipeline is born: every application stores the
// M-Pesa featuresSnapshot (X) and is later backfilled with an outcome (y). The
// thin-file score is recomputed SERVER-SIDE (never trusted from the client).
// If posting is enabled and the borrower is graduated, the loan is posted to
// ServiceSuite via sp_InsertLoan into the BirgenAI workflow.
//
// IDENTITY IS SERVER-AUTHORITATIVE. The borrower's phone comes from the OTP
// session cookie, and every fact the credit decision leans on — who they are at
// the lender, whether they have graduated, how many loans they have cleared — is
// re-derived from that phone here. The client used to assert all of it, which
// meant a borrower could hand us any `serviceSuiteBorrowerId` they liked and
// have a stranger's repayment history fused into their own probability of
// default (and, at the far end of this route, a loan posted under that id).

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { originStamp } from "@/lib/rbac/scope";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { borrowerFor, otpRequired } from "@/lib/portal/session";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { meter } from "@/lib/billing/meter";
import { createOfferForApplication } from "@/lib/lending/offer";
import { autoScheduleVerification } from "@/lib/field/auto";
import { scoreThinFileAuto } from "@/lib/statement/score-thinfile";
import type { CashflowFeatures } from "@/lib/statement/features";
import { LMS_STAGES, stageFromDecision, type LmsStageKey } from "@/lib/lms/workflow";
import { postLoan, isPostingEnabled, checkGraduation, type Graduation } from "@/lib/lms/servicesuite";
import { scoreBorrowerBehavioral } from "@/lib/scoring/behavioral";
import { scoreOrigination, isOriginationConfigured } from "@/lib/scoring/origination";
import { fuseScores } from "@/lib/scoring/fusion";
import { attachKycSession } from "@/lib/kyc/attach";

export const runtime = "nodejs";

const CONSENT_VERSION = "2026-06-30";

type Body = {
  lenderSlug?: string;
  /** Self-declared, stored as a claim for KYC to verify. Never a lookup key. */
  nationalId?: string;
  /** Only used for a brand-new applicant the lender has never seen. */
  borrowerName?: string;
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
  /** SHA-256 of the applying device's stable traits — the ring-fraud signal. */
  deviceFingerprint?: string;
  /** Pay-to-institution products: where the money actually goes (§7). */
  payee?: { name?: string; paybill?: string; account?: string };
  locationAddress?: string;
};

const validCoord = (lat: unknown, lng: unknown): lat is number =>
  Number.isFinite(lat) && Math.abs(lat as number) <= 90 && Number.isFinite(lng) && Math.abs(lng as number) <= 180;

export async function POST(req: NextRequest) {
  // A staff session is optional and incidental here (it only records who was
  // signed in). The borrower's identity comes from the OTP cookie below.
  const session = await auth();

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 });
  }

  const org = await resolveOrg(body.lenderSlug ?? "");
  // Bind the RLS tenant in OUR async context (enterWith does not escape a callee).
  if (org) enterOrg(org.id);
  if (!org) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });

  const portal = await borrowerFor(org.id);
  if (!portal) return otpRequired();
  const phone = portal.phone; // verified msisdn — the only identity we trust

  // An application costs a credit decision, a CRB pull and an officer's queue
  // slot. One borrower does not need more than a handful an hour.
  const limited = await rateLimit([
    { name: "apply:phone", subject: `${org.id}:${phone}`, max: 5, windowSec: 3600 },
    { name: "apply:ip", subject: clientIp(req), max: 20, windowSec: 3600 },
  ]);
  if (limited) return limited;

  const amount = Number(body.amountRequested);
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
  const entityId = org.entityId;
  const orgRow = { id: org.id };

  // ── Identity, re-derived from the verified phone ───────────────────────────
  // One lookup, used for the fusion score AND the posting gate at the far end of
  // this route. Bridged orgs answer from the lender's own book; native orgs from
  // ours. A borrower the lender has never seen resolves to nothing, which is the
  // correct answer: they are new, thin-file only, and cannot be posted.
  let grad: Graduation | null = null;
  if (org.bridgedReady && org.registry) {
    try {
      grad = await checkGraduation(org.registry, entityId, phone);
    } catch {
      /* lender DB unreachable — treat as a new applicant, thin-file only */
    }
  }

  let graduated = grad?.graduated ?? false;
  let priorLoanCount = grad?.clearedLoans ?? 0;
  let knownName: string | null = grad?.borrowerName?.trim() || null;
  const ssBorrowerId = grad?.borrowerId ?? null;

  if (!grad && org.mode === "NATIVE") {
    const known = await prisma.borrower.findFirst({
      where: { orgId: orgRow.id, phone: { endsWith: phone.slice(-9) } },
      select: { id: true, firstName: true, otherName: true },
    });
    if (known) {
      const [cleared, active] = await Promise.all([
        prisma.loan.count({ where: { orgId: orgRow.id, borrowerId: known.id, status: "CLEARED" } }),
        prisma.loan.count({ where: { orgId: orgRow.id, borrowerId: known.id, status: { in: ["ACTIVE", "PENDING_DISBURSEMENT"] } } }),
      ]);
      graduated = cleared >= 5 && active === 0;
      priorLoanCount = cleared;
      knownName = `${known.firstName ?? ""} ${known.otherName ?? ""}`.trim() || null;
    }
  }

  // A returning borrower's name is whatever the lender already has on file. Only
  // a genuinely new applicant gets to introduce themselves.
  const borrowerName = knownName ?? (body.borrowerName?.trim() || session?.user?.name || null);

  // NATIVE orgs: resolve the chosen product from OUR product table (uuid ref)
  // so the application carries productId and booking can generate the schedule.
  let nativeProductId: string | null = null;
  let payee: { name: string | null; paybill: string; account: string | null } | null = null;
  if (org.mode === "NATIVE" && body.productRef) {
    const p = await prisma.product.findFirst({
      where: { id: body.productRef, orgId: org.id, isActive: true },
      select: { id: true, name: true, minPrincipal: true, maxPrincipal: true, disbursementMode: true },
    });
    if (p) {
      nativeProductId = p.id;
      body.productName = body.productName || p.name;
      const min = Number(p.minPrincipal), max = Number(p.maxPrincipal);
      if ((min > 0 && amount < min) || (max > 0 && amount > max)) {
        return NextResponse.json({ success: false, message: `For ${p.name}, enter an amount within the product limits.` }, { status: 400 });
      }
      // §7 diversion control: school-fees-style products pay the institution's
      // paybill, never the applicant's phone — the payee is part of applying.
      if (p.disbursementMode === "TO_THIRD_PARTY") {
        const paybill = (body.payee?.paybill ?? "").replace(/\D/g, "");
        if (!/^\d{5,8}$/.test(paybill)) {
          return NextResponse.json({ success: false, message: `${p.name} pays the institution directly — enter its paybill number (it's on the fee structure).` }, { status: 400 });
        }
        payee = {
          name: body.payee?.name?.trim().slice(0, 80) || null,
          paybill,
          account: body.payee?.account?.trim().slice(0, 30) || null,
        };
      }
    }
  }

  // FUSION: a matched ServiceSuite borrower (returning/graduated) also has a repayment
  // track record + the lender's product/agent as-of signal — blend it with cashflow for
  // a stronger decision. Brand-new applicants (no borrower id) stay on thin-file only.
  // The borrower id is the one we just resolved from the verified phone.
  let originationPd: number | null = null;
  let hasHistory = graduated || priorLoanCount > 0;
  if (ssBorrowerId != null && isOriginationConfigured() && org.bridgedReady && org.registry) {
    try {
      const o = await scoreOrigination(org.registry, entityId, ssBorrowerId, { loanAmount: amount });
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
  const nameParts = (borrowerName ?? "").split(/\s+/).filter(Boolean);
  // A borrower who walked in off the public portal has NO officer. They are stamped to
  // the head office rather than left branchless: a null branch belongs to no one, so a
  // branch-scoped manager would never see them and the lead would rot unclaimed.
  const portalOrigin = await originStamp(orgRow.id, null);

  let app;
  let borrowerRowId: string | null = null;
  try {
    const borrower = await prisma.borrower.upsert({
      where: { orgId_phone: { orgId: orgRow.id, phone } },
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
        branchId: portalOrigin.branchId,
        phone,
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
        // Inherit the borrower's owner: a repeat customer who applies from their phone
        // stays on the officer's book rather than falling off it.
        officerId: borrower.createdById ?? null,
        branchId: borrower.branchId ?? portalOrigin.branchId,
        borrowerId: borrower.id,
        productId: nativeProductId,
        hubUserId: session?.user?.id ?? null,
        phone,
        nationalId: body.nationalId?.trim() || null,
        serviceSuiteBorrowerId: ssBorrowerId,
        borrowerName,
        graduated,
        priorLoanCount,
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
        deviceFingerprint: /^[0-9a-f]{32,64}$/i.test(body.deviceFingerprint ?? "") ? body.deviceFingerprint : null,
        payeeName: payee?.name ?? null,
        payeePaybill: payee?.paybill ?? null,
        payeeAccount: payee?.account ?? null,
        decidedAt: new Date(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not save your application.";
    return NextResponse.json({ success: false, message }, { status: 200 });
  }

  // One scored application = one billable score. Metered after the row exists, so
  // a failed application is never charged for.
  void meter(orgRow.id, "score", 1, { applicationId: app.id, engine: scored.fusionEngine, decision: scored.decision });

  // Draft the credit agreement. The borrower must read it and sign it with a code
  // before anything can be booked (§5.1.13) — a declined application gets no offer,
  // and a referred one waits for a human before the terms are put in front of anyone.
  let offerId: string | null = null;
  if (scored.decision === "APPROVE") {
    try {
      offerId = (await createOfferForApplication(app.id))?.id ?? null;
    } catch (err) {
      // An application that scored must survive a failure to draft its paperwork;
      // staff can re-issue the offer from the console.
      console.error("[apply] offer draft failed:", err);
    }
  }

  // The applicant verified their identity at /verify while still anonymous, so
  // the KYC session is keyed by phone. Now that the Borrower row exists, promote
  // the verified artifacts onto it and link the audit trail. Best-effort: a
  // reconciliation hiccup must never sink a submitted application.
  if (borrowerRowId) {
    try {
      await attachKycSession(orgRow.id, borrowerRowId, phone, body.nationalId?.trim() || null);
    } catch (err) {
      console.error("[apply] KYC attach failed:", err);
    }
  }

  // An SME application with a captured business location gets a relationship
  // officer AUTO-dispatched to verify the premises (blueprint §5.1) — nobody
  // has to remember to click "dispatch". Entitlement-gated inside; best-effort.
  if (hasCoords && locationType === "business" && borrowerRowId) {
    await autoScheduleVerification({
      orgId: orgRow.id,
      borrowerId: borrowerRowId,
      applicationId: app.id,
      lat: lat!,
      lng: lng!,
      label: `${borrowerName || phone} (business verification)`,
      address: locationAddress,
    });
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
          label: (borrowerName || phone) + (locationType ? ` (${locationType})` : ""),
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
  if (ssBorrowerId != null && org.bridgedReady && org.registry) {
    try {
      const beh = await scoreBorrowerBehavioral(org.registry, entityId, ssBorrowerId);
      await prisma.scoreSnapshot.create({
        data: {
          orgId: orgRow.id,
          borrowerId: borrowerRowId,
          applicationId: app.id,
          serviceSuiteBorrowerId: ssBorrowerId,
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
  // SERVER-AUTHORITATIVE: `grad` was resolved at the top of this request from the
  // OTP-verified phone, in the lender's own database. Nothing the client sent can
  // reach `postLoan` — not the borrower id, not the graduated flag.
  const posting: { attempted: boolean; ok: boolean; message: string } = { attempted: false, ok: false, message: "" };
  const wantsPost =
    isPostingEnabled() &&
    org.bridgedReady && !!org.registry &&
    !!body.productRef &&
    (scored.decision === "APPROVE" || scored.decision === "REFER");

  if (wantsPost && !grad?.graduated) {
    posting.message = grad
      ? "Not yet eligible for direct posting (needs 5+ cleared loans and no active loan) — an officer will review."
      : "No matching borrower record at the lender — an officer will review.";
  }

  if (wantsPost && grad?.graduated) {
    posting.attempted = true;
    const res = await postLoan(org.registry!, {
      borrowerId: grad.borrowerId,
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
    // Present ⇒ the funnel shows the agreement and asks for a signature.
    offerId,
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
