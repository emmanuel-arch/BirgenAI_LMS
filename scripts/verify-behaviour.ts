// ─────────────────────────────────────────────────────────────────────────────
// BEHAVIOURAL SCORING & GRADUATION — parity with sp_CreditScoringAndGraduation,
// and the three things it cannot do.
//
// Part 1 recomputes the stored procedure's arithmetic BY HAND on worked examples
// (the CASE tables, the AVG-per-loan-then-AVG-across-loans, the 50/50 blend, the
// band cuts, the 30/15/0 steps, the 5,000 cap) and holds the generalised engine to
// it under the MICROMART preset. If these ever diverge, a lender's numbers moved on
// the day they migrated — which is the one thing a migration must never do.
//
// Part 2 exercises what the procedure structurally cannot: scoring a live loan,
// lowering a limit, and graduating without the risk of cutting one.
//
//   npx tsx scripts/verify-behaviour.ts
// ─────────────────────────────────────────────────────────────────────────────
import { scoreBehaviour, assessLadder, type LoanFact, type InstallmentFact } from "../src/lib/scoring/behaviour";
import {
  MICROMART_BEHAVIOUR, MICROMART_GRADUATION, BEHAVIOUR_DEFAULTS, GRADUATION_DEFAULTS,
  validateBehaviour, type BehaviourBlock, type GraduationBlock,
} from "../src/lib/scoring/behaviour-policy";

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  x ${m}`); };
const pass = (m: string) => console.log(`  + ${m}`);
const check = (cond: boolean, ok: string, bad: string) => { if (cond) pass(ok); else fail(bad); };

const NOW = new Date("2026-07-31T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

/** Build an installment: due `dueOffset` days from NOW, paid `lateDays` after due. */
function inst(seq: number, amountDue: number, paidRatio: number, dueOffset: number, lateDays: number | null): InstallmentFact {
  return {
    seq, amountDue, amountPaid: amountDue * paidRatio,
    dueDate: day(dueOffset),
    paidAt: lateDays === null ? null : day(dueOffset + lateDays),
  };
}

function loan(id: string, principal: number, status: LoanFact["status"], installments: InstallmentFact[]): LoanFact {
  return { id, principal, status, borrowDate: day(-90), clearedAt: status === "CLEARED" ? day(-1) : null, installments };
}

// ── The procedure's own arithmetic, reimplemented independently ───────────────
// Deliberately a SEPARATE implementation from the engine — a parity test that
// shares code with the thing it checks proves nothing.
const procRepayment = (due: number, paid: number): number =>
  due <= 0 ? 100 : paid >= due ? 100 : paid >= 0.75 * due ? 75 : paid >= 0.5 * due ? 50 : 0;
const procArrears = (daysLate: number): number =>
  daysLate <= 0 ? 100 : daysLate <= 3 ? 30 : daysLate <= 6 ? 10 : 0;

function procScore(loans: LoanFact[]): number {
  // WHERE LoanCleared = 1, TOP 2 most recent, AVG per loan then AVG across loans.
  const cleared = loans.filter((l) => l.status === "CLEARED").slice(0, 2);
  const per = cleared.map((l) => {
    const rh: number[] = l.installments.map((i) => procRepayment(i.amountDue, i.amountPaid));
    const da: number[] = l.installments.map((i) =>
      procArrears(Math.floor(((i.paidAt ?? NOW).getTime() - i.dueDate.getTime()) / 86_400_000)));
    return {
      rh: rh.reduce((a, b) => a + b, 0) / rh.length,
      da: da.reduce((a, b) => a + b, 0) / da.length,
    };
  });
  const rh = per.reduce((s, x) => s + x.rh, 0) / per.length;
  const da = per.reduce((s, x) => s + x.da, 0) / per.length;
  return Math.round((0.5 * rh + 0.5 * da) * 100) / 100;
}
const procCategory = (s: number) => (s > 76 ? "MINOR" : s >= 51 ? "MODERATE" : "MAJOR");
const procPercent = (s: number) => (s > 76 ? 30 : s >= 51 ? 15 : 0);
function procNewLimit(lastPrincipal: number, pct: number): number {
  const inc = (lastPrincipal * pct) / 100;
  return inc > 5000 ? lastPrincipal + 5000 : lastPrincipal + inc;
}

// ── Part 0 · policy validity ──────────────────────────────────────────────────
console.log("\nPolicy validation");
const POLICIES: [string, BehaviourBlock, GraduationBlock][] = [
  ["platform defaults", BEHAVIOUR_DEFAULTS, GRADUATION_DEFAULTS],
  ["Micromart preset", MICROMART_BEHAVIOUR, MICROMART_GRADUATION],
];
for (const [label, b, g] of POLICIES) {
  const issues = validateBehaviour(b, g);
  check(issues.length === 0, `${label} valid`, `${label}: ${issues.map((i) => `${i.path} — ${i.message}`).join("; ")}`);
}

// ── Part 1 · parity with the stored procedure ─────────────────────────────────
console.log("\nParity — engine under MICROMART preset vs the procedure's arithmetic");

type Case = { name: string; loans: LoanFact[]; limit: number };
const CASES: Case[] = [
  {
    name: "Flawless — 4/4 in full, on time",
    limit: 5000,
    loans: [
      loan("a1", 5000, "CLEARED", [1, 2, 3, 4].map((s) => inst(s, 1500, 1, -60 + s * 7, 0))),
      loan("a2", 5000, "CLEARED", [1, 2, 3, 4].map((s) => inst(s, 1500, 1, -120 + s * 7, 0))),
    ],
  },
  {
    name: "Always full, always 2 days late",
    limit: 5000,
    loans: [
      loan("b1", 5000, "CLEARED", [1, 2, 3, 4].map((s) => inst(s, 1500, 1, -60 + s * 7, 2))),
      loan("b2", 5000, "CLEARED", [1, 2, 3, 4].map((s) => inst(s, 1500, 1, -120 + s * 7, 2))),
    ],
  },
  {
    name: "Three-quarter payer, on time",
    limit: 5000,
    loans: [
      loan("c1", 5000, "CLEARED", [1, 2, 3, 4].map((s) => inst(s, 1500, 0.8, -60 + s * 7, 0))),
      loan("c2", 5000, "CLEARED", [1, 2, 3, 4].map((s) => inst(s, 1500, 0.8, -120 + s * 7, 0))),
    ],
  },
  {
    name: "Mixed — half paid, a week late",
    limit: 5000,
    loans: [
      loan("d1", 5000, "CLEARED", [inst(1, 1500, 1, -50, 0), inst(2, 1500, 0.6, -43, 8), inst(3, 1500, 0.5, -36, 10), inst(4, 1500, 1, -29, 1)]),
      loan("d2", 5000, "CLEARED", [inst(1, 1500, 1, -110, 0), inst(2, 1500, 0.4, -103, 12), inst(3, 1500, 1, -96, 5), inst(4, 1500, 1, -89, 0)]),
    ],
  },
  {
    name: "Uneven loan lengths (2 vs 6 installments)",
    limit: 20000,
    loans: [
      loan("e1", 20000, "CLEARED", [inst(1, 9000, 1, -40, 0), inst(2, 9000, 1, -33, 4)]),
      loan("e2", 20000, "CLEARED", [1, 2, 3, 4, 5, 6].map((s) => inst(s, 3000, 1, -120 + s * 7, s % 2 === 0 ? 5 : 0))),
    ],
  },
  {
    name: "Large principal — the 5,000 cap binds",
    limit: 100000,
    loans: [
      loan("f1", 100000, "CLEARED", [1, 2, 3, 4].map((s) => inst(s, 30000, 1, -60 + s * 7, 0))),
      loan("f2", 100000, "CLEARED", [1, 2, 3, 4].map((s) => inst(s, 30000, 1, -120 + s * 7, 0))),
    ],
  },
];

for (const c of CASES) {
  const engine = scoreBehaviour(c.loans, MICROMART_BEHAVIOUR, NOW);
  const want = procScore(c.loans);
  const wantCat = procCategory(want);
  const wantPct = procPercent(want);

  if (Math.abs(engine.score - want) >= 0.01) {
    fail(`${c.name}: score ${engine.score} vs procedure ${want}`);
    continue;
  }
  if (engine.category?.key !== wantCat) {
    fail(`${c.name}: category ${engine.category?.key} vs procedure ${wantCat}`);
    continue;
  }

  const ladder = assessLadder({ loans: c.loans, currentLimit: c.limit }, MICROMART_BEHAVIOUR, MICROMART_GRADUATION, NOW);
  const lastPrincipal = c.loans.find((l) => l.status === "CLEARED")!.principal;

  if (wantPct > 0) {
    const wantLimit = procNewLimit(lastPrincipal, wantPct);
    if (ladder.move !== "graduate") {
      fail(`${c.name}: engine held, procedure would graduate ${wantPct}%`);
    } else if (ladder.newLimit !== wantLimit) {
      fail(`${c.name}: new limit ${ladder.newLimit} vs procedure ${wantLimit}`);
    } else {
      pass(`${c.name.padEnd(42)} score ${engine.score} · ${wantCat} · ${wantPct}% → ${ladder.newLimit.toLocaleString()}`);
    }
  } else {
    check(
      ladder.move !== "graduate",
      `${c.name.padEnd(42)} score ${engine.score} · ${wantCat} · no graduation`,
      `${c.name}: engine graduated, procedure would not`,
    );
  }
}

// The same-principal gate.
{
  const mixed = [
    loan("g1", 7000, "CLEARED", [1, 2].map((s) => inst(s, 4000, 1, -40 + s * 7, 0))),
    loan("g2", 5000, "CLEARED", [1, 2].map((s) => inst(s, 3000, 1, -80 + s * 7, 0))),
  ];
  const a = assessLadder({ loans: mixed, currentLimit: 7000 }, MICROMART_BEHAVIOUR, MICROMART_GRADUATION, NOW);
  check(
    a.move === "hold" && a.reason.includes("different amounts"),
    "same-principal gate: two different amounts do not graduate",
    `same-principal gate: got ${a.move} — ${a.reason}`,
  );
}

// ── Part 2 · what the procedure cannot do ─────────────────────────────────────
console.log("\nBeyond the procedure");

// (a) A live loan moves the score — a PD that changes during the cycle.
{
  const cleared = loan("h0", 5000, "CLEARED", [1, 2, 3, 4].map((s) => inst(s, 1500, 1, -120 + s * 7, 0)));
  const trail: number[] = [];
  for (const paidUpTo of [0, 1, 2, 3]) {
    const live = loan("h1", 5000, "ACTIVE", [1, 2, 3, 4].map((s) =>
      s <= paidUpTo ? inst(s, 1500, 1, -30 + s * 7, 0) : inst(s, 1500, 0, -30 + s * 7, null)));
    trail.push(scoreBehaviour([live, cleared], BEHAVIOUR_DEFAULTS, NOW).score);
  }
  const rising = trail.every((v, i) => i === 0 || v >= trail[i - 1]);
  const moved = new Set(trail).size > 1;
  check(
    moved && rising,
    `live scoring: PD moves across the cycle — ${trail.join(" → ")} as installments are met`,
    `live scoring: trail ${trail.join(" → ")} (moved=${moved}, monotonic=${rising})`,
  );

  const frozen = [0, 3].map((paidUpTo) => {
    const live = loan("h2", 5000, "ACTIVE", [1, 2, 3, 4].map((s) =>
      s <= paidUpTo ? inst(s, 1500, 1, -30 + s * 7, 0) : inst(s, 1500, 0, -30 + s * 7, null)));
    return scoreBehaviour([live, cleared], MICROMART_BEHAVIOUR, NOW).score;
  });
  check(
    frozen[0] === frozen[1],
    `Micromart preset: score frozen at ${frozen[0]} whatever happens on the live loan (the procedure's behaviour)`,
    `Micromart preset should ignore live loans, got ${frozen.join(" vs ")}`,
  );
}

