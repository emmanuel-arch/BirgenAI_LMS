// ─────────────────────────────────────────────────────────────────────────────
// POST /api/portal/riri/feedback — the thumbs on an answer.
//
// Body: { lenderSlug, question, helpful, source?, intent? }
//
// Plan §07 step 5: "Every deflection is a row: question, matched packs,
// confidence, outcome." The thumbs are what turn a deflection count into a
// deflection RATE worth believing — an answer nobody rated down and nobody
// escalated after is the closest thing this surface has to "it worked". Rows land
// in RiriQueryLog as `customer:helpful` / `customer:unhelpful`, which the console's
// First response panel counts beside the answers and escalations.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { borrowerFor, otpRequired } from "@/lib/portal/session";
import { rateLimit } from "@/lib/ratelimit";
import { logRiriQuery } from "@/lib/riri/log";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { lenderSlug?: string; question?: string; helpful?: unknown; source?: string; intent?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 });
  }

  const org = await resolveOrg(body.lenderSlug ?? "");
  if (!org) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });
  enterOrg(org.id);

  const session = await borrowerFor(org.id);
  if (!session) return otpRequired();

  const limited = await rateLimit([{ name: "riri:feedback:phone", subject: `${org.id}:${session.phone}`, max: 60, windowSec: 3600 }]);
  if (limited) return limited;

  const question = (body.question ?? "").trim().slice(0, 500);
  if (!question || typeof body.helpful !== "boolean") {
    return NextResponse.json({ success: false, message: "Nothing to record." }, { status: 400 });
  }

  // The source id is a label from our own answer, echoed back; it is stored for
  // grouping and never trusted as a fact about anything.
  const source = typeof body.source === "string" ? body.source.slice(0, 120) : null;
  await logRiriQuery({
    orgId: org.id, staffId: null, model: "customer", question,
    route: body.helpful ? "customer:helpful" : "customer:unhelpful",
    metricId: source ?? (typeof body.intent === "string" ? `intent:${body.intent.slice(0, 40)}` : null),
    ok: body.helpful,
  });

  return NextResponse.json({ success: true });
}
