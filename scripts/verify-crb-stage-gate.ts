// ─────────────────────────────────────────────────────────────────────────────
// The per-stage CRB gate, and the loop it is built to prevent.
//
//   npm run test:crb-gate
//
// Pure logic, no database — the gate's decision is a function of one timestamp,
// so it can be pinned down exactly, including the case that only shows up on a
// lender whose reuse window is wider than the gate's freshness window.
// ─────────────────────────────────────────────────────────────────────────────
import { crbGateDecision, CRB_FRESH_DAYS } from "../src/lib/crb/stage-gate";

let failures = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "+" : "x"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

const NOW = new Date("2026-08-19T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

console.log(`\nPer-stage CRB gate (freshness = ${CRB_FRESH_DAYS} days)\n`);

// 1. No file at all — blocked, but nothing to force: the first pull is a normal
//    pull and should be allowed to reuse anything the endpoint already has.
{
  const g = crbGateDecision(null, NOW);
  ok("No bureau file → blocked, not forced",
    g.blocked === true && g.blocked && g.stale === false && g.force === false,
    JSON.stringify(g));
}

// 2. A fresh file clears the gate.
{
  const g = crbGateDecision(daysAgo(1), NOW);
  ok("File from yesterday → passes", g.blocked === false, JSON.stringify(g));
}

// 3. Boundary: a file exactly at the window edge still counts. The gate says
//    "no older than 30 days", so day 30 is inside.
{
  const g = crbGateDecision(daysAgo(CRB_FRESH_DAYS), NOW);
  ok(`File exactly ${CRB_FRESH_DAYS} days old → passes`, g.blocked === false, JSON.stringify(g));
}

// 4. One second past the window → blocked.
{
  const justOver = new Date(daysAgo(CRB_FRESH_DAYS).getTime() - 1000);
  const g = crbGateDecision(justOver, NOW);
  ok("File one second past the window → blocked", g.blocked === true, JSON.stringify(g));
}

// 5. THE LOOP GUARD. A stale file must be replaced, not re-served. If this ever
//    reports force:false, an officer on a lender with a wide reuse window can
//    click "Run CRB check" forever: the endpoint returns the same rejected file
//    and the stage refuses it again.
{
  const g = crbGateDecision(daysAgo(90), NOW);
  ok("Stale file → blocked AND forced (the loop guard)",
    g.blocked === true && g.blocked && g.stale === true && g.force === true,
    JSON.stringify(g));
}

// 6. The stale branch must hand back the date, because the officer is told which
//    file was rejected — an unexplained "too old" is not actionable.
{
  const when = daysAgo(45);
  const g = crbGateDecision(when, NOW);
  ok("Stale file reports the date it was rejected for",
    g.blocked === true && g.blocked && g.lastCheckedAt?.getTime() === when.getTime(),
    g.blocked ? String(g.lastCheckedAt?.toISOString()) : "");
}

// 7. A lender-tightened window re-decides an already-stored file, so the same
//    borrower can pass under one policy and be blocked under a stricter one.
{
  const file = daysAgo(10);
  ok("Same file: passes at 30 days, blocked at 7",
    crbGateDecision(file, NOW, 30).blocked === false && crbGateDecision(file, NOW, 7).blocked === true);
}

// 8. A clock-skewed future timestamp must not be treated as stale — it is fresh
//    by any reading, and forcing a paid pull on a skew would spend real money.
{
  const g = crbGateDecision(new Date(NOW.getTime() + 60_000), NOW);
  ok("Future-dated file → passes, never force-billed", g.blocked === false, JSON.stringify(g));
}

console.log(`\n${failures === 0 ? "+ ALL PASSED" : `x ${failures} FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