// (b) THE CUT BUG. A borrower with a 10,000 limit who repaid 5,000 twice, perfectly.
{
  const loans = [
    loan("i1", 5000, "CLEARED", [1, 2, 3, 4].map((s) => inst(s, 1500, 1, -60 + s * 7, 0))),
    loan("i2", 5000, "CLEARED", [1, 2, 3, 4].map((s) => inst(s, 1500, 1, -120 + s * 7, 0))),
  ];
  const original = assessLadder({ loans, currentLimit: 10000 }, MICROMART_BEHAVIOUR, MICROMART_GRADUATION, NOW);
  const fixed = assessLadder({ loans, currentLimit: 10000 }, BEHAVIOUR_DEFAULTS, GRADUATION_DEFAULTS, NOW);

  check(
    original.newLimit !== null && original.newLimit < 10000,
    `reproduced the original's defect: perfect record, limit 10,000 → ${original.newLimit?.toLocaleString()} (a ${Math.round((1 - (original.newLimit ?? 0) / 10000) * 100)}% CUT, filed as a graduation)`,
    `expected the last_principal basis to cut the limit, got ${original.newLimit}`,
  );
  check(
    fixed.newLimit !== null && fixed.newLimit > 10000,
    `higher_of basis fixes it: 10,000 → ${fixed.newLimit?.toLocaleString()}`,
    `higher_of should never reduce, got ${fixed.newLimit}`,
  );
}

