// POST /api/portal/recrunch/run  (multipart/form-data)
// Fields: lenderSlug, nationalId, intentId, file (PDF), password?
//
// The paid half of the customer refresh: with a SUCCESS RECRUNCH payment in hand,
// the borrower uploads their latest M-Pesa statement and gets a fresh Internal
// Report. The payment is a ONE-SHOT credit — the `recrunch.run` audit row is the
// latch, checked before the crunch and written after, so a refresh can never be
// spent twice and a failed parse (wrong password, not a statement) costs the
// credit nothing.
//
// The statement must belong to the person who paid: the holder printed on it is
// name-checked against the borrower, closing the "upload a better statement" gap.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { borrowerFor, otpRequired } from "@/lib/portal/session";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { extractPdfText, PdfPasswordRequiredError, PdfPasswordIncorrectError } from "@/lib/statement/extract-pdf";
import { parseMpesaStatement, extractStatementName, namesMatch } from "@/lib/statement/mpesa-parser";
import { analyzeStatement } from "@/lib/statement/analyze";
import { RECRUNCH_CODE } from "@/lib/statement/recrunch";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(req: NextRequest) {
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ success: false, message: "Upload your statement." }, { status: 400 }); }

  const lenderSlug = ((form.get("lenderSlug") as string) || "").trim();
  const nationalId = ((form.get("nationalId") as string) || "").trim();
  const intentId = ((form.get("intentId") as string) || "").trim();
  const password = ((form.get("password") as string) || "").trim() || undefined;
  const file = form.get("file") as File | null;

  if (!nationalId) return NextResponse.json({ success: false, message: "Enter your national ID." }, { status: 400 });

  const org = await resolveOrg(lenderSlug);
  if (org) enterOrg(org.id);
  if (!org || org.mode !== "NATIVE") return NextResponse.json({ success: false, message: "This service isn't available for this lender." }, { status: 400 });

  const verified = await borrowerFor(org.id);
  if (!verified) return otpRequired();

  const limited = await rateLimit([{ name: "recrunch-run:ip", subject: clientIp(req), max: 20, windowSec: 3600 }]);
  if (limited) return limited;

  const borrower = await prisma.borrower.findFirst({
    where: { orgId: org.id, phone: { endsWith: verified.phone.slice(-9) }, nationalId },
    orderBy: { createdAt: "desc" },
    select: { id: true, firstName: true, otherName: true },
  });
  if (!borrower) return NextResponse.json({ success: false, message: "We couldn't match your details." }, { status: 404 });

  // ── The credit must exist, belong to them, and be unspent. ──────────────────
  const intent = await prisma.paymentIntent.findFirst({
    where: { id: intentId, orgId: org.id, borrowerId: borrower.id, purpose: "CHARGE", reference: RECRUNCH_CODE, state: "SUCCESS" },
    select: { id: true },
  });
  if (!intent) return NextResponse.json({ success: false, needsPayment: true, message: "Pay for the refresh first." }, { status: 402 });

  const alreadyUsed = await prisma.auditLog.findFirst({ where: { orgId: org.id, action: "recrunch.run", entityId: intent.id }, select: { id: true } });
  if (alreadyUsed) return NextResponse.json({ success: false, message: "That refresh has already been used. Pay for another to run it again." }, { status: 409 });

  if (!file) return NextResponse.json({ success: false, message: "Attach your M-Pesa statement PDF." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ success: false, message: "That file is too large (max 15 MB)." }, { status: 400 });
  const name = file.name.toLowerCase();
  if (!name.endsWith(".pdf") && file.type !== "application/pdf") {
    return NextResponse.json({ success: false, message: "Upload the official M-Pesa statement PDF." }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const text = await extractPdfText(buffer, password);
    const txns = parseMpesaStatement(text);
    if (txns.length === 0) {
      return NextResponse.json({ success: false, message: "We couldn't find transactions in this PDF. Use the official Safaricom statement with the detailed table." });
    }

    // The statement must be the payer's own — inherit no one else's score.
    const expectedName = [borrower.firstName, borrower.otherName].filter(Boolean).join(" ").trim();
    const statementName = extractStatementName(text);
    if (expectedName && statementName && !namesMatch(expectedName, statementName).match) {
      return NextResponse.json({
        success: false, nameMismatch: true,
        message: `This statement belongs to “${statementName}”, not you. A refresh only reads your own statement.`,
      });
    }

    const report = analyzeStatement(txns);

    // Spend the credit: the latch first (so a crash can't hand out a free second run),
    // then meter it exactly like any other crunch.
    await prisma.auditLog.create({
      data: {
        orgId: org.id, actorType: "borrower", actorId: borrower.id,
        action: "recrunch.run", entity: "PaymentIntent", entityId: intent.id,
        meta: { txns: txns.length, score: report.score.value, via: "portal" },
      },
    });
    await prisma.usageEvent.create({
      data: { orgId: org.id, kind: "statement", qty: 1, meta: { via: "portal-recrunch", txns: txns.length, score: report.score.value } },
    }).catch(() => { /* metering must never fail the customer's report */ });

    return NextResponse.json({ success: true, report });
  } catch (err) {
    if (err instanceof PdfPasswordRequiredError) return NextResponse.json({ success: false, needPassword: true, message: err.message });
    if (err instanceof PdfPasswordIncorrectError) return NextResponse.json({ success: false, needPassword: true, message: err.message });
    const message = err instanceof Error ? err.message : "We couldn't read that statement.";
    return NextResponse.json({ success: false, message });
  }
}
