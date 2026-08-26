// ─────────────────────────────────────────────────────────────────────────────
// GET  /api/portal/consent — what this customer has agreed to, and what each
//                            permission actually allows.
// POST /api/portal/consent — change it. Body: { nationalId, grants: {...} }
//
// The customer side of the Consent model. Until now consent could only be
// GIVEN, once, inside an application (see /api/lms/apply). There was no way for
// a customer to see what they had agreed to afterwards, and no way at all to
// take it back — which is the half that the Data Protection Act actually cares
// about and the half a regulator asks to see.
//
// ── APPEND-ONLY, AND WHY THAT IS THE POINT ───────────────────────────────────
// A withdrawal does not edit or delete the earlier row. It writes a NEW row
// carrying the full set of grants as they now stand. The Consent table has no
// `updatedAt` and no `withdrawnAt` for exactly this reason: the question a
// regulator asks is never "what do they consent to?" but "what did they consent
// to ON THE DAY you ran that check, and can you prove it?". An UPDATE destroys
// the only evidence that answers it.
//
// So the current state is the LATEST row, and the history is every row. Both are
// returned, because a customer is owed the same audit trail the lender holds.
//
// ── WHAT THIS ROUTE DELIBERATELY WILL NOT DO ─────────────────────────────────
// It will not let a customer switch OFF a mandatory grant while a loan is live
// and call it done. `mpesaAnalysis` and `automatedScoring` are how the decision
// was made; withdrawing them cannot un-make a decision already taken. Withdrawal
// is honoured going FORWARD — it stops the next check — and the response says
// so in words rather than silently accepting a toggle that changes nothing.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { borrowerFor, otpRequired } from "@/lib/portal/session";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

/**
 * The consent text this route writes against.
 *
 * Bumping it means the wording changed, which means prior agreement was to
 * DIFFERENT words and cannot be carried forward silently. Kept in step with
 * CONSENT_VERSION in /api/lms/apply.
 */
const CONSENT_VERSION = "2026-06-30";

/**
 * The vocabulary, mirroring src/lib/i18n/portal.ts.
 *
 * `mandatory` marks the two the assessment itself depends on. They are not
 * hidden and not un-togglable — a customer may withdraw anything — but the UI is
 * told which ones stop a future application, so it can say so before the toggle
 * rather than after.
 */
const CATALOGUE = [
  {
    key: "mpesaAnalysis",
    label: "Analyse my M-PESA statement",
    detail: "To assess affordability from my cashflow.",
    mandatory: true,
  },
  {
    key: "automatedScoring",
    label: "Use automated credit scoring",
    detail: "An AI model helps decide; a human reviews adverse outcomes.",
    mandatory: true,
  },
  {
    key: "crbCheck",
    label: "Check my credit reference (CRB)",
    detail: "Via the lender's licensed bureau.",
    mandatory: false,
  },
  {
    // ── THE INTERCHANGE ──────────────────────────────────────────────────────
    // This is the grant the federated exposure query is gated on, and its
    // wording is deliberately RECIPROCAL: the customer is told that we ask other
    // lenders AND that we answer about them. Describing only the half that
    // benefits us would be the kind of consent a regulator reads as no consent
    // at all.
    //
    // It also names what is not shared, because "we share your data with other
    // lenders" is what a borrower will otherwise assume this means. Amounts come
    // back as ranges and status as a bucket — never a name, never an ID number,
    // never a phone number. That is enforced in the node, not promised here.
    //
    // Mandatory, matching `ecosystem.exposure` in the Interchange's own scope
    // catalogue: it forms part of the affordability assessment, which is what
    // makes conditioning a loan on it defensible.
    key: "ecosystemExposure",
    label: "Check what I owe other lenders in this network",
    detail:
      "They are told ranges and repayment status — never my name, ID number or phone number. They may ask the same about me.",
    mandatory: true,
  },
  {
    key: "iprs",
    label: "Verify my ID against the national register",
    detail: "Confirms the ID belongs to me.",
    mandatory: false,
  },
  {
    key: "modelImprovement",
    label: "Use my de-identified data to improve models",
    detail: "Aggregated, never sold.",
    mandatory: false,
  },
  {
    key: "crossBorder",
    label: "Process data with secure overseas AI services",
    detail: "Minimised & masked per the Data Protection Act.",
    mandatory: false,
  },
  {
    key: "geoTagging",
    label: "Record my business and home location",
    detail: "Captured once so an officer can find you — not ongoing tracking.",
    mandatory: false,
  },
] as const;

type GrantKey = (typeof CATALOGUE)[number]["key"];
const KEYS = CATALOGUE.map((c) => c.key) as readonly string[];

/** Whatever is in the Json column, reduced to a boolean per known key. */
function readGrants(raw: unknown): Record<GrantKey, boolean> {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = {} as Record<GrantKey, boolean>;
  for (const k of KEYS) out[k as GrantKey] = src[k] === true;
  return out;
}

