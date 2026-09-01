// ─────────────────────────────────────────────────────────────────────────────
// POST /api/portal/exposure — "what does the credit system see about me?"
//
// Body: { lenderSlug, nationalId }. The phone comes from the verified OTP
// session; the national ID is the second factor, the same door as /my-loan and
// /decision. A person's bureau file is at least as sensitive as their balance,
// so it gets the same lock rather than a lighter one.
//
// ── THIS ROUTE NEVER SPENDS THE LENDER'S MONEY ───────────────────────────────
// A live Metropol pull is BILLED PER PULL, and the tariff scales with the
// scrutiny tier — a forensic report is not a rounding error. An endpoint a
// customer can trigger, that pulls the bureau on every open, is a way to hand a
// lender a surprise invoice and, at scale, a denial-of-wallet.
//
// So it reads the LAST STORED REPORT (KycCheck kind=CRB, where every console
// pull is already persisted in full) and never calls runCrbCheck(). If nothing
// is on file the honest answer is "nothing has been pulled yet", which is both
// true and useful — it tells the customer their lender has not checked them.
//
// The paid pull stays where the spend decision belongs: with the lender, in
// /api/console/crb, which already has a reuse window for the same reason.
//
// ── CONSENT IS CHECKED, NOT ASSUMED ──────────────────────────────────────────
// `crbCheck` must be granted on the borrower's latest Consent row. Reading back
// a report the customer has since withdrawn permission for is exactly the thing
// the withdrawal was meant to stop, and "we already had it" is not a defence.
//
// ── WHAT IS RETURNED, AND WHAT IS NOT ────────────────────────────────────────
// The customer-safe subset. `metropol` (the full bureau detail) and `cost` (what
// the lender paid) are stripped: the first carries third-party account detail
// beyond what a subject-access response should stream to a handset, and the
// second is the lender's commercial data, not the customer's.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { MERGED_CRB_ONLY } from "@/lib/crb/rows";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { borrowerFor, otpRequired } from "@/lib/portal/session";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import type { CrbReport } from "@/lib/crb/provider";
import {
  authorise,
  deriveToken,
  fetchFilters,
  hasMemberIdentity,
  interchangeConfigured,
  issueConsent,
  memberIdentity,
} from "@/lib/interchange/registry";
import { queryExposure } from "@/lib/interchange/broker";
import { NODE_MEMBERS, memberCodeForOrgSlug } from "@/lib/interchange/members";

export const runtime = "nodejs";

/** Beyond this a stored file is shown, but flagged as possibly out of date. */
const STALE_AFTER_DAYS = 90;

type SafeReport = Omit<CrbReport, "metropol" | "cost"> & { stale: boolean };

function toSafe(raw: unknown, checkedAt: Date): SafeReport | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as CrbReport;
  if (typeof r.score !== "number") return null;

  // Destructured out rather than deleted, so a future field added to CrbReport
  // is included by default and only the two named ones are ever withheld.
  const { metropol: _m, cost: _c, ...rest } = r;
  const ageDays = (Date.now() - checkedAt.getTime()) / 86_400_000;

  return { ...rest, stale: ageDays > STALE_AFTER_DAYS };
}

