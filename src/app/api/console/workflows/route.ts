// ─────────────────────────────────────────────────────────────────────────────
// APPROVAL WORKFLOWS — the chains a case moves along, for every kind of case.
//
//   GET    → workflows with stages (?kind=LOAN to narrow)
//   POST   → create
//   PUT    → replace title/description/kind/multiApproval/stages
//   DELETE → remove one, if nothing is riding on it
//
// Two things changed here, and both are the same change: a stage stopped being a row
// of hard-coded gates and became a row that CARRIES gates.
//
//   `kind` — ServiceSuite has one boolean ("is this a loan workflow?") whose only
//   job is to decide whether the stage editor offers reschedule and Ratiba, which
//   means every non-loan approval in the business shares one undifferentiated "No".
//   Naming the subject lets each after-book action in the `loans` namespace point at
//   a chain built for it.
//
//   `checks` — ServiceSuite grew `RequestMpesaRatiba` as a bit column the day a
//   lender wanted a Ratiba mandate at their finance stage, and `crbRequired` is the
//   same story a year earlier. Both are now bindings in a Json array validated
//   against lib/workflow/checks.ts, so putting a bureau pull at risk review — or at
//   the front door, in borrower settings — is configuration rather than a migration.
//   `crbRequired` stays as a projection so every reader written before this keeps working.
//
// `disbursementRoute` on the FINALIZING stage is where a lender says whose system
// pays the loan out — LMS_NATIVE (our B2C queue) or LENDER_BRIDGE (posted into
// their own workflow). Absent = inherit the org's mode.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { Prisma, type DisbursementRoute, type WorkflowKind } from "@prisma/client";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma, orgTx } from "@/lib/prisma";
import { normaliseBindings, CHECK_BY_ID } from "@/lib/workflow/checks";

export const runtime = "nodejs";

const ROUTES: DisbursementRoute[] = ["LMS_NATIVE", "LENDER_BRIDGE"];

const KINDS: WorkflowKind[] = [
  "LOAN", "RESTRUCTURE", "TOPUP", "WAIVER", "WRITEOFF", "REDISBURSEMENT",
  "DISBURSEMENT", "RECONCILIATION", "FLOAT", "EXPENSE", "OTHER",
];

type StageIn = {
  title?: string; accessTier?: number; canFinalize?: boolean; canUpdate?: boolean;
  otpRequired?: boolean; crbRequired?: boolean; maxAmount?: number | null;
  disbursementRoute?: string | null;
  checks?: unknown;
  attachments?: unknown;
  detailGroups?: unknown;
  roleIds?: unknown;
  userIds?: unknown;
  canReschedule?: boolean;
  slaHours?: number;
};

const codes = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.map((x) => String(x).toUpperCase().trim()).filter(Boolean))] : [];
const ids = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.map(String).map((s) => s.trim()).filter(Boolean))] : [];

function validateStages(stages: StageIn[]): string | null {
  if (!Array.isArray(stages) || stages.length === 0) return "Add at least one stage.";
  if (stages.length > 8) return "Keep workflows to 8 stages or fewer.";

  let finalizes = false;
  for (const s of stages) {
    if (!s.title?.trim()) return "Every stage needs a title.";
    if (![1, 2, 3].includes(Number(s.accessTier))) return "Stage tier must be 1 (Initiator), 2 (Authorizer) or 3 (Validator).";
    if (s.canFinalize) finalizes = true;

    if (s.disbursementRoute != null && !ROUTES.includes(s.disbursementRoute as DisbursementRoute)) {
      return "Disbursement route must be LMS_NATIVE or LENDER_BRIDGE.";
    }
    // A non-finalizing stage never pays anything out, so a route on it would be a
    // setting that silently does nothing — say so rather than storing dead config.
    if (s.disbursementRoute != null && !s.canFinalize) {
      return `"${s.title.trim()}" does not finalize, so it cannot choose a disbursement route.`;
    }

    // A check bound to a stage where it cannot run is a queue that never clears.
    // normaliseBindings drops anything invalid, so compare counts to catch it.
    const raw = Array.isArray(s.checks) ? s.checks : [];
    const kept = normaliseBindings(raw, "stage");
    if (kept.length < raw.length) {
      const keptIds = new Set(kept.map((k) => k.id));
      const dropped = raw
        .map((r) => (typeof r === "string" ? r : String((r as { id?: unknown })?.id ?? "")))
        .find((id) => !keptIds.has(id));
      return `"${s.title.trim()}" has a check that cannot run at an approval stage${dropped ? ` (${dropped})` : ""}.`;
    }
    if (Number(s.slaHours ?? 0) < 0 || Number(s.slaHours ?? 0) > 720) {
      return `"${s.title.trim()}": the escalation window must be between 0 and 720 hours.`;
    }
  }

  // A chain that never finalizes is a queue with no exit — cases enter it and stop.
  if (!finalizes) return "No stage finalizes, so nothing could ever leave this workflow.";
  return null;
}

