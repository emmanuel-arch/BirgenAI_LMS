// ─────────────────────────────────────────────────────────────────────────────
// THE WRITE PATH — the ONLY module permitted to write into CollectBox.
//
// ── THE RULE ─────────────────────────────────────────────────────────────────
// CollectBox is Micromart's live production collections database. Their floor is
// working it right now; 2,053 payments landed against it today. A write here is
// not a database operation, it is an entry in somebody's real ledger.
//
// So every desk action takes the same two steps, in this order, always:
//
//   1. RECORD IT HERE.   A `DeskInteraction` row in our Postgres, written
//                        immediately and unconditionally. This is authoritative
//                        for us: the timeline, the agent's shift, the case file
//                        and every other system read from it. It never fails
//                        because CollectBox was slow or unreachable.
//
//   2. MIRROR IT THERE.  Only if `COLLECTBOX_POSTING_ENABLED=true`. Otherwise
//                        the exact statement that WOULD have run is composed,
//                        parameters and all, and stored on the row as
//                        `shadowSql`.
//
// Shadow mode is the DEFAULT, and it is not a degraded mode. Every screen is
// fully interactive, the timeline builds up as you work, cross-system sync is
// real — the only thing that does not happen is the write to their server.
// Arming it later is then a review of real recorded intent (`pendingMirrors()`
// shows exactly what would go), not a leap of faith.
//
// ── WHY THE SHADOW SQL IS STORED WITH VALUES INLINED ─────────────────────────
// A parameterised statement plus a parameter array is what you want to EXECUTE
// and the worst possible thing to REVIEW — nobody spots a wrong loan id in
// `@p3`. The shadow is rendered with the literals in place so a human can read
// it and say "no, that is the wrong account". Rendering is for reading only; the
// real execution path always binds parameters and never interpolates.
//
// ── WHAT IS NEVER WRITTEN ────────────────────────────────────────────────────
// `PayedAmount` — the money table. Receipts are created by M-Pesa and their
// reconciler, and a call-centre tool that can insert a payment is a call-centre
// tool that can be used to fake one. It is read, always, and never written.
// ─────────────────────────────────────────────────────────────────────────────

import type { OrgDef } from "@/lib/enterprise/connections";
import { prisma } from "@/lib/prisma";
import { runWithOrg } from "@/lib/db/context";
import { execNonQuery, callStoredProc, mssql, type QueryParam } from "@/lib/enterprise/mssql";
import { CB } from "./client";
import { disposition, type DispositionId } from "./taxonomy";

export type MirrorState = "SHADOW" | "MIRRORED" | "FAILED" | "SKIPPED";

/** Is the mirror armed? One variable, checked in one place. */
export function isMirrorArmed(): boolean {
  return process.env.COLLECTBOX_POSTING_ENABLED === "true";
}

/** A human-readable summary of the write posture, for the UI banner. */
export function mirrorPosture(): { armed: boolean; label: string; detail: string } {
  const armed = isMirrorArmed();
  return armed
    ? {
        armed: true,
        label: "Live — writing to CollectBox",
        detail: "Dispositions, promises and tasks are being written into Micromart's production collections database.",
      }
    : {
        armed: false,
        label: "Shadow — recording locally",
        detail: "Every action is recorded here and the CollectBox statement is composed and stored, but not executed. Nothing reaches Micromart's production database.",
      };
}

// ── Statement rendering (for review, never for execution) ────────────────────

