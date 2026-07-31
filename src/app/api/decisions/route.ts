// ─────────────────────────────────────────────────────────────────────────────
// THE DECISION ENDPOINT — the underwriting pipeline, as a product.
//
//   POST { report, history?, applicationId? }
//     → { verdict, startingLimit, tier, products[], reasonCodes[], trace[] }
//
// This is the SAME `decide()` the console calls (lib/decision/engine.ts), reading
// the SAME per-org credit policy and the SAME published product versions. There is
// no second implementation to drift — which is the point of the API-first rule: a
// capability that is separable is a capability that can be sold, embedded in
// ServiceSuite, or called by a lender's own front end without forking the logic.
//
// When `applicationId` is supplied the decision is PERSISTED onto that application:
// verdict, reason codes and the full stage trace. An adverse outcome you cannot
// reconstruct six months later is not a decision, it is an opinion.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { runWithOrg } from "@/lib/db/context";
import { readCreditPolicy } from "@/lib/config/store";
import { candidatesFor } from "@/lib/decision/candidates";
import { decide } from "@/lib/decision/engine";
import type { InternalReport } from "@/lib/statement/analyze";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  // Running a decision is an origination act, not a read: it is what an officer
  // does on a borrower's behalf at the counter.
  const denied = await requireRight(session, "applications.decide");
  if (denied) return denied;

  const orgId = session.user.orgId;

  let body: {
    report?: InternalReport;
    history?: { clearedLoans: number; hasActiveLoan: boolean; age?: number };
    applicationId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 });
  }

  const report = body.report;
  if (!report?.score || !report?.affordability || !report?.features) {
    return NextResponse.json(
      { success: false, message: "Provide an internal report (score, affordability, features)." },
      { status: 400 },
    );
  }

  const [policyDoc, products] = await Promise.all([readCreditPolicy(orgId), candidatesFor(orgId)]);
  if (products.length === 0) {
    return NextResponse.json(
      { success: false, message: "No active products to match against. Create one first." },
      { status: 409 },
    );
  }

  const decision = decide({
    report,
    policy: policyDoc.value,
    products,
    history: body.history,
  });

  // The decision cites the policy version it ran under, so the same inputs can be
  // replayed against the rules as they stood — not as they stand now.
  const stamped = { ...decision, policyVersion: policyDoc.version };

  if (body.applicationId) {
    const app = await runWithOrg(orgId, () =>
      prisma.loanApplication.findFirst({ where: { id: body.applicationId, orgId }, select: { id: true } }),
    );
    if (!app) return NextResponse.json({ success: false, message: "Application not found." }, { status: 404 });

    const recommended = decision.products.find((p) => p.productId === decision.recommendedProductId);
    await runWithOrg(orgId, () =>
      prisma.loanApplication.update({
        where: { id: app.id },
        data: {
          decision: decision.verdict,
          reasonCodes: decision.reasonCodes as never,
          approvedLimit: decision.startingLimit > 0 ? decision.startingLimit : null,
          // Which published product version the offer was priced against — the
          // other half of the reproducibility story (Loan carries it too).
          productVersionId: recommended
            ? products.find((p) => p.id === recommended.productId)?.versionId ?? null
            : null,
        },
      }),
    );

    await prisma.auditLog.create({
      data: {
        orgId, actorId: session.user.id, actorType: "staff",
        action: "application.decide", entity: "LoanApplication", entityId: app.id,
        meta: {
          verdict: decision.verdict,
          startingLimit: decision.startingLimit,
          policyVersion: policyDoc.version,
          trace: decision.trace,
        },
      },
    }).catch(() => {});
  }

  return NextResponse.json({ success: true, decision: stamped });
}
