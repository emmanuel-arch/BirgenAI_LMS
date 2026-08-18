// ─────────────────────────────────────────────────────────────────────────────
// THE FLOOR — the people on it, and what they actually did today.
//
// ── THE ROSETTA STONE ────────────────────────────────────────────────────────
// A collections agent exists three times on this server and nothing joined the
// three up until now:
//
//   CollectBox.dbo.UserMaster      — who they are on the call floor
//   Serviceconnect.dbo.UserMaster  — who they are in the lending system
//   Serviceconnect.dbo.CollectionAgents — the ONLY table carrying both ids
//         .CollectBoxRef → CollectBox.dbo.UserMaster.ID
//         .AgentRef      → Serviceconnect.dbo.UserMaster.ID
//
// That table is why ConnectDesk can say "Mercy Kaitano" and the Lending Console
// can say "Mercy Kaitano" and both mean the same employee — which is the whole
// premise of a connected suite and is otherwise just an assertion.
//
// It is also incompletely populated: most rows carry `CollectBoxRef = 0`. So the
// resolution below falls back to matching on normalised phone number and then on
// email, in that order, and REPORTS which method it used. A silent fuzzy match
// between two staff directories is how one agent's commission ends up on another
// agent's payslip, so the method is carried on the record rather than hidden.
//
// ── WHAT "PERFORMANCE" MEANS HERE ────────────────────────────────────────────
// Three different numbers get called "collections" and they measure different
// things. This module keeps them apart:
//
//   · RECOVERED — money that actually landed (PayedAmount, agent-attributed,
//     M-Pesa referenced). This is the only one that is cash.
//   · PROMISED  — what was committed to on calls. A forecast, not a fact.
//   · CONTACT   — how many dials reached a human. The leading indicator; it is
//     the only one an agent fully controls, and it is what you coach on.
//
// A dashboard that adds them together, or shows only the first, is why floors
// end up managed by anecdote.
// ─────────────────────────────────────────────────────────────────────────────

import type { OrgDef } from "@/lib/enterprise/connections";
import { CB, SC, cbQuery, cbOne, num, str, dt, msisdn, P } from "./client";
import { CONTACT_MADE, category, type Category } from "./taxonomy";

export type Agent = {
  /** CollectBox.dbo.UserMaster.ID — the id every collections fact is keyed by. */
  id: number;
  name: string;
  username: string;
  phone: string;
  email: string;
  /** 3 = Super Administrator, 4 = Agent, 5 = Branch manager, 6 = Agent 1. */
  roleId: number;
  role: string;
  entityId: number;
  /** The same human in the lending system, when we can prove it. */
  lms: { userId: number; name: string } | null;
  /** How that link was established — never hidden. */
  linkedBy: "collectbox-ref" | "phone" | "email" | null;
  active: boolean;
};

const ROLES: Record<number, string> = {
  3: "Super Administrator",
  4: "Agent",
  5: "Branch manager",
  6: "Agent 1",
};

/**
 * Every agent on the floor, linked to their lending-system identity where that
 * link can be established honestly.
 */
export async function listAgents(org: OrgDef): Promise<Agent[]> {
  const [cbUsers, links] = await Promise.all([
    cbQuery<Record<string, unknown>>(
      org,
      `SELECT ID, Username, FirstName, OtherName, PhoneNumber, Email, RoleID, EntityId, UserStatus, IsLocked
         FROM ${CB}.UserMaster ORDER BY FirstName, OtherName`,
      [], { maxRows: 500 },
    ),
    cbQuery<Record<string, unknown>>(
      org,
      `SELECT ca.ID, ca.AgentName, ca.AgentPhoneNo, ca.AgentEmail, ca.AgentRef, ca.CollectBoxRef, ca.AgentStatus,
              um.ID AS lmsId, um.FirstName AS lmsFirst, um.OtherName AS lmsOther
         FROM ${SC}.CollectionAgents ca
         LEFT JOIN ${SC}.UserMaster um ON um.ID = ca.AgentRef
        WHERE ca.AgentStatus = 1`,
      [], { maxRows: 500 },
    ),
  ]);

  // Three indexes, consulted in order of trustworthiness.
  const byRef = new Map<number, Record<string, unknown>>();
  const byPhone = new Map<string, Record<string, unknown>>();
  const byEmail = new Map<string, Record<string, unknown>>();
  for (const l of links) {
    const ref = num(l.CollectBoxRef);
    if (ref > 0) byRef.set(ref, l);
    const ph = msisdn(l.AgentPhoneNo);
    if (ph) byPhone.set(ph, l);
    const em = str(l.AgentEmail).toLowerCase();
    if (em) byEmail.set(em, l);
  }

  return cbUsers.map((u): Agent => {
    const id = num(u.ID);
    const phone = msisdn(u.PhoneNumber);
    const email = str(u.Email).toLowerCase();

    let link = byRef.get(id) ?? null;
    let linkedBy: Agent["linkedBy"] = link ? "collectbox-ref" : null;
    if (!link && phone) { link = byPhone.get(phone) ?? null; if (link) linkedBy = "phone"; }
    if (!link && email) { link = byEmail.get(email) ?? null; if (link) linkedBy = "email"; }

    const lmsId = link ? num(link.lmsId) : 0;
    const roleId = num(u.RoleID);

    return {
      id,
      name: [str(u.FirstName), str(u.OtherName)].filter(Boolean).join(" ") || str(u.Username),
      username: str(u.Username),
      phone,
      email: str(u.Email),
      roleId,
      role: ROLES[roleId] ?? "Staff",
      entityId: num(u.EntityId),
      lms: lmsId > 0
        ? { userId: lmsId, name: [str(link!.lmsFirst), str(link!.lmsOther)].filter(Boolean).join(" ") || str(link!.AgentName) }
        : null,
      linkedBy: lmsId > 0 ? linkedBy : null,
      active: num(u.IsLocked) !== 1,
    };
  });
}

