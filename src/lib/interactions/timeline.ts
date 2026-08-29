// ─────────────────────────────────────────────────────────────────────────────
// THE INTERACTION TIMELINE — the spine of the connected suite.
//
// ── THE ARGUMENT ─────────────────────────────────────────────────────────────
// Six systems sharing a database is not interconnectedness. It is a shared
// database, and every lender already has one of those. What makes a suite
// *connected* is that a thing which happens in one system is a first-class fact
// in all six, immediately, without an export, an import or a nightly job.
//
// This module is where that is actually true. Everything a lender and a customer
// have ever done to each other — across FIVE separate systems on TWO databases —
// is merged into one stream, in one shape, sorted by time:
//
//   CollectBox.CallLogs      → the call centre's dispositions          (1,342,610)
//   CollectBox.PayedAmount   → agent-attributed recoveries, M-Pesa ref (1,149,026)
//   CollectBox.PromisedToPay → promises taken on the phone               (150,345)
//   CollectBox.TaskScheduler → callbacks and field visits                 (48,945)
//   CollectBox.SMS           → outbound collections messages              (12,603)
//   Serviceconnect.Loans     → disbursements and clearances
//   Postgres.DeskInteraction → everything ConnectDesk itself has recorded
//
// One function. Six consumers: the Lending Console's Customer 360, the Customer
// Portal's activity feed, ConnectDesk's case file, the Analytics & Reporting's agent
// screen, PeopleHub's staff activity, and Ledgerly's audit trail. They do not
// each reimplement "what happened to this customer" — they call this, and so
// they cannot disagree about it.
//
// ── WHY THE MERGE IS IN NODE AND NOT IN SQL ──────────────────────────────────
// The obvious version is one big UNION ALL. It was tried and rejected: the seven
// sources have genuinely different shapes (a payment has an M-Pesa code, a call
// has a disposition, a task has a due date), so a UNION forces every row through
// the widest common column list and the type coercions alone make it unreadable.
// Worse, one source being slow would hold up all seven.
//
// Instead each source is queried independently, in parallel, bounded by the same
// window and row cap, and merged in memory. Seven small sorted lists merged into
// one is arithmetic, not a performance problem — and any single source failing
// degrades to a timeline missing that source rather than no timeline at all,
// which for a screen an agent is reading mid-call is the difference that matters.
// ─────────────────────────────────────────────────────────────────────────────

import type { OrgDef } from "@/lib/enterprise/connections";
import { prisma } from "@/lib/prisma";
import { currentTenant, runWithOrg } from "@/lib/db/context";
import { CB, SC, cbQuery, num, str, dt, msisdn, P } from "@/lib/collectbox/client";
import { disposition, category, ptpState } from "@/lib/collectbox/taxonomy";

/**
 * Run a Postgres read under a tenant stamp.
 *
 * The desk rows live in our own database behind FORCE row-level security, so a
 * query without an `app.org_id` stamp does not return zero rows — it throws. On a
 * staff surface the session has already stamped the async context and this is a
 * no-op. Off a request (a verify script, a cron sweep) there is no session, so
 * the caller passes `orgId` and this supplies the stamp.
 *
 * Neither present means the desk source is skipped rather than allowed to take
 * the whole timeline down with it. The live CollectBox sources need no stamp and
 * still render — which is exactly the degradation this module is built for.
 */
function withTenant<T>(orgId: string | undefined, fn: () => Promise<T>): Promise<T> {
  if (orgId) return runWithOrg(orgId, fn);
  const ctx = currentTenant();
  if (ctx?.orgId || ctx?.platform) return fn();
  return Promise.reject(new Error("[timeline] no tenant context and no orgId — desk interactions skipped"));
}

// ── The canonical shape ──────────────────────────────────────────────────────

export type InteractionSource =
  | "collectbox"      // their call-centre database
  | "serviceconnect"  // their lending ledger
  | "desk"            // ConnectDesk (this platform)
  | "console"         // the Lending Console
  | "portal"          // the Customer Portal
  | "pipeline";       // the Fintech bridge

