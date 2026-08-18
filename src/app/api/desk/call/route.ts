// POST /api/desk/call — record a disposition against a case.
//
// The disposition vocabulary is CollectBox's own (`PaymentResponse`), and the
// rules it carries are enforced HERE rather than trusted from the client: a
// "Promised to pay" without an amount and a date is refused, because a promise
// that cannot be chased is not a promise, and putting one on the board makes the
// keep-rate a lie.
import { NextRequest, NextResponse } from "next/server";
import { logCall } from "@/lib/collectbox/write";
import { disposition, type DispositionId } from "@/lib/collectbox/taxonomy";
import { deskContext, readSubject, isResponse, actionResult } from "@/lib/desk/action";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ctx = await deskContext();
  if (isResponse(ctx)) return ctx;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const subject = readSubject(body);
  if (isResponse(subject)) return subject;

  const d = disposition(Number(body.dispositionId));
  if (!d) return NextResponse.json({ success: false, message: "Unknown disposition." }, { status: 400 });

  const promiseAmount = body.promiseAmount != null ? Number(body.promiseAmount) : undefined;
  const promiseDate = typeof body.promiseDate === "string" ? new Date(body.promiseDate) : undefined;

  if (d.requiresPromise) {
    if (!promiseAmount || promiseAmount <= 0) {
      return NextResponse.json({ success: false, message: `"${d.name}" needs an amount greater than zero.` }, { status: 400 });
    }
    if (!promiseDate || Number.isNaN(promiseDate.getTime())) {
      return NextResponse.json({ success: false, message: `"${d.name}" needs a date the money is expected.` }, { status: 400 });
    }
  }

  try {
    const res = await logCall({
      org: ctx.org,
      orgId: ctx.orgId,
      actor: ctx.actor,
      subject,
      dispositionId: d.id as DispositionId,
      comment: typeof body.comment === "string" ? body.comment.slice(0, 2000) : undefined,
      promiseAmount,
      promiseDate,
      durationSec: Number(body.durationSec) || 0,
    });
    return actionResult(res);
  } catch (e) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : "Failed to record." }, { status: 500 });
  }
}