// ── Performance ──────────────────────────────────────────────────────────────

export type AgentScore = {
  agentId: number;
  name: string;
  /** Loans currently sitting in this agent's queue. */
  assigned: number;
  assignedOlb: number;
  /** Cash that landed against this agent's loans in the window. */
  recovered: number;
  payments: number;
  /** Distinct loans that paid anything at all. */
  loansPaying: number;
  /** Calls logged in the window. */
  calls: number;
  contacts: number;
  contactRate: number;
  /** Promises taken, and what they were worth. */
  promises: number;
  promisedValue: number;
  /** Commission earned, computed from each loan's band rate. */
  commission: number;
  /** Recovery as a share of the book this agent carries. */
  recoveryRate: number;
  lastActivityAt: Date | null;
};

export type Window = "today" | "7d" | "30d" | "mtd";

const WINDOW_SQL: Record<Window, string> = {
  today: "CAST(GETDATE() AS date)",
  "7d": "DATEADD(day,-7,GETDATE())",
  "30d": "DATEADD(day,-30,GETDATE())",
  mtd: "DATEADD(day, 1-DAY(GETDATE()), CAST(GETDATE() AS date))",
};

export const WINDOW_LABEL: Record<Window, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  mtd: "Month to date",
};

/**
 * The leaderboard.
 *
 * Commission is computed here rather than read, because `LoanCategories.Commision`
 * is a rate per BAND (Watch 2 pays 1.2%, NPL pays 10%) and the money table records
 * which band each payment was recovered from. So the honest figure is a weighted
 * sum over the payments, not a single rate applied to a total — an agent who
 * recovers 100,000 out of NPL has earned five times what an agent who recovers
 * 100,000 out of Watch 1 has earned, and a flat calculation erases that entirely.
 */
