// ─────────────────────────────────────────────────────────────────────────────
// POST /api/console/interchange/report — buy a report THROUGH THE INTERCHANGE.
//
// The officer presses one button on an application and gets a PDF. What happens
// underneath is the whole architecture, in order:
//
//   1. RIGHTS     the operator must hold borrowers.view on this org.
//   2. CONSENT    the borrower must have granted `crbCheck` on their LMS consent
//                 record. Not a formality: it is the lawful basis for the pull,
//                 and it is checked BEFORE the identifier is tokenised, so a
//                 borrower who refused leaves no trace in the Registry at all.
//   3. TOKENISE   the national ID is blinded here, evaluated by the Registry as
//                 a random point, and unblinded here. The Registry never sees it.
//   4. CONSENT REF a consent is registered with the Interchange against that
//                 token, quoting the LMS consent row as its evidence.
//   5. REQUEST    a signed call to /api/v1/report. The Registry gates it, asks
//                 the contract holder's node to pull from Metropol, normalises
//                 the answer, renders it, and logs the whole thing to the
//                 hash-chained message log.
//   6. STREAM     the PDF comes back to the browser as a download.
//
// ── WHY GO THROUGH THE INTERCHANGE AT ALL, WHEN THIS DEPLOYMENT HOLDS THE KEYS ─
// Because the point is the road, not the destination. This same button, in a
// member who has NO Metropol contract, does exactly the same thing and works —
// the Registry routes the pull to whoever holds the contract, meters it, and
// bills it. Calling Metropol directly from here would be faster today and would
// prove nothing about the product being built.
//
// The direct path still exists at /api/console/crb and is untouched: it is what
// a stage gate uses to buy a merged file for THIS lender's own decision. This
// endpoint is the ecosystem path, and it is deliberately separate.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import {
  deriveToken,
  hasMemberIdentity,
  interchangeConfigured,
  issueConsent,
  memberIdentity,
  signedPostRaw,
  InterchangeUnavailable,
} from "@/lib/interchange/registry";
import { memberCodeForOrgSlug } from "@/lib/interchange/members";
import { INTERCHANGE_PROVIDER } from "@/lib/crb/rows";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
/** A bureau pull is several serial third-party calls, then a render. */
export const maxDuration = 120;

type Body = {
  applicationId?: string;
  borrowerId?: string;
  /** Interchange report type. 8 = Credit Info (Metropol's own numbering). */
  reportType?: number;
  format?: "pdf" | "json" | "html";
  loanAmount?: number;
};

