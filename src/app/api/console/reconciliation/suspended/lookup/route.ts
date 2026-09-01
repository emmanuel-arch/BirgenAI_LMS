// ─────────────────────────────────────────────────────────────────────────────
// "WHO IS THIS REFERENCE?" — GET ?ref=              (reconciliation.view)
//
// The question an officer must answer before moving somebody's money, and the
// one place this integration deliberately diverges from ServiceSuite's own code.
// Theirs is:
//
//     SELECT COUNT(*) FROM Borrowers WHERE phoneNumber = @ref OR NationalId = @ref
//
// — no entity filter, and a COUNT. On this server 3002 and 3005 hold different
// people and 185 national IDs appear in BOTH, so that check can green-light a
// reference belonging to a stranger in the other book. This returns WHO matched,
// scoped to the entity being worked, because "yes, that exists somewhere" is not
// information anybody can act on.
//
// It also returns the NORMALISED form, so the officer can see that "0729522220"
// is about to be written as "254729522220" — their rule, reproduced exactly, and
// the value their posting job will match on.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { resolveOrg } from "@/lib/tenancy";
import { findAccountForBillRef, normaliseBillRef } from "@/lib/lms/servicesuite-reconciliation";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await auth();
  const denied = await requireRight(session, "reconciliation.view");
  if (denied) return denied;

  const slug = session!.user!.orgSlug;
  const org = slug ? await resolveOrg(slug) : null;
  if (!org || org.mode !== "BRIDGED" || !org.bridgedReady || !org.registry || !org.entityId) {
    return NextResponse.json({ success: false, message: "This organisation has no connected lender system to look a reference up in." }, { status: 400 });
  }

  const raw = (req.nextUrl.searchParams.get("ref") ?? "").trim();
  if (!raw) return NextResponse.json({ success: false, message: "Type a phone number, ID number or account number." }, { status: 400 });

  const billRef = normaliseBillRef(raw);

  try {
    const matches = await findAccountForBillRef(org.registry, org.entityId, billRef);
    return NextResponse.json({
      success: true,
      ref: raw,
      billRef,
      entityId: org.entityId,
      lender: org.name,
      matches,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: `Could not check that reference: ${err instanceof Error ? err.message : "unknown error"}` },
      { status: 502 },
    );
  }
}
