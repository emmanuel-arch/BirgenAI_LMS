// ─────────────────────────────────────────────────────────────────────────────
// Riri Analyst — the semantic metric layer. "Talk to your loan book."
//
// This is the REAL intelligence: a natural-language question is routed to a
// catalog of governed portfolio metrics, each computed live from the org's own
// Prisma rows. No LLM, no external credential, no free-form SQL touching the DB —
// so it is safe, deterministic, tenant-isolated and always truthful. Every
// answer carries the actual numbers plus, where useful, metric chips, a mini
// series for a sparkline, or a small table.
//
// The seam to a future text-to-SQL/LLM planner is `route()`: swap the keyword
// router for an intent classifier and the metric handlers stay identical.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { hasFeature } from "@/lib/billing/entitlements";
import { cheapestPlanWith } from "@/lib/billing/plans";
import { portfolioEarlyWarning } from "@/lib/intelligence/earlywarning";

export type MetricChip = { label: string; value: string; sub?: string; tone?: "good" | "warn" | "bad" };
export type Series = { unit: "KES" | "count"; points: { x: string; y: number }[] };
export type MiniTable = { head: string[]; rows: string[][] };
export type AnalystResult = {
  answer: string;
  kind: string;
  chips?: MetricChip[];
  series?: Series;
  table?: MiniTable;
};

// ── Formatting ────────────────────────────────────────────────────────────────
const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const kesShort = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `KES ${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (a >= 1_000) return `KES ${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return kes(n);
};
const pct = (num: number, den: number) => (den > 0 ? (num / den) * 100 : 0);
const num = (d: unknown) => Number(d ?? 0);

// ── Date ranges (server-local, mirroring the console dashboard tiles) ─────────
function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function startOfWeek() { const d = startOfToday(); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return d; }
function startOfMonth() { const d = startOfToday(); d.setDate(1); return d; }
function startOfYear() { const d = startOfToday(); d.setMonth(0, 1); return d; }

type Range = { start: Date | null; label: string };
function detectRange(q: string, fallback: Range): Range {
  if (/\btoday\b|\bso far today\b/.test(q)) return { start: startOfToday(), label: "today" };
  if (/\bthis week\b|\bthis wk\b|\bweek\b/.test(q)) return { start: startOfWeek(), label: "this week" };
  if (/\bthis month\b|\bmonth\b|\bmtd\b/.test(q)) return { start: startOfMonth(), label: "this month" };
  if (/\bthis year\b|\byear\b|\bytd\b|\bannual\b/.test(q)) return { start: startOfYear(), label: "this year" };
  if (/\ball[- ]?time\b|\bever\b|\bto date\b|\boverall\b|\btotal\b/.test(q)) return { start: null, label: "all-time" };
  return fallback;
}

// Bucket signed money rows into the last 6 calendar months for a sparkline.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function sixMonthSeries(rows: { at: Date; amount: number }[]): Series {
  const now = new Date();
  const buckets: { x: string; y: number; key: string }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({ x: MONTHS[d.getMonth()], y: 0, key: `${d.getFullYear()}-${d.getMonth()}` });
  }
  const idx = new Map(buckets.map((b, i) => [b.key, i]));
  for (const r of rows) {
    const k = `${r.at.getFullYear()}-${r.at.getMonth()}`;
    const i = idx.get(k);
    if (i != null) buckets[i].y += r.amount;
  }
  return { unit: "KES", points: buckets.map((b) => ({ x: b.x, y: Math.round(b.y) })) };
}

// ── Shared portfolio pulse (used by several handlers + the greeting) ──────────
async function pulse(orgId: string) {
  const par30Cutoff = new Date(Date.now() - 30 * 86400000);
  const [olbAgg, activeCount, par30, apps] = await Promise.all([
    prisma.loan.aggregate({ where: { orgId, status: "ACTIVE" }, _sum: { balance: true } }),
    prisma.loan.count({ where: { orgId, status: "ACTIVE" } }),
    prisma.loan.aggregate({
      where: { orgId, status: "ACTIVE", installments: { some: { status: "OVERDUE", dueDate: { lt: par30Cutoff } } } },
      _sum: { balance: true }, _count: true,
    }),
    prisma.loanApplication.count({ where: { orgId, status: { in: ["SUBMITTED", "AI_PRESCREEN", "OFFICER_REVIEW", "REFERRED"] } } }),
  ]);
  const olb = num(olbAgg._sum.balance);
  const par = num(par30._sum.balance);
  return { olb, activeCount, parAmount: par, parCount: par30._count, par30: pct(par, olb), appsWaiting: apps };
}

