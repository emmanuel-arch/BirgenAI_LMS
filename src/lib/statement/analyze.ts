// ─────────────────────────────────────────────────────────────────────────────
// The Internal Report — a deep, CRB-beating read of an M-Pesa statement.
//
// A CRB report tells you what someone BORROWED and whether they PAID. This reads
// the TEXT of the statement to tell you who the customer actually is: where their
// money goes, what they like, which lenders they already owe, how often they
// repay, and whether they can afford another instalment. It fuses that into one
// Internal Score (250–900, CRB-scale) with fully transparent reasons.
//
// It sits ON TOP of the existing cashflow engine (features.ts) — reusing its
// affordability read — and adds the merchant-taxonomy clustering and behavioural
// narrative that no bureau in this market sells. This is the payload the crunch
// API returns.
// ─────────────────────────────────────────────────────────────────────────────
import type { MpesaTxn } from "./mpesa-parser";
import { crunch, type CashflowFeatures, type Affordability, type MonthlyRow } from "./features";

// ── Life-category taxonomy (Kenyan merchant vocabulary) ───────────────────────
// Ordered by specificity: the first list whose keyword appears in the row's text
// wins, so "FAB LIQUOR HOUSE" lands in Alcohol before the generic Retail net.
export type LifeCategory =
  | "Transport" | "Fuel" | "Food & Dining" | "Groceries" | "Alcohol & Nightlife"
  | "Betting" | "Utilities" | "Airtime & Data" | "Retail & Shopping" | "Health"
  | "Education" | "Rent & Housing" | "Financial & Loans" | "Savings" | "Government"
  | "Transfers" | "Cash / ATM" | "Other";

const TAXONOMY: { cat: LifeCategory; kw: string[] }[] = [
  { cat: "Betting", kw: ["sportpesa", "betika", "odibets", "1xbet", "mozzart", "betway", "shabiki", "bangbet", "betlion", "mcheza", "kwikbet", "premierbet", "helabet", "melbet", "22bet", "chezacash", "betpawa", "elitebet", "dafabet", "aviator", "bet "] },
  { cat: "Alcohol & Nightlife", kw: ["liquor", "wines", "spirits", " bar", "club", "lounge", " pub", "tavern", "keg", "nightclub", "brew", "distillers", "cellar"] },
  { cat: "Fuel", kw: ["petrol", "total energ", "shell", "rubis", "oilibya", "ola energy", "petroleum", "fuel", "gapco", "hashi", "astrol", "energ", "oil "] },
  { cat: "Transport", kw: ["safari", "sacco", "matatu", "uber", "bolt", "little cab", "taxi", "shuttle", "travellers", "coach", "railway", "sgr", "boda", "logistics", "movers", "transport", "car hire", "fare"] },
  { cat: "Food & Dining", kw: ["restaurant", "cafe", "caffe", "coffee", "eatery", "grill", "kitchen", "kfc", "java", "artcaffe", "chicken", "pizza", "burger", "bakery", "fast food", "hotel", "nyama", "fries", "chips", "canteen", "foods", "deli", "cake"] },
  { cat: "Groceries", kw: ["naivas", "quickmart", "carrefour", "tuskys", "chandarana", "cleanshelf", "supermarket", "greengrocer", "grocers", "butchery", "mart ", "mini mart", "minimart", "wholesalers", "market"] },
  { cat: "Health", kw: ["pharmacy", "chemist", "hospital", "clinic", "medical", "healthcare", "afya", "dawa", "dental", "opticians", "diagnostic", "nursing", "wellness"] },
  { cat: "Education", kw: ["school", "college", "university", "academy", "tuition", "education", "bursary", "polytechnic", "kindergarten", "montessori", "learning", "institute"] },
  { cat: "Utilities", kw: ["kplc", "kenya power", "water", "gotv", "dstv", "zuku", "startimes", "electricity", "token", "garbage", "sanitation", "internet", "fibre", "faiba", "safaricom home"] },
  { cat: "Airtime & Data", kw: ["airtime", "bundles", " data", "credit purchase", "top up", "topup"] },
  { cat: "Rent & Housing", kw: ["rent", "apartments", "properties", "landlord", "housing", "estate", "gardens", "villas", "court "] },
  { cat: "Savings", kw: ["m-shwari", "mshwari", "kcb m-pesa", "lock savings", "savings", "sacco savings", "goal"] },
  { cat: "Financial & Loans", kw: ["bank", "equity", "co-op", "cooperative", "co-operative", "kcb", "absa", "ncba", "dtb", "stanbic", "family bank", "sidian", "gulf african", "i&m", "national bank", "housing finance", "hfc", "microfinance", "capital", "investments", "insurance", "chama", "credit ltd", "loan", "finance", "fund", "mortgage"] },
  { cat: "Government", kw: ["ntsa", "ecitizen", " kra", "county", "government", "huduma", "itax", "ntsa", "immigration", "registrar"] },
  { cat: "Retail & Shopping", kw: ["shop", "stores", "boutique", "collection", "traders", "enterprises", "hardware", "electronics", "phones", "fashion", "clothing", "textiles", "cosmetics", "salon", "barber", "beauty", "furniture", "agrovet", "stationery"] },
];