export type InteractionKind =
  | "call" | "ptp" | "payment" | "sms" | "task" | "note"
  | "loan" | "cleared" | "visit" | "assign" | "escalate" | "pipeline";

export type Interaction = {
  /** Stable and source-qualified, so React keys survive a refetch. */
  id: string;
  at: Date;
  source: InteractionSource;
  kind: InteractionKind;
  /** Who did it. Null for system events like a disbursement posting. */
  actor: { name: string; role: string } | null;
  subject: { loanId: number; borrowerId?: number; name?: string; phone?: string };
  headline: string;
  detail: string;
  /** Money involved, when there is any. */
  amount?: number;
  /** Green / amber / red — how this reads at a glance in a dense list. */
  tone: "positive" | "neutral" | "warning" | "negative";
  /** Freeform badges: "M-Pesa UHIA53XUCJ", "Watch 2", "shadow". */
  tags: string[];
  /** Which of the six systems a reader should attribute this to. */
  system: string;
};

export type TimelineQuery = {
  loanId?: number;
  borrowerId?: number;
  /** All loans belonging to this borrower — the relationship, not one debt. */
  wholeRelationship?: boolean;
  agentId?: number;
  since?: Date;
  /** Our org id, for the tenant stamp on the desk source. Required off-request. */
  orgId?: string;
  limit?: number;
};

const SYSTEM_LABEL: Record<InteractionSource, string> = {
  collectbox: "Call Centre",
  serviceconnect: "Core Ledger",
  desk: "ConnectDesk",
  console: "Lending Console",
  portal: "Customer Portal",
  pipeline: "Fintech Pipeline",
};

/**
 * Everything that has ever happened between this lender and this customer.
 *
 * `wholeRelationship` is the difference between a debt and a customer. Given a
 * loan id it expands to every loan that borrower has ever held, so an agent
 * opening a case sees the four loans repaid perfectly before this one — which is
 * usually the single most useful fact on the screen and is invisible in every
 * system Micromart currently runs.
 */
export async function getTimeline(org: OrgDef, q: TimelineQuery): Promise<Interaction[]> {
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);
  const since = q.since ?? new Date(Date.now() - 1000 * 60 * 60 * 24 * 365 * 3);

  // Resolve the set of loan ids this timeline covers.
  const loanIds = await resolveLoanIds(org, q);
  if (loanIds.length === 0) return [];
  const idList = loanIds.join(",");

  const settled = await Promise.allSettled([
    readCalls(org, idList, since, limit),
    readPayments(org, idList, since, limit),
    readPromises(org, idList, since, limit),
    readTasks(org, idList, since, limit),
    readSms(org, idList, since, limit),
    readLoanEvents(org, idList, since),
    readDeskInteractions(q.orgId, loanIds, since, limit),
  ]);

  const all: Interaction[] = [];
  for (const s of settled) {
    // A source that fails degrades the timeline; it does not empty it.
    if (s.status === "fulfilled") all.push(...s.value);
    else console.error("[timeline] source failed:", s.reason instanceof Error ? s.reason.message : s.reason);
  }

  return all.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

/** Which loans does this timeline cover? */
async function resolveLoanIds(org: OrgDef, q: TimelineQuery): Promise<number[]> {
  if (q.borrowerId && q.wholeRelationship !== false) {
    const rows = await cbQuery<{ id: number }>(
      org, `SELECT id FROM ${SC}.Loans WHERE BorrowerId = @b ORDER BY BorrowDate DESC`,
      [P.int("b", q.borrowerId)], { maxRows: 200 },
    );
    return rows.map((r) => num(r.id)).filter(Boolean);
  }
  if (q.loanId && q.wholeRelationship) {
    const rows = await cbQuery<{ id: number }>(
      org,
      `SELECT l2.id FROM ${SC}.Loans l1 JOIN ${SC}.Loans l2 ON l2.BorrowerId = l1.BorrowerId
        WHERE l1.id = @l ORDER BY l2.BorrowDate DESC`,
      [P.int("l", q.loanId)], { maxRows: 200 },
    );
    return rows.map((r) => num(r.id)).filter(Boolean);
  }
  if (q.loanId) return [q.loanId];
  return [];
}

