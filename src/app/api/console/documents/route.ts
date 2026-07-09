// The Document Parser.
//
//   GET  /api/console/documents?borrowerId=  → what has been read for this org
//   POST /api/console/documents              → { kind, filename, file, password?, borrowerId?, applicationId? }
//
// Order matters here. We gate on the package BEFORE doing any work, parse BEFORE
// storing anything, and meter only AFTER a row exists — so a lender is never billed
// for a document we failed to read, and never charged for a feature they have not
// bought. A file we cannot read is still stored and attached: the officer wants the
// paperwork on the borrower's record whether or not a machine could understand it.
import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireFeature } from "@/lib/billing/entitlements";
import { meter } from "@/lib/billing/meter";
import { putDocumentObject } from "@/lib/storage/provider";
import {
  decodeUpload, parseDocument, parserMode, MAX_DOCUMENT_BYTES,
  UnsupportedDocumentError, PdfPasswordRequiredError, PdfPasswordIncorrectError,
} from "@/lib/documents/parse";
import type { DocumentKind } from "@/lib/documents/extract";

export const runtime = "nodejs";

const KINDS: DocumentKind[] = ["FEE_STRUCTURE", "INVOICE", "PERMIT", "BANK_STATEMENT", "NATIONAL_ID", "OTHER"];

/** base64 inflates by 4/3; refuse an oversized body before req.json() buffers it. */
const MAX_BODY_BYTES = Math.ceil(MAX_DOCUMENT_BYTES * 1.4);

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const orgId = session.user.orgId;

  const gate = await requireFeature(orgId, "document-parser");
  if (gate) return gate;

  const borrowerId = req.nextUrl.searchParams.get("borrowerId") ?? undefined;
  const documents = await prisma.document.findMany({
    where: { orgId, ...(borrowerId ? { borrowerId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: {
      id: true, kind: true, filename: true, contentType: true, bytes: true, pages: true,
      status: true, confidence: true, fields: true, note: true, parserMode: true,
      borrowerId: true, createdAt: true,
    },
  });

  return NextResponse.json({ success: true, documents, mode: parserMode() });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const orgId = session.user.orgId;

  const gate = await requireFeature(orgId, "document-parser");
  if (gate) return gate;

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json({ success: false, message: "That file is too large — keep it under 3 MB." }, { status: 413 });
  }

  let body: { kind?: string; filename?: string; file?: string; password?: string; borrowerId?: string; applicationId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const kind = (KINDS as string[]).includes(body.kind ?? "") ? (body.kind as DocumentKind) : null;
  if (!kind) return NextResponse.json({ success: false, message: `kind must be one of ${KINDS.join(", ")}.` }, { status: 400 });

  let buffer: Buffer, contentType: string;
  try {
    ({ buffer, contentType } = decodeUpload(body.file ?? ""));
  } catch (err) {
    const message = err instanceof UnsupportedDocumentError ? err.message : "Could not read that file.";
    return NextResponse.json({ success: false, message }, { status: 400 });
  }

  // A borrower reference must belong to this org. RLS would refuse the write anyway,
  // but a clear 404 beats a foreign-key error.
  if (body.borrowerId) {
    const owned = await prisma.borrower.findFirst({ where: { id: body.borrowerId, orgId }, select: { id: true } });
    if (!owned) return NextResponse.json({ success: false, message: "Borrower not found." }, { status: 404 });
  }

  // Parse first. A password-protected PDF is a question for the officer, not a row.
  let parsed;
  try {
    parsed = await parseDocument(buffer, contentType, kind, body.password);
  } catch (err) {
    if (err instanceof PdfPasswordRequiredError) return NextResponse.json({ success: false, needsPassword: true, message: err.message }, { status: 400 });
    if (err instanceof PdfPasswordIncorrectError) return NextResponse.json({ success: false, needsPassword: true, message: err.message }, { status: 400 });
    return NextResponse.json({ success: false, message: "Could not read that document." }, { status: 400 });
  }

  const created = await prisma.document.create({
    data: {
      orgId,
      borrowerId: body.borrowerId || null,
      applicationId: body.applicationId || null,
      kind,
      filename: (body.filename || "document").slice(0, 200),
      contentType,
      bytes: buffer.length,
      pages: parsed.pages,
      storageKey: "",
      status: parsed.status,
      confidence: parsed.extraction?.confidence ?? 0,
      // The fields, never the text. Raw document text is PII with no use once parsed.
      fields: (parsed.extraction?.fields ?? null) as Prisma.InputJsonValue,
      note: parsed.note ?? null,
      parserMode: parsed.mode,
      uploadedBy: session.user.id,
    },
  });

  // Store the bytes under the row's id, then point the row at them. If the upload
  // fails the record survives with an empty key and says so — losing the officer's
  // parse because a bucket hiccuped would be the worse outcome.
  try {
    const storageKey = await putDocumentObject(orgId, created.id, buffer, contentType);
    await prisma.document.update({ where: { id: created.id }, data: { storageKey } });
  } catch (err) {
    console.error("[documents] upload failed:", err);
  }

  await prisma.auditLog.create({
    data: {
      orgId, actorId: session.user.id, actorType: "staff", action: "document.parse",
      entity: "Document", entityId: created.id,
      meta: { kind, status: parsed.status, confidence: created.confidence, bytes: buffer.length },
    },
  }).catch(() => {});

  // One document read = one billable parse, after the row exists. A FAILED read is
  // not billed: we charge for an answer, not for an attempt.
  if (parsed.status !== "FAILED") void meter(orgId, "document", 1, { documentId: created.id, kind, status: parsed.status });

  return NextResponse.json({
    success: true,
    document: {
      id: created.id, kind, filename: created.filename, status: parsed.status,
      confidence: created.confidence, fields: parsed.extraction?.fields ?? null,
      missing: parsed.extraction?.missing ?? [], note: parsed.note ?? null,
      pages: parsed.pages, mode: parsed.mode,
    },
  });
}
