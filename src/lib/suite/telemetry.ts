// ─────────────────────────────────────────────────────────────────────────────
// SUITE TELEMETRY — one live number per system, read at request time.
//
// ── WHY THE LAUNCHER NEEDS THIS ──────────────────────────────────────────────
// A launcher with six cards is a menu. A launcher whose six cards each carry a
// number that was true thirty seconds ago is a demonstration that all six are
// connected to the same nervous system — which is the entire claim.
//
// So every tile here is READ, not written down:
//
//   Lending Console   the live book — borrowers and OLB from Serviceconnect
//   Customer Portal   loans disbursed today, the customer-facing surface
//   Analytics Studio  the whole group's outstanding balance
//   ConnectDesk       cash recovered today and agents on the floor, CollectBox
//   PeopleHub         the staff directory, from UserMaster + CollectionAgents
//   Ledgerly          money that moved today, from the payments ledger
//
// ── DEGRADATION IS PART OF THE DESIGN ────────────────────────────────────────
// This runs on a launcher, which is the first screen anyone sees. If the SQL
// Server is unreachable — a Tailscale drop, a restart — the launcher must still
// render six doors. Every probe is settled independently and a failed one
// returns `null`, which the UI renders as "—" rather than as a zero. A zero and
// a failure look identical on a tile and mean opposite things.
// ─────────────────────────────────────────────────────────────────────────────

import { collectBoxOrg, CB, SC, cbOne, num, dt } from "@/lib/collectbox/client";

export type SystemPulse = {
  id: string;
  /** The headline figure, already formatted for display. */
  value: string | null;
  /** What it is. */
  label: string;
  /** A second, smaller line. */
  detail: string | null;
  /** Where it came from — shown as provenance. */
  source: string;
};

export type SuiteTelemetry = {
  systems: SystemPulse[];
  /** The cross-system flows drawn on the pipeline diagram. */
  flows: { from: string; to: string; label: string; value: string | null; live: boolean }[];
  /** Micromart Fintech's position — the demo's subject. */
  fintech: {
    borrowers: number | null;
    loansOpen: number | null;
    olb: number | null;
    disbursedToday: number | null;
    trackedInCollectBox: number | null;
  };
  /** Proof of liveness. */
  lastEventAt: string | null;
  /** True when nothing could be read at all. */
  offline: boolean;
  readMs: number;
};

const KES = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return Math.round(n).toLocaleString("en-KE");
};
const N = (n: number) => Math.round(n).toLocaleString("en-KE");