// ── Source: CollectBox.CallLogs ──────────────────────────────────────────────

async function readCalls(org: OrgDef, idList: string, since: Date, limit: number): Promise<Interaction[]> {
  const rows = await cbQuery<Record<string, unknown>>(
    org,
    `SELECT TOP (@limit) cl.ID, cl.RecordID, cl.PhoneNumber, cl.CreatedDate, cl.CallResponse, cl.CallStatus,
            cl.PromisedAmount, cl.PromisedDate, cl.Comments, cl.CallDuration,
            um.FirstName, um.OtherName, um.RoleID
       FROM ${CB}.CallLogs cl
       LEFT JOIN ${CB}.UserMaster um ON um.ID = cl.CreatedBy
      WHERE cl.RecordID IN (${idList}) AND cl.CreatedDate >= @since
      ORDER BY cl.CreatedDate DESC`,
    [P.int("limit", limit), P.date("since", since)], { timeoutMs: 25000, maxRows: limit },
  );

  return rows.map((r): Interaction => {
    const d = disposition(num(r.CallResponse));
    const promised = num(r.PromisedAmount);
    const agent = [str(r.FirstName), str(r.OtherName)].filter(Boolean).join(" ") || "Agent";
    const tags = ["Call"];
    const dur = str(r.CallDuration);
    if (dur && dur !== "00:00:00") tags.push(dur);
    return {
      id: `cb-call-${num(r.ID)}`,
      at: dt(r.CreatedDate) ?? new Date(0),
      source: "collectbox",
      kind: "call",
      actor: { name: agent, role: "Collections agent" },
      subject: { loanId: num(r.RecordID), phone: msisdn(r.PhoneNumber) },
      headline: d?.name ?? (num(r.CallStatus) === 1 ? "Call — contact made" : "Call attempted"),
      detail: str(r.Comments) || (d?.meaning ?? ""),
      amount: promised > 0 ? promised : undefined,
      tone: d ? (d.id === 1 ? "positive" : d.callStatus === 1 ? "neutral" : "warning") : "neutral",
      tags,
      system: SYSTEM_LABEL.collectbox,
    };
  });
}

// ── Source: CollectBox.PayedAmount ───────────────────────────────────────────

async function readPayments(org: OrgDef, idList: string, since: Date, limit: number): Promise<Interaction[]> {
  const rows = await cbQuery<Record<string, unknown>>(
    org,
    `SELECT TOP (@limit) pa.ID, pa.LoanId, pa.AmountPaid, pa.DatePaid, pa.MpesaCode, pa.LoanCategory,
            um.FirstName, um.OtherName
       FROM ${CB}.PayedAmount pa
       LEFT JOIN ${CB}.UserMaster um ON um.ID = pa.AgentId
      WHERE pa.LoanId IN (${idList}) AND pa.DatePaid >= @since
      ORDER BY pa.DatePaid DESC`,
    [P.int("limit", limit), P.date("since", since)], { timeoutMs: 25000, maxRows: limit },
  );

  return rows.map((r): Interaction => {
    const amt = num(r.AmountPaid);
    const cat = category(num(r.LoanCategory));
    const agent = [str(r.FirstName), str(r.OtherName)].filter(Boolean).join(" ");
    const code = str(r.MpesaCode);
    const tags = ["Payment"];
    if (code) tags.push(`M-Pesa ${code}`);
    if (cat) tags.push(cat.name);
    return {
      id: `cb-pay-${num(r.ID)}`,
      at: dt(r.DatePaid) ?? new Date(0),
      source: "collectbox",
      kind: "payment",
      actor: agent ? { name: agent, role: "Collections agent" } : null,
      subject: { loanId: num(r.LoanId) },
      headline: `Paid KES ${amt.toLocaleString("en-KE")}`,
      detail: agent ? `Recovered by ${agent}${cat ? ` from the ${cat.name} queue` : ""}.` : "Payment received.",
      amount: amt,
      tone: "positive",
      tags,
      system: SYSTEM_LABEL.collectbox,
    };
  });
}

