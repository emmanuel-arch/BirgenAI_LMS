// GET /api/console/borrowers/[id]/erasure-assessment — what erasing this person
// would actually do, before anyone promises anything.
//
// Read-only. It exists because the honest answer to "delete me" depends on facts
// the officer cannot see (has this customer ever borrowed? did the last loan close
// more than seven years ago?), and because getting it wrong means either telling a
// customer a comfortable lie or deleting a record POCAMLA required you to keep.
//
// The reasoning lives in src/lib/compliance/erasure.ts.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { resolveScope, canSeeBorrower } from "@/lib/rbac/scope";
import { assessErasure } from "@/lib/compliance/erasure";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const denied = await requireRight(session, "compliance.manage");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;
  const { id } = await ctx.params;

  const scope = await resolveScope(session!);
  if (!(await canSeeBorrower(scope, id))) {
    return NextResponse.json({ success: false, message: "Borrower not found." }, { status: 404 });
  }

  const assessment = await assessErasure(orgId, id);
  if (!assessment) return NextResponse.json({ success: false, message: "Borrower not found." }, { status: 404 });

  return NextResponse.json({ success: true, assessment });
}
