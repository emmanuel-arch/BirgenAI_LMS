// ─────────────────────────────────────────────────────────────────────────────
// Dashboard data model + showcase simulation.
//
// The METRIC CONTRACT mirrors ServiceSuite's [dbo].[MainDashboard] proc exactly
// (OLB, Clean OLB, PAR, PQS, NPL count/amount/collected, dues today, arrears,
// CPR, approval-stage counts, disbursed/declined, new customers …) and its three
// role SCOPES (validator = whole entity, authorizer = an org-unit subtree, agent
// = own book). When a lender's book is live, a server route fills this shape from
// Postgres/ServiceSuite; when the book is empty (a new lender like Mular on demo
// day), `simulate()` produces realistic, cinematic figures instead.
//
// Pure + deterministic (seeded): the same range/scope always yields the same
// numbers, so charts never flicker between renders.
// ─────────────────────────────────────────────────────────────────────────────

export type RangeKey = "today" | "7d" | "30d" | "qtd" | "ytd" | "12mo";
export type Scope = "entity" | "unit" | "agent";

export const RANGES: { key: RangeKey; label: string; short: string }[] = [
  { key: "today", label: "Today", short: "1D" },
  { key: "7d", label: "This week", short: "7D" },
  { key: "30d", label: "This month", short: "30D" },
  { key: "qtd", label: "This quarter", short: "QTD" },
  { key: "ytd", label: "This year", short: "YTD" },
  { key: "12mo", label: "12 months", short: "12M" },
];

export const SCOPES: { key: Scope; label: string; hint: string }[] = [
  { key: "entity", label: "Whole book", hint: "Every branch & officer" },
  { key: "unit", label: "My region", hint: "Your org-unit subtree" },
  { key: "agent", label: "My customers", hint: "Loans you own" },
];

export type Kpis = {
  olb: number; cleanOlb: number; cleanOlbCount: number;
  activeLoans: number; totalCustomers: number; newCustomers: number;
  par: number; pqs: number;
  totalArrears: number; arrearsLoans: number;
  npl: number; nplCount: number; nplCollected: number; nplCollectedMonth: number;
  disbursedAmount: number; disbursedCount: number;
  collectedAmount: number;
  dueAmount: number; dueCount: number;
  paidAmount: number; paidCount: number;
  unpaidAmount: number; unpaidCount: number;
  prepaidAmount: number; prepaidCount: number;
  arrearsPaid: number;
  todayCR: number; prepaidCR: number; cpr: number;
  declinedLoans: number; percentageFunded: number;
  atInitiator: number; atAuthorizer: number; atValidator: number;
};

export type SeriesPoint = { key: string; label: string; disbursed: number; collected: number; due: number; applications: number };
export type AgingBucket = { bucket: string; amount: number; count: number; tone: "good" | "warn" | "high" | "bad" };
export type Slice = { name: string; value: number; color: string };
export type ProductRow = { name: string; olb: number; count: number };
export type BranchRow = { name: string; olb: number; par: number; officers: number };

export type DashboardData = {
  kpis: Kpis;
  series: SeriesPoint[];
  prevSeries: SeriesPoint[];
  aging: AgingBucket[];
  composition: Slice[];
  productMix: ProductRow[];
  branches: BranchRow[];
  spark: { olb: number[]; par: number[]; collections: number[]; disbursed: number[] };
  range: RangeKey;
  scope: Scope;
  simulated: boolean;
  currency: string;
};

// A snapshot of REAL "as of now" figures from the lender's book. Every field is
// OPTIONAL: the server overrides only what it can compute truthfully from Postgres
// today; everything else stays modeled (and clearly so). Empty books (a new lender
// like Mular on demo day) pass null and get the pure showcase.
export type LiveSnapshot = Partial<{
  olb: number; activeLoans: number; par: number;
  totalArrears: number; npl: number; nplCount: number;
  disbursedAmount: number; disbursedCount: number; collectedAmount: number;
  dueAmount: number; dueCount: number; paidAmount: number; paidCount: number;
  totalCustomers: number; newCustomers: number;
  atInitiator: number; atAuthorizer: number; atValidator: number;
  declinedLoans: number;
}>;