export async function getSuiteTelemetry(): Promise<SuiteTelemetry> {
  const started = Date.now();

  let org;
  try {
    org = collectBoxOrg("micromart");
  } catch {
    return offlineResult(Date.now() - started);
  }

  // Five probes, issued together, each allowed to fail on its own.
  const [book, desk, fintech, people, money] = await Promise.allSettled([
    cbOne<{ borrowers: number; loans: number; olb: number; disbursedToday: number }>(
      org,
      `SELECT (SELECT COUNT(*) FROM ${SC}.Borrowers WHERE EntityId IN (3002,3005)) AS borrowers,
              (SELECT COUNT(*) FROM ${SC}.Loans WHERE EntityId IN (3002,3005) AND LoanCleared = 0) AS loans,
              (SELECT SUM(CAST(COALESCE(LoanBalance,0) AS decimal(18,2))) FROM ${SC}.Loans
                WHERE EntityId IN (3002,3005) AND LoanCleared = 0) AS olb,
              (SELECT COUNT(*) FROM ${SC}.Loans WHERE BorrowDate >= CAST(GETDATE() AS date)) AS disbursedToday`,
      [], { timeoutMs: 12000 },
    ),
    cbOne<{ recovered: number; agents: number; payments: number; lastAt: Date; tracked: number }>(
      org,
      `SELECT (SELECT SUM(CAST(AmountPaid AS decimal(18,2))) FROM ${CB}.PayedAmount WHERE DatePaid >= CAST(GETDATE() AS date)) AS recovered,
              (SELECT COUNT(DISTINCT AgentId) FROM ${CB}.PayedAmount WHERE DatePaid >= CAST(GETDATE() AS date)) AS agents,
              (SELECT COUNT(*) FROM ${CB}.PayedAmount WHERE DatePaid >= CAST(GETDATE() AS date)) AS payments,
              -- TOP 1 … ORDER BY DESC, not MAX(DatePaid). Same answer; MAX has
              -- no index to lean on over 1.16M payment rows and scans the lot,
              -- measured at 4.5s against 1.2s for this. It is the freshness
              -- stamp on the launcher — the first screen anyone opens — so the
              -- three seconds are the difference between "live" and "loading".
              (SELECT TOP 1 DatePaid FROM ${CB}.PayedAmount ORDER BY DatePaid DESC) AS lastAt,
              (SELECT COUNT(*) FROM ${CB}.CollectionTracker) AS tracked`,
      [], { timeoutMs: 12000 },
    ),
    cbOne<{ borrowers: number; loansOpen: number; olb: number; today: number; tracked: number }>(
      org,
      `SELECT (SELECT COUNT(*) FROM ${SC}.Borrowers WHERE EntityId = 3005) AS borrowers,
              (SELECT COUNT(*) FROM ${SC}.Loans WHERE EntityId = 3005 AND LoanCleared = 0) AS loansOpen,
              (SELECT SUM(CAST(COALESCE(LoanBalance,0) AS decimal(18,2))) FROM ${SC}.Loans
                WHERE EntityId = 3005 AND LoanCleared = 0) AS olb,
              (SELECT COUNT(*) FROM ${SC}.Loans WHERE EntityId = 3005 AND BorrowDate >= CAST(GETDATE() AS date)) AS today,
              (SELECT COUNT(*) FROM ${CB}.CollectionTracker ct JOIN ${SC}.Loans l ON l.id = ct.LoanId
                WHERE l.EntityId = 3005) AS tracked`,
      [], { timeoutMs: 12000 },
    ),
    cbOne<{ staff: number; agents: number; branches: number }>(
      org,
      `SELECT (SELECT COUNT(*) FROM ${SC}.UserMaster WHERE EntityId IN (3002,3005)) AS staff,
              (SELECT COUNT(*) FROM ${CB}.UserMaster) AS agents,
              (SELECT COUNT(DISTINCT EntityUnit) FROM ${SC}.Borrowers WHERE EntityId IN (3002,3005)) AS branches`,
      [], { timeoutMs: 12000 },
    ),
    cbOne<{ inToday: number; countToday: number; mtd: number }>(
      org,
      `SELECT (SELECT SUM(CAST(AmountPaid AS decimal(18,2))) FROM ${CB}.PayedAmount WHERE DatePaid >= CAST(GETDATE() AS date)) AS inToday,
              (SELECT COUNT(*) FROM ${CB}.PayedAmount WHERE DatePaid >= CAST(GETDATE() AS date)) AS countToday,
              (SELECT SUM(CAST(AmountPaid AS decimal(18,2))) FROM ${CB}.PayedAmount
                WHERE DatePaid >= DATEADD(day, 1-DAY(GETDATE()), CAST(GETDATE() AS date))) AS mtd`,
      [], { timeoutMs: 12000 },
    ),
  ]);

  const ok = <T,>(r: PromiseSettledResult<T | null>): T | null => (r.status === "fulfilled" ? r.value : null);
  const b = ok(book), d = ok(desk), f = ok(fintech), p = ok(people), m = ok(money);
  const anything = !!(b || d || f || p || m);

  const systems: SystemPulse[] = [
    {
      id: "lms",
      value: b ? N(num(b.loans)) : null,
      label: "active loans",
      detail: b ? `${N(num(b.borrowers))} borrowers on the book` : null,
      source: "Serviceconnect.Loans",
    },
    {
      id: "portal",
      value: b ? N(num(b.disbursedToday)) : null,
      label: "disbursed today",
      detail: f ? `${N(num(f.today))} of them Micro Eazy` : null,
      source: "Serviceconnect.Loans",
    },
    {
      id: "analytics",
      value: b ? `KES ${KES(num(b.olb))}` : null,
      label: "outstanding",
      detail: b ? "across both Micromart entities" : null,
      source: "Serviceconnect.Loans",
    },
    {
      id: "callcenter",
      value: d ? `KES ${KES(num(d.recovered))}` : null,
      label: "recovered today",
      detail: d ? `${num(d.agents)} agents · ${N(num(d.payments))} payments` : null,
      source: "CollectBox.PayedAmount",
    },
    {
      id: "hr",
      value: p ? N(num(p.staff) + num(p.agents)) : null,
      label: "people on the roster",
      detail: p ? `${num(p.agents)} on the call floor · ${num(p.branches)} branches` : null,
      source: "UserMaster + CollectionAgents",
    },
    {
      id: "accounting",
      value: m ? `KES ${KES(num(m.mtd))}` : null,
      label: "collected month to date",
      detail: m ? `${N(num(m.countToday))} receipts today` : null,
      source: "CollectBox.PayedAmount",
    },
  ];

  const flows = [
    {
      from: "Serviceconnect", to: "ConnectDesk",
      label: "loans → collections queue",
      value: d ? `${N(num(d.tracked))} tracked` : null,
      live: !!d && num(d.tracked) > 0,
    },
    {
      from: "CollectBox", to: "Core ledger",
      label: "recoveries → balances",
      value: d ? `KES ${KES(num(d.recovered))} today` : null,
      live: !!d && num(d.recovered) > 0,
    },
    {
      from: "Fintech 3005", to: "ConnectDesk",
      label: "Micro Eazy → collections",
      value: f ? (num(f.tracked) > 0 ? `${N(num(f.tracked))} tracked` : "not connected") : null,
      live: !!f && num(f.tracked) > 0,
    },
    {
      from: "Every system", to: "Interaction timeline",
      label: "one merged history",
      value: "7 sources",
      live: anything,
    },
  ];

  return {
    systems,
    flows,
    fintech: {
      borrowers: f ? num(f.borrowers) : null,
      loansOpen: f ? num(f.loansOpen) : null,
      olb: f ? num(f.olb) : null,
      disbursedToday: f ? num(f.today) : null,
      trackedInCollectBox: f ? num(f.tracked) : null,
    },
    lastEventAt: d ? (dt(d.lastAt)?.toISOString() ?? null) : null,
    offline: !anything,
    readMs: Date.now() - started,
  };
}

function offlineResult(readMs: number): SuiteTelemetry {
  return {
    systems: ["lms", "portal", "analytics", "callcenter", "hr", "accounting"].map((id) => ({
      id, value: null, label: "", detail: null, source: "",
    })),
    flows: [],
    fintech: { borrowers: null, loansOpen: null, olb: null, disbursedToday: null, trackedInCollectBox: null },
    lastEventAt: null,
    offline: true,
    readMs,
  };
}