function literal(v: unknown): string {
  if (v == null) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (v instanceof Date) return `'${v.toISOString().slice(0, 23).replace("T", " ")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** The statement as a person would read it. Reviewing artefact only. */
function render(sql: string, params: QueryParam[]): string {
  let out = sql;
  // Longest names first so @loanId is not clobbered by @loan.
  for (const p of [...params].sort((a, b) => b.name.length - a.name.length)) {
    out = out.replaceAll(`@${p.name}`, literal(p.value));
  }
  return out.replace(/\s+/g, " ").trim();
}

// ── The shared shape ─────────────────────────────────────────────────────────

export type DeskActor = {
  /** Our StaffUser id, when the person signed in through this platform. */
  staffId?: string | null;
  /** CollectBox.dbo.UserMaster.ID — what every collections fact on their side is keyed by. */
  agentId: number;
  name: string;
};

export type DeskSubject = {
  entityId: number;
  loanId: number;
  borrowerId?: number | null;
  name?: string | null;
  phone?: string | null;
  /** CollectBox.dbo.LoanCategories.ID — which queue the case was in when worked. */
  categoryId?: number | null;
};

type Composed = {
  /** null = nothing to mirror; the interaction is internal to this platform. */
  sql: string | null;
  params: QueryParam[];
  /** Statements that must run after the primary insert (tracker updates). */
  followUps?: { sql: string; params: QueryParam[] }[];
};

type RecordArgs = {
  org: OrgDef;
  orgId: string;
  actor: DeskActor;
  subject: DeskSubject;
  kind: "CALL" | "PTP" | "NOTE" | "TASK" | "SMS" | "ASSIGN" | "ESCALATE" | "PIPELINE";
  headline: string;
  detail?: string | null;
  dispositionId?: number | null;
  amount?: number | null;
  dueDate?: Date | null;
  source?: string;
  composed: Composed;
};

export type DeskWriteResult = {
  id: string;
  mirrorState: MirrorState;
  shadowSql: string | null;
  mirrorRowId: number | null;
  mirrorError: string | null;
};

/**
 * The single funnel every desk action passes through.
 *
 * Order matters and is not negotiable: our row is committed BEFORE the mirror is
 * attempted. If the mirror throws, the action still happened, the agent still
 * sees it, and the failure is recorded on the row for a supervisor to retry. The
 * opposite order — mirror first, record after — loses the action entirely when
 * their server is unreachable, which is precisely when an agent is most likely
 * to be repeating themselves.
 */
async function record(args: RecordArgs): Promise<DeskWriteResult> {
  const { org, orgId, actor, subject, composed } = args;

  const shadowSql = composed.sql ? render(composed.sql, composed.params) : null;
  const armed = isMirrorArmed();
  const initial: MirrorState = composed.sql == null ? "SKIPPED" : armed ? "SHADOW" : "SHADOW";

  // Every desk row is written under an explicit tenant stamp. On a staff surface
  // the session has already set one and this is a no-op; off-request (a cron
  // sweep, a verify script) it is the only thing standing between this write and
  // an RLS rejection.
  const row = await runWithOrg(orgId, () => prisma.deskInteraction.create({
    data: {
      orgId,
      entityId: subject.entityId,
      liveLoanId: subject.loanId,
      liveBorrowerId: subject.borrowerId ?? null,
      subjectName: subject.name ?? null,
      subjectPhone: subject.phone ?? null,
      kind: args.kind,
      dispositionId: args.dispositionId ?? null,
      categoryId: subject.categoryId ?? null,
      headline: args.headline,
      detail: args.detail ?? null,
      amount: args.amount ?? null,
      dueDate: args.dueDate ?? null,
      actorStaffId: actor.staffId ?? null,
      actorAgentId: actor.agentId,
      actorName: actor.name,
      source: args.source ?? "desk",
      mirrorState: initial,
      shadowSql,
    },
    select: { id: true },
  }));

  if (!armed || composed.sql == null) {
    return {
      id: row.id,
      mirrorState: composed.sql == null ? "SKIPPED" : "SHADOW",
      shadowSql,
      mirrorRowId: null,
      mirrorError: null,
    };
  }

  // ── Armed. Everything below touches Micromart's production database. ──
  try {
    const inserted = await execNonQuery(org, composed.sql, composed.params, { timeoutMs: 20000 });
    for (const f of composed.followUps ?? []) {
      await execNonQuery(org, f.sql, f.params, { timeoutMs: 20000 });
    }
    await runWithOrg(orgId, () => prisma.deskInteraction.update({
      where: { id: row.id },
      data: { mirrorState: "MIRRORED", mirroredAt: new Date(), mirrorRowId: inserted || null },
    }));
    return { id: row.id, mirrorState: "MIRRORED", shadowSql, mirrorRowId: inserted || null, mirrorError: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await runWithOrg(orgId, () => prisma.deskInteraction.update({
      where: { id: row.id },
      data: { mirrorState: "FAILED", mirrorError: message.slice(0, 900) },
    }));
    return { id: row.id, mirrorState: "FAILED", shadowSql, mirrorRowId: null, mirrorError: message };
  }
}

// ── Log a call ───────────────────────────────────────────────────────────────

export type LogCallArgs = {
  org: OrgDef;
  orgId: string;
  actor: DeskActor;
  subject: DeskSubject;
  dispositionId: DispositionId;
  comment?: string;
  /** Required when the disposition is "Promised to pay". */
  promiseAmount?: number;
  promiseDate?: Date;
  /** Seconds. Written to CallLogs.CallDuration as a `time`. */
  durationSec?: number;
  callId?: string;
};

/**
 * Record a disposition against a case.
 *
 * The mirror writes `CallLogs` exactly as their own app does — `RecordID` is the
 * LOAN id (verified: 73,050 rows since 2025 resolve to `Loans.id` at 100%), and
 * `CreatedBy` is the CollectBox agent id. Getting `RecordID` wrong would put the
 * call on another customer's file, which is why this is derived from the case
 * being worked and never accepted from the client.
 */
export async function logCall(args: LogCallArgs): Promise<DeskWriteResult> {
  const d = disposition(args.dispositionId);
  if (!d) throw new Error(`Unknown disposition ${args.dispositionId}.`);
  if (d.requiresPromise && !(args.promiseAmount && args.promiseDate)) {
    throw new Error(`"${d.name}" requires a promised amount and a date — a promise without either is not a promise.`);
  }

  const duration = secondsToSqlTime(args.durationSec ?? 0);
  const params: QueryParam[] = [
    { name: "recordId", type: mssql.Int, value: args.subject.loanId },
    { name: "phone", type: mssql.VarChar(100), value: args.subject.phone ?? "" },
    { name: "callId", type: mssql.VarChar(100), value: args.callId ?? "" },
    { name: "duration", type: mssql.VarChar(12), value: duration },
    { name: "response", type: mssql.Int, value: d.id },
    { name: "status", type: mssql.Int, value: d.callStatus },
    { name: "promised", type: mssql.Decimal(18, 2), value: args.promiseAmount ?? 0 },
    { name: "promisedDate", type: mssql.Date, value: args.promiseDate ?? null },
    { name: "createdBy", type: mssql.Int, value: args.actor.agentId },
    { name: "comments", type: mssql.VarChar(mssql.MAX), value: args.comment ?? "" },
  ];

  const sql = `INSERT INTO ${CB}.CallLogs
      (RecordID, PhoneNumber, callID, TimeOfCall, CallDuration, CallResponse, CallStatus,
       PromisedAmount, PromisedDate, CreatedBy, CreatedDate, Comments)
    VALUES
      (@recordId, @phone, @callId, GETDATE(), @duration, @response, @status,
       @promised, @promisedDate, @createdBy, GETDATE(), @comments)`;

  // The tracker carries the case's own state — mark it worked, and stamp the
  // comment so the next agent to open it sees what happened without a join.
  const followUps = [{
    sql: `UPDATE ${CB}.CollectionTracker
             SET IsActioned = 1, ActionStatus = @response, LastActionedDate = GETDATE(),
                 Last_update = GETDATE(), LastComment = @comments
           WHERE LoanId = @recordId`,
    params: [
      { name: "response", type: mssql.Int, value: d.id },
      { name: "comments", type: mssql.VarChar(mssql.MAX), value: (args.comment ?? "").slice(0, 400) },
      { name: "recordId", type: mssql.Int, value: args.subject.loanId },
    ] as QueryParam[],
  }];

  const headline = d.requiresPromise && args.promiseAmount
    ? `${d.name} — KES ${args.promiseAmount.toLocaleString("en-KE")} by ${args.promiseDate?.toDateString()}`
    : d.name;

  return record({
    org: args.org, orgId: args.orgId, actor: args.actor, subject: args.subject,
    kind: "CALL", headline, detail: args.comment ?? null,
    dispositionId: d.id,
    amount: args.promiseAmount ?? null, dueDate: args.promiseDate ?? null,
    composed: { sql, params, followUps },
  });
}

// ── Take a promise ───────────────────────────────────────────────────────────

export type TakePromiseArgs = {
  org: OrgDef; orgId: string; actor: DeskActor; subject: DeskSubject;
  amount: number; dueDate: Date; note?: string;
};

/**
 * A promise to pay, as its own record.
 *
 * `logCall` with disposition 1 already writes the promise onto the call row;
 * this creates the tracked PTP that the promise board and the keep-rate are
 * computed from. Their app writes both, and so do we — a promise that exists
 * only on a call log cannot be chased, which is the entire point of taking one.
 */
export async function takePromise(args: TakePromiseArgs): Promise<DeskWriteResult> {
  if (!(args.amount > 0)) throw new Error("A promise needs an amount greater than zero.");

  const params: QueryParam[] = [
    { name: "amount", type: mssql.Decimal(18, 2), value: args.amount },
    { name: "due", type: mssql.DateTime, value: args.dueDate },
    { name: "recordId", type: mssql.Int, value: args.subject.loanId },
    { name: "createdBy", type: mssql.Int, value: args.actor.agentId },
  ];

  const sql = `INSERT INTO ${CB}.PromisedToPay
      (PromisedAmount, PromisedDate, PaymentStatus, RecordID, CreatedBy, CreatedDate, AmountPaid, Balance)
    VALUES
      (@amount, @due, 0, @recordId, @createdBy, GETDATE(), 0, @amount)`;

  const followUps = [{
    sql: `UPDATE ${CB}.CollectionTracker
             SET PtpDate = @due, ptpAmount = @amount, PtpStatus = 0, Last_update = GETDATE()
           WHERE LoanId = @recordId`,
    params: [
      { name: "due", type: mssql.Date, value: args.dueDate },
      { name: "amount", type: mssql.Decimal(18, 2), value: args.amount },
      { name: "recordId", type: mssql.Int, value: args.subject.loanId },
    ] as QueryParam[],
  }];

  return record({
    org: args.org, orgId: args.orgId, actor: args.actor, subject: args.subject,
    kind: "PTP",
    headline: `Promise — KES ${args.amount.toLocaleString("en-KE")} by ${args.dueDate.toDateString()}`,
    detail: args.note ?? null,
    amount: args.amount, dueDate: args.dueDate,
    composed: { sql, params, followUps },
  });
}

// ── Schedule a task ──────────────────────────────────────────────────────────

export type ScheduleTaskArgs = {
  org: OrgDef; orgId: string; actor: DeskActor; subject: DeskSubject;
  /** CollectBox.dbo.TaskAction.ID — 1 call, 2 meet, 3 field visit. */
  action: 1 | 2 | 3;
  when: Date;
  note?: string;
};

export async function scheduleTask(args: ScheduleTaskArgs): Promise<DeskWriteResult> {
  const names: Record<number, string> = { 1: "Call debtor", 2: "Meet debtor", 3: "Field visit" };
  const params: QueryParam[] = [
    { name: "action", type: mssql.Int, value: args.action },
    { name: "when", type: mssql.Date, value: args.when },
    { name: "createdBy", type: mssql.Int, value: args.actor.agentId },
    { name: "recordId", type: mssql.Int, value: args.subject.loanId },
    { name: "comments", type: mssql.VarChar(mssql.MAX), value: args.note ?? "" },
  ];
  const sql = `INSERT INTO ${CB}.TaskScheduler
      (TaskAction, TaskDate, CreatedBy, CreatedDate, RecordId, Comments, IsActive)
    VALUES (@action, @when, @createdBy, GETDATE(), @recordId, @comments, 1)`;

  return record({
    org: args.org, orgId: args.orgId, actor: args.actor, subject: args.subject,
    kind: "TASK",
    headline: `${names[args.action]} scheduled for ${args.when.toDateString()}`,
    detail: args.note ?? null, dueDate: args.when,
    composed: { sql, params },
  });
}

// ── Reassign a case ──────────────────────────────────────────────────────────

export type AssignArgs = {
  org: OrgDef; orgId: string; actor: DeskActor; subject: DeskSubject;
  toAgentId: number; toAgentName: string; reason?: string;
};

export async function assignCase(args: AssignArgs): Promise<DeskWriteResult> {
  const params: QueryParam[] = [
    { name: "agent", type: mssql.Int, value: args.toAgentId },
    { name: "from", type: mssql.Int, value: args.actor.agentId },
    { name: "recordId", type: mssql.Int, value: args.subject.loanId },
  ];
  // An UPDATE, not an INSERT — assignment is a property of the case.
  const sql = `UPDATE ${CB}.CollectionTracker
                  SET AgentAssigned = @agent, IsAgentAssigned = 1, AgentFrom = @from, AgentTo = @agent,
                      LastDateAssigned = GETDATE(), Last_update = GETDATE()
                WHERE LoanId = @recordId`;

  return record({
    org: args.org, orgId: args.orgId, actor: args.actor, subject: args.subject,
    kind: "ASSIGN",
    headline: `Reassigned to ${args.toAgentName}`,
    detail: args.reason ?? null,
    composed: { sql, params },
  });
}

// ── Notes and escalations ────────────────────────────────────────────────────

export async function addNote(args: {
  org: OrgDef; orgId: string; actor: DeskActor; subject: DeskSubject; note: string; source?: string;
}): Promise<DeskWriteResult> {
  // Deliberately NOT mirrored. CollectBox has no note object of its own — their
  // notes live on call rows — and inventing a call to carry a note would corrupt
  // every contact-rate figure computed from that table. The note is ours.
  return record({
    org: args.org, orgId: args.orgId, actor: args.actor, subject: args.subject,
    kind: "NOTE", headline: "Note added", detail: args.note, source: args.source,
    composed: { sql: null, params: [] },
  });
}

export async function escalate(args: {
  org: OrgDef; orgId: string; actor: DeskActor; subject: DeskSubject;
  to: "field" | "legal" | "supervisor"; reason: string;
}): Promise<DeskWriteResult> {
  const label = { field: "Field recovery", legal: "Legal", supervisor: "Supervisor" }[args.to];
  // Field escalation has a real counterpart on their side — a field-visit task.
  const composed: Composed = args.to === "field"
    ? {
        sql: `INSERT INTO ${CB}.TaskScheduler (TaskAction, TaskDate, CreatedBy, CreatedDate, RecordId, Comments, IsActive)
              VALUES (3, CAST(GETDATE() AS date), @createdBy, GETDATE(), @recordId, @comments, 1)`,
        params: [
          { name: "createdBy", type: mssql.Int, value: args.actor.agentId },
          { name: "recordId", type: mssql.Int, value: args.subject.loanId },
          { name: "comments", type: mssql.VarChar(mssql.MAX), value: args.reason },
        ],
      }
    : { sql: null, params: [] };

  return record({
    org: args.org, orgId: args.orgId, actor: args.actor, subject: args.subject,
    kind: "ESCALATE", headline: `Escalated to ${label}`, detail: args.reason,
    composed,
  });
}

// ── The Fintech pipeline write ───────────────────────────────────────────────

export type PullToFloorArgs = {
  org: OrgDef; orgId: string; actor: DeskActor;
  entityId: number; loanId: number; borrowerId: number;
  name: string; phone: string;
  categoryId: number; dpd: number; amountDue: number; instalment: number;
  assignToAgentId: number; assignToAgentName: string;
};

/**
 * Pull a Micromart Fintech (3005) case onto the collections floor.
 *
 * This is the pipeline, and it is one INSERT. A `CollectionTracker` row is
 * everything a loan needs to be worked: the queue, the agent, the band, the
 * balances. The moment it exists, every screen in ConnectDesk treats that Micro
 * Eazy loan exactly as it treats the 93,376 loans from the main book — same
 * queues, same agents, same commission bands, same promise tracking.
 *
 * Nothing is migrated. The loan stays in Serviceconnect where it was booked. All
 * that crosses is a reference.
 */
export async function pullToFloor(args: PullToFloorArgs): Promise<DeskWriteResult> {
  const bandColumn = ({ 1: "Prepayment1", 2: "AmountDue", 3: "Watch1", 4: "Watch2", 5: "Watch3", 6: "Npl", 7: "Watch1" } as Record<number, string>)[args.categoryId] ?? "AmountDue";

  const params: QueryParam[] = [
    { name: "loanId", type: mssql.Int, value: args.loanId },
    { name: "dpd", type: mssql.Int, value: Math.max(0, args.dpd) },
    { name: "agent", type: mssql.Int, value: args.assignToAgentId },
    { name: "band", type: mssql.Int, value: args.categoryId },
    { name: "due", type: mssql.Decimal(18, 2), value: args.amountDue },
    { name: "inst", type: mssql.Int, value: args.instalment },
  ];

  // Guarded by NOT EXISTS: pulling the same case twice would give it two queue
  // positions and double-count it in every band total on the floor.
  const sql = `INSERT INTO ${CB}.CollectionTracker
      (LoanId, DaysInArears, Create_date, Last_update, FirstDateInArrears, IsAgentAssigned, AgentAssigned,
       IsActioned, Loantype, AmountDue, ${bandColumn}, Installment, LastDateAssigned, PtpStatus)
    SELECT @loanId, @dpd, GETDATE(), GETDATE(), GETDATE(), 1, @agent,
           0, @band, @due, @due, @inst, GETDATE(), 0
     WHERE NOT EXISTS (SELECT 1 FROM ${CB}.CollectionTracker WHERE LoanId = @loanId)`;

  return record({
    org: args.org, orgId: args.orgId, actor: args.actor,
    subject: {
      entityId: args.entityId, loanId: args.loanId, borrowerId: args.borrowerId,
      name: args.name, phone: args.phone, categoryId: args.categoryId,
    },
    kind: "PIPELINE",
    headline: `Pulled onto the floor — assigned to ${args.assignToAgentName}`,
    detail: `Micromart Fintech (entity ${args.entityId}) case joined the collections queue in band ${args.categoryId} at ${args.dpd} days.`,
    amount: args.amountDue,
    source: "pipeline",
    composed: { sql, params },
  });
}

// ── Reviewing and retrying the shadow ────────────────────────────────────────

export type PendingMirror = {
  id: string; createdAt: Date; kind: string; headline: string;
  actorName: string; subjectName: string | null; liveLoanId: number; entityId: number;
  shadowSql: string; state: MirrorState; error: string | null;
};

/** Everything composed but not executed — the review list before arming. */
export async function pendingMirrors(orgId: string, limit = 100): Promise<PendingMirror[]> {
  const rows = await runWithOrg(orgId, () => prisma.deskInteraction.findMany({
    where: { orgId, mirrorState: { in: ["SHADOW", "FAILED"] }, shadowSql: { not: null } },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 500),
    select: {
      id: true, createdAt: true, kind: true, headline: true, actorName: true,
      subjectName: true, liveLoanId: true, entityId: true, shadowSql: true,
      mirrorState: true, mirrorError: true,
    },
  }));
  return rows.map((r) => ({
    id: r.id, createdAt: r.createdAt, kind: r.kind, headline: r.headline,
    actorName: r.actorName, subjectName: r.subjectName, liveLoanId: r.liveLoanId,
    entityId: r.entityId, shadowSql: r.shadowSql!, state: r.mirrorState as MirrorState,
    error: r.mirrorError,
  }));
}

/** How much is sitting in the shadow, for the banner count. */
export async function shadowCount(orgId: string): Promise<{ shadow: number; failed: number; mirrored: number }> {
  const [shadow, failed, mirrored] = await runWithOrg(orgId, () => Promise.all([
    prisma.deskInteraction.count({ where: { orgId, mirrorState: "SHADOW", shadowSql: { not: null } } }),
    prisma.deskInteraction.count({ where: { orgId, mirrorState: "FAILED" } }),
    prisma.deskInteraction.count({ where: { orgId, mirrorState: "MIRRORED" } }),
  ]));
  return { shadow, failed, mirrored };
}

// ── Utilities ────────────────────────────────────────────────────────────────

/** `CallLogs.CallDuration` is a SQL `time`. Seconds in, HH:MM:SS out. */
function secondsToSqlTime(sec: number): string {
  const s = Math.max(0, Math.trunc(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/**
 * Their own stored procedure, for the paths where behaviour beyond the INSERT
 * matters. `sp_AddCallLog` and `sp_ptpCallResponse` carry logic we do not want to
 * reimplement and get subtly wrong. Left available and unused by default: their
 * parameter contracts are not documented anywhere, so calling one blind is a
 * bigger risk than the INSERT it replaces. Prefer the explicit statements above
 * until a contract has actually been read off the procedure definition.
 */
export async function callTheirProc(org: OrgDef, name: string, params: QueryParam[]) {
  if (!isMirrorArmed()) throw new Error("CollectBox posting is disarmed. Set COLLECTBOX_POSTING_ENABLED=true to call stored procedures.");
  return callStoredProc(org, name, params);
}