// ── Intent handlers ───────────────────────────────────────────────────────────
async function h_olb(orgId: string): Promise<AnalystResult> {
  const p = await pulse(orgId);
  const avg = p.activeCount > 0 ? p.olb / p.activeCount : 0;
  return {
    kind: "olb",
    answer: `Your outstanding loan book is **${kes(p.olb)}** across **${p.activeCount}** active loan${p.activeCount === 1 ? "" : "s"} — an average balance of ${kesShort(avg)}.`,
    chips: [
      { label: "Outstanding book", value: kesShort(p.olb) },
      { label: "Active loans", value: String(p.activeCount) },
      { label: "Avg balance", value: kesShort(avg) },
    ],
  };
}

async function h_par(orgId: string): Promise<AnalystResult> {
  const p = await pulse(orgId);
  const tone: MetricChip["tone"] = p.par30 < 5 ? "good" : p.par30 < 10 ? "warn" : "bad";
  const read = p.par30 < 5 ? "healthy" : p.par30 < 10 ? "worth watching" : "elevated — worth a collections push";
  return {
    kind: "par",
    answer: `Your **PAR 30 is ${p.par30.toFixed(1)}%** — ${kes(p.parAmount)} at risk across ${p.parCount} loan${p.parCount === 1 ? "" : "s"} on a ${kesShort(p.olb)} book. That's ${read}.`,
    chips: [
      { label: "PAR 30", value: `${p.par30.toFixed(1)}%`, tone },
      { label: "At risk", value: kesShort(p.parAmount) },
      { label: "Loans in arrears", value: String(p.parCount) },
    ],
  };
}

async function h_disbursed(orgId: string, q: string): Promise<AnalystResult> {
  const range = detectRange(q, { start: startOfMonth(), label: "this month" });
  const sixStart = new Date(new Date().getFullYear(), new Date().getMonth() - 5, 1);
  const [agg, sixMo] = await Promise.all([
    prisma.disbursement.aggregate({
      where: { orgId, state: { in: ["CONFIRMED", "MANUAL_CONFIRMED"] }, ...(range.start ? { updatedAt: { gte: range.start } } : {}) },
      _sum: { amount: true }, _count: true,
    }),
    prisma.disbursement.findMany({
      where: { orgId, state: { in: ["CONFIRMED", "MANUAL_CONFIRMED"] }, updatedAt: { gte: sixStart } },
      select: { amount: true, updatedAt: true },
    }),
  ]);
  const total = num(agg._sum.amount);
  return {
    kind: "disbursed",
    answer: `You disbursed **${kes(total)}** ${range.label} across ${agg._count} loan${agg._count === 1 ? "" : "s"}.`,
    chips: [{ label: `Disbursed ${range.label}`, value: kesShort(total) }, { label: "Loans", value: String(agg._count) }],
    series: sixMonthSeries(sixMo.map((r) => ({ at: r.updatedAt, amount: num(r.amount) }))),
  };
}

async function h_collected(orgId: string, q: string): Promise<AnalystResult> {
  const range = detectRange(q, { start: startOfMonth(), label: "this month" });
  const sixStart = new Date(new Date().getFullYear(), new Date().getMonth() - 5, 1);
  const [c2b, stk, sixMo] = await Promise.all([
    prisma.c2BReceipt.aggregate({ where: { orgId, ...(range.start ? { createdAt: { gte: range.start } } : {}) }, _sum: { amount: true }, _count: true }),
    prisma.paymentIntent.aggregate({ where: { orgId, state: "SUCCESS", ...(range.start ? { updatedAt: { gte: range.start } } : {}) }, _sum: { amount: true } }),
    prisma.c2BReceipt.findMany({ where: { orgId, createdAt: { gte: sixStart } }, select: { amount: true, createdAt: true } }),
  ]);
  const total = num(c2b._sum.amount) + num(stk._sum.amount);
  return {
    kind: "collected",
    answer: `You collected **${kes(total)}** ${range.label} — across paybill receipts and STK repayments.`,
    chips: [
      { label: `Collected ${range.label}`, value: kesShort(total), tone: "good" },
      { label: "Paybill", value: kesShort(num(c2b._sum.amount)) },
      { label: "STK", value: kesShort(num(stk._sum.amount)) },
    ],
    series: sixMonthSeries(sixMo.map((r) => ({ at: r.createdAt, amount: num(r.amount) }))),
  };
}