// ── Source: CollectBox.PromisedToPay ─────────────────────────────────────────

async function readPromises(org: OrgDef, idList: string, since: Date, limit: number): Promise<Interaction[]> {
  const rows = await cbQuery<Record<string, unknown>>(
    org,
    `SELECT TOP (@limit) p.ID, p.RecordID, p.PromisedAmount, p.PromisedDate, p.PaymentStatus,
            p.AmountPaid, p.CreatedDate, p.Dateofpayment,
            um.FirstName, um.OtherName
       FROM ${CB}.PromisedToPay p
       LEFT JOIN ${CB}.UserMaster um ON um.ID = p.CreatedBy
      WHERE p.RecordID IN (${idList}) AND p.CreatedDate >= @since
      ORDER BY p.CreatedDate DESC`,
    [P.int("limit", limit), P.date("since", since)], { timeoutMs: 25000, maxRows: limit },
  );

  return rows.map((r): Interaction => {
    const promised = num(r.PromisedAmount);
    const paid = num(r.AmountPaid);
    const due = dt(r.PromisedDate);
    const state = ptpState(promised, paid, due);
    const agent = [str(r.FirstName), str(r.OtherName)].filter(Boolean).join(" ");
    return {
      id: `cb-ptp-${num(r.ID)}`,
      at: dt(r.CreatedDate) ?? new Date(0),
      source: "collectbox",
      kind: "ptp",
      actor: agent ? { name: agent, role: "Collections agent" } : null,
      subject: { loanId: num(r.RecordID) },
      headline: `Promised KES ${promised.toLocaleString("en-KE")}${due ? ` by ${due.toLocaleDateString("en-KE")}` : ""}`,
      detail: paid > 0
        ? `KES ${paid.toLocaleString("en-KE")} received against this promise.`
        : "No payment recorded against this promise yet.",
      amount: promised,
      tone: state.key === "kept" ? "positive" : state.key === "broken" ? "negative" : state.key === "partial" ? "warning" : "neutral",
      tags: ["Promise", state.label],
      system: SYSTEM_LABEL.collectbox,
    };
  });
}

// ── Source: CollectBox.TaskScheduler ─────────────────────────────────────────

async function readTasks(org: OrgDef, idList: string, since: Date, limit: number): Promise<Interaction[]> {
  const rows = await cbQuery<Record<string, unknown>>(
    org,
    `SELECT TOP (@limit) t.ID, t.RecordId, t.TaskAction, t.TaskDate, t.CreatedDate, t.Comments, t.IsActive,
            ta.ActionName, um.FirstName, um.OtherName
       FROM ${CB}.TaskScheduler t
       LEFT JOIN ${CB}.TaskAction ta ON ta.ID = t.TaskAction
       LEFT JOIN ${CB}.UserMaster um ON um.ID = t.CreatedBy
      WHERE t.RecordId IN (${idList}) AND t.CreatedDate >= @since
      ORDER BY t.CreatedDate DESC`,
    [P.int("limit", limit), P.date("since", since)], { timeoutMs: 25000, maxRows: limit },
  );

  return rows.map((r): Interaction => {
    const when = dt(r.TaskDate);
    const agent = [str(r.FirstName), str(r.OtherName)].filter(Boolean).join(" ");
    const action = str(r.ActionName) || "Task";
    const open = num(r.IsActive) === 1;
    return {
      id: `cb-task-${num(r.ID)}`,
      at: dt(r.CreatedDate) ?? new Date(0),
      source: "collectbox",
      kind: num(r.TaskAction) === 3 ? "visit" : "task",
      actor: agent ? { name: agent, role: "Collections agent" } : null,
      subject: { loanId: num(r.RecordId) },
      headline: `${action}${when ? ` — ${when.toLocaleDateString("en-KE")}` : ""}`,
      detail: str(r.Comments) || (open ? "Scheduled and still open." : "Closed."),
      tone: open ? "neutral" : "positive",
      tags: ["Task", open ? "Open" : "Closed"],
      system: SYSTEM_LABEL.collectbox,
    };
  });
}

