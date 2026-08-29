// Run a report, and hand it back in whichever shape the reader needs.
//
//   GET /api/analytics/reports/<id>?format=json|csv|xlsx|pdf
//       &from=&to=&ent=&branch=&officer=
//
// The FORMAT is the only thing that changes between a screen and a download —
// the same scope, the same parameters and the same SQL produce all four, so a
// spreadsheet can never disagree with the table it was exported from. That is
// not a nicety: "the PDF says something different from the screen" is the single
// fastest way to lose a finance team's trust in a reporting system.
//
// Tenant isolation is structural and identical to the studio's: the scope is
// built from the CALLER's org and their own declared entities, so an `ent` in
// the query string can only ever select a book this lender actually has.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireRight } from "@/lib/rbac/authz";
import { resolveScope } from "@/lib/analytics/scope";
import { activeRealm } from "@/lib/suite/realm-server";
import { runReport, ReportUnavailable, SCREEN_ROWS, EXPORT_ROWS } from "@/lib/reporting/run";
import { toCsv, toExcel, toPdf, CONTENT_TYPE } from "@/lib/reporting/export";
import { reportFilename } from "@/lib/reporting/naming";
import { reportById } from "@/lib/reporting/definitions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FORMATS = ["json", "csv", "xlsx", "pdf"] as const;
type Format = (typeof FORMATS)[number];

/** Integer ids from a comma list. Anything else is dropped, never rejected. */
const ints = (raw: string | null, cap = 60): number[] =>
  raw ? [...new Set(raw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0))].slice(0, cap) : [];

function parseDate(raw: string | null, fallback: Date): Date {
  if (!raw) return fallback;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const denied = await requireRight(session, "reports.view");
  if (denied) return denied;

  const { id } = await ctx.params;
  const def = reportById(id);
  if (!def) return NextResponse.json({ success: false, message: `No report called "${id}".` }, { status: 404 });

  const org = await prisma.org.findUnique({
    where: { id: session!.user!.orgId! },
    select: { name: true, slug: true, mode: true },
  });
  if (!org) return NextResponse.json({ success: false, message: "Unknown organisation." }, { status: 404 });

  const sp = req.nextUrl.searchParams;
  const format = (FORMATS as readonly string[]).includes(sp.get("format") ?? "") ? (sp.get("format") as Format) : "json";

  const realm = await activeRealm(org.slug).catch(() => null);
  const scope = resolveScope({
    orgId: session!.user!.orgId!,
    orgSlug: org.slug,
    orgMode: org.mode,
    entityIds: ints(sp.get("ent"), 8),
    fallbackRealmId: realm?.id ?? null,
    split: false,
  });

  const to = parseDate(sp.get("to"), new Date());
  const from = parseDate(sp.get("from"), new Date(to.getTime() - 30 * 86400000));

  try {
    const result = await runReport(scope, id, {
      from,
      to,
      branchIds: ints(sp.get("branch")),
      officerIds: ints(sp.get("officer")),
      // A download carries the full set; a screen carries what it can render.
      limit: format === "json" ? SCREEN_ROWS : EXPORT_ROWS,
    });

    if (format === "json") {
      return NextResponse.json({
        success: true,
        report: {
          id: def.id, name: def.name, category: def.category, purpose: def.purpose,
          mirrors: def.mirrors, divergence: def.divergence ?? null, ranged: def.ranged,
          columns: def.columns,
        },
        rows: result.rows,
        truncated: result.truncated,
        elapsedMs: result.elapsedMs,
        books: result.books,
      });
    }

    const filename = reportFilename({
      org: org.name,
      books: result.books.map((b) => b.label),
      subject: def.name,
      period: def.ranged ? { from, to } : null,
      ext: format,
    });

    const body =
      format === "csv" ? Buffer.from(toCsv(result, org.name), "utf8")
        : format === "xlsx" ? await toExcel(result, org.name)
          : await toPdf(result, org.name);

    return new NextResponse(new Uint8Array(body), {
      headers: {
        "content-type": CONTENT_TYPE[format],
        // `attachment` with an explicit filename is what makes the naming
        // convention real — without it the browser names the file after the
        // route and every download is called "arrears".
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof ReportUnavailable) {
      return NextResponse.json({ success: false, message: e.message }, { status: 409 });
    }
    const message = e instanceof Error ? e.message : "The report could not be built.";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