async function h_applications(orgId: string): Promise<AnalystResult> {
  const grouped = await prisma.loanApplication.groupBy({ by: ["status"], where: { orgId }, _count: true });
  const by = new Map(grouped.map((g) => [g.status, g._count]));
  const g = (k: string) => by.get(k as never) ?? 0;
  const waiting = g("SUBMITTED") + g("AI_PRESCREEN") + g("OFFICER_REVIEW") + g("REFERRED");
  return {
    kind: "applications",
    answer: `You have **${waiting}** application${waiting === 1 ? "" : "s"} waiting for a decision. ${g("REFERRED")} referred, ${g("OFFICER_REVIEW")} in officer review.`,
    chips: [
      { label: "Waiting", value: String(waiting), tone: waiting > 0 ? "warn" : "good" },
      { label: "Approved", value: String(g("APPROVED") + g("DISBURSED")) },
      { label: "Declined", value: String(g("DECLINED")) },
    ],
    table: {
      head: ["Stage", "Count"],
      rows: [
        ["Submitted", String(g("SUBMITTED"))],
        ["AI pre-screen", String(g("AI_PRESCREEN"))],
        ["Officer review", String(g("OFFICER_REVIEW"))],
        ["Referred", String(g("REFERRED"))],
      ].filter((r) => r[1] !== "0"),
    },
  };
}

async function h_approval(orgId: string): Promise<AnalystResult> {
  const grouped = await prisma.loanApplication.groupBy({ by: ["status"], where: { orgId }, _count: true });
  const by = new Map(grouped.map((g) => [g.status, g._count]));
  const g = (k: string) => by.get(k as never) ?? 0;
  const approved = g("APPROVED") + g("DISBURSED");
  const declined = g("DECLINED");
  const decided = approved + declined;
  const rate = pct(approved, decided);
  return {
    kind: "approval",
    answer: `Your approval rate is **${rate.toFixed(0)}%** — ${approved} approved vs ${declined} declined of ${decided} decided application${decided === 1 ? "" : "s"}.`,
    chips: [
      { label: "Approval rate", value: `${rate.toFixed(0)}%` },
      { label: "Approved", value: String(approved), tone: "good" },
      { label: "Declined", value: String(declined) },
    ],
  };
}

async function h_outcomes(orgId: string): Promise<AnalystResult> {
  const grouped = await prisma.loanApplication.groupBy({ by: ["outcome"], where: { orgId }, _count: true });
  const by = new Map(grouped.map((g) => [g.outcome, g._count]));
  const g = (k: string) => by.get(k) ?? 0;
  const repaid = g("REPAID"), defaulted = g("DEFAULTED"), pending = g("PENDING");
  const observed = repaid + defaulted;
  const dr = pct(defaulted, observed);
  const tone: MetricChip["tone"] = dr < 5 ? "good" : dr < 12 ? "warn" : "bad";
  return {
    kind: "outcomes",
    answer: `On realised outcomes, your **default rate is ${dr.toFixed(1)}%** — ${repaid} repaid, ${defaulted} defaulted, ${pending} still running. These labelled outcomes are what trains the credit models.`,
    chips: [
      { label: "Default rate", value: `${dr.toFixed(1)}%`, tone },
      { label: "Repaid", value: String(repaid), tone: "good" },
      { label: "Defaulted", value: String(defaulted), tone: "bad" },
      { label: "Still open", value: String(pending) },
    ],
  };
}

async function h_topBorrowers(orgId: string): Promise<AnalystResult> {
  const grouped = await prisma.loan.groupBy({
    by: ["borrowerId"], where: { orgId, status: "ACTIVE" },
    _sum: { balance: true }, orderBy: { _sum: { balance: "desc" } }, take: 5,
  });
  const ids = grouped.map((g) => g.borrowerId);
  const borrowers = await prisma.borrower.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, otherName: true, phone: true } });
  const nameOf = new Map(borrowers.map((b) => [b.id, `${b.firstName ?? "Borrower"}${b.otherName ? " " + b.otherName : ""}`.trim()]));
  return {
    kind: "top-borrowers",
    answer: `Your five largest active exposures total ${kesShort(grouped.reduce((s, g) => s + num(g._sum.balance), 0))}.`,
    table: {
      head: ["Borrower", "Balance"],
      rows: grouped.map((g) => [nameOf.get(g.borrowerId) ?? "—", kesShort(num(g._sum.balance))]),
    },
  };
}

