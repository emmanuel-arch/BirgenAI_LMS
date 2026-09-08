// GET /api/console/borrowers — the org's borrower book (staff).
// ?q= filters by phone / national ID / name. Includes loan + application
// aggregates (the native Customer-360 list view).
//
// A BRIDGED lender's book is READ THROUGH, not mirrored. Their customers live in
// their own ServiceSuite and are resolved live, so the console can never show a
// stale copy: Micromart's Fintech entity carries 17,017 borrowers and ~59.8k
// approved loans, and a nightly copy of that would be wrong by morning. Rows come
// back with a namespaced `ss:<id>` ref rather than an LMS uuid, and `source` says
// which book answered.
//
// Paging is done IN the lender's database (`take`/`skip`) — 17k rows is not a list
// to load and filter on the client.
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { readBorrowerConfig, readDetailsConfig } from "@/lib/config/store";
import { KYC_FIELDS } from "@/lib/config/borrower";
import { groupsFor, validateDetailValues, type DetailValues } from "@/lib/config/details";
import { originStamp, resolveScope, borrowerScopeWhere } from "@/lib/rbac/scope";
import { portraitsFor } from "@/lib/kyc/avatars";
import { resolveOrg } from "@/lib/tenancy";
import { listBorrowersLive, getBorrowerBookStats } from "@/lib/lms/servicesuite";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "borrowers.view");
  if (denied) return denied;
  const orgId = session.user.orgId;

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const takeParam = Number(req.nextUrl.searchParams.get("take") ?? 100);
  const skipParam = Number(req.nextUrl.searchParams.get("skip") ?? 0);
  const take = Number.isFinite(takeParam) ? Math.min(Math.max(takeParam, 1), 200) : 100;
  const skip = Number.isFinite(skipParam) ? Math.max(skipParam, 0) : 0;

  // BRIDGED + connected ⇒ the lender's own book answers this.
  if (session.user.orgSlug) {
    const org = await resolveOrg(session.user.orgSlug);
    if (org?.mode === "BRIDGED" && org.bridgedReady && org.registry && org.entityId) {
      try {
        // Book-wide stats only on the first page of an unfiltered view: they
        // describe the whole book, so recomputing them per page would cost a
        // 17k-row scan to say the same thing.
        const wantStats = skip === 0 && q === "";
        const [live, stats] = await Promise.all([
          listBorrowersLive(org.registry, org.entityId, { q, take, skip }),
          wantStats ? getBorrowerBookStats(org.registry, org.entityId) : Promise.resolve(null),
        ]);
        return NextResponse.json({
          success: true,
          source: "servicesuite",
          entityId: org.entityId,
          total: live.total,
          stats,
          borrowers: live.borrowers.map((b) => ({
            id: b.ref,
            serviceSuiteId: b.serviceSuiteId,
            portraitUrl: b.portraitUrl,
            name: b.name,
            phone: b.phone ?? "",
            nationalId: b.nationalId,
            // Their book records a verification flag, not our KYC state machine.
            kycStatus: b.kycVerified ? "VERIFIED" : "NONE",
            // Their RiskScore (0–100), not CreditScore. The list used to print
            // CreditScore, which is a points field running into the millions —
            // "score 4500" beside a KES 9,100 limit, on a scale nobody has.
            behaviouralScore: b.riskScore,
            riskBand: b.riskCategory,
            // No location data comes across: this entity is 0% pinned, which is
            // exactly why every one of them lands on the field-ops worklist.
            locationType: null,
            locationAddress: null,
            hasGeo: b.hasGeo,
            createdAt: b.createdAt,
            loansCount: b.loansCount,
            activeLoans: b.activeLoans,
            clearedLoans: b.clearedLoans,
            olb: b.olb,
            totalBorrowed: b.totalBorrowed,
            loanLimit: b.loanLimit,
            graduationCount: b.graduationCount,
            accountStatus: b.accountStatus,
            // Applications and consents are OURS — a customer the lender has never
            // sent through our funnel has none, and saying 0 is honest.
            applications: 0,
            lastConsent: null,
            graduated: b.graduated,
          })),
        });
      } catch (err) {
        // A bridged read failing is worth saying out loud rather than silently
        // showing an empty book that looks like "this lender has no customers".
        return NextResponse.json(
          { success: false, source: "servicesuite", message: `Could not read the lender's book: ${err instanceof Error ? err.message : "unknown error"}` },
          { status: 502 },
        );
      }
    }
  }

  // Phones are stored as 2547XXXXXXXX; searches arrive as 07XX…, +2547…, etc —
  // match on the last 9 digits so every format finds the same borrower.
  const digits = q.replace(/\D/g, "");
  const phoneNeedle = digits.length >= 9 ? digits.slice(-9) : digits;
  // WHOSE borrowers. Enforced in the QUERY, never in the page: a list that filters on
  // render still ships every row in the HTML (the bug the billing work already caught).
  const scope = await resolveScope(session);

  const borrowers = await prisma.borrower.findMany({
    where: {
      orgId,
      ...borrowerScopeWhere(scope),
      ...(q
        ? {
            OR: [
              ...(phoneNeedle ? [{ phone: { contains: phoneNeedle } }] : []),
              { nationalId: { contains: q } },
              { firstName: { contains: q, mode: "insensitive" as const } },
              { otherName: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      loans: { select: { status: true, loanAmount: true, balance: true } },
      applications: { select: { status: true }, take: 20, orderBy: { createdAt: "desc" } },
      consents: { select: { version: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  // The face beside the name. One batch signature for the whole page (lib/kyc/avatars).
  const portraits = await portraitsFor(borrowers.map((b) => b.id));

  return NextResponse.json({
    success: true,
    borrowers: borrowers.map((b) => {
      const active = b.loans.filter((l) => l.status === "ACTIVE" || l.status === "PENDING_DISBURSEMENT");
      const cleared = b.loans.filter((l) => l.status === "CLEARED");
      return {
        id: b.id,
        portraitUrl: portraits[b.id] ?? null,
        name: `${b.firstName ?? ""} ${b.otherName ?? ""}`.trim() || null,
        phone: b.phone,
        nationalId: b.nationalId,
        kycStatus: b.kycStatus,
        creditScore: b.creditScore,
        riskBand: b.riskBand,
        locationType: b.locationType,
        locationAddress: b.locationAddress,
        hasGeo: b.lat != null && b.lng != null,
        createdAt: b.createdAt,
        loansCount: b.loans.length,
        activeLoans: active.length,
        clearedLoans: cleared.length,
        olb: active.reduce((a, l) => a + Number(l.balance), 0),
        totalBorrowed: b.loans.reduce((a, l) => a + Number(l.loanAmount), 0),
        applications: b.applications.length,
        graduated: cleared.length >= 5 && active.length === 0,
        lastConsent: b.consents[0]?.version ?? null,
      };
    }),
  });
}

// POST — register a walk-in borrower from the console (borrowers.create).
// The officer-side twin of the funnel's self-onboarding: identity now, KYC and
// scoring follow through the normal machinery (the /verify wizard and the
// application pipeline treat a console-created borrower like any other).
export async function POST(req: NextRequest) {
  const session = await auth();
  const denied = await requireRight(session, "borrowers.create");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;

  let body: {
    name?: string; phone?: string; nationalId?: string; email?: string;
    locationType?: string; locationAddress?: string; lat?: number; lng?: number;
    dob?: string; gender?: string;
    /** Consented one-time location snapshots from the onboarding page. Business
        is the primary pin when both are captured (it's what dispatch routes on). */
    geo?: {
      consent?: boolean;
      business?: { lat?: number; lng?: number; address?: string } | null;
      home?: { lat?: number; lng?: number; address?: string } | null;
    };
    /** Registry-first onboarding: the IPRS payload the officer reviewed (frozen as a KycCheck). */
    iprs?: { mode?: string; fullName?: string; gender?: string; dob?: string; citizenship?: string; serialNumber?: string; placeOfBirth?: string; placeOfLive?: string };
    /** The lender's own extra questions, keyed by the stable item code. */
    details?: Record<string, unknown>;
    /** Which rail produced this record — audited, and shown on the customer file. */
    onboardingMethod?: string;
    occupation?: string; businessName?: string;
    postalAddress?: string; physicalAddress?: string;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const name = (body.name ?? "").trim();
  const digits = (body.phone ?? "").replace(/\D/g, "");
  if (name.length < 3) return NextResponse.json({ success: false, message: "Enter the borrower's full name." }, { status: 400 });
  if (digits.length < 9) return NextResponse.json({ success: false, message: "Enter a valid phone number." }, { status: 400 });
  const phone = `254${digits.slice(-9)}`;

  // ── The lender's own rules, enforced server-side ──────────────────────────
  //
  // The screen rendered the onboarding contract; this re-derives it and checks the
  // submission against it. Not belt-and-braces: the contract is what a lender
  // configured, four surfaces submit to this one endpoint, and a rule only the
  // client enforces is a rule a different client does not.
  const [borrowerCfg, detailsCfg] = await Promise.all([
    readBorrowerConfig(orgId),
    readDetailsConfig(orgId),
  ]);
  const kyc = borrowerCfg.value.kyc.fields;
  const submitted: Record<string, string> = {
    firstName: name.split(/\s+/)[0] ?? "",
    otherName: name.split(/\s+/).slice(1).join(" "),
    nationalId: (body.nationalId ?? "").trim(),
    phone: digits,
    email: (body.email ?? "").trim(),
    dob: (body.dob ?? body.iprs?.dob ?? "").trim(),
    gender: (body.gender ?? body.iprs?.gender ?? "").trim(),
    occupation: (body.occupation ?? "").trim(),
    businessName: (body.businessName ?? "").trim(),
    postalAddress: (body.postalAddress ?? "").trim(),
    physicalAddress: (body.physicalAddress ?? "").trim(),
    nextOfKin: "",
  };
  const missingFields = KYC_FIELDS
    .filter((f) => kyc[f.key]?.required && !kyc[f.key]?.hidden && !submitted[f.key])
    .map((f) => f.label);
  if (missingFields.length > 0) {
    return NextResponse.json({
      success: false,
      message: `Your borrower settings require ${missingFields.join(", ")}.`,
    }, { status: 422 });
  }

  // The extra questions this lender invented, validated by the same function the
  // screen ran, so the two can never disagree about what "complete" means.
  const detailValues = (body.details ?? {}) as DetailValues;
  const detailIssues = validateDetailValues(groupsFor(detailsCfg.value, "borrower"), detailValues);
  if (detailIssues.length > 0) {
    return NextResponse.json(
      { success: false, message: detailIssues[0].message, issues: detailIssues },
      { status: 422 },
    );
  }

  // A location the lender insists on is not optional because a client forgot it.
  if (borrowerCfg.value.onboarding.geo.required) {
    const anyPin = borrowerCfg.value.onboarding.geo.places.some((place) => {
      const p = place === "business" ? body.geo?.business : body.geo?.home;
      return p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));
    });
    if (!body.geo?.consent || !anyPin) {
      return NextResponse.json({
        success: false,
        message: "Your borrower settings require a consented location snapshot.",
      }, { status: 422 });
    }
  }

  // One borrower per phone per org — the phone IS the identity key everywhere else.
  const dup = await prisma.borrower.findFirst({ where: { orgId, phone: { contains: digits.slice(-9) } }, select: { id: true } });
  if (dup) {
    return NextResponse.json({ success: false, message: "A borrower with that phone already exists.", borrowerId: dup.id }, { status: 409 });
  }

  const [first, ...rest] = name.split(/\s+/);
  const hasGeo = Number.isFinite(Number(body.lat)) && Number.isFinite(Number(body.lng));

  // Location snapshots (new onboarding shape). The pin only lands with consent;
  // business becomes the primary lat/lng, home rides in its own columns unless
  // it is the only pin (then IT is primary and locationType says so).
  const pin = (p?: { lat?: number; lng?: number } | null) =>
    p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) ? { lat: Number(p.lat), lng: Number(p.lng) } : null;
  const consented = body.geo?.consent === true;
  const biz = consented ? pin(body.geo?.business) : null;
  const home = consented ? pin(body.geo?.home) : null;
  const primary = biz ?? home;
  const geoData = primary
    ? {
        lat: primary.lat,
        lng: primary.lng,
        locationType: biz ? "business" : "home",
        locationAddress: (biz ? body.geo?.business?.address : body.geo?.home?.address)?.trim() || null,
        homeLat: biz && home ? home.lat : null,
        homeLng: biz && home ? home.lng : null,
        homeAddress: body.geo?.home?.address?.trim() || null,
        geoConsentAt: new Date(),
      }
    : null;

  // Registry dates arrive in whatever the bureau prints ("14/03/1988",
  // "1988-03-14", "14. 03. 1988") — parse best-effort, store null over garbage.
  const dob = parseDob(body.dob ?? body.iprs?.dob);
  const gender = (body.gender ?? body.iprs?.gender ?? "").trim() || null;

  // The officer who registers a walk-in OWNS them: this stamp is what later lets an
  // OWN-scoped officer see their own book and nobody else's (src/lib/rbac/scope.ts).
  const me = await prisma.staffUser.findFirst({
    where: { id: session!.user!.id, orgId },
    select: { id: true, branchId: true },
  });
  const origin = await originStamp(orgId, me);

  const borrower = await prisma.borrower.create({
    data: {
      orgId,
      createdById: origin.staffId,
      branchId: origin.branchId,
      phone,
      firstName: first,
      otherName: rest.join(" ") || null,
      nationalId: body.nationalId?.trim() || null,
      email: body.email?.trim() || null,
      dob,
      gender,
      locationType: body.locationType === "business" || body.locationType === "home" ? body.locationType : null,
      locationAddress: body.locationAddress?.trim() || null,
      lat: hasGeo ? Number(body.lat) : null,
      lng: hasGeo ? Number(body.lng) : null,
      // The lender's own questions, filed under the item CODE and never the title —
      // renaming a field on the settings screen must not orphan a year of capture.
      details: Object.keys(detailValues).length > 0 ? (detailValues as Prisma.InputJsonValue) : undefined,
      ...(geoData ?? {}),
    },
  });

  // Registry-first onboarding: the IPRS prefill the officer reviewed is frozen
  // onto the record as a KycCheck — the identity fields on this borrower came
  // from the registry, and this row is what says so. It is a PREFILL, not a
  // verification: kycStatus stays NONE until the full pipeline (face, liveness)
  // runs, because a registry says the ID exists, not that this person owns it.
  if (body.iprs?.fullName) {
    await prisma.kycCheck.create({
      data: {
        orgId,
        borrowerId: borrower.id,
        kind: "IPRS",
        passed: true,
        score: 100,
        payload: {
          context: "onboarding-prefill",
          engine: body.iprs.mode === "live" ? "spinmobile" : "simulation",
          name: body.iprs.fullName,
          gender: body.iprs.gender ?? null,
          dob: body.iprs.dob ?? null,
          citizenship: body.iprs.citizenship ?? null,
          serialNumber: body.iprs.serialNumber ?? null,
          placeOfBirth: body.iprs.placeOfBirth ?? null,
          placeOfLive: body.iprs.placeOfLive ?? null,
          collectedBy: session!.user!.name ?? session!.user!.id,
        },
      },
    }).catch(() => {});
  }

  await prisma.auditLog.create({
    data: {
      orgId, actorId: session!.user!.id, actorType: "staff", action: "borrower.create",
      entity: "Borrower", entityId: borrower.id,
      meta: {
        channel: "console",
        phone,
        method: body.onboardingMethod ?? "manual",
        iprsPrefill: !!body.iprs?.fullName,
        detailsCaptured: Object.keys(detailValues).length,
        geoPinned: geoData ? (biz && home ? "business+home" : biz ? "business" : "home") : "none",
      },
    },
  }).catch(() => {});

  return NextResponse.json({ success: true, borrowerId: borrower.id });
}

/** "14/03/1988" · "1988-03-14" · "14. 03. 1988" → Date, or null — never garbage. */
function parseDob(raw?: string | null): Date | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const iso = v.match(/^(\d{4})[-/. ]+(\d{1,2})[-/. ]+(\d{1,2})$/);
  const dmy = v.match(/^(\d{1,2})[-/. ]+(\d{1,2})[-/. ]+(\d{4})$/);
  const [y, m, d] = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : dmy
      ? [Number(dmy[3]), Number(dmy[2]), Number(dmy[1])]
      : [NaN, NaN, NaN];
  if (!Number.isFinite(y) || y < 1900 || y > new Date().getFullYear() || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(date.getTime()) ? null : date;
}