// Digital / formal lenders whose name in the row means the customer already owes.
const LENDERS = ["tala", "branch", "zenka", "okash", "timiza", "stawi", "zash", "ipesa", "berry", "mfanisi", "hustler fund", "kcb m-pesa", "m-shwari", "mshwari", "fuliza", "saida", "lpesa", "kuwazo", "okolea", "champion", "credable", "izwe", "platinum credit", "momentum credit", "ngao", "premier credit", "musoni", "faulu", "kwft", "credit ltd", "microfinance", "axe", "micromart","mular"];

const cap = (n: number) => Math.round(n);
const has = (s: string, kw: string[]) => kw.some((k) => s.includes(k));

function lifeCategory(t: MpesaTxn): LifeCategory {
  const s = t.details.toLowerCase();
  if (t.isGambling) return "Betting";
  if (t.category === "withdraw") return "Cash / ATM";
  if (t.category === "airtime") return "Airtime & Data";
  if (t.category === "send_money") return "Transfers";
  if (t.category === "loan_repay" || t.category === "loan_in") return "Financial & Loans";
  for (const { cat, kw } of TAXONOMY) if (has(s, kw)) return cat;
  if (t.category === "paybill" || t.category === "till") return "Retail & Shopping";
  return "Other";
}

// Extract the human merchant name from a "… - NAME" / "to <till> - NAME" row.
function merchantName(details: string): string {
  const dash = details.split(" - ");
  let name = dash.length > 1 ? dash[dash.length - 1] : details;
  name = name.replace(/\b\d{5,}\b/g, "").replace(/\b(KD[A-Z]\s?\d{3}[A-Z]?)\b/gi, "").trim();
  return (name || details).replace(/\s{2,}/g, " ").slice(0, 48).trim();
}

// ── Report shape (the API payload) ────────────────────────────────────────────
export type CategorySpend = { category: LifeCategory; amount: number; count: number; share: number };
export type MerchantSpend = { name: string; category: LifeCategory; amount: number; count: number };
export type LenderExposure = { name: string; borrowed: number; repaid: number; events: number };
export type Highlight = { tone: "positive" | "watch" | "negative"; label: string; detail: string };

export type InternalScore = {
  value: number;      // 250–900, CRB-scale
  band: "Excellent" | "Good" | "Fair" | "Poor" | "Very Poor";
  drivers: { factor: string; direction: "up" | "down"; points: number; detail: string }[];
};

export type InternalReport = {
  generatedAt: string;
  period: { start: string | null; end: string | null; months: number; txns: number };
  score: InternalScore;
  affordability: Affordability;
  features: CashflowFeatures;
  monthly: MonthlyRow[];
  spendByCategory: CategorySpend[];
  topMerchants: MerchantSpend[];
  loanBehaviour: {
    lenders: LenderExposure[];
    repaymentCadence: "weekly" | "biweekly" | "monthly" | "irregular" | "none";
    activeExposureEstimate: number;   // borrowed − repaid over the window
    fulizaReliant: boolean;
  };
  lifestyle: { tags: string[]; narrative: string };
  highlights: Highlight[];
};