/** Resolve org + verified borrower, or the response that says why not. */
async function context(lenderSlug: string, nationalId: string) {
  const org = await resolveOrg(lenderSlug);
  if (org) enterOrg(org.id);
  if (!org) {
    return { fail: NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 }) };
  }

  const verified = await borrowerFor(org.id);
  if (!verified) return { fail: otpRequired() };

  const borrower = await prisma.borrower.findFirst({
    where: { orgId: org.id, phone: { endsWith: verified.phone.slice(-9) }, nationalId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!borrower) {
    // Deliberately the same wording whether the ID is wrong or simply unknown
    // here: a different message for each turns this into an oracle for "does
    // this ID number bank with this lender?".
    return {
      fail: NextResponse.json(
        { success: false, message: "We could not match that ID to an account on this number." },
        { status: 404 },
      ),
    };
  }

  return { org, borrower };
}

export async function POST(req: NextRequest) {
  let body: { lenderSlug?: string; nationalId?: string; grants?: Record<string, unknown>; action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 });
  }

  const nationalId = (body.nationalId ?? "").trim();
  if (!nationalId) {
    return NextResponse.json({ success: false, message: "Enter your national ID." }, { status: 400 });
  }

  const ctx = await context(body.lenderSlug ?? "", nationalId);
  if ("fail" in ctx) return ctx.fail;
  const { org, borrower } = ctx;

  const limited = await rateLimit(
    [
      { name: "consent:write", subject: `${org.id}:${borrower.id}`, max: 20, windowSec: 3600 },
      { name: "consent:write:ip", subject: clientIp(req), max: 60, windowSec: 3600 },
    ],
    "Too many changes. Please wait a moment.",
  );
  if (limited) return limited;

  // ── READ: the current state, so a partial body cannot silently clear a grant
  // the customer did not touch. The client sends what it wants changed; every
  // other permission carries forward exactly as it was.
  const latest = await prisma.consent.findFirst({
    where: { orgId: org.id, borrowerId: borrower.id },
    orderBy: { createdAt: "desc" },
    select: { grants: true },
  });
  const current = readGrants(latest?.grants);

  const incoming = body.grants && typeof body.grants === "object" ? body.grants : {};
  const next = { ...current };
  let touched = 0;
  for (const k of KEYS) {
    if (k in incoming) {
      const v = incoming[k] === true;
      if (next[k as GrantKey] !== v) touched += 1;
      next[k as GrantKey] = v;
    }
  }

  if (!touched) {
    return NextResponse.json({
      success: true,
      unchanged: true,
      grants: current,
      message: "Nothing changed.",
    });
  }

  const row = await prisma.consent.create({
    data: {
      orgId: org.id,
      borrowerId: borrower.id,
      version: CONSENT_VERSION,
      grants: next as Prisma.InputJsonValue,
      ip: req.headers.get("x-forwarded-for") || null,
    },
    select: { id: true, createdAt: true },
  });

  const withdrewMandatory = CATALOGUE.some((c) => c.mandatory && current[c.key] && !next[c.key]);

  return NextResponse.json({
    success: true,
    grants: next,
    recordedAt: row.createdAt,
    version: CONSENT_VERSION,
    // Said plainly rather than left for the customer to discover at the next
    // application. Withdrawal is honoured forward; it does not reverse a
    // decision already taken on the strength of the earlier permission.
    message: withdrewMandatory
      ? "Saved. Because you have withdrawn a permission the assessment depends on, a new application cannot be scored until you turn it back on. Decisions already made are unaffected."
      : "Saved. This takes effect from now on.",
  });
}

export async function GET(req: NextRequest) {
  const nationalId = (req.nextUrl.searchParams.get("nationalId") ?? "").trim();
  const lenderSlug = req.nextUrl.searchParams.get("lenderSlug") ?? "";
  if (!nationalId) {
    return NextResponse.json({ success: false, message: "Enter your national ID." }, { status: 400 });
  }

  const ctx = await context(lenderSlug, nationalId);
  if ("fail" in ctx) return ctx.fail;
  const { org, borrower } = ctx;

  const rows = await prisma.consent.findMany({
    where: { orgId: org.id, borrowerId: borrower.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, version: true, grants: true, createdAt: true },
    take: 25,
  });

  return NextResponse.json({
    success: true,
    catalogue: CATALOGUE,
    grants: readGrants(rows[0]?.grants),
    version: rows[0]?.version ?? CONSENT_VERSION,
    recordedAt: rows[0]?.createdAt ?? null,
    /** Every change, newest first — the customer's copy of the audit trail. */
    history: rows.map((r) => ({
      id: r.id,
      at: r.createdAt,
      version: r.version,
      grants: readGrants(r.grants),
    })),
  });
}
