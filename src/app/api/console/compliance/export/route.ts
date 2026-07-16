// GET /api/console/compliance/export — the download.
//
//   ?scope=borrower&id=<borrowerId>          one customer, everything we hold (JSON)
//   ?scope=org                               the lender's whole book (JSON)
//   ?scope=org&format=csv&table=borrowers    one table, for Excel
//
// AN EXPORT IS A DISCLOSURE. Every one of these is logged to the register and the
// audit trail before a single byte goes out — who took a copy of whose data, and
// when. That record is the whole reason an org can answer "has anyone ever
// downloaded my customers?" with something other than a shrug.
//
// The bytes are streamed and never stored. Writing an export to a bucket would
// create a fresh, unguarded copy of every customer a lender has, sitting somewhere
// waiting to leak. See the header of src/lib/compliance/export.ts.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { resolveScope, canSeeBorrower } from "@/lib/rbac/scope";
import { exportBorrower, exportOrg, exportOrgTable, toCsv, subjectLabel, ORG_TABLES, type OrgTable } from "@/lib/compliance/export";
import { auditCompliance } from "@/lib/compliance/register";

export const runtime = "nodejs";
export const maxDuration = 120;

function download(body: string, filename: string, contentType: string) {
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      // A file full of customers must not sit in a proxy cache.
      "Cache-Control": "no-store, private",
    },
  });
}

export async function GET(req: NextRequest) {
  const session = await auth();
  const denied = await requireRight(session, "compliance.manage");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;
  const staffId = session!.user!.id;

  const params = req.nextUrl.searchParams;
  const scopeParam = params.get("scope") ?? "org";
  const day = new Date().toISOString().slice(0, 10);

  // ── One customer ───────────────────────────────────────────────────────────
  if (scopeParam === "borrower") {
    const borrowerId = params.get("id") ?? "";
    const scope = await resolveScope(session!);
    if (!borrowerId || !(await canSeeBorrower(scope, borrowerId))) {
      return NextResponse.json({ success: false, message: "Borrower not found." }, { status: 404 });
    }
    const bundle = await exportBorrower(orgId, borrowerId);
    if (!bundle) return NextResponse.json({ success: false, message: "Borrower not found." }, { status: 404 });

    const label = await subjectLabel(orgId, borrowerId);
    const request = await prisma.complianceRequest.create({
      data: {
        orgId, kind: "BORROWER_EXPORT", status: "COMPLETED",
        subjectId: borrowerId, subjectLabel: label,
        reason: "Subject access request — a copy of their data was given to the customer.",
        requestedById: staffId, decidedById: staffId, decidedAt: new Date(), completedAt: new Date(),
        // Counts, never content: the register must not become a second copy of them.
        result: bundle._counts,
      },
    });
    await auditCompliance(orgId, staffId, "compliance.borrower-exported", request.id, { borrowerId });

    return download(JSON.stringify(bundle, null, 2), `my-data-${label.replace(/\W+/g, "")}-${day}.json`, "application/json");
  }

  if (scopeParam !== "org") {
    return NextResponse.json({ success: false, message: "Unknown export scope." }, { status: 400 });
  }

  // ── The lender's whole book ────────────────────────────────────────────────
  const format = params.get("format") ?? "json";

  if (format === "csv") {
    const table = params.get("table") as OrgTable | null;
    if (!table || !ORG_TABLES.includes(table)) {
      return NextResponse.json({ success: false, message: `Unknown table. One of: ${ORG_TABLES.join(", ")}` }, { status: 400 });
    }
    const rows = await exportOrgTable(orgId, table);
    const request = await prisma.complianceRequest.create({
      data: {
        orgId, kind: "ORG_EXPORT", status: "COMPLETED",
        reason: `Data export — ${table} (CSV).`,
        requestedById: staffId, decidedById: staffId, decidedAt: new Date(), completedAt: new Date(),
        result: { table, rows: rows.length, format: "csv" },
      },
    });
    await auditCompliance(orgId, staffId, "compliance.org-exported", request.id, { table, rows: rows.length, format: "csv" });
    return download(toCsv(rows), `${table}-${day}.csv`, "text/csv; charset=utf-8");
  }

  const bundle = await exportOrg(orgId);
  const request = await prisma.complianceRequest.create({
    data: {
      orgId, kind: "ORG_EXPORT", status: "COMPLETED",
      reason: "Data export — the complete book (JSON).",
      requestedById: staffId, decidedById: staffId, decidedAt: new Date(), completedAt: new Date(),
      result: bundle._about.counts,
    },
  });
  await auditCompliance(orgId, staffId, "compliance.org-exported", request.id, { format: "json", ...bundle._about.counts });

  return download(JSON.stringify(bundle, null, 2), `book-export-${day}.json`, "application/json");
}