const fail = (message: string, status: number, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ success: false, message, ...extra }, { status });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return fail("Sign in.", 401);
  const denied = await requireRight(session, "borrowers.view");
  if (denied) return denied;
  const orgId = session.user.orgId;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return fail("Invalid request.", 400);
  }

  const reportType = Number(body.reportType ?? 8);
  const format = body.format ?? "pdf";

  // ── Resolve the subject from the application, not from the browser ────────
  // The caller names an application; the borrower is looked up from it inside
  // this org. A borrowerId accepted straight from the client would let anyone
  // with console access pull a bureau file on any borrower id they could guess.
  let borrower: { id: string; nationalId: string | null; firstName: string | null; otherName: string | null; erasedAt: Date | null } | null =
    null;
  let loanAmount = Number(body.loanAmount ?? 0);

  if (body.applicationId) {
    const app = await prisma.loanApplication.findFirst({
      where: { id: body.applicationId, orgId },
      select: {
        amountRequested: true,
        borrower: { select: { id: true, nationalId: true, firstName: true, otherName: true, erasedAt: true } },
      },
    });
    if (!app) return fail("Application not found.", 404);
    borrower = app.borrower;
    if (!loanAmount) loanAmount = Number(app.amountRequested ?? 0);
  } else if (body.borrowerId) {
    borrower = await prisma.borrower.findFirst({
      where: { id: body.borrowerId, orgId },
      select: { id: true, nationalId: true, firstName: true, otherName: true, erasedAt: true },
    });
    if (!borrower) return fail("Borrower not found.", 404);
  } else {
    return fail("An application or a borrower is required.", 400);
  }

  if (borrower.erasedAt) return fail("That customer was erased. Nothing may be pulled about them.", 403);
  if (!borrower.nationalId) {
    return fail("This customer has no national ID on file — a bureau identifies people by ID, not by name.", 422);
  }

  // ── The lawful basis, checked before anything is derived ──────────────────
  const consentRow = await prisma.consent.findFirst({
    where: { orgId, borrowerId: borrower.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, version: true, grants: true, createdAt: true },
  });
  const grants =
    consentRow?.grants && typeof consentRow.grants === "object" && !Array.isArray(consentRow.grants)
      ? (consentRow.grants as Record<string, unknown>)
      : {};
  if (grants.crbCheck !== true) {
    return fail(
      "This customer has not consented to a credit reference check, so no bureau report may be requested about them.",
      403,
      { code: "CONSENT_MISSING" },
    );
  }

  // ── Is this deployment on the network at all? ─────────────────────────────
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { slug: true, name: true } });
  const memberCode = memberCodeForOrgSlug(org?.slug ?? "");
  // ── THREE DIFFERENT FAULTS, THREE DIFFERENT SENTENCES ────────────────────
  // This used to answer "This lender is not connected to the Interchange yet"
  // for all three, which is the kind of message that costs an afternoon: it
  // reads as a commercial fact about the lender, so nobody goes looking for the
  // environment variable that is actually missing. Two of the three are a
  // deployment that has not been configured, and only the third is about the
  // lender at all.
  if (!interchangeConfigured()) {
    return fail(
      "This deployment is not wired to the Interchange. Set INTERCHANGE_URL and INTERCHANGE_NODE_KEYS on the server.",
      503,
      { code: "NOT_CONFIGURED" },
    );
  }
  if (!memberCode) {
    return fail(
      `${org?.name ?? "This lender"} is not a member of the Interchange, so reports cannot be requested through it.`,
      503,
      { code: "NOT_A_MEMBER" },
    );
  }
  if (!hasMemberIdentity(memberCode)) {
    return fail(
      `This server holds no signing key for ${memberCode}, so it cannot ask the Interchange as ${org?.name ?? "this lender"}. Add it to INTERCHANGE_NODE_KEYS.`,
      503,
      { code: "NO_NODE_KEY" },
    );
  }

  const started = Date.now();
  try {
    const who = memberIdentity(memberCode);

    // The identity boundary. Blinded here, evaluated as a random point, and
    // unblinded here — the Registry cannot learn the number.
    const subjectToken = await deriveToken(who, "national_id", borrower.nationalId);

    const consent = await issueConsent(who, {
      subjectToken,
      capturedVia: "LMS_CONSOLE",
      wordingVersion: consentRow?.version,
      evidence: {
        surface: "console/applications",
        lmsConsentId: consentRow?.id,
        lmsConsentVersion: consentRow?.version,
        capturedAt: consentRow?.createdAt?.toISOString(),
        presentedAt: new Date().toISOString(),
      },
    });
    if (!consent.ok) {
      return fail(`The network would not register this consent: ${consent.message}`, 502, { code: "CONSENT_REFUSED" });
    }

    // ── The call ────────────────────────────────────────────────────────────
    // A PDF request asks the Registry for a BUNDLE: the structured file and the
    // rendered document from one billed pull. The file is stored against the
    // borrower (which is what satisfies a crbRequired stage), the document goes
    // to the officer. Asking twice would be billed twice for the same bytes.
    const wireFormat = format === "pdf" ? "bundle" : format;
    const res = await signedPostRaw(who, "/api/v1/report", {
      report_type: reportType,
      identity_number: borrower.nationalId,
      consent_ref: consent.ref,
      format: wireFormat,
      loan_amount: Math.max(1, Math.round(loanAmount || 10_000)),
      report_reason: 1,
    });

    const logSeq = res.headers.get("x-interchange-log-seq");
    const billed = res.headers.get("x-interchange-billed-pulls");

    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return fail(
        String(j.api_code_description ?? j.message ?? "The Interchange refused this report."),
        res.status === 403 ? 403 : 502,
        { code: String(j.api_code ?? "REFUSED"), outcome: j.outcome ?? null },
      );
    }

    if (format === "pdf") {
      const bundle = (await res.json()) as Record<string, unknown> & {
        document?: { content?: string };
        file?: unknown;
      };
      const base64 = bundle.document?.content;
      if (!base64) return fail("The Interchange returned no document to download.", 502);
      const bytes = Buffer.from(base64, "base64");

      // ── File it against the borrower ────────────────────────────────────
      // This is a real, paid, recent bureau file on this person, so it belongs
      // on their record — and it is what lets a Risk stage flagged crbRequired
      // be satisfied by this button. The provider prefix keeps it out of the
      // screens that expect the merged CrbReport shape.
      await prisma.kycCheck.create({
        data: {
          orgId,
          borrowerId: borrower.id,
          kind: "CRB",
          passed: true,
          provider: `${INTERCHANGE_PROVIDER}${reportType}`,
          payload: {
            via: "interchange",
            memberCode,
            reportType,
            consentRef: consent.ref,
            logSeq: logSeq ?? null,
            billedPulls: billed ? Number(billed) : null,
            requestedAt: new Date().toISOString(),
            source: bundle.source ?? null,
            // The normalised bureau file. The PDF is NOT stored here: it is
            // deterministic from this payload, and a base64 document per pull
            // would bloat every borrower row that ever had one.
            file: bundle.file ?? null,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      const name = `${borrower.firstName ?? "borrower"}-${borrower.otherName ?? ""}`.trim().replace(/[^A-Za-z0-9-]+/g, "-");
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "content-type": "application/pdf",
          // `attachment` so the button downloads rather than navigating away
          // from the application the officer is working on.
          "content-disposition": `attachment; filename="interchange-report-${reportType}-${name || "file"}.pdf"`,
          "x-interchange-log-seq": logSeq ?? "",
          "x-interchange-billed-pulls": billed ?? "",
          "x-interchange-ms": String(Date.now() - started),
        },
      });
    }

    const payload = format === "json" ? await res.json() : await res.text();
    return NextResponse.json({
      success: true,
      reportType,
      logSeq,
      billedPulls: billed ? Number(billed) : null,
      ms: Date.now() - started,
      payload,
    });
  } catch (e) {
    if (e instanceof InterchangeUnavailable) {
      return fail(`The Interchange could not be reached: ${e.message}`, 503, { code: "UNAVAILABLE" });
    }
    return fail(e instanceof Error ? e.message : "The report could not be requested.", 500);
  }
}