const numOr = (v: number | undefined, fallback: number): number => (typeof v === "number" && isFinite(v) ? v : fallback);

/** Overlay whatever real figures the server has onto the modeled dataset. Derived
 *  KPIs (clean OLB, PQS, composition, today's CR) recompute from the merged view;
 *  the time-series stays modeled until the live history backend lands. */
export function applyLive(data: DashboardData, live: LiveSnapshot): DashboardData {
  const k = { ...data.kpis };
  for (const key of Object.keys(live) as (keyof LiveSnapshot)[]) {
    const v = live[key];
    if (typeof v === "number" && isFinite(v)) (k as Record<string, number>)[key] = v;
  }
  const olb = k.olb, arrears = numOr(live.totalArrears, k.totalArrears);
  k.cleanOlb = Math.max(0, olb - arrears);
  k.cleanOlbCount = Math.max(0, k.activeLoans - Math.round(k.activeLoans * (k.par / 100) * 1.4));
  k.pqs = (k.cleanOlbCount / Math.max(1, k.activeLoans)) * 100;
  k.unpaidAmount = Math.max(0, k.dueAmount - k.paidAmount);
  k.unpaidCount = Math.max(0, k.dueCount - k.paidCount);
  k.todayCR = (k.paidAmount / Math.max(1, k.dueAmount)) * 100;
  k.percentageFunded = (k.activeLoans / Math.max(1, k.totalCustomers)) * 100;

  return {
    ...data,
    simulated: false,
    kpis: k,
    composition: [
      { name: "Clean book", value: k.cleanOlb, color: "#16a34a" },
      { name: "In arrears", value: Math.max(0, arrears - k.npl), color: "#f59e0b" },
      { name: "NPL", value: k.npl, color: "#ef4444" },
    ],
  };
}