function median(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function cadence(dates: string[]): InternalReport["loanBehaviour"]["repaymentCadence"] {
  if (dates.length < 2) return dates.length ? "irregular" : "none";
  const ds = [...new Set(dates)].sort();
  const gaps: number[] = [];
  for (let i = 1; i < ds.length; i++) gaps.push((new Date(ds[i]).getTime() - new Date(ds[i - 1]).getTime()) / 86_400_000);
  const g = median(gaps.filter((x) => x > 0));
  if (g <= 9) return "weekly";
  if (g <= 18) return "biweekly";
  if (g <= 38) return "monthly";
  return "irregular";
}

export function analyzeStatement(txns: MpesaTxn[]): InternalReport {
  const { features: f, monthly, affordability } = crunch(txns);
  const outs = txns.filter((t) => t.direction === "out");
  const grossOut = outs.reduce((s, t) => s + t.amount, 0) || 1;

  // Category clustering
  const byCat = new Map<LifeCategory, { amount: number; count: number }>();
  const byMerchant = new Map<string, { category: LifeCategory; amount: number; count: number }>();
  for (const t of outs) {
    const cat = lifeCategory(t);
    const c = byCat.get(cat) ?? { amount: 0, count: 0 };
    c.amount += t.amount; c.count += 1; byCat.set(cat, c);
    if (t.category === "till" || t.category === "paybill" || cat === "Alcohol & Nightlife" || cat === "Food & Dining" || cat === "Betting" || cat === "Fuel" || cat === "Transport") {
      const key = merchantName(t.details).toLowerCase();
      const m = byMerchant.get(key) ?? { category: cat, amount: 0, count: 0 };
      m.amount += t.amount; m.count += 1; byMerchant.set(key, m);
    }
  }
  const spendByCategory: CategorySpend[] = [...byCat.entries()]
    .map(([category, v]) => ({ category, amount: cap(v.amount), count: v.count, share: Number((v.amount / grossOut).toFixed(3)) }))
    .sort((a, b) => b.amount - a.amount);
  const topMerchants: MerchantSpend[] = [...byMerchant.entries()]
    .map(([name, v]) => ({ name: merchantTitle(name), category: v.category, amount: cap(v.amount), count: v.count }))
    .sort((a, b) => b.amount - a.amount).slice(0, 12);

  // Loan behaviour — only ACTUAL borrow/repay events count (a purchase that merely
  // mentions a lender is not exposure). Fuliza overdrafts book as "OverDraft of
  // Credit Party"; map those to Fuliza rather than "other lender".
  const lenderMap = new Map<string, LenderExposure>();
  for (const t of txns) {
    if (t.category !== "loan_in" && t.category !== "loan_repay") continue;
    const s = t.details.toLowerCase();
    const hit = LENDERS.find((l) => l !== "credit ltd" && l !== "microfinance" && l !== "fuliza" && s.includes(l));
    const isFuliza = s.includes("overdraft of credit party") || s.includes("fuliza") || s.includes("od loan repayment") || s.includes("overdraw");
    const key = hit ?? (isFuliza ? "fuliza" : "other lender");
    const e = lenderMap.get(key) ?? { name: lenderTitle(key), borrowed: 0, repaid: 0, events: 0 };
    if (t.category === "loan_in") e.borrowed += t.amount;
    if (t.category === "loan_repay") e.repaid += t.amount;
    e.events += 1; lenderMap.set(key, e);
  }
  const lenders = [...lenderMap.values()].map((e) => ({ ...e, borrowed: cap(e.borrowed), repaid: cap(e.repaid) })).sort((a, b) => b.borrowed - a.borrowed);
  const repayDates = txns.filter((t) => t.category === "loan_repay").map((t) => t.date);
  const fulizaReliant = txns.filter((t) => t.details.toLowerCase().includes("fuliza")).length >= 4;

  // Lifestyle tags + narrative
  const catShare = (c: LifeCategory) => (byCat.get(c)?.amount ?? 0) / grossOut;
  const tags: string[] = [];
  if (catShare("Fuel") > 0.04) tags.push("Drives / commutes (regular fuel)");
  if (catShare("Transport") > 0.05) tags.push("Frequent transport spend");
  if ((byCat.get("Food & Dining")?.count ?? 0) >= 4) tags.push("Eats out often");
  if (catShare("Groceries") > 0.05) tags.push("Supermarket regular");
  if ((byCat.get("Alcohol & Nightlife")?.amount ?? 0) > 0) tags.push("Nightlife / alcohol present");
  if (f.gamblingRatio > 0.02) tags.push("Active bettor");
  if (catShare("Health") > 0.03) tags.push("Notable health spend");
  if (catShare("Education") > 0.03) tags.push("Pays school fees");
  if (catShare("Savings") > 0.03) tags.push("Saves regularly");
  const DISCRETIONARY: LifeCategory[] = ["Food & Dining", "Alcohol & Nightlife", "Betting", "Retail & Shopping", "Transport", "Fuel"];
  const topCat = spendByCategory.find((c) => DISCRETIONARY.includes(c.category));
  const narrative = buildNarrative(f, spendByCategory, lenders, topCat?.category);

  // ── Internal Score (250–900), transparent drivers ────────────────────────────
  const drivers: InternalScore["drivers"] = [];
  let score = 250 + Math.round((affordability.score / 100) * 500); // 250–750 from affordability
  drivers.push({ factor: "Cashflow affordability", direction: "up", points: 250 + Math.round((affordability.score / 100) * 500) - 250, detail: `${affordability.band} — score ${affordability.score}/100.` });
  const add = (cond: boolean, pts: number, factor: string, detail: string) => {
    if (!cond) return; score += pts; drivers.push({ factor, direction: pts >= 0 ? "up" : "down", points: pts, detail });
  };
  add(f.incomeMonthsRatio >= 0.8, 40, "Earns every month", `Income in ${Math.round(f.incomeMonthsRatio * 100)}% of months.`);
  add(f.incomeVolatility <= 0.5 && f.avgMonthlyIncome > 0, 30, "Stable income", `Low volatility (${f.incomeVolatility}).`);
  add(f.incomeVolatility > 1, -35, "Erratic income", `High volatility (${f.incomeVolatility}).`);
  add(f.balanceTrend > 0, 20, "Balance growing", "Closing balance above opening.");
  add(f.gamblingRatio > 0.02, -Math.min(90, Math.round(f.gamblingRatio * 350)), "Betting activity", `${Math.round(f.gamblingRatio * 100)}% of outflow to betting.`);
  add(f.loanDependencyRatio > 0.15, -Math.min(70, Math.round(f.loanDependencyRatio * 180)), "Loan-stacking", `${Math.round(f.loanDependencyRatio * 100)}% of inflow is borrowed, ${lenders.length} lender(s).`);
  add(fulizaReliant, -25, "Fuliza reliant", "Frequent overdraft use.");
  add(catShare("Savings") > 0.03, 25, "Saves", "Regular transfers to savings.");
  score = Math.max(250, Math.min(900, score));
  const band: InternalScore["band"] = score >= 800 ? "Excellent" : score >= 700 ? "Good" : score >= 600 ? "Fair" : score >= 450 ? "Poor" : "Very Poor";

  // Highlights
  const highlights: Highlight[] = [];
  if (affordability.recommendedMaxInstallment > 0) highlights.push({ tone: "positive", label: "Affordable instalment", detail: `Comfortably services ~KES ${affordability.recommendedMaxInstallment.toLocaleString()}/mo.` });
  if (lenders.length) highlights.push({ tone: lenders.length > 2 ? "negative" : "watch", label: `${lenders.length} existing lender(s)`, detail: lenders.slice(0, 3).map((l) => l.name).join(", ") + "." });
  if (f.gamblingRatio > 0.05) highlights.push({ tone: "negative", label: "Heavy betting", detail: `KES ${f.gamblingOutflow.toLocaleString()} to betting.` });
  if (f.incomeMonthsRatio >= 0.8 && f.incomeVolatility <= 0.5) highlights.push({ tone: "positive", label: "Reliable earner", detail: "Steady income every month." });

  return {
    generatedAt: new Date().toISOString(),
    period: { start: f.periodStart, end: f.periodEnd, months: f.monthsCovered, txns: f.txnCount },
    score: { value: score, band, drivers },
    affordability, features: f, monthly,
    spendByCategory, topMerchants,
    loanBehaviour: { lenders, repaymentCadence: cadence(repayDates), activeExposureEstimate: cap(f.loanInflow - f.loanRepayOutflow), fulizaReliant },
    lifestyle: { tags, narrative },
    highlights,
  };
}

function merchantTitle(lower: string): string {
  return lower.replace(/\b\w/g, (c) => c.toUpperCase()) || "Unknown merchant";
}
function lenderTitle(key: string): string {
  const t: Record<string, string> = { "m-shwari": "M-Shwari", "mshwari": "M-Shwari", "kcb m-pesa": "KCB M-Pesa", "fuliza": "Fuliza", "hustler fund": "Hustler Fund", "other lender": "Other lender" };
  return t[key] ?? key.replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildNarrative(f: CashflowFeatures, cats: CategorySpend[], lenders: LenderExposure[], topCat?: LifeCategory): string {
  const parts: string[] = [];
  parts.push(`Over ${f.monthsCovered} month${f.monthsCovered === 1 ? "" : "s"}, this customer received ~KES ${f.avgMonthlyIncome.toLocaleString()}/mo and spent ~KES ${f.avgMonthlyExpense.toLocaleString()}/mo, ${f.avgMonthlyNet >= 0 ? `keeping ~KES ${f.avgMonthlyNet.toLocaleString()}` : `overspending by ~KES ${Math.abs(f.avgMonthlyNet).toLocaleString()}`} on average.`);
  if (topCat) parts.push(`Their biggest discretionary category is ${topCat}.`);
  if (lenders.length) parts.push(`They are already servicing ${lenders.length} lender${lenders.length === 1 ? "" : "s"} (${lenders.slice(0, 3).map((l) => l.name).join(", ")}).`);
  if (f.gamblingRatio > 0.02) parts.push(`${Math.round(f.gamblingRatio * 100)}% of outflow goes to betting.`);
  return parts.join(" ");
}