export async function getLeaderboard(org: OrgDef, window: Window = "today"): Promise<AgentScore[]> {
  const since = WINDOW_SQL[window];

  const [money, calls, load, names] = await Promise.all([
    cbQuery<{ AgentId: number; LoanCategory: number; n: number; amt: number; loans: number; last: Date }>(
      org,
      `SELECT AgentId, LoanCategory, COUNT(*) AS n, SUM(CAST(AmountPaid AS decimal(18,2))) AS amt,
              COUNT(DISTINCT LoanId) AS loans, MAX(DatePaid) AS last
         FROM ${CB}.PayedAmount
        WHERE DatePaid >= ${since}
        GROUP BY AgentId, LoanCategory`,
      [], { timeoutMs: 30000, maxRows: 2000 },
    ),
    cbQuery<{ CreatedBy: number; calls: number; contacts: number; promises: number; promisedValue: number; last: Date }>(
      org,
      `SELECT CreatedBy, COUNT(*) AS calls,
              SUM(CASE WHEN CallResponse IN (${CONTACT_MADE.join(",")}) THEN 1 ELSE 0 END) AS contacts,
              SUM(CASE WHEN CallResponse = 1 THEN 1 ELSE 0 END) AS promises,
              SUM(CASE WHEN CallResponse = 1 THEN CAST(COALESCE(PromisedAmount,0) AS decimal(18,2)) ELSE 0 END) AS promisedValue,
              MAX(CreatedDate) AS last
         FROM ${CB}.CallLogs
        WHERE CreatedDate >= ${since}
        GROUP BY CreatedBy`,
      [], { timeoutMs: 30000, maxRows: 500 },
    ),
    cbQuery<{ AgentAssigned: number; assigned: number; olb: number }>(
      org,
      `SELECT ct.AgentAssigned, COUNT(*) AS assigned,
              SUM(CAST(COALESCE(l.LoanBalance,0) AS decimal(18,2))) AS olb
         FROM ${CB}.CollectionTracker ct
         JOIN ${SC}.Loans l ON l.id = ct.LoanId
        WHERE ct.IsAgentAssigned = 1
        GROUP BY ct.AgentAssigned`,
      [], { timeoutMs: 40000, maxRows: 500 },
    ),
    cbQuery<{ ID: number; FirstName: string; OtherName: string; Username: string }>(
      org, `SELECT ID, FirstName, OtherName, Username FROM ${CB}.UserMaster`, [], { maxRows: 500 },
    ),
  ]);

  const nameOf = new Map<number, string>();
  for (const n of names) {
    nameOf.set(num(n.ID), [str(n.FirstName), str(n.OtherName)].filter(Boolean).join(" ") || str(n.Username) || `Agent ${num(n.ID)}`);
  }

  const acc = new Map<number, AgentScore>();
  const seat = (id: number): AgentScore => {
    let s = acc.get(id);
    if (!s) {
      s = {
        agentId: id, name: nameOf.get(id) ?? `Agent ${id}`,
        assigned: 0, assignedOlb: 0, recovered: 0, payments: 0, loansPaying: 0,
        calls: 0, contacts: 0, contactRate: 0, promises: 0, promisedValue: 0,
        commission: 0, recoveryRate: 0, lastActivityAt: null,
      };
      acc.set(id, s);
    }
    return s;
  };
  const touch = (s: AgentScore, when: Date | null) => {
    if (when && (!s.lastActivityAt || when > s.lastActivityAt)) s.lastActivityAt = when;
  };

  for (const m of money) {
    const s = seat(num(m.AgentId));
    const amt = num(m.amt);
    s.recovered += amt;
    s.payments += num(m.n);
    s.loansPaying += num(m.loans);
    const cat: Category | null = category(num(m.LoanCategory));
    s.commission += amt * ((cat?.commission ?? 0) / 100);
    touch(s, dt(m.last));
  }
  for (const c of calls) {
    const s = seat(num(c.CreatedBy));
    s.calls += num(c.calls);
    s.contacts += num(c.contacts);
    s.promises += num(c.promises);
    s.promisedValue += num(c.promisedValue);
    touch(s, dt(c.last));
  }
  for (const l of load) {
    const s = seat(num(l.AgentAssigned));
    s.assigned = num(l.assigned);
    s.assignedOlb = num(l.olb);
  }

  for (const s of acc.values()) {
    s.contactRate = s.calls > 0 ? (s.contacts / s.calls) * 100 : 0;
    s.recoveryRate = s.assignedOlb > 0 ? (s.recovered / s.assignedOlb) * 100 : 0;
  }

  return [...acc.values()]
    .filter((s) => s.agentId > 0 && (s.recovered > 0 || s.calls > 0 || s.assigned > 0))
    .sort((a, b) => b.recovered - a.recovered || b.calls - a.calls);
}

/** One agent's numbers, for their own screen. */
export async function getAgentScore(org: OrgDef, agentId: number, window: Window = "today"): Promise<AgentScore | null> {
  const board = await getLeaderboard(org, window);
  return board.find((s) => s.agentId === agentId) ?? null;
}

// ── The pulse — what the floor is doing, hour by hour ────────────────────────

export type PulsePoint = { hour: number; recovered: number; payments: number; calls: number; agents: number };

/**
 * Today, by hour. This is the shape a floor manager reads at a glance: where the
 * morning went, whether the after-lunch dip happened again, and whether the last
 * hour is worth extending.
 */
export async function getFloorPulse(org: OrgDef): Promise<PulsePoint[]> {
  const [pay, call] = await Promise.all([
    cbQuery<{ h: number; amt: number; n: number; agents: number }>(
      org,
      `SELECT DATEPART(hour, DatePaid) AS h, SUM(CAST(AmountPaid AS decimal(18,2))) AS amt,
              COUNT(*) AS n, COUNT(DISTINCT AgentId) AS agents
         FROM ${CB}.PayedAmount WHERE DatePaid >= CAST(GETDATE() AS date)
        GROUP BY DATEPART(hour, DatePaid)`,
      [], { maxRows: 24 },
    ),
    cbQuery<{ h: number; n: number }>(
      org,
      `SELECT DATEPART(hour, CreatedDate) AS h, COUNT(*) AS n
         FROM ${CB}.CallLogs WHERE CreatedDate >= CAST(GETDATE() AS date)
        GROUP BY DATEPART(hour, CreatedDate)`,
      [], { maxRows: 24 },
    ),
  ]);

  const out: PulsePoint[] = Array.from({ length: 24 }, (_, hour) => ({ hour, recovered: 0, payments: 0, calls: 0, agents: 0 }));
  for (const p of pay) {
    const h = num(p.h); if (h < 0 || h > 23) continue;
    out[h].recovered = num(p.amt); out[h].payments = num(p.n); out[h].agents = num(p.agents);
  }
  for (const c of call) {
    const h = num(c.h); if (h < 0 || h > 23) continue;
    out[h].calls = num(c.n);
  }
  return out;
}

