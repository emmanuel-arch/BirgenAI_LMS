// POST /api/mpesa/ratiba-callback/[slug]?key=… — M-Pesa Ratiba result webhook.
//
// A standing order is authorized on the customer's phone AFTER we create it, so
// Safaricom confirms (or declines) it here. We match the order by the reference it
// gave us at creation and flip PENDING → ACTIVE or FAILED. Idempotent: an order
// already resolved is left alone, so a retried callback banks nothing twice.
//
// The exact payload shape is thin in Safaricom's docs, so the parse is defensive —
// it reads a result code and a reference out of whatever nesting arrives.
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runAsPlatform, runWithOrg } from "@/lib/db/context";
import { verifyCallbackKey } from "@/lib/mpesa/daraja";

export const runtime = "nodejs";

const ACK = { ResultCode: 0, ResultDesc: "Accepted" };

/** Pull the first defined value for any of these keys, however the body is nested. */
function dig(obj: unknown, keys: string[]): string | null {
  const seen = new Set<unknown>();
  const walk = (o: unknown): string | null => {
    if (!o || typeof o !== "object" || seen.has(o)) return null;
    seen.add(o);
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (keys.includes(k) && v != null && typeof v !== "object") return String(v);
    }
    for (const v of Object.values(o as Record<string, unknown>)) {
      const hit = walk(v);
      if (hit != null) return hit;
    }
    return null;
  };
  return walk(obj);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (!verifyCallbackKey(slug, req.nextUrl.searchParams.get("key"))) {
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Rejected" }, { status: 401 });
  }
  const org = await runAsPlatform(() => prisma.org.findUnique({ where: { slug }, select: { id: true } }));
  if (!org) return NextResponse.json({ ResultCode: 1, ResultDesc: "Unknown org" }, { status: 404 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json(ACK); }

  const ref = dig(body, ["responseRefID", "ResponseRefID", "BankReference", "reference", "AccountReference"]);
  const codeRaw = dig(body, ["ResultCode", "responseCode", "ResponseCode", "resultCode"]);
  const desc = dig(body, ["ResultDesc", "responseDescription", "ResponseDescription"]) ?? "";
  const success = codeRaw != null && (codeRaw === "0" || codeRaw === "200" || codeRaw === "1000");

  return runWithOrg(org.id, async () => {
    // Match on the external ref if we captured one; otherwise fall back to the
    // account reference we sent (the loan short-id).
    const so = ref
      ? await prisma.standingOrder.findFirst({ where: { orgId: org.id, OR: [{ externalRef: ref }, { reference: ref }] }, orderBy: { createdAt: "desc" } })
      : null;
    if (!so || so.status === "ACTIVE" || so.status === "CANCELLED") return NextResponse.json(ACK);

    await prisma.standingOrder.update({
      where: { id: so.id },
      data: { status: success ? "ACTIVE" : "FAILED", raw: body as Prisma.InputJsonValue },
    }).catch(() => {});
    await prisma.auditLog.create({
      data: { orgId: org.id, actorType: "system", action: success ? "standingorder.active" : "standingorder.failed", entity: "StandingOrder", entityId: so.id, meta: { desc } },
    }).catch(() => {});

    return NextResponse.json(ACK);
  });
}
