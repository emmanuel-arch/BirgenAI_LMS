// ─────────────────────────────────────────────────────────────────────────────
// POST /api/config/credit/preview — "what would this policy do?", before it does it.
//
// The credit screen's dry run. Takes an UNSAVED policy document, assesses the
// book under it and under the one that is live, and returns the difference. It
// writes nothing, publishes nothing and bumps no version — the same arithmetic
// the graduation cron performs, minus every UPDATE.
//
//   { policy }               → aggregate impact + the biggest movers
//   { policy, borrowerId }   → that one borrower's full assessment, both sides
//
// The incoming policy is merged forward before it is used, so a half-typed
// document previews rather than throws. Validation stays where it belongs: on
// PUT, which is the call that can actually hurt someone.
//
// NAMES ARE A SEPARATE PERMISSION. The counts are a property of the lender's own
// policy and need `settings.view`. Attaching a NAME to "this person's limit falls
// by 4,000" is borrower data, so it rides on `borrowers.view` — a policy reviewer
// without it still gets every number, with the names withheld.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight, hasRight } from "@/lib/rbac/authz";
import { readCreditPolicy } from "@/lib/config/store";
import { mergeCreditPolicy, validateCreditPolicy } from "@/lib/decision/policy";
import { creditPolicyImpact, previewBorrower, DEFAULT_SAMPLE, MAX_SAMPLE } from "@/lib/risk/policy-impact";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "settings.view");
  if (denied) return denied;
  const orgId = session.user.orgId;

  let body: { policy?: unknown; borrowerId?: unknown; sample?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 });
  }
  if (!body.policy || typeof body.policy !== "object") {
    return NextResponse.json({ success: false, message: "Provide the policy to preview." }, { status: 400 });
  }

  const edited = mergeCreditPolicy(body.policy);
  const live = await readCreditPolicy(orgId);
  const includeNames = await hasRight(session, "borrowers.view");

  // Reported, not enforced. A policy mid-edit is expected to be briefly invalid,
  // and refusing to preview it is exactly when a lender most wants to see the shape.
  const issues = validateCreditPolicy(edited);

  if (typeof body.borrowerId === "string" && body.borrowerId) {
    const detail = await previewBorrower(orgId, body.borrowerId, live.value, edited, { includeNames });
    if (!detail) return NextResponse.json({ success: false, message: "No such borrower." }, { status: 404 });
    return NextResponse.json({ success: true, liveVersion: live.version, issues, borrower: detail });
  }

  const sample = Math.min(Math.max(Number(body.sample) || DEFAULT_SAMPLE, 1), MAX_SAMPLE);
  const impact = await creditPolicyImpact(orgId, live.value, edited, { sample, includeNames });

  return NextResponse.json({ success: true, liveVersion: live.version, issues, impact, namesWithheld: !includeNames });
}
