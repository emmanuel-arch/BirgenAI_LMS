// GET    /api/console/documents/[id]   → the document, plus a short-lived link to its file
// DELETE /api/console/documents/[id]   → erase the row and the bytes (DPA erasure)
//
// The only exit for a stored document. Authorisation is not the id — a uuid is not a
// secret — it is the row: RLS scopes the lookup to the caller's org, so a foreign id
// resolves to nothing. Every link minted is written to the audit log, because a fee
// structure or a bank statement is somebody's private business.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { requireFeature } from "@/lib/billing/entitlements";
import { signedUrl, deleteObjects, DOCS_BUCKET, keyBelongsToOrg } from "@/lib/storage/provider";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "documents.view");
  if (denied) return denied;
  const orgId = session.user.orgId;

  const gate = await requireFeature(orgId, "document-parser");
  if (gate) return gate;

  const { id } = await ctx.params;
  const doc = await prisma.document.findFirst({ where: { id, orgId } });
  if (!doc) return NextResponse.json({ success: false, message: "Document not found." }, { status: 404 });

  // Belt and braces: the key must live under this org's prefix even though the row
  // already proved ownership. A mismatch means data corruption, not a valid read.
  if (doc.storageKey && !keyBelongsToOrg(doc.storageKey, orgId)) {
    return NextResponse.json({ success: false, message: "Document not found." }, { status: 404 });
  }

  const simulated = !doc.storageKey || doc.storageKey.startsWith("sim/");
  const url = simulated ? null : await signedUrl(doc.storageKey, 120, DOCS_BUCKET);

  if (url) {
    await prisma.auditLog.create({
      data: { orgId, actorId: session.user.id, actorType: "staff", action: "document.view", entity: "Document", entityId: doc.id },
    }).catch(() => {});
  }

  return NextResponse.json({ success: true, document: doc, url, simulated });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "documents.manage");
  if (denied) return denied;
  const orgId = session.user.orgId;
  const { id } = await ctx.params;

  const doc = await prisma.document.findFirst({ where: { id, orgId } });
  if (!doc) return NextResponse.json({ success: false, message: "Document not found." }, { status: 404 });

  // Bytes first, then the row. A dangling object with no row pointing at it is a
  // privacy problem; a dangling row with no object is merely untidy.
  if (doc.storageKey) await deleteObjects([doc.storageKey], DOCS_BUCKET);
  await prisma.document.delete({ where: { id: doc.id } });
  await prisma.auditLog.create({
    data: { orgId, actorId: session.user.id, actorType: "staff", action: "document.delete", entity: "Document", entityId: doc.id, meta: { kind: doc.kind, filename: doc.filename } },
  }).catch(() => {});

  return NextResponse.json({ success: true });
}