// ── Source: CollectBox.SMS ───────────────────────────────────────────────────

async function readSms(org: OrgDef, idList: string, since: Date, limit: number): Promise<Interaction[]> {
  const rows = await cbQuery<Record<string, unknown>>(
    org,
    `SELECT TOP (@limit) s.ID, s.RecordID, s.Phone, s.Message, s.CreatedDate, s.DateSend, s.isSent, s.ResponseStatus, s.cost
       FROM ${CB}.SMS s
      WHERE s.RecordID IN (${idList}) AND s.CreatedDate >= @since
      ORDER BY s.CreatedDate DESC`,
    [P.int("limit", limit), P.date("since", since)], { timeoutMs: 25000, maxRows: limit },
  );

  return rows.map((r): Interaction => {
    const sent = num(r.isSent) === 1;
    const body = str(r.Message);
    return {
      id: `cb-sms-${num(r.ID)}`,
      at: dt(r.DateSend) ?? dt(r.CreatedDate) ?? new Date(0),
      source: "collectbox",
      kind: "sms",
      actor: null,
      subject: { loanId: num(r.RecordID), phone: msisdn(r.Phone) },
      headline: sent ? "SMS delivered" : "SMS queued",
      detail: body.length > 240 ? `${body.slice(0, 237)}…` : body,
      tone: sent ? "neutral" : "warning",
      tags: ["SMS", str(r.ResponseStatus) || (sent ? "Sent" : "Pending")].filter(Boolean),
      system: SYSTEM_LABEL.collectbox,
    };
  });
}

// ── Source: Serviceconnect.Loans ─────────────────────────────────────────────

async function readLoanEvents(org: OrgDef, idList: string, since: Date): Promise<Interaction[]> {
  const rows = await cbQuery<Record<string, unknown>>(
    org,
    `SELECT l.id, l.BorrowerId, l.LoanAmount, l.Principal, l.LoanBalance, l.BorrowDate,
            l.LoanDisbursmentDate, l.DateCleared, l.LoanCleared, l.EntityId, l.ExpectedClearDate,
            p.ProductName, um.FirstName, um.OtherName
       FROM ${SC}.Loans l
       LEFT JOIN ${SC}.Products p   ON p.ID = l.ProductId
       LEFT JOIN ${SC}.UserMaster um ON um.ID = l.CreatedBy
      WHERE l.id IN (${idList})
      ORDER BY l.BorrowDate DESC`,
    [], { timeoutMs: 25000, maxRows: 200 },
  );

  const out: Interaction[] = [];
  for (const r of rows) {
    const id = num(r.id);
    const amount = num(r.LoanAmount);
    const product = str(r.ProductName) || "Loan";
    const officer = [str(r.FirstName), str(r.OtherName)].filter(Boolean).join(" ");
    const borrowedAt = dt(r.LoanDisbursmentDate) ?? dt(r.BorrowDate);
    const due = dt(r.ExpectedClearDate);

    if (borrowedAt && borrowedAt >= since) {
      out.push({
        id: `sc-loan-${id}`,
        at: borrowedAt,
        source: "serviceconnect",
        kind: "loan",
        actor: officer ? { name: officer, role: "Relationship officer" } : null,
        subject: { loanId: id, borrowerId: num(r.BorrowerId) },
        headline: `${product} disbursed — KES ${amount.toLocaleString("en-KE")}`,
        detail: due ? `Due ${due.toLocaleDateString("en-KE")}. Booked in entity ${num(r.EntityId)}.` : `Booked in entity ${num(r.EntityId)}.`,
        amount,
        tone: "neutral",
        tags: ["Loan", product, `Entity ${num(r.EntityId)}`],
        system: SYSTEM_LABEL.serviceconnect,
      });
    }

    const clearedAt = dt(r.DateCleared);
    if (num(r.LoanCleared) === 1 && clearedAt && clearedAt >= since) {
      out.push({
        id: `sc-cleared-${id}`,
        at: clearedAt,
        source: "serviceconnect",
        kind: "cleared",
        actor: null,
        subject: { loanId: id, borrowerId: num(r.BorrowerId) },
        headline: `${product} cleared in full`,
        detail: `KES ${amount.toLocaleString("en-KE")} repaid. The account is settled.`,
        amount,
        tone: "positive",
        tags: ["Cleared", product],
        system: SYSTEM_LABEL.serviceconnect,
      });
    }
  }
  return out;
}

