// ─────────────────────────────────────────────────────────────────────────────
// GET /api/console/borrowers/[id]/master-file — the whole dossier, as one file.
//
// The screen version is for reading. This is for KEEPING: the artifact an
// underwriter attaches to a decision, an auditor asks for two years later, or a
// member publishes to the Interchange as their contribution.
//
// It is composed the same way the screen is (lib/lms/master-file) rather than
// assembled separately, so the file somebody downloads and the file somebody
// read can never be two different accounts of the same customer.
//
// ── WHAT IT DELIBERATELY DOES NOT CONTAIN ────────────────────────────────────
// Raw bureau payloads, document bytes and KYC images. The master file is the
// EVIDENCE REGISTER — what was checked, by whom, when, and what it found. A
// third party's account detail out of a Metropol report, or a photograph of
// somebody's face, is not something to hand out as a download because a page had
// a button on it. Those stay where they are, behind the screens that already
// gate them; the subject-access export at /api/console/compliance/export is the
// route that exists for "give the customer everything".
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { resolveScope, canSeeBorrower } from "@/lib/rbac/scope";
import { resolveOrg } from "@/lib/tenancy";
import { readMasterFile, EVIDENCE_CLASSES } from "@/lib/lms/master-file";
import { readLiveCustomer360 } from "@/lib/lms/customer360";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const denied = await requireRight(session, "borrowers.view");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;
  const { id } = await ctx.params;

  // Same boundary as every other read of a customer: a route that answers for any
  // id you type is not a boundary, it is a speed bump.
  const scope = await resolveScope(session!);
  if (!(await canSeeBorrower(scope, id))) {
    return NextResponse.json({ success: false, message: "Borrower not found." }, { status: 404 });
  }

  const borrower = await prisma.borrower.findFirst({
    where: { id, orgId },
    select: { id: true, firstName: true, otherName: true, phone: true, nationalId: true, serviceSuiteBorrowerId: true, erasedAt: true },
  });
  if (!borrower) return NextResponse.json({ success: false, message: "Borrower not found." }, { status: 404 });
  // A person who exercised their right to erasure has no file to publish. The row
  // survives because the financial record must; the person does not.
  if (borrower.erasedAt) {
    return NextResponse.json({ success: false, message: "This customer was erased. There is no file to produce." }, { status: 410 });
  }

  const org = session!.user!.orgSlug ? await resolveOrg(session!.user!.orgSlug) : null;
  const live = org?.bridgedReady && org.registry && org.entityId
    ? await readLiveCustomer360(org.registry, org.entityId, { serviceSuiteBorrowerId: borrower.serviceSuiteBorrowerId, phone: borrower.phone }, orgId).catch(() => null)
    : null;

  const file = await readMasterFile(orgId, id, {
    behaviour: live?.behaviour ?? null,
    hasLiveBook: !!live,
  });

  const name = `${borrower.firstName ?? ""} ${borrower.otherName ?? ""}`.trim() || "Borrower";
  const body = {
    masterFile: {
      version: 1,
      generatedAt: new Date().toISOString(),
      generatedBy: session!.user!.email ?? session!.user!.id,
      lender: org?.name ?? null,
      subject: {
        borrowerId: borrower.id,
        name,
        phone: borrower.phone,
        nationalId: borrower.nationalId,
      },
      // The scoring model, shipped WITH the file. A weight of 62 means nothing to
      // a reader who cannot see what the 100 was made of — and on the Interchange,
      // where members compare contributions, an unexplained score is one nobody
      // can audit or trust.
      weight: file.weight,
      weightModel: EVIDENCE_CLASSES,
      lastLearnedAt: file.lastLearnedAt,
      evidence: file.evidence,
      gaps: file.gaps,
    },
  };

  const safe = name.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "borrower";
  return new NextResponse(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="master-file-${safe}-${new Date().toISOString().slice(0, 10)}.json"`,
      // A dossier is per-caller and per-moment. Nothing in front of this may keep it.
      "Cache-Control": "no-store, private",
    },
  });
}
