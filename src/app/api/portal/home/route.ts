// ─────────────────────────────────────────────────────────────────────────────
// POST /api/portal/home — everything the first screen needs, in one call.
//
// Body: { lenderSlug, nationalId? }
//
// The read itself lives in lib/portal/position.ts, and moved there for one reason:
// the customer's Riri answers "what do I owe?" from the SAME function this route
// renders. One truth, two readers — Home and Riri cannot disagree about a balance.
// Everything that used to be explained here (why one endpoint and not four, where
// the money comes from, why `CreditScore` is not a credit score) is explained
// there, beside the code it describes.
//
// This route keeps what is specific to a SCREEN: the session gate, the rate limit,
// and the response shape the app's Home was written against. `borrowerId` is read
// server-side for Riri and deliberately not sent — the app has never needed it.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { borrowerFor, otpRequired } from "@/lib/portal/session";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { readPosition } from "@/lib/portal/position";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { lenderSlug?: string; nationalId?: string };
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

  const limited = await rateLimit([
    { name: "home:phone", subject: `${org.id}:${session.phone}`, max: 60, windowSec: 900 },
    { name: "home:ip", subject: clientIp(req), max: 200, windowSec: 3600 },
  ]);
  if (limited) return limited;

  const position = await readPosition(org, session, body.nationalId);

  // An erased borrower answers exactly as it always did: not found, and nothing else.
  if (position.erased) {
    return NextResponse.json({ success: true, found: false, lender: org.name });
  }

  const { borrowerId: _server, erased: _erased, ...rest } = position;
  void _server; void _erased;
  return NextResponse.json({ success: true, ...rest });
}
