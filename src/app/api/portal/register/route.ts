// ─────────────────────────────────────────────────────────────────────────────
// POST /api/portal/register — the customer registers themselves, under the SAME
// rules an officer registers a walk-in with.
//
// The counter posts to /api/console/borrowers after rendering the onboarding
// contract. This is its twin for the "portal" channel, and it re-derives the same
// contract on the server and checks the submission against it — required fields,
// the lender's own extra questions, age bounds, referees, the location rule and
// the duplicate rule — because a rule only a client enforces is a rule a
// different client does not.
//
// ── WHAT IS TAKEN FROM THE CUSTOMER, AND WHAT IS NOT ────────────────────────
//   phone        from the verified session, never the body.
//   national ID  must be the one the KYC session read or looked up. A customer
//                who photographs one card and types another number is not
//                registering, they are testing the gate.
//   name         the REGISTRY's, when the registry answered live; otherwise
//                what they confirmed on the review screen.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { borrowerFor, otpRequired } from "@/lib/portal/session";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { originStamp } from "@/lib/rbac/scope";
import { attachKycSession } from "@/lib/kyc/attach";
import { validateDetailValues, type DetailValues } from "@/lib/config/details";
import { portalContract } from "@/lib/portal/journey";

export const runtime = "nodejs";

const CONSENT_VERSION = "portal-onboarding-2026-09-13";

type Pin = { lat?: number; lng?: number; accuracy?: number; address?: string } | null | undefined;
type Person = { name?: string; phone?: string; relationship?: string };

type Body = {
  lenderSlug?: string;
  firstName?: string;
  otherName?: string;
  nationalId?: string;
  dob?: string;
  gender?: string;
  email?: string;
  occupation?: string;
  businessName?: string;
  postalAddress?: string;
  physicalAddress?: string;
  nextOfKin?: Person | null;
  referees?: Person[];
  details?: Record<string, unknown>;
  geo?: { consent?: boolean; business?: Pin; home?: Pin };
  /** Which rail produced the identity — audited, and shown on the customer file. */
  onboardingMethod?: string;
  /** The permissions the customer gave on the consent screen. */
  consent?: Record<string, boolean>;
};

const clean = (v: unknown, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const msisdn = (v: unknown) => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length >= 9 ? `254${d.slice(-9)}` : "";
};
const coord = (p: Pin) =>
  p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) && Math.abs(Number(p.lat)) <= 90 && Math.abs(Number(p.lng)) <= 180
    ? { lat: Number(p.lat), lng: Number(p.lng) }
    : null;

function ageOn(dob: Date, at = new Date()): number {
  let a = at.getUTCFullYear() - dob.getUTCFullYear();
  const m = at.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && at.getUTCDate() < dob.getUTCDate())) a--;
  return a;
}

