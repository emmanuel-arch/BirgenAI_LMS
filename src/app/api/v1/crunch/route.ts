// POST /api/v1/crunch — the productized M-Pesa Internal Report API.
//
// Any lender or their own system posts a statement (+ password) here and gets the
// full Internal Report JSON back — the same deep analysis our console and portal
// run, exposed as a service. Auth is a per-lender API key (see src/lib/api/keys);
// every call is metered as a UsageEvent so it bills like any other engine.
//
// multipart/form-data:  statement=<pdf file>  password=<string, optional>
// header:               x-api-key: brgn_<slug>.<sig>   (or Authorization: Bearer …)
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithOrg } from "@/lib/db/context";
import { resolveOrg } from "@/lib/tenancy";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { verifyReportKey } from "@/lib/api/keys";
import { extractPdfText, PdfPasswordRequiredError, PdfPasswordIncorrectError } from "@/lib/statement/extract-pdf";
import { parseMpesaStatement } from "@/lib/statement/mpesa-parser";
import { analyzeStatement } from "@/lib/statement/analyze";

export const runtime = "nodejs";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

export async function GET() {
  return json({
    service: "BirgenAI Internal Report API",
    version: "v1",
    endpoint: "POST /api/v1/crunch",
    auth: "x-api-key: brgn_<orgSlug>.<sig>",
    body: "multipart/form-data — statement=<pdf>, password=<optional>",
    returns: "{ success, orgSlug, report } — Internal Score, spend-by-category, top merchants, loan behaviour, lifestyle, highlights",
  });
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const limited = await rateLimit([{ name: "crunch-api:ip", subject: ip, max: 30, windowSec: 300 }], "Too many requests. Slow down.");
  if (limited) return limited;

  const key = req.headers.get("x-api-key") || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
  const auth = verifyReportKey(key);
  if (!auth) return json({ success: false, error: "Invalid or missing API key." }, 401);

  const org = await resolveOrg(auth.orgSlug);
  if (!org || org.status === "SUSPENDED") return json({ success: false, error: "Organization not found or not active." }, 403);

  // Per-org throughput ceiling on top of the IP one.
  const orgLimited = await rateLimit([{ name: "crunch-api:org", subject: org.id, max: 200, windowSec: 3600 }], "Hourly limit reached for this key.");
  if (orgLimited) return orgLimited;

  let form: FormData;
  try { form = await req.formData(); }
  catch { return json({ success: false, error: "Send multipart/form-data with a 'statement' file." }, 400); }

  const file = form.get("statement");
  const password = (form.get("password") as string | null)?.trim() || undefined;
  if (!(file instanceof File)) return json({ success: false, error: "Missing 'statement' file field." }, 400);
  if (file.size > 15 * 1024 * 1024) return json({ success: false, error: "Statement too large (15MB max)." }, 413);

  const buffer = Buffer.from(await file.arrayBuffer());

  let report;
  try {
    const text = await extractPdfText(buffer, password);
    const txns = parseMpesaStatement(text);
    if (!txns.length) return json({ success: false, error: "No M-Pesa transactions found — is this a Safaricom detailed statement?" }, 422);
    report = analyzeStatement(txns);
  } catch (e) {
    if (e instanceof PdfPasswordRequiredError) return json({ success: false, error: e.message, code: "password_required" }, 422);
    if (e instanceof PdfPasswordIncorrectError) return json({ success: false, error: e.message, code: "password_incorrect" }, 422);
    return json({ success: false, error: "Could not read this statement." }, 422);
  }

  // Meter the call — bills exactly like a console crunch.
  await runWithOrg(org.id, () =>
    prisma.usageEvent.create({ data: { orgId: org.id, kind: "statement", qty: 1, meta: { via: "api", txns: report!.period.txns, score: report!.score.value } } }),
  ).catch(() => { /* metering must never fail the response */ });

  return json({ success: true, orgSlug: org.slug, report });
}