// ── formatting ───────────────────────────────────────────────────────────────
export const KES = (n: number): string => `KES ${Math.round(n).toLocaleString("en-KE")}`;
export const compact = (n: number): string => {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${Math.round(n)}`;
};
export const KESc = (n: number): string => `KES ${compact(n)}`;
export const pct = (n: number): string => `${n.toFixed(1)}%`;

// ── seeded PRNG (mulberry32) ─────────────────────────────────────────────────
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedFrom = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

const SCOPE_SCALE: Record<Scope, number> = { entity: 1, unit: 0.36, agent: 0.085 };

/** Point count + label style per range. */
function grid(range: RangeKey): { n: number; unit: "hour" | "day" | "week" | "month" } {
  switch (range) {
    case "today": return { n: 11, unit: "hour" };   // 08:00 → 18:00
    case "7d": return { n: 7, unit: "day" };
    case "30d": return { n: 30, unit: "day" };
    case "qtd": return { n: 13, unit: "week" };
    case "ytd": return { n: new Date().getMonth() + 1, unit: "month" };
    case "12mo": return { n: 12, unit: "month" };
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function labelFor(unit: string, i: number, n: number): string {
  const now = new Date();
  if (unit === "hour") return `${String(8 + i).padStart(2, "0")}:00`;
  if (unit === "day") {
    const d = new Date(now); d.setDate(now.getDate() - (n - 1 - i));
    return n <= 7 ? DAYS[d.getDay()] : `${d.getDate()}/${d.getMonth() + 1}`;
  }
  if (unit === "week") return `W${i + 1}`;
  if (unit === "month") { const m = (now.getMonth() - (n - 1 - i) + 12) % 12; return MONTHS[m]; }
  return String(i + 1);
}

function buildSeries(range: RangeKey, scale: number, rand: () => number, lift: number): SeriesPoint[] {
  const { n, unit } = grid(range);
  const base = 2_450_000 * scale * (unit === "month" ? 22 : unit === "week" ? 5.5 : unit === "hour" ? 0.11 : 1);
  const out: SeriesPoint[] = [];
  for (let i = 0; i < n; i++) {
    const trend = 0.82 + (i / Math.max(1, n - 1)) * 0.42 * lift;            // upward drift
    const season = unit === "day" ? (DAYS_WEEKEND(i, n) ? 0.55 : 1) : unit === "hour" ? Math.sin((i / (n - 1)) * Math.PI) * 0.7 + 0.5 : 1;
    const noise = 0.8 + rand() * 0.45;
    const disbursed = Math.max(0, base * trend * season * noise);
    const collected = Math.max(0, disbursed * (1.02 + rand() * 0.5));       // collections run a touch above
    const due = collected * (1.05 + rand() * 0.2);
    const applications = Math.round((disbursed / (base || 1)) * (14 + rand() * 12));
    out.push({ key: `${i}`, label: labelFor(unit, i, n), disbursed, collected, due, applications });
  }
  return out;
}
function DAYS_WEEKEND(i: number, n: number): boolean {
  const d = new Date(); d.setDate(d.getDate() - (n - 1 - i));
  return d.getDay() === 0 || d.getDay() === 6;
}

/** Generate the full showcase dataset. */
export function simulate(range: RangeKey, scope: Scope, opts?: { seed?: string; currency?: string }): DashboardData {
  const scale = SCOPE_SCALE[scope];
  const rand = rng(seedFrom(`${opts?.seed ?? "mular"}|${range}|${scope}`));
  const currency = opts?.currency ?? "KES";

  const olb = 184_500_000 * scale * (0.97 + rand() * 0.06);
  const par = 7.8 + (rand() - 0.5) * 1.6;
  const nplRate = 4.1 + (rand() - 0.5) * 0.8;
  const totalArrears = olb * (par / 100);
  const npl = olb * (nplRate / 100);
  const cleanOlb = olb - totalArrears;
  const activeLoans = Math.round(3240 * scale * (0.97 + rand() * 0.06));
  const arrearsLoans = Math.round(activeLoans * (par / 100) * 1.4);
  const nplCount = Math.round(activeLoans * (nplRate / 100) * 1.2);
  const cleanOlbCount = activeLoans - arrearsLoans;
  const pqs = (cleanOlbCount / Math.max(1, activeLoans)) * 100;

  const series = buildSeries(range, scale, rand, 1);
  const prevSeries = buildSeries(range, scale, rng(seedFrom(`prev|${range}|${scope}`)), 0.86);

  const disbursedAmount = series.reduce((s, p) => s + p.disbursed, 0) * (range === "today" ? 1 : 0.16);
  const disbursedCount = Math.round(38 * scale * (range === "today" ? 1 : range === "7d" ? 6 : range === "30d" ? 24 : 90));
  const collectedAmount = series.reduce((s, p) => s + p.collected, 0) * (range === "today" ? 1 : 0.16);

  const dueAmount = 4_180_000 * scale * (0.9 + rand() * 0.2);
  const dueCount = Math.round(142 * scale);
  const paidAmount = dueAmount * (0.86 + rand() * 0.08);
  const paidCount = Math.round(dueCount * 0.84);
  const unpaidAmount = dueAmount - paidAmount;
  const unpaidCount = dueCount - paidCount;
  const prepaidAmount = 620_000 * scale * (0.8 + rand() * 0.4);
  const prepaidCount = Math.round(26 * scale);
  const arrearsPaid = 910_000 * scale * (0.8 + rand() * 0.5);

  const todayCR = (paidAmount / Math.max(1, dueAmount)) * 100;
  const prepaidCR = (prepaidAmount / Math.max(1, dueAmount)) * 100;
  const cpr = 88 + (rand() - 0.4) * 8;

  const aging: AgingBucket[] = [
    { bucket: "Current", amount: cleanOlb, count: cleanOlbCount, tone: "good" },
    { bucket: "1–30", amount: totalArrears * 0.42, count: Math.round(arrearsLoans * 0.44), tone: "warn" },
    { bucket: "31–60", amount: totalArrears * 0.24, count: Math.round(arrearsLoans * 0.22), tone: "warn" },
    { bucket: "61–90", amount: totalArrears * 0.18, count: Math.round(arrearsLoans * 0.18), tone: "high" },
    { bucket: "91–180", amount: totalArrears * 0.16, count: Math.round(arrearsLoans * 0.16), tone: "high" },
    { bucket: "180+ (NPL)", amount: npl, count: nplCount, tone: "bad" },
  ];

  const composition: Slice[] = [
    { name: "Clean book", value: cleanOlb, color: "#16a34a" },
    { name: "In arrears", value: Math.max(0, totalArrears - npl), color: "#f59e0b" },
    { name: "NPL", value: npl, color: "#ef4444" },
  ];

  const productMix: ProductRow[] = [
    { name: "Business Loan", olb: olb * 0.41, count: Math.round(activeLoans * 0.38) },
    { name: "School Fees", olb: olb * 0.23, count: Math.round(activeLoans * 0.24) },
    { name: "Salary Advance", olb: olb * 0.16, count: Math.round(activeLoans * 0.2) },
    { name: "Asset Finance", olb: olb * 0.12, count: Math.round(activeLoans * 0.09) },
    { name: "Emergency", olb: olb * 0.08, count: Math.round(activeLoans * 0.09) },
  ];

  const branchNames = ["Nairobi CBD", "Thika", "Nakuru", "Eldoret", "Mombasa", "Kisumu"];
  const branches: BranchRow[] = branchNames.map((name, i) => ({
    name,
    olb: olb * [0.3, 0.19, 0.16, 0.14, 0.12, 0.09][i],
    par: Math.max(1.5, par + (rand() - 0.5) * 6),
    officers: Math.round([14, 9, 8, 7, 6, 5][i] * (scope === "agent" ? 0.2 : scope === "unit" ? 0.5 : 1)) || 1,
  }));

  const spark = {
    olb: Array.from({ length: 12 }, (_, i) => olb * (0.78 + i * 0.02 + rand() * 0.02)),
    par: Array.from({ length: 12 }, () => par + (rand() - 0.5) * 2),
    collections: Array.from({ length: 12 }, () => collectedAmount * (0.7 + rand() * 0.6)),
    disbursed: Array.from({ length: 12 }, () => disbursedAmount * (0.7 + rand() * 0.6)),
  };

  return {
    kpis: {
      olb, cleanOlb, cleanOlbCount, activeLoans,
      totalCustomers: Math.round(5600 * scale), newCustomers: Math.round(148 * scale * (0.7 + rand() * 0.6)),
      par, pqs, totalArrears, arrearsLoans, npl, nplCount,
      nplCollected: 210_000 * scale * (0.6 + rand()), nplCollectedMonth: 1_640_000 * scale * (0.7 + rand() * 0.5),
      disbursedAmount, disbursedCount, collectedAmount,
      dueAmount, dueCount, paidAmount, paidCount, unpaidAmount, unpaidCount,
      prepaidAmount, prepaidCount, arrearsPaid,
      todayCR, prepaidCR, cpr,
      declinedLoans: Math.round(24 * scale * (0.6 + rand())), percentageFunded: (activeLoans / Math.round(5600 * scale)) * 100,
      atInitiator: Math.round(18 * scale) || 1, atAuthorizer: Math.round(9 * scale) || 1, atValidator: Math.round(4 * scale) || 1,
    },
    series, prevSeries, aging, composition, productMix, branches, spark,
    range, scope, simulated: true, currency,
  };
}
