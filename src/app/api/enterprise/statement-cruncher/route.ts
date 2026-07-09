// POST /api/enterprise/statement-cruncher  (multipart/form-data)
// Fields: file (PDF), password? (for encrypted M-Pesa statements), borrowerName?
//
// Uploads a borrower's M-Pesa statement → extract text → parse transactions →
// engineer cashflow features → transparent affordability read. These features are
// the inputs for the future thin-file / acquisition credit model.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { readBorrowerSession } from "@/lib/portal/session";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { requireFeature } from "@/lib/billing/entitlements";
import { meter } from "@/lib/billing/meter";
import { extractPdfText, PdfPasswordRequiredError, PdfPasswordIncorrectError } from "@/lib/statement/extract-pdf";
import { parseMpesaStatement } from "@/lib/statement/mpesa-parser";
import { crunch } from "@/lib/statement/features";
import { scoreThinFileAuto } from "@/lib/statement/score-thinfile";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

export async function POST(req: NextRequest) {
  // Compute-only (no DB writes, nothing stored), but far from free: 15 MB of PDF
  // and up to a minute of server time per call. Callers must be a verified
  // borrower or signed-in staff — no org binding, since the analysis touches no
  // tenant data and the funnel form carries no lender slug.
  const [staff, borrower] = await Promise.all([auth(), readBorrowerSession()]);
  if (!staff?.user?.id && !borrower) {
    return NextResponse.json(
      { success: false, needsOtp: true, message: "Verify your phone number to continue." },
      { status: 401 },
    );
  }

  const subject = borrower ? `phone:${borrower.phone}` : `staff:${staff!.user!.id}`;
  const limited = await rateLimit([
    { name: "crunch:subject", subject, max: 8, windowSec: 3600 },
    { name: "crunch:ip", subject: clientIp(req), max: 30, windowSec: 3600 },
  ]);
  if (limited) return limited;

  // Whose plan pays for this? The borrower's lender, or the signed-in staff's org.
  const orgId = borrower?.orgId ?? staff!.user!.orgId!;
  const gated = await requireFeature(orgId, "statement-cruncher");
  if (gated) return gated;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ success: false, message: "Upload a statement file." }, { status: 400 });
  }

  const file = form.get("file") as File | null;
  const password = ((form.get("password") as string) || "").trim() || undefined;
  if (!file) return NextResponse.json({ success: false, message: "No file received." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ success: false, message: "File is too large (max 15 MB)." }, { status: 400 });

  const name = file.name.toLowerCase();
  if (!name.endsWith(".pdf") && file.type !== "application/pdf") {
    return NextResponse.json({ success: false, message: "Please upload the M-Pesa statement PDF." }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const text = await extractPdfText(buffer, password);

    const txns = parseMpesaStatement(text);
    if (txns.length === 0) {
      return NextResponse.json({
        success: false,
        message:
          "Couldn't find M-Pesa transactions in this PDF. Make sure it's the official Safaricom statement (with the detailed transaction table).",
      });
    }

    const result = crunch(txns);
    const creditScore = scoreThinFileAuto(result.features);

    // Billed only on a statement we actually parsed — a password failure or an
    // unreadable PDF exits above this line and costs the lender nothing.
    void meter(orgId, "statement", 1, { transactions: txns.length, months: result.features.monthsCovered });

    // Real ledger aggregates — these drive the crunch theatre's posting animation
    // and category columns, so what the borrower watches is their actual data.
    const buckets = new Map<string, { count: number; amount: number; inAmt: number; outAmt: number }>();
    let paidIn = 0, paidOut = 0;
    for (const t of txns) {
      const b = buckets.get(t.category) ?? { count: 0, amount: 0, inAmt: 0, outAmt: 0 };
      b.count++; b.amount += t.amount;
      if (t.direction === "in") { b.inAmt += t.amount; paidIn += t.amount; }
      else { b.outAmt += t.amount; paidOut += t.amount; }
      buckets.set(t.category, b);
    }
    const categories = [...buckets.entries()]
      .map(([category, v]) => ({ category, count: v.count, amount: Math.round(v.amount), inAmt: Math.round(v.inAmt), outAmt: Math.round(v.outAmt) }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      success: true,
      borrowerName: ((form.get("borrowerName") as string) || "").trim() || null,
      transactionCount: txns.length,
      creditScore,
      ...result,
      categories,
      paidIn: Math.round(paidIn),
      paidOut: Math.round(paidOut),
      // A real slice of the ledger for the posting animation (not the full book).
      sample: txns.slice(0, 40).map((t) => ({
        date: t.date,
        details: t.details.slice(0, 48),
        direction: t.direction,
        amount: t.amount,
        category: t.category,
      })),
    });
  } catch (err) {
    if (err instanceof PdfPasswordRequiredError) {
      return NextResponse.json({ success: false, needPassword: true, message: err.message });
    }
    if (err instanceof PdfPasswordIncorrectError) {
      return NextResponse.json({ success: false, needPassword: true, message: err.message });
    }
    const message = err instanceof Error ? err.message : "Could not process the statement.";
    return NextResponse.json({ success: false, message }, { status: 200 });
  }
}