// (c) Demotion — the missing half of the ladder.
{
  const bad = [
    loan("j1", 5000, "CLEARED", [1, 2, 3, 4].map((s) => inst(s, 1500, 0.3, -60 + s * 7, 20))),
    loan("j2", 5000, "CLEARED", [1, 2, 3, 4].map((s) => inst(s, 1500, 0.3, -120 + s * 7, 20))),
  ];
  const noDemote = assessLadder({ loans: bad, currentLimit: 30000 }, MICROMART_BEHAVIOUR, MICROMART_GRADUATION, NOW);
  const withDemote = assessLadder(
    { loans: bad, currentLimit: 30000 },
    BEHAVIOUR_DEFAULTS,
    { ...GRADUATION_DEFAULTS, demotion: { enabled: true, belowCategory: "HIGH", percent: 25, floor: 5000 } },
    NOW,
  );
  check(
    noDemote.move === "hold",
    "procedure's behaviour: a deteriorating borrower keeps their inflated limit",
    `expected hold under the Micromart preset, got ${noDemote.move}`,
  );
  check(
    withDemote.move === "demote" && withDemote.newLimit === 22500,
    `demotion: 30,000 → ${withDemote.newLimit?.toLocaleString()} once behaviour falls to HIGH`,
    `expected a demotion to 22,500, got ${withDemote.move} → ${withDemote.newLimit}`,
  );
}

