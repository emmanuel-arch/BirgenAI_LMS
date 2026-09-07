// POST /api/console/borrowers/resolve — turn a live `ss:<id>` reference into a
// local borrower id, so a screen that lists a BRIDGED lender's book can go on to
// use every borrower-scoped endpoint we have.
//
// The Borrowers List reaches the same code through a PAGE
// (/console/borrowers/resolve/<ref>), because there the resolve step ends in a
// redirect to Customer 360. Apply for a Borrower cannot: it stays on one screen,
// resolves in the background and carries straight on to the limit preview. Same
// resolution, same audit entry, same idempotency — see lib/lms/resolve-live-borrower.ts.
//
// RIGHTS: this WRITES a borrower row, so it is gated on `borrowers.create`
// alongside the `borrowers.view` that listing the book already required. An
// officer who may read the lender's book but not open an account here gets the
// list and not the resolution.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { resolveOrg } from "@/lib/tenancy";
import { parseLiveRef, resolveLiveBorrower } from "@/lib/lms/resolve-live-borrower";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await auth();
  const denied = await requireRight(session, "borrowers.create");
  if (denied) return denied;

  let body: { ref?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 });
  }

  const serviceSuiteId = parseLiveRef(body.ref ?? "");
  if (serviceSuiteId == null) {
    return NextResponse.json(
      { success: false, message: "That is not a live customer reference." },
      { status: 400 },
    );
  }

  const org = session!.user!.orgSlug ? await resolveOrg(session!.user!.orgSlug!) : null;
  if (!org) {
    return NextResponse.json({ success: false, message: "This lender's book is not connected." }, { status: 409 });
  }

  const outcome = await resolveLiveBorrower(org, serviceSuiteId, { id: session!.user!.id });
  if (!outcome.ok) {
    // 409 rather than 404: the customer is really there in the lender's book, and
    // what failed is our ability to take them onto ours. "Not found" would send an
    // officer looking for a record that exists.
    return NextResponse.json({ success: false, message: outcome.detail, title: outcome.title }, { status: 409 });
  }

  return NextResponse.json({ success: true, borrowerId: outcome.borrowerId, created: outcome.created });
}
