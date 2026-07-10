// Approval workflows (admin, own org) — ServiceSuite ApprovalWorkflow parity,
// linear stage chains ordered by `order`.
//   GET  → workflows with stages
//   POST → create { title, description?, stages: [{ title, accessTier, canFinalize, otpRequired, maxAmount? }] }
//   PUT  → replace a workflow's title/stages { id, title?, stages? }
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma, orgTx } from "@/lib/prisma";

export const runtime = "nodejs";

type StageIn = { title?: string; accessTier?: number; canFinalize?: boolean; otpRequired?: boolean; maxAmount?: number | null };

function validateStages(stages: StageIn[]): string | null {
  if (!Array.isArray(stages) || stages.length === 0) return "Add at least one stage.";
  if (stages.length > 6) return "Keep workflows to 6 stages or fewer.";
  for (const s of stages) {
    if (!s.title?.trim()) return "Every stage needs a title.";
    if (![1, 2, 3].includes(Number(s.accessTier))) return "Stage tier must be 1 (Initiator), 2 (Authorizer) or 3 (Validator).";
  }
  if (!stages[stages.length - 1].canFinalize) return "The last stage must be able to finalize.";
  return null;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "workflows.view");
  if (denied) return denied;
  const workflows = await prisma.workflow.findMany({
    where: { orgId: session.user.orgId },
    include: { stages: { orderBy: { order: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({
    success: true,
    workflows: workflows.map((w) => ({
      id: w.id, title: w.title, description: w.description,
      stages: w.stages.map((s) => ({
        id: s.id, title: s.title, order: s.order, accessTier: s.accessTier,
        canFinalize: s.canFinalize, otpRequired: s.otpRequired,
        maxAmount: s.maxAmount != null ? Number(s.maxAmount) : null,
      })),
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "workflows.manage");
  if (denied) return denied;
  let body: { title?: string; description?: string; stages?: StageIn[] };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const title = (body.title ?? "").trim();
  if (title.length < 3) return NextResponse.json({ success: false, message: "Name the workflow." }, { status: 400 });
  const err = validateStages(body.stages ?? []);
  if (err) return NextResponse.json({ success: false, message: err }, { status: 400 });

  const workflow = await prisma.workflow.create({
    data: {
      orgId: session.user.orgId,
      title,
      description: body.description?.trim() || null,
      stages: {
        create: body.stages!.map((s, i) => ({
          title: s.title!.trim(),
          order: i + 1,
          accessTier: Number(s.accessTier),
          canFinalize: !!s.canFinalize,
          otpRequired: s.otpRequired ?? true,
          maxAmount: s.maxAmount != null && Number.isFinite(Number(s.maxAmount)) ? new Prisma.Decimal(Number(s.maxAmount)) : null,
        })),
      },
    },
    include: { stages: { orderBy: { order: "asc" } } },
  });
  await prisma.auditLog.create({
    data: { orgId: session.user.orgId, actorId: session.user.id, actorType: "staff", action: "workflow.create", entity: "Workflow", entityId: workflow.id },
  }).catch(() => {});
  return NextResponse.json({ success: true, workflow });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "workflows.manage");
  if (denied) return denied;
  let body: { id?: string; title?: string; description?: string; stages?: StageIn[] };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ success: false, message: "Workflow id required." }, { status: 400 });

  const existing = await prisma.workflow.findFirst({ where: { id: body.id, orgId: session.user.orgId } });
  if (!existing) return NextResponse.json({ success: false, message: "Workflow not found." }, { status: 404 });

  if (body.stages) {
    const err = validateStages(body.stages);
    if (err) return NextResponse.json({ success: false, message: err }, { status: 400 });
    // In-flight applications keep moving: their currentStageId points at old
    // stage ids, which the approval route treats as stage-1 fallback if gone.
    await orgTx(async (tx) => {
      await tx.workflowStage.deleteMany({ where: { workflowId: existing.id } });
      await tx.workflow.update({
        where: { id: existing.id },
        data: {
          title: body.title?.trim() || undefined,
          description: body.description !== undefined ? body.description?.trim() || null : undefined,
          stages: {
            create: body.stages!.map((s, i) => ({
              title: s.title!.trim(),
              order: i + 1,
              accessTier: Number(s.accessTier),
              canFinalize: !!s.canFinalize,
              otpRequired: s.otpRequired ?? true,
              maxAmount: s.maxAmount != null && Number.isFinite(Number(s.maxAmount)) ? new Prisma.Decimal(Number(s.maxAmount)) : null,
            })),
          },
        },
      });
    });
  } else if (body.title) {
    await prisma.workflow.update({ where: { id: existing.id }, data: { title: body.title.trim() } });
  }
  return NextResponse.json({ success: true });
}