async function h_byProduct(orgId: string): Promise<AnalystResult> {
  const grouped = await prisma.loan.groupBy({
    by: ["productId"], where: { orgId, status: "ACTIVE" },
    _sum: { balance: true }, _count: true, orderBy: { _sum: { balance: "desc" } },
  });
  const products = await prisma.product.findMany({ where: { id: { in: grouped.map((g) => g.productId) } }, select: { id: true, name: true } });
  const nameOf = new Map(products.map((p) => [p.id, p.name]));
  return {
    kind: "by-product",
    answer: `Here's your outstanding book split by product.`,
    table: {
      head: ["Product", "OLB", "Loans"],
      rows: grouped.map((g) => [nameOf.get(g.productId) ?? "—", kesShort(num(g._sum.balance)), String(g._count)]),
    },
  };
}

async function h_borrowers(orgId: string): Promise<AnalystResult> {
  const [total, newThisWeek, verified] = await Promise.all([
    prisma.borrower.count({ where: { orgId } }),
    prisma.borrower.count({ where: { orgId, createdAt: { gte: startOfWeek() } } }),
    prisma.borrower.count({ where: { orgId, kycStatus: "VERIFIED" } }),
  ]);
  return {
    kind: "borrowers",
    answer: `You have **${total}** borrower${total === 1 ? "" : "s"} on the book — ${newThisWeek} joined this week, ${verified} fully KYC-verified.`,
    chips: [
      { label: "Borrowers", value: String(total) },
      { label: "New this week", value: String(newThisWeek), tone: newThisWeek > 0 ? "good" : undefined },
      { label: "KYC verified", value: String(verified) },
    ],
  };
}

async function h_field(orgId: string): Promise<AnalystResult> {
  const [visits, agents] = await Promise.all([
    prisma.fieldVisit.groupBy({ by: ["status"], where: { orgId }, _count: true }),
    prisma.staffUser.count({ where: { orgId, isFieldAgent: true, status: "ACTIVE" } }),
  ]);
  const by = new Map(visits.map((v) => [v.status, v._count]));
  const g = (k: string) => by.get(k as never) ?? 0;
  const open = g("QUEUED") + g("ALLOCATED") + g("EN_ROUTE") + g("ARRIVED");
  return {
    kind: "field",
    answer: `**${agents}** field agent${agents === 1 ? "" : "s"} on duty with **${open}** open visit${open === 1 ? "" : "s"}. ${g("VERIFIED")} verified, ${g("QUEUED")} awaiting allocation.`,
    chips: [
      { label: "Field agents", value: String(agents) },
      { label: "Open visits", value: String(open), tone: open > 0 ? "warn" : "good" },
      { label: "Verified", value: String(g("VERIFIED")), tone: "good" },
    ],
  };
}

async function h_scores(orgId: string): Promise<AnalystResult> {
  const [agg, bands] = await Promise.all([
    prisma.scoreSnapshot.aggregate({ where: { orgId }, _avg: { score: true }, _count: true }),
    prisma.scoreSnapshot.groupBy({ by: ["riskBand"], where: { orgId }, _count: true, orderBy: { _count: { riskBand: "desc" } } }),
  ]);
  const avg = agg._avg.score != null ? Math.round(agg._avg.score) : null;
  return {
    kind: "scores",
    answer: `Riri has scored **${agg._count}** application${agg._count === 1 ? "" : "s"} to date${avg != null ? `, averaging **${avg}**` : ""}. Every score is a training row in your closed ML loop.`,
    chips: [
      { label: "Scores", value: String(agg._count) },
      ...(avg != null ? [{ label: "Avg score", value: String(avg) }] : []),
      ...bands.filter((b) => b.riskBand).slice(0, 2).map((b) => ({ label: b.riskBand ?? "—", value: String(b._count) })),
    ],
  };
}

async function h_watchlist(orgId: string): Promise<AnalystResult> {
  // Riri ships on Advanced, but early-warning is a Premium engine. Asking her
  // about it must not become a side door around the package the lender bought.
  if (!(await hasFeature(orgId, "portfolio-scan"))) {
    const plan = cheapestPlanWith("portfolio-scan");
    return {
      kind: "watchlist",
      answer: `Portfolio early-warning isn't on your package yet. **${plan?.name}** (KES ${plan?.monthlyKes.toLocaleString()}/mo) scores every active loan for the early signs of default. Open **Billing** to add it.`,
    };
  }
  const ew = await portfolioEarlyWarning(orgId);
  const top = ew.rows.slice(0, 5);
  const dr = ew.tiles.olb > 0 ? pct(ew.tiles.atRiskValue, ew.tiles.olb) : 0;
  return {
    kind: "watchlist",
    answer: ew.rows.length === 0
      ? `Nothing on the early-warning watchlist right now — every active loan is behaving. I'll flag them the moment they start to slip.`
      : `**${ew.rows.length}** borrower${ew.rows.length === 1 ? "" : "s"} on the early-warning watchlist — ${ew.tiles.high} high-risk, ${kesShort(ew.tiles.atRiskValue)} at risk (${dr.toFixed(0)}% of book), ~${kesShort(ew.tiles.projectedLoss)} projected loss. Open **Credit Intelligence** to act on them.`,
    chips: [
      { label: "Watchlist", value: String(ew.rows.length), tone: ew.rows.length > 0 ? "warn" : "good" },
      { label: "High risk", value: String(ew.tiles.high), tone: ew.tiles.high > 0 ? "bad" : "good" },
      { label: "Value at risk", value: kesShort(ew.tiles.atRiskValue) },
      { label: "Projected loss", value: kesShort(ew.tiles.projectedLoss), tone: "bad" },
    ],
    table: top.length ? { head: ["Borrower", "DPD", "Risk", "Balance"], rows: top.map((r) => [r.name, String(r.dpd), r.band, kesShort(r.balance)]) } : undefined,
  };
}