function stageData(s: StageIn, i: number) {
  const checks = normaliseBindings(s.checks, "stage");
  return {
    title: s.title!.trim(),
    order: i + 1,
    accessTier: Number(s.accessTier) || 1,
    canFinalize: !!s.canFinalize,
    canUpdate: !!s.canUpdate,
    otpRequired: s.otpRequired !== false,
    // A projection of the bindings, kept so every reader written before the check
    // catalogue existed keeps working unchanged.
    crbRequired: !!s.crbRequired || checks.some((c) => c.id.startsWith("crb.")),
    maxAmount: s.maxAmount != null && Number.isFinite(Number(s.maxAmount)) ? new Prisma.Decimal(Number(s.maxAmount)) : null,
    disbursementRoute: (s.disbursementRoute as DisbursementRoute | null) ?? null,
    checks: checks as unknown as Prisma.InputJsonValue,
    attachments: codes(s.attachments) as unknown as Prisma.InputJsonValue,
    detailGroups: codes(s.detailGroups) as unknown as Prisma.InputJsonValue,
    roleIds: ids(s.roleIds) as unknown as Prisma.InputJsonValue,
    userIds: ids(s.userIds) as unknown as Prisma.InputJsonValue,
    canReschedule: !!s.canReschedule,
    slaHours: Math.max(0, Math.min(720, Math.round(Number(s.slaHours ?? 0)) || 0)),
  };
}

