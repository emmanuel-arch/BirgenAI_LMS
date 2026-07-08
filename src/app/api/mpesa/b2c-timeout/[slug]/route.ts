// POST /api/mpesa/b2c-timeout/[slug]?key=… — Daraja B2C queue-timeout webhook.
// Marks a stuck SENT/SENDING disbursement FAILED so Finance can retry.
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyCallbackKey } from "@/lib/mpesa/daraja";

export const runtime = "nodejs";

const ACK = { ResultCode: 0, ResultDesc: "Accepted" };

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (!verifyCallbackKey(slug, req.nextUrl.searchParams.get("key"))) {
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Rejected" }, { status: 401 });
  }
  const org = await prisma.org.findUnique({ where: { slug }, select: { id: true } });
  if (!org) return NextResponse.json({ ResultCode: 1, ResultDesc: "Unknown org" }, { status: 404 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json(ACK); }

  const conversationId = String((body as { Result?: Record<string, unknown> }).Result?.ConversationID ?? "");
  if (conversationId) {
    await prisma.disbursement.updateMany({
      where: { orgId: org.id, b2cRef: conversationId, state: { in: ["SENDING", "SENT"] } },
      data: { state: "FAILED", failReason: "B2C queue timeout", raw: body as Prisma.InputJsonValue },
    });
  }
  return NextResponse.json(ACK);
}