async function h_help(orgId: string): Promise<AnalystResult> {
  const p = await pulse(orgId);
  return {
    kind: "help",
    answer:
      `I'm **Riri Analyst** — I read your live loan book so you don't have to pull a report. Right now you're carrying ${kesShort(p.olb)} across ${p.activeCount} active loans, PAR 30 at ${p.par30.toFixed(1)}%, with ${p.appsWaiting} application${p.appsWaiting === 1 ? "" : "s"} waiting.\n\nTry asking about disbursements, collections, arrears, approval rate, default rate, top borrowers, or your product mix.`,
    chips: [
      { label: "Outstanding book", value: kesShort(p.olb) },
      { label: "PAR 30", value: `${p.par30.toFixed(1)}%`, tone: p.par30 < 5 ? "good" : p.par30 < 10 ? "warn" : "bad" },
      { label: "Apps waiting", value: String(p.appsWaiting) },
    ],
  };
}

// ── Router (the LLM/text-to-SQL seam) ─────────────────────────────────────────
type Intent = { id: string; keys: RegExp; run: (orgId: string, q: string) => Promise<AnalystResult> };
const INTENTS: Intent[] = [
  { id: "watchlist", keys: /watchlist|early warning|who.*(default|risk|slip)|going to default|might default|about to default|risky borrower|flight risk|who owes/, run: (o) => h_watchlist(o) },
  { id: "par", keys: /\bpar\b|arrears|overdue|at risk|delinquen|non[- ]?performing|npl/, run: (o) => h_par(o) },
  { id: "outcomes", keys: /default rate|defaults?|repaid|repayment rate|write[- ]?off|charge[- ]?off|outcome/, run: (o) => h_outcomes(o) },
  { id: "disbursed", keys: /disburs|paid out|lent|loaned out|payout|booked/, run: (o, q) => h_disbursed(o, q) },
  { id: "collected", keys: /collect|repay|received|recover|inflow|collections/, run: (o, q) => h_collected(o, q) },
  { id: "approval", keys: /approval rate|approv|decline rate|declined|rejection/, run: (o) => h_approval(o) },
  { id: "applications", keys: /applications?|pipeline|queue|waiting|to review|pending app/, run: (o) => h_applications(o) },
  { id: "top-borrowers", keys: /top borrower|largest|biggest|top 5|top five|exposure|concentration/, run: (o) => h_topBorrowers(o) },
  { id: "by-product", keys: /by product|per product|product mix|product breakdown|which product/, run: (o) => h_byProduct(o) },
  { id: "borrowers", keys: /borrowers?|customers?|clients?|how many people/, run: (o) => h_borrowers(o) },
  { id: "field", keys: /field|agent|visit|verification|route|on the ground/, run: (o) => h_field(o) },
  { id: "scores", keys: /score|scoring|model|risk band|credit intelligence/, run: (o) => h_scores(o) },
  { id: "olb", keys: /olb|outstanding|loan book|portfolio|book size|how big|total loans/, run: (o) => h_olb(o) },
];

/** Route a question to the best-matching metric handler (keyword scored). */
export async function analyze(orgId: string, question: string): Promise<AnalystResult> {
  const q = question.toLowerCase();
  if (/^\s*(hi|hey|hello|help|what can you do|who are you)\b/.test(q) || q.trim().length < 3) {
    return h_help(orgId);
  }
  let best: Intent | null = null;
  let bestScore = 0;
  for (const it of INTENTS) {
    const m = q.match(new RegExp(it.keys, "g"));
    const score = m ? m.length : 0;
    if (score > bestScore) { bestScore = score; best = it; }
  }
  if (!best) return h_help(orgId);
  return best.run(orgId, q);
}