function parseDob(raw?: string | null): Date | null {
  const v = (raw ?? "").trim();
  const iso = v.match(/^(\d{4})[-/. ]+(\d{1,2})[-/. ]+(\d{1,2})/);
  const dmy = v.match(/^(\d{1,2})[-/. ]+(\d{1,2})[-/. ]+(\d{4})$/);
  const [y, m, d] = iso ? [+iso[1], +iso[2], +iso[3]] : dmy ? [+dmy[3], +dmy[2], +dmy[1]] : [NaN, NaN, NaN];
  if (!Number.isFinite(y) || y < 1900 || y > new Date().getFullYear() || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const org = await resolveOrg(body.lenderSlug ?? "");
  if (!org) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });
  enterOrg(org.id);

  const session = await borrowerFor(org.id);
  if (!session) return otpRequired();
  const phone = session.phone;

  const limited = await rateLimit([
    { name: "register:phone", subject: `${org.id}:${phone}`, max: 12, windowSec: 3600 },
    { name: "register:ip", subject: clientIp(req), max: 40, windowSec: 3600 },
  ]);
  if (limited) return limited;

  const contract = await portalContract(org);
  if (!contract.enabled) {
    return NextResponse.json(
      { success: false, reason: "channel", message: `${org.name} is not registering customers in the app right now. Visit a branch and an officer will do it with you.` },
      { status: 403 },
    );
  }

  // ── The identity the KYC session already holds ────────────────────────────
  const kyc = await prisma.kycSession.findFirst({
    where: { orgId: org.id, phone: { endsWith: phone.slice(-9) } },
    orderBy: { createdAt: "desc" },
    select: { id: true, nationalId: true, idOcrNumber: true, idOcrName: true, idOcrDob: true, iprsName: true, iprsMatched: true, provider: true },
  });
  const heldId = (kyc?.nationalId || kyc?.idOcrNumber || "").replace(/\D/g, "");
  const typedId = clean(body.nationalId, 12).replace(/\D/g, "");
  if (heldId && typedId && heldId !== typedId) {
    return NextResponse.json(
      { success: false, field: "nationalId", message: "That ID number is not the one on the card you verified. Use the number from your ID." },
      { status: 422 },
    );
  }
  const nationalId = heldId || typedId;

  // The registry's own name wins when the registry genuinely answered; a
  // simulated registry echoes whatever it was handed, so it proves nothing.
  const registryName = kyc?.iprsMatched && kyc.provider === "live" ? kyc.iprsName : null;
  const [regFirst, ...regRest] = (registryName ?? "").split(/\s+/).filter(Boolean);
  const firstName = regFirst || clean(body.firstName, 60);
  const otherName = regRest.join(" ") || clean(body.otherName, 120);

  const dob = parseDob(body.dob || kyc?.idOcrDob);
  const nok = body.nextOfKin && clean(body.nextOfKin.name) ? {
    name: clean(body.nextOfKin.name, 80),
    relationship: clean(body.nextOfKin.relationship, 40) || null,
    phone: msisdn(body.nextOfKin.phone) || null,
  } : null;

  const submitted: Record<string, string> = {
    firstName, otherName, nationalId, phone,
    dob: dob ? dob.toISOString().slice(0, 10) : "",
    gender: clean(body.gender, 12),
    email: clean(body.email, 120),
    postalAddress: clean(body.postalAddress, 160),
    physicalAddress: clean(body.physicalAddress, 160),
    occupation: clean(body.occupation, 80),
    businessName: clean(body.businessName, 120),
    nextOfKin: nok ? nok.name : "",
  };

  // ── The contract's required fields ────────────────────────────────────────
  const missing = contract.fields.filter((f) => f.required && !submitted[f.key]).map((f) => f.label);
  if (missing.length) {
    return NextResponse.json({ success: false, missing, message: `${org.name} needs your ${missing.join(", ").toLowerCase()} to open your account.` }, { status: 422 });
  }
  if (submitted.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(submitted.email)) {
    return NextResponse.json({ success: false, field: "email", message: "That email address does not look right." }, { status: 422 });
  }

  // ── Age ───────────────────────────────────────────────────────────────────
  if (contract.age) {
    if (!dob) {
      return NextResponse.json({ success: false, field: "dob", message: "We need your date of birth — it is on the front of your ID." }, { status: 422 });
    }
    const age = ageOn(dob);
    if (age < contract.age.min || age > contract.age.max) {
      return NextResponse.json(
        { success: false, reason: "age", field: "dob", message: `${org.name} lends to customers aged ${contract.age.min} to ${contract.age.max}. The date of birth on your ID puts you outside that range.` },
        { status: 422 },
      );
    }
  }

  // ── The lender's own questions ────────────────────────────────────────────
  const detailValues = (body.details ?? {}) as DetailValues;
  const detailIssues = validateDetailValues(contract.detailGroups, detailValues);
  if (detailIssues.length) {
    return NextResponse.json({ success: false, issues: detailIssues, message: detailIssues[0].message }, { status: 422 });
  }

  // ── Referees ──────────────────────────────────────────────────────────────
  const referees = (Array.isArray(body.referees) ? body.referees : [])
    .map((r) => ({ name: clean(r?.name, 80), phone: msisdn(r?.phone), relationship: clean(r?.relationship, 40) || null }))
    .filter((r) => r.name || r.phone);
  if (contract.flags.referees) {
    const { min, max } = contract.flags.referees;
    const complete = referees.filter((r) => r.name && r.phone);
    if (complete.length < min) {
      return NextResponse.json({ success: false, field: "referees", message: `Add ${min} referee${min === 1 ? "" : "s"} — somebody who knows you, with their phone number.` }, { status: 422 });
    }
    if (complete.length > max) {
      return NextResponse.json({ success: false, field: "referees", message: `${org.name} takes at most ${max} referee${max === 1 ? "" : "s"}.` }, { status: 422 });
    }
    if (complete.some((r) => r.phone === phone)) {
      return NextResponse.json({ success: false, field: "referees", message: "A referee has to be somebody other than you." }, { status: 422 });
    }
  }

  // ── Location ──────────────────────────────────────────────────────────────
  const consented = body.geo?.consent === true;
  const biz = consented ? coord(body.geo?.business) : null;
  const home = consented ? coord(body.geo?.home) : null;
  if (contract.geo.required && !(biz || home)) {
    return NextResponse.json({ success: false, field: "geo", message: `${org.name} needs a location pin for your ${contract.geo.places.join(" or ")} before your account can open.` }, { status: 422 });
  }

  // ── Somebody who is already on this book ─────────────────────────────────
  const warnings: string[] = [];
  if (nationalId) {
    const clash = await prisma.borrower.findFirst({
      where: { orgId: org.id, nationalId, erasedAt: null, NOT: { phone: { endsWith: phone.slice(-9) } } },
      select: { id: true, phone: true },
    });
    if (clash) {
      if (contract.flags.onDuplicate === "warn") {
        warnings.push("duplicate-national-id");
      } else {
        const tail = clash.phone.slice(-3);
        return NextResponse.json(
          {
            success: false,
            reason: "duplicate",
            message:
              contract.flags.onDuplicate === "open_existing"
                ? `This ID already has an account with ${org.name} on a number ending ${tail}. Sign in with that number instead.`
                : `This ID already has an account with ${org.name}. One person holds one account — contact ${org.name} if you have changed your number.`,
          },
          { status: 409 },
        );
      }
    }
  }

  const primary = biz ?? home;
  const geoData = primary
    ? {
        lat: primary.lat,
        lng: primary.lng,
        locationType: biz ? "business" : "home",
        locationAddress: clean(biz ? body.geo?.business?.address : body.geo?.home?.address, 200) || null,
        homeLat: biz && home ? home.lat : null,
        homeLng: biz && home ? home.lng : null,
        homeAddress: clean(body.geo?.home?.address, 200) || null,
        geoConsentAt: new Date(),
      }
    : {};

  const allDetails: Record<string, unknown> = {
    ...detailValues,
    ...(submitted.occupation ? { OCCUPATION: submitted.occupation } : {}),
    ...(submitted.businessName ? { BUSINESS_NAME: submitted.businessName } : {}),
    ...(submitted.postalAddress ? { POSTAL_ADDRESS: submitted.postalAddress } : {}),
    ...(submitted.physicalAddress ? { PHYSICAL_ADDRESS: submitted.physicalAddress } : {}),
    ...(referees.length ? { REFEREES: referees } : {}),
  };

  const origin = await originStamp(org.id, null);
  const identity = {
    firstName: firstName || null,
    otherName: otherName || null,
    nationalId: nationalId || null,
    email: submitted.email || null,
    dob,
    gender: submitted.gender || null,
    nextOfKin: nok ? (nok as Prisma.InputJsonValue) : undefined,
    details: Object.keys(allDetails).length ? (allDetails as Prisma.InputJsonValue) : undefined,
    ...geoData,
  };

  const borrower = await prisma.borrower.upsert({
    where: { orgId_phone: { orgId: org.id, phone } },
    update: identity,
    create: { orgId: org.id, phone, branchId: origin.branchId, ...identity },
    select: { id: true, createdAt: true, updatedAt: true },
  });
  const created = borrower.createdAt.getTime() === borrower.updatedAt.getTime();

  // The permissions given on screen, as a versioned, IP-stamped record.
  await prisma.consent.create({
    data: {
      orgId: org.id,
      borrowerId: borrower.id,
      version: CONSENT_VERSION,
      grants: { ...(body.consent ?? {}), geoTagging: consented } as Prisma.InputJsonValue,
      ip: clientIp(req),
    },
  }).catch(() => {});

  for (const [kind, pin, addr] of [["business", biz, body.geo?.business?.address], ["home", home, body.geo?.home?.address]] as const) {
    if (!pin) continue;
    await prisma.geoPin.create({
      data: {
        orgId: org.id, borrowerId: borrower.id, label: `${firstName || phone} (${kind})`,
        lat: pin.lat, lng: pin.lng, locationType: kind, address: clean(addr, 200) || null, phone,
        source: "self-onboard", note: "Pinned by the customer in the app",
      },
    }).catch(() => {});
  }

  // A session finished before this call is promoted now; one finished after is
  // promoted by finalize, which looks the borrower up by phone.
  await attachKycSession(org.id, borrower.id, phone, nationalId || null).catch(() => null);

  await prisma.auditLog.create({
    data: {
      orgId: org.id, actorId: borrower.id, actorType: "borrower",
      action: created ? "borrower.create" : "borrower.update",
      entity: "Borrower", entityId: borrower.id, ip: clientIp(req),
      meta: {
        channel: "portal",
        method: clean(body.onboardingMethod, 20) || contract.primary,
        detailsCaptured: Object.keys(detailValues).length,
        referees: referees.length,
        geoPinned: biz && home ? "business+home" : biz ? "business" : home ? "home" : "none",
        warnings,
      },
    },
  }).catch(() => {});

  return NextResponse.json({ success: true, borrowerId: borrower.id, created, warnings });
}