export async function POST(req: NextRequest) {
  let body: { lenderSlug?: string; nationalId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 });
  }

  const nationalId = (body.nationalId ?? "").trim();
  if (!nationalId) {
    return NextResponse.json({ success: false, message: "Enter your national ID." }, { status: 400 });
  }

  const org = await resolveOrg(body.lenderSlug ?? "");
  if (org) enterOrg(org.id);
  if (!org) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });

  const verified = await borrowerFor(org.id);
  if (!verified) return otpRequired();

  const limited = await rateLimit(
    [
      { name: "exposure:phone", subject: `${org.id}:${verified.phone}`, max: 20, windowSec: 3600 },
      { name: "exposure:ip", subject: clientIp(req), max: 60, windowSec: 3600 },
    ],
    "Too many requests. Please wait a moment.",
  );
  if (limited) return limited;

  const borrower = await prisma.borrower.findFirst({
    where: { orgId: org.id, phone: { endsWith: verified.phone.slice(-9) }, nationalId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!borrower) {
    return NextResponse.json(
      { success: false, message: "We could not match that ID to an account on this number." },
      { status: 404 },
    );
  }

  // ── Consent gate ─────────────────────────────────────────────────────────
  const consent = await prisma.consent.findFirst({
    where: { orgId: org.id, borrowerId: borrower.id },
    orderBy: { createdAt: "desc" },
    select: { grants: true },
  });
  const grants =
    consent?.grants && typeof consent.grants === "object" && !Array.isArray(consent.grants)
      ? (consent.grants as Record<string, unknown>)
      : {};
  const crbAllowed = grants.crbCheck === true;

  const [stored, loanCount] = await Promise.all([
    crbAllowed
      ? prisma.kycCheck.findFirst({
          where: { orgId: org.id, borrowerId: borrower.id, kind: "CRB", ...MERGED_CRB_ONLY },
          orderBy: { createdAt: "desc" },
          select: { payload: true, createdAt: true },
        })
      : Promise.resolve(null),
    // The one exposure figure this deployment can answer for itself, honestly:
    // what this customer owes THIS lender. Everything wider needs the exchange.
    // "Open" is ACTIVE + RESTRUCTURED: money still owed. PENDING_DISBURSEMENT is
    // not yet money in hand, and CLEARED/WRITTEN_OFF are closed. Taken from the
    // LoanStatus enum in schema.prisma rather than assumed — there is no
    // ARREARS or DEFAULTED member, and naming one throws at query time.
    prisma.loan.count({
      where: { orgId: org.id, borrowerId: borrower.id, status: { in: ["ACTIVE", "RESTRUCTURED"] } },
    }).catch(() => 0),
  ]);

  const report = stored ? toSafe(stored.payload, stored.createdAt) : null;

  return NextResponse.json({
    success: true,

    /** The bureau file, or an honest account of why there isn't one. */
    crb: {
      consented: crbAllowed,
      available: Boolean(report),
      checkedAt: stored?.createdAt ?? null,
      report,
      message: !crbAllowed
        ? "You have not given permission for a credit reference check. Turn it on under Permissions to see your file here."
        : report
          ? null
          : "Your lender has not run a credit reference check on you yet. When they do, the result appears here.",
    },

    /** What this lender itself is carrying for this customer. */
    withThisLender: {
      lender: org.name,
      openLoans: loanCount,
    },

    /**
     * ── THE INTERCHANGE ──────────────────────────────────────────────────
     * Federated exposure across the other members of the network.
     *
     * Every one of the five states this can return is a DIFFERENT sentence on
     * the screen, because they mean different things to the customer and only
     * one of them means "you owe nothing elsewhere":
     *
     *   not-configured  this lender is not on the network
     *   not-consented   the customer has not permitted the check
     *   refused         the Registry turned the query down, with its reason
     *   partial         some members could not answer — the figure is a floor
     *   ok              a complete answer
     *
     * Collapsing any of them into "no exposure found" would tell a customer
     * their record is clean when it is merely unknown, and would tell a lender
     * the same thing.
     */
    interchange: await interchangeExposure(org.slug, nationalId, grants),
  });
}

/**
 * Run the brokered query, or explain precisely why it did not run.
 *
 * This never throws. The credit file is a screen a customer opens; a network
 * fault on one section must not take the bureau file and this lender's own
 * balance down with it.
 */
async function interchangeExposure(
  orgSlug: string,
  nationalId: string,
  grants: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const memberCode = memberCodeForOrgSlug(orgSlug);

  if (!interchangeConfigured() || !memberCode || !hasMemberIdentity(memberCode)) {
    return {
      connected: false,
      state: "not-configured",
      message:
        "Exposure across other lenders is not switched on for this lender yet. When it is, you will see how much you owe elsewhere as a range — never the names of other lenders, and never exact amounts.",
    };
  }

  // ── Consent, before anything is derived ──────────────────────────────────
  // Checked BEFORE tokenisation, not after. Deriving a subject token for a
  // customer who has refused the check would spend the ecosystem key on
  // somebody who said no, and leave a trace of them in the Registry's issuance
  // log — which is exactly what the refusal was meant to prevent.
  if (grants.ecosystemExposure !== true) {
    return {
      connected: true,
      state: "not-consented",
      message:
        "You have not given permission to check what you owe other lenders. Turn it on under Permissions to see your position across the network here.",
    };
  }

  try {
    const who = memberIdentity(memberCode);

    // The identity boundary. The national ID is blinded here, evaluated by the
    // Registry as a random point, and finalized here. It never crosses.
    const subjectToken = await deriveToken(who, "national_id", nationalId);

    const consent = await issueConsent({
      subjectToken,
      memberCode,
      capturedVia: "PWA",
      evidence: { surface: "portal/credit-file", capturedAt: new Date().toISOString() },
    });
    if (!consent.ok) {
      return {
        connected: true,
        state: "refused",
        message: "We could not record your permission with the network, so no lender was asked.",
        detail: consent.message,
      };
    }

    const authz = await authorise(who, {
      serviceCode: "exposure-v1",
      subjectToken,
      consentRef: consent.ref,
    });
    if (!authz.ok) {
      return {
        connected: true,
        state: "refused",
        message: "The network declined this check, so no lender was asked.",
        detail: authz.reason,
      };
    }

    const filters = await fetchFilters();
    const result = await queryExposure({
      who,
      memberCodes: NODE_MEMBERS.map((m) => m.code),
      filters,
      subjectToken,
      // The customer sees WHO only if they granted identity.disclose. Until the
      // permissions screen offers that grant, the honest default is anonymous
      // aggregates, which is what the scope catalogue treats as the baseline.
      discloseLenders: false,
    });

    const found = result.lenders > 0;

    return {
      connected: true,
      state: result.partial ? "partial" : "ok",
      lenders: result.lenders,
      activeLoans: result.activeLoans,
      outstandingBand: found ? result.outstandingBand : "none",
      worstBucket: found ? result.worstBucket : null,
      /** New credit taken anywhere in the network in the last fortnight. */
      velocity14d: result.velocity14d,
      asOf: result.asOf,
      queried: result.queried,
      responded: result.responded,
      message: !found
        ? result.partial
          ? "No other lender in the network reported a loan to you — but not every lender could be reached, so this may not be the whole picture."
          : "No other lender in the network is currently reporting a loan to you."
        : result.partial
          ? "Some lenders could not be reached, so you may owe more elsewhere than is shown here."
          : null,
    };
  } catch (e) {
    // A network fault is not a clean bill of health, and must never read as one.
    return {
      connected: true,
      state: "refused",
      message: "The lending network could not be reached, so we cannot show your position across other lenders.",
      detail: (e as Error).message,
    };
  }
}
