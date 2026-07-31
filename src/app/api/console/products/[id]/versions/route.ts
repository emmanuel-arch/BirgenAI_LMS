// ─────────────────────────────────────────────────────────────────────────────
// A product's published history — and what changed between any two versions.
//
//   GET                    → { definition, versions[] }   versions carry loanCount
//   GET ?diff=<from>,<to>  → { ...above, diff: FieldChange[] }
//
// `loanCount` per version is the blast radius: the question a credit manager asks
// before touching a rate is not "what does it say now" but "who is still held to the
// old terms". The system we are replacing cannot answer that at all, because a loan
// points at the product row rather than at a version of it.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { currentDefinition, listVersions, definitionsAt, diffDefinitions } from "@/lib/products/versioning";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "products.view");
  if (denied) return denied;

  const orgId = session.user.orgId;

  // currentDefinition scopes by orgId, so an id from another tenant reads as absent
  // rather than as a permission error — the same shape RLS would produce anyway.
  const [definition, versions] = await Promise.all([
    currentDefinition(orgId, id),
    listVersions(orgId, id),
  ]);
  if (!definition) return NextResponse.json({ success: false, message: "Product not found." }, { status: 404 });

  const raw = req.nextUrl.searchParams.get("diff");
  if (!raw) return NextResponse.json({ success: true, definition, versions });

  const [from, to] = raw.split(",").map((n) => Number(n.trim()));
  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    return NextResponse.json({ success: false, message: "diff must be two version numbers." }, { status: 400 });
  }

  const docs = await definitionsAt(orgId, id, [from, to]);
  const a = docs.get(from);
  const b = docs.get(to);
  if (!a || !b) return NextResponse.json({ success: false, message: "One of those versions does not exist." }, { status: 404 });

  return NextResponse.json({
    success: true,
    definition,
    versions,
    diff: diffDefinitions(a, b),
    diffFrom: from,
    diffTo: to,
  });
}
