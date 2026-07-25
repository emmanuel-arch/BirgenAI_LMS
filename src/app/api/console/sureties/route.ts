// Sureties — the guarantors standing behind live applications.
//
//   GET → every guarantor on this org's book, with the applicant they back, the
//   amount they stood behind, their consent state, and the evidence of it. Sorted
//   newest-invited first. Read-only here; the consent action lives on the
//   applicant's dossier where the officer works the file.
//
// Scope-fenced like the applications it hangs off: applications.view admits, and
// the officer's data scope narrows it to their own book.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { resolveScope, borrowerScopeWhere } from "@/lib/rbac/scope";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "applications.view");
  if (denied) return denied;
  const orgId = session.user.orgId;

  const scope = await resolveScope(session);
  const rows = await prisma.guarantor.findMany({
    where: { orgId, borrower: { ...borrowerScopeWhere(scope) } },
    orderBy: { invitedAt: "desc" },
    take: 500,
    select: {
      id: true, fullName: true, phone: true, relationship: true, nationalId: true,
      status: true, amountGuaranteed: true, invitedAt: true, remindedAt: true,
      consentedAt: true, declinedAt: true, expiresAt: true, consentIp: true,
      borrowerId: true,
      borrower: { select: { firstName: true, otherName: true } },
      application: { select: { id: true, status: true, amountRequested: true, product: { select: { name: true } } } },
    },
  });

  const now = Date.now();
  const sureties = rows.map((g) => {
    // An INVITED surety whose window has closed reads as EXPIRED even if the
    // sweep that flips the column hasn't run — the truth is the clock.
    const lapsed = g.status === "INVITED" && g.expiresAt.getTime() < now;
    return {
      id: g.id,
      name: g.fullName,
      phone: g.phone,
      relationship: g.relationship,
      hasId: !!g.nationalId,
      status: lapsed ? "EXPIRED" : g.status,
      amountGuaranteed: g.amountGuaranteed != null ? Number(g.amountGuaranteed) : null,
      invitedAt: g.invitedAt.toISOString(),
      remindedAt: g.remindedAt?.toISOString() ?? null,
      consentedAt: g.consentedAt?.toISOString() ?? null,
      declinedAt: g.declinedAt?.toISOString() ?? null,
      expiresAt: g.expiresAt.toISOString(),
      consentIp: g.consentIp,
      borrowerId: g.borrowerId,
      applicantName: [g.borrower?.firstName, g.borrower?.otherName].filter(Boolean).join(" ") || "Applicant",
      applicationId: g.application?.id ?? null,
      applicationStatus: g.application?.status ?? null,
      amountRequested: g.application?.amountRequested != null ? Number(g.application.amountRequested) : null,
      productName: g.application?.product?.name ?? null,
    };
  });

  const summary = {
    total: sureties.length,
    consented: sureties.filter((s) => s.status === "CONSENTED").length,
    pending: sureties.filter((s) => s.status === "INVITED").length,
    lapsed: sureties.filter((s) => s.status === "EXPIRED" || s.status === "DECLINED").length,
    coverage: sureties.filter((s) => s.status === "CONSENTED").reduce((sum, s) => sum + (s.amountGuaranteed ?? 0), 0),
  };

  return NextResponse.json({ success: true, sureties, summary });
}