/** The shape every reader of this route gets back. */
function present(w: {
  id: string; title: string; description: string | null; kind: WorkflowKind;
  multiApproval: boolean; isActive: boolean;
  stages: {
    id: string; title: string; order: number; accessTier: number; canFinalize: boolean;
    canUpdate: boolean; otpRequired: boolean; crbRequired: boolean; maxAmount: unknown;
    disbursementRoute: DisbursementRoute | null; checks: unknown; attachments: unknown;
    detailGroups: unknown; roleIds: unknown; userIds: unknown; canReschedule: boolean; slaHours: number;
  }[];
}) {
  return {
    id: w.id, title: w.title, description: w.description,
    kind: w.kind, multiApproval: w.multiApproval, isActive: w.isActive,
    stages: w.stages.map((s) => {
      const checks = normaliseBindings(s.checks, "stage");
      return {
        id: s.id, title: s.title, order: s.order, accessTier: s.accessTier,
        canFinalize: s.canFinalize, canUpdate: s.canUpdate, otpRequired: s.otpRequired,
        crbRequired: s.crbRequired,
        maxAmount: s.maxAmount != null ? Number(s.maxAmount) : null,
        disbursementRoute: s.disbursementRoute,
        checks,
        // What each check will actually do here, so a list can be rendered without
        // the client re-deriving the catalogue.
        checkLabels: checks.map((c) => CHECK_BY_ID[c.id]?.label).filter(Boolean),
        attachments: codes(s.attachments),
        detailGroups: codes(s.detailGroups),
        roleIds: ids(s.roleIds),
        userIds: ids(s.userIds),
        canReschedule: s.canReschedule,
        slaHours: s.slaHours,
      };
    }),
  };
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "workflows.view");
  if (denied) return denied;

  const kind = req.nextUrl.searchParams.get("kind");
  const where = {
    orgId: session.user.orgId,
    ...(kind && KINDS.includes(kind as WorkflowKind) ? { kind: kind as WorkflowKind } : {}),
  };

  const workflows = await prisma.workflow.findMany({
    where,
    include: { stages: { orderBy: { order: "asc" } } },
    orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
  });

  // How many products point at each chain — the "8 Products / 3 Products" column on
  // the workflow list, and the reason a lender hesitates before deleting one.
  const products = await prisma.product.findMany({
    where: { orgId: session.user.orgId },
    select: { newWorkflowId: true, repeatWorkflowId: true },
  });

  return NextResponse.json({
    success: true,
    workflows: workflows.map((w) => ({
      ...present(w),
      newLoanProducts: products.filter((p) => p.newWorkflowId === w.id).length,
      repeatLoanProducts: products.filter((p) => p.repeatWorkflowId === w.id).length,
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "workflows.manage");
  if (denied) return denied;

  let body: { title?: string; description?: string; kind?: string; multiApproval?: boolean; isActive?: boolean; stages?: StageIn[] };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const title = (body.title ?? "").trim();
  if (title.length < 3) return NextResponse.json({ success: false, message: "Name the workflow." }, { status: 400 });
  const err = validateStages(body.stages ?? []);
  if (err) return NextResponse.json({ success: false, message: err }, { status: 400 });

  const dup = await prisma.workflow.findFirst({ where: { orgId: session.user.orgId, title } });
  if (dup) return NextResponse.json({ success: false, message: `You already have a workflow called "${title}".` }, { status: 409 });

  const workflow = await prisma.workflow.create({
    data: {
      orgId: session.user.orgId,
      title,
      description: body.description?.trim() || null,
      kind: KINDS.includes(body.kind as WorkflowKind) ? (body.kind as WorkflowKind) : "LOAN",
      multiApproval: !!body.multiApproval,
      isActive: body.isActive !== false,
      stages: { create: body.stages!.map(stageData) },
    },
    include: { stages: { orderBy: { order: "asc" } } },
  });

  await prisma.auditLog.create({
    data: {
      orgId: session.user.orgId, actorId: session.user.id, actorType: "staff",
      action: "workflow.create", entity: "Workflow", entityId: workflow.id,
      meta: { title, kind: workflow.kind, stages: workflow.stages.length },
    },
  }).catch(() => {});

  return NextResponse.json({ success: true, workflow: present(workflow) });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "workflows.manage");
  if (denied) return denied;

  let body: {
    id?: string; title?: string; description?: string; kind?: string;
    multiApproval?: boolean; isActive?: boolean; stages?: StageIn[];
  };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ success: false, message: "Workflow id required." }, { status: 400 });

  const existing = await prisma.workflow.findFirst({ where: { id: body.id, orgId: session.user.orgId } });
  if (!existing) return NextResponse.json({ success: false, message: "Workflow not found." }, { status: 404 });

  const head = {
    title: body.title?.trim() || undefined,
    description: body.description !== undefined ? body.description?.trim() || null : undefined,
    kind: KINDS.includes(body.kind as WorkflowKind) ? (body.kind as WorkflowKind) : undefined,
    multiApproval: typeof body.multiApproval === "boolean" ? body.multiApproval : undefined,
    isActive: typeof body.isActive === "boolean" ? body.isActive : undefined,
  };

  if (body.stages) {
    const err = validateStages(body.stages);
    if (err) return NextResponse.json({ success: false, message: err }, { status: 400 });
    // In-flight applications keep moving: their currentStageId points at old
    // stage ids, which the approval route treats as stage-1 fallback if gone.
    await orgTx(async (tx) => {
      await tx.workflowStage.deleteMany({ where: { workflowId: existing.id } });
      await tx.workflow.update({
        where: { id: existing.id },
        // stageData is shared with POST on purpose: this replace path used to build
        // its own object and had quietly dropped `crbRequired`, so editing any
        // workflow silently removed its CRB gate.
        data: { ...head, stages: { create: body.stages!.map(stageData) } },
      });
    });
  } else {
    await prisma.workflow.update({ where: { id: existing.id }, data: head });
  }

  await prisma.auditLog.create({
    data: {
      orgId: session.user.orgId, actorId: session.user.id, actorType: "staff",
      action: "workflow.update", entity: "Workflow", entityId: existing.id,
      meta: { title: head.title ?? existing.title, stagesReplaced: Boolean(body.stages) },
    },
  }).catch(() => {});

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "workflows.manage");
  if (denied) return denied;
  const orgId = session.user.orgId;

  const id = req.nextUrl.searchParams.get("id") ?? "";
  const existing = await prisma.workflow.findFirst({ where: { id, orgId }, select: { id: true, title: true } });
  if (!existing) return NextResponse.json({ success: false, message: "Workflow not found." }, { status: 404 });

  // A workflow a product points at is load-bearing: deleting it leaves applications
  // with nowhere to go. Switch it off instead, and say which products to move first.
  const users = await prisma.product.findMany({
    where: { orgId, OR: [{ newWorkflowId: id }, { repeatWorkflowId: id }] },
    select: { name: true },
  });
  if (users.length > 0) {
    return NextResponse.json({
      success: false,
      message: `${users.length} product${users.length === 1 ? "" : "s"} still route through this workflow (${users.map((p) => p.name).join(", ")}). Point them elsewhere first, or switch this workflow off.`,
    }, { status: 409 });
  }

  const inFlight = await prisma.loanApplication.count({
    where: { orgId, status: { in: ["SUBMITTED", "AI_PRESCREEN", "OFFICER_REVIEW", "REFERRED"] }, product: { newWorkflowId: id } },
  });
  if (inFlight > 0) {
    return NextResponse.json({
      success: false,
      message: `${inFlight} application${inFlight === 1 ? " is" : "s are"} still moving through this workflow.`,
    }, { status: 409 });
  }

  await orgTx(async (tx) => {
    await tx.workflowStage.deleteMany({ where: { workflowId: id } });
    await tx.workflow.delete({ where: { id } });
  });

  await prisma.auditLog.create({
    data: {
      orgId, actorId: session.user.id, actorType: "staff",
      action: "workflow.delete", entity: "Workflow", entityId: id, meta: { title: existing.title },
    },
  }).catch(() => {});

  return NextResponse.json({ success: true });
}