// (d) A lender adding a third factor — the thing that needed a code change before.
{
  const custom: BehaviourBlock = {
    ...BEHAVIOUR_DEFAULTS,
    factors: [
      { ...BEHAVIOUR_DEFAULTS.factors[0], weight: 40 },
      { ...BEHAVIOUR_DEFAULTS.factors[1], weight: 40 },
      {
        key: "streak", label: "Missed runs", weight: 20, metric: "arrears_streak", enabled: true,
        bands: [
          { threshold: 0, points: 100, label: "Never missed twice running" },
          { threshold: 2, points: 40, label: "Missed twice running" },
          { threshold: null, points: 0, label: "Missed three or more running" },
        ],
      },
    ],
  };
  const issues = validateBehaviour(custom, GRADUATION_DEFAULTS);
  if (issues.length) {
    fail(`three-factor policy rejected: ${issues.map((i) => i.message).join("; ")}`);
  } else {
    const loans = [loan("k1", 5000, "CLEARED", [inst(1, 1500, 1, -40, 0), inst(2, 1500, 0, -33, null), inst(3, 1500, 0, -26, null), inst(4, 1500, 1, -19, 0)])];
    const r = scoreBehaviour(loans, custom, NOW);
    check(
      r.factors.length === 3 && r.factors.some((f) => f.key === "streak"),
      `third factor works with no code change: ${r.factors.map((f) => `${f.label} ${f.raw}`).join(", ")} → ${r.score}`,
      `custom factor did not contribute: ${JSON.stringify(r.factors)}`,
    );
  }
}

// (e) Weights that do not sum to 100 are refused rather than silently rescaled.
{
  const broken: BehaviourBlock = {
    ...BEHAVIOUR_DEFAULTS,
    factors: BEHAVIOUR_DEFAULTS.factors.map((f) => ({ ...f, weight: 40 })),
  };
  const issues = validateBehaviour(broken, GRADUATION_DEFAULTS);
  check(
    issues.some((i) => i.path === "behaviour.factors" && i.message.includes("80")),
    "weights that do not total 100 are refused with the actual total named",
    `expected a weight-total issue, got ${JSON.stringify(issues)}`,
  );
}

// (f) Bands listed out of order are caught — a later rung would be unreachable.
{
  const broken: BehaviourBlock = {
    ...BEHAVIOUR_DEFAULTS,
    factors: [
      {
        ...BEHAVIOUR_DEFAULTS.factors[0],
        bands: [
          { threshold: 0.5, points: 50, label: "Half" },
          { threshold: 1, points: 100, label: "Full" },
          { threshold: null, points: 0, label: "Nothing" },
        ],
      },
      BEHAVIOUR_DEFAULTS.factors[1],
    ],
  };
  const issues = validateBehaviour(broken, GRADUATION_DEFAULTS);
  check(
    issues.some((i) => i.message.includes("out of order")),
    "bands listed out of order are caught before they silently swallow a rung",
    `expected an ordering issue, got ${JSON.stringify(issues)}`,
  );
}

console.log(failures === 0 ? "\nBehavioural engine verified.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