// ── Source: our own DeskInteraction ──────────────────────────────────────────

const DESK_TONE: Record<string, Interaction["tone"]> = {
  PTP: "positive", CALL: "neutral", NOTE: "neutral", TASK: "neutral",
  SMS: "neutral", ASSIGN: "neutral", ESCALATE: "warning", PIPELINE: "positive",
};

const DESK_KIND: Record<string, InteractionKind> = {
  CALL: "call", PTP: "ptp", NOTE: "note", TASK: "task",
  SMS: "sms", ASSIGN: "assign", ESCALATE: "escalate", PIPELINE: "pipeline",
};

async function readDeskInteractions(orgId: string | undefined, loanIds: number[], since: Date, limit: number): Promise<Interaction[]> {
  const rows = await withTenant(orgId, () =>
    prisma.deskInteraction.findMany({
      where: { liveLoanId: { in: loanIds }, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  );

  return rows.map((r): Interaction => {
    const d = r.dispositionId ? disposition(r.dispositionId) : null;
    const cat = r.categoryId ? category(r.categoryId) : null;
    const tags = [r.kind === "PIPELINE" ? "Pipeline" : "ConnectDesk"];
    if (cat) tags.push(cat.name);
    if (d) tags.push(d.name);
    // The shadow badge is not a footnote. A supervisor reading this timeline has
    // to be able to tell an action that reached Micromart's systems from one
    // that is recorded only here.
    if (r.mirrorState === "SHADOW" && r.shadowSql) tags.push("Shadow");
    if (r.mirrorState === "FAILED") tags.push("Mirror failed");
    if (r.mirrorState === "MIRRORED") tags.push("Mirrored");

    return {
      id: `desk-${r.id}`,
      at: r.createdAt,
      source: r.kind === "PIPELINE" ? "pipeline" : (r.source as InteractionSource) || "desk",
      kind: DESK_KIND[r.kind] ?? "note",
      actor: { name: r.actorName, role: "Collections agent" },
      subject: {
        loanId: r.liveLoanId,
        borrowerId: r.liveBorrowerId ?? undefined,
        name: r.subjectName ?? undefined,
        phone: r.subjectPhone ?? undefined,
      },
      headline: r.headline,
      detail: r.detail ?? "",
      amount: r.amount ? Number(r.amount) : undefined,
      tone: r.mirrorState === "FAILED" ? "negative" : (DESK_TONE[r.kind] ?? "neutral"),
      tags,
      system: r.kind === "PIPELINE" ? SYSTEM_LABEL.pipeline : SYSTEM_LABEL.desk,
    };
  });
}

// ── The cross-system activity feed ───────────────────────────────────────────

export type FeedItem = Interaction & { subjectLabel: string };

/**
 * The whole floor's activity, newest first — not one customer's.
 *
 * This is what the ConnectDesk wall board and the `/suite` launcher's live rail
 * read. It answers "what is happening in this business right now" across systems,
 * which is a question no screen Micromart currently owns can answer at all.
 */
export async function getActivityFeed(org: OrgDef, opts: { limit?: number; agentId?: number; orgId?: string } = {}): Promise<FeedItem[]> {
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 200);
  const agentFilter = opts.agentId ? `AND pa.AgentId = ${Math.trunc(opts.agentId)}` : "";
  const callFilter = opts.agentId ? `AND cl.CreatedBy = ${Math.trunc(opts.agentId)}` : "";

  const settled = await Promise.allSettled([
    // Recent recoveries — the live money feed.
    cbQuery<Record<string, unknown>>(
      org,
      `SELECT TOP (@limit) pa.ID, pa.LoanId, pa.AmountPaid, pa.DatePaid, pa.MpesaCode, pa.LoanCategory,
              um.FirstName, um.OtherName, b.firstName AS bFirst, b.otherName AS bOther, b.PhoneNumber, l.EntityId
         FROM ${CB}.PayedAmount pa
         LEFT JOIN ${CB}.UserMaster um ON um.ID = pa.AgentId
         JOIN ${SC}.Loans l     ON l.id = pa.LoanId
         JOIN ${SC}.Borrowers b ON b.ID = l.BorrowerId
        WHERE pa.DatePaid > DATEADD(day,-3,GETDATE()) ${agentFilter}
        ORDER BY pa.DatePaid DESC`,
      [P.int("limit", limit)], { timeoutMs: 30000, maxRows: limit },
    ),
    // Recent dispositions.
    cbQuery<Record<string, unknown>>(
      org,
      `SELECT TOP (@limit) cl.ID, cl.RecordID, cl.CreatedDate, cl.CallResponse, cl.Comments, cl.PromisedAmount,
              um.FirstName, um.OtherName, b.firstName AS bFirst, b.otherName AS bOther, b.PhoneNumber, l.EntityId
         FROM ${CB}.CallLogs cl
         LEFT JOIN ${CB}.UserMaster um ON um.ID = cl.CreatedBy
         JOIN ${SC}.Loans l     ON l.id = cl.RecordID
         JOIN ${SC}.Borrowers b ON b.ID = l.BorrowerId
        WHERE cl.CreatedDate > DATEADD(day,-30,GETDATE()) ${callFilter}
        ORDER BY cl.CreatedDate DESC`,
      [P.int("limit", limit)], { timeoutMs: 30000, maxRows: limit },
    ),
    // Recent disbursements — including the Fintech book.
    cbQuery<Record<string, unknown>>(
      org,
      `SELECT TOP (@limit) l.id, l.LoanAmount, l.LoanDisbursmentDate, l.BorrowDate, l.EntityId,
              p.ProductName, b.firstName AS bFirst, b.otherName AS bOther, b.PhoneNumber,
              um.FirstName, um.OtherName
         FROM ${SC}.Loans l
         JOIN ${SC}.Borrowers b ON b.ID = l.BorrowerId
         LEFT JOIN ${SC}.Products p    ON p.ID = l.ProductId
         LEFT JOIN ${SC}.UserMaster um ON um.ID = l.CreatedBy
        WHERE l.BorrowDate > DATEADD(day,-7,GETDATE())
        ORDER BY l.BorrowDate DESC`,
      [P.int("limit", limit)], { timeoutMs: 30000, maxRows: limit },
    ),
    withTenant(opts.orgId, () => prisma.deskInteraction.findMany({ orderBy: { createdAt: "desc" }, take: limit })),
  ]);

  const out: FeedItem[] = [];
  const nameOf = (r: Record<string, unknown>) =>
    [str(r.bFirst), str(r.bOther)].filter(Boolean).join(" ") || "Customer";

  if (settled[0].status === "fulfilled") {
    for (const r of settled[0].value as Record<string, unknown>[]) {
      const amt = num(r.AmountPaid);
      const cat = category(num(r.LoanCategory));
      const agent = [str(r.FirstName), str(r.OtherName)].filter(Boolean).join(" ");
      out.push({
        id: `feed-pay-${num(r.ID)}`, at: dt(r.DatePaid) ?? new Date(0),
        source: "collectbox", kind: "payment",
        actor: agent ? { name: agent, role: "Collections agent" } : null,
        subject: { loanId: num(r.LoanId), name: nameOf(r), phone: msisdn(r.PhoneNumber) },
        subjectLabel: nameOf(r),
        headline: `Paid KES ${amt.toLocaleString("en-KE")}`,
        detail: agent ? `Recovered by ${agent}.` : "Payment received.",
        amount: amt, tone: "positive",
        tags: ["Payment", str(r.MpesaCode), cat?.name].filter(Boolean) as string[],
        system: SYSTEM_LABEL.collectbox,
      });
    }
  }

  if (settled[1].status === "fulfilled") {
    for (const r of settled[1].value as Record<string, unknown>[]) {
      const d = disposition(num(r.CallResponse));
      const agent = [str(r.FirstName), str(r.OtherName)].filter(Boolean).join(" ");
      out.push({
        id: `feed-call-${num(r.ID)}`, at: dt(r.CreatedDate) ?? new Date(0),
        source: "collectbox", kind: "call",
        actor: agent ? { name: agent, role: "Collections agent" } : null,
        subject: { loanId: num(r.RecordID), name: nameOf(r), phone: msisdn(r.PhoneNumber) },
        subjectLabel: nameOf(r),
        headline: d?.name ?? "Call logged",
        detail: str(r.Comments),
        amount: num(r.PromisedAmount) || undefined,
        tone: d ? (d.id === 1 ? "positive" : d.callStatus === 1 ? "neutral" : "warning") : "neutral",
        tags: ["Call"],
        system: SYSTEM_LABEL.collectbox,
      });
    }
  }

  if (settled[2].status === "fulfilled") {
    for (const r of settled[2].value as Record<string, unknown>[]) {
      const amt = num(r.LoanAmount);
      const officer = [str(r.FirstName), str(r.OtherName)].filter(Boolean).join(" ");
      const entity = num(r.EntityId);
      out.push({
        id: `feed-loan-${num(r.id)}`, at: dt(r.LoanDisbursmentDate) ?? dt(r.BorrowDate) ?? new Date(0),
        source: "serviceconnect", kind: "loan",
        actor: officer ? { name: officer, role: "Relationship officer" } : null,
        subject: { loanId: num(r.id), name: nameOf(r), phone: msisdn(r.PhoneNumber) },
        subjectLabel: nameOf(r),
        headline: `${str(r.ProductName) || "Loan"} — KES ${amt.toLocaleString("en-KE")}`,
        detail: `Disbursed in entity ${entity}${entity === 3005 ? " (Micromart Fintech)" : ""}.`,
        amount: amt, tone: "neutral",
        tags: ["Disbursed", `Entity ${entity}`],
        system: SYSTEM_LABEL.serviceconnect,
      });
    }
  }

  if (settled[3].status === "fulfilled") {
    for (const r of settled[3].value) {
      out.push({
        id: `feed-desk-${r.id}`, at: r.createdAt,
        source: r.kind === "PIPELINE" ? "pipeline" : "desk",
        kind: DESK_KIND[r.kind] ?? "note",
        actor: { name: r.actorName, role: "Collections agent" },
        subject: { loanId: r.liveLoanId, name: r.subjectName ?? undefined, phone: r.subjectPhone ?? undefined },
        subjectLabel: r.subjectName ?? `Loan #${r.liveLoanId}`,
        headline: r.headline, detail: r.detail ?? "",
        amount: r.amount ? Number(r.amount) : undefined,
        tone: r.mirrorState === "FAILED" ? "negative" : (DESK_TONE[r.kind] ?? "neutral"),
        tags: [r.kind === "PIPELINE" ? "Pipeline" : "ConnectDesk", r.mirrorState === "SHADOW" && r.shadowSql ? "Shadow" : ""].filter(Boolean),
        system: r.kind === "PIPELINE" ? SYSTEM_LABEL.pipeline : SYSTEM_LABEL.desk,
      });
    }
  }

  return out.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}