/** The collections trend, day by day, for the sparkline and the trend panel. */
export async function getDailyTrend(org: OrgDef, days = 30): Promise<{ day: string; recovered: number; payments: number; agents: number }[]> {
  const rows = await cbQuery<{ d: Date; amt: number; n: number; agents: number }>(
    org,
    `SELECT CAST(DatePaid AS date) AS d, SUM(CAST(AmountPaid AS decimal(18,2))) AS amt,
            COUNT(*) AS n, COUNT(DISTINCT AgentId) AS agents
       FROM ${CB}.PayedAmount
      WHERE DatePaid >= DATEADD(day, -@days, CAST(GETDATE() AS date))
      GROUP BY CAST(DatePaid AS date)
      ORDER BY CAST(DatePaid AS date)`,
    [P.int("days", Math.min(Math.max(days, 1), 365))],
    { timeoutMs: 30000, maxRows: 400 },
  );
  return rows.map((r) => ({
    day: (dt(r.d) ?? new Date()).toISOString().slice(0, 10),
    recovered: num(r.amt), payments: num(r.n), agents: num(r.agents),
  }));
}

// ── The phone floor ──────────────────────────────────────────────────────────

export type Extension = { id: number; extension: string; mac: string; status: number; userId: number; agentName: string | null };

/**
 * The physical handsets. Forty-four of them, mapped to agents.
 *
 * ConnectDesk does not dial them — that is the PBX's job — but showing which
 * extension an agent is on is what makes a supervisor able to walk over, and
 * what lets a call recording be traced back to a seat.
 */
export async function listExtensions(org: OrgDef): Promise<Extension[]> {
  const rows = await cbQuery<Record<string, unknown>>(
    org,
    `SELECT e.ID, e.ExtensionID, e.MacAddress, e.Status, e.Userid,
            um.FirstName, um.OtherName
       FROM ${CB}.PBXExtensions e
       LEFT JOIN ${CB}.UserMaster um ON um.ID = e.Userid
      ORDER BY e.ExtensionID`,
    [], { maxRows: 200 },
  );
  return rows.map((r) => ({
    id: num(r.ID),
    extension: str(r.ExtensionID),
    mac: str(r.MacAddress),
    status: num(r.Status),
    userId: num(r.Userid),
    agentName: [str(r.FirstName), str(r.OtherName)].filter(Boolean).join(" ") || null,
  }));
}

/** Recent call detail records — the raw PBX trace, with recordings where present. */
export async function listRecentCdr(org: OrgDef, limit = 50): Promise<{
  id: number; callId: string; from: string; to: string; start: Date | null;
  duration: string; talk: string; status: string; type: string; recording: string;
}[]> {
  const rows = await cbQuery<Record<string, unknown>>(
    org,
    `SELECT TOP (@limit) id, callid, callfrom, callto, timestart, callduraction, talkduraction, status, type, recording
       FROM ${CB}.callcdr ORDER BY timestart DESC`,
    [P.int("limit", Math.min(Math.max(limit, 1), 200))], { maxRows: 200 },
  );
  return rows.map((r) => ({
    id: num(r.id), callId: str(r.callid), from: str(r.callfrom), to: str(r.callto),
    start: dt(r.timestart), duration: str(r.callduraction), talk: str(r.talkduraction),
    status: str(r.status), type: str(r.type), recording: str(r.recording),
  }));
}

/** Is anybody actually working right now? Drives the "live floor" indicator. */
export async function getLiveActivity(org: OrgDef): Promise<{ activeAgents: number; lastEventAt: Date | null; eventsLastHour: number }> {
  const row = await cbOne<{ agents: number; last: Date; n: number }>(
    org,
    `SELECT COUNT(DISTINCT AgentId) AS agents, MAX(DatePaid) AS last, COUNT(*) AS n
       FROM ${CB}.PayedAmount WHERE DatePaid > DATEADD(hour,-1,GETDATE())`,
  );
  return { activeAgents: num(row?.agents), lastEventAt: dt(row?.last), eventsLastHour: num(row?.n) };
}
