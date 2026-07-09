// ─────────────────────────────────────────────────────────────────────────────
// Riri Copilot (2.5) + Riri Max (3.0) — the reasoning tiers.
//
// SIMULATION-FIRST, exactly like the KYC provider: with no AI key in the vault
// these answer from a curated, platform-aware microfinance corpus so a demo is
// indistinguishable from production — grounded in THIS console (Workflows,
// Products, Repayments, Float, STK, Field, Settings → Vault). The moment an LLM
// key is provisioned, `llmMode` flips to "live" and the same call sites can call
// the real model. Copilot answers as a hands-on operator; Max reframes the same
// substance as a board-ready strategy note (the "deep reasoning" PRO tier).
// ─────────────────────────────────────────────────────────────────────────────
import type { RiriModelId } from "./models";

export type LlmMode = "simulation" | "live";

/** Live when an LLM key is provisioned (platform env for now; a per-org vault
 *  `AI` integration kind is the future — the seam is here, not at the call site). */
export async function llmMode(_orgId: string): Promise<LlmMode> {
  return process.env.RIRI_LLM_KEY ? "live" : "simulation";
}

type Topic = {
  id: string;
  keys: RegExp;
  title: string;
  summary: string;
  steps: string[];
  tip: string; // "In the console: …"
  watch: string[]; // Max: what to monitor
  closing: string; // Max: strategic close
};

const TOPICS: Topic[] = [
  {
    id: "par",
    keys: /\bpar\b|arrears|overdue|delinquen|reduce.*(risk|default)|collections?|late payment/,
    title: "Bringing down PAR 30",
    summary:
      "PAR usually concentrates in a handful of cohorts, not evenly across the book. The fastest wins come from segmenting the arrears, not blanket chasing everyone.",
    steps: [
      "Open Repayments → sort active loans by days-past-due and isolate the 1–7 day bucket; a same-day SMS + STK link here recovers most before it hardens.",
      "For 8–30 days, trigger a field visit from the Field module — the nearest agent is auto-allocated, and an in-person touch on early arrears outperforms calls.",
      "Restructure genuine hardship cases rather than let them roll; a realistic schedule beats a defaulted write-off.",
      "Tighten the front door: raise minCreditScore on the product that is over-represented in your arrears so you stop feeding the problem.",
    ],
    tip: "the PAR 30 tile on your dashboard and the arrears cron (05:00 daily) already flag and SMS overdue borrowers — lean on it.",
    watch: ["PAR 30 by product and by officer", "roll rates between the 1–7 / 8–30 / 30+ buckets", "cure rate on restructured loans"],
    closing: "Target the cohort driving the ratio, not the ratio itself — a 2-point PAR move almost always traces to one product or one branch.",
  },
  {
    id: "product",
    keys: /design.*(product|loan)|new product|product.*(design|structure)|loan product|create.*loan/,
    title: "Designing a loan product",
    summary:
      "A product is a risk-priced contract: principal band, tenor, interest method and the workflow that approves it. Start narrow and let repayment data widen it.",
    steps: [
      "In Products, set a tight min/max principal for a first cohort — small tickets let you learn cheaply before you scale exposure.",
      "Pick the interest method deliberately: flat is simpler for short tenors; reducing-balance is fairer and better for longer ones (the schedule engine handles both).",
      "Match tenor to the borrower's cashflow cycle — weekly for traders, monthly for salaried; the repayment period drives your installment plan.",
      "Attach an approval workflow and, for anything above your comfort line, require OTP + a finalize amount cap on the validator stage.",
    ],
    tip: "clone an existing product and adjust — limits, rate and workflow are all editable per product without touching code.",
    watch: ["first-cycle default rate on the new product", "average ticket vs. limit utilisation", "graduation rate into the next tier"],
    closing: "Price for the cohort you can measure, not the one you hope for; widen limits only as realised repayment earns it.",
  },
  {
    id: "workflow",
    keys: /workflow|approval (chain|stage|process|flow)|maker[- ]?checker|two[- ]?tier|authoriz|who approves/,
    title: "Setting up an approval workflow",
    summary:
      "Approvals mirror ServiceSuite's Initiator → Authorizer → Validator tiers. The point is separation of duties: whoever originates a loan should never be the one who finalizes disbursement.",
    steps: [
      "In Workflows, build a stage chain: an Initiator (tier 1) stage for the officer, then a Validator (tier 3) stage that can finalize.",
      "Turn on OTP on the finalizing stage and set a maxAmount cap so large loans need a second, higher-authority pass.",
      "In Team & Roles, assign staff their tiers — maker-checker auto-activates once you have two or more active staff.",
      "Assign the workflow to each product (new vs. repeat can differ — repeat borrowers can ride a lighter chain).",
    ],
    tip: "if you leave a product without a workflow it falls back to the built-in two-tier default, so nothing is ever unguarded.",
    watch: ["approval turnaround time per stage", "override/exception frequency", "disbursements finalized without a second signer"],
    closing: "Controls should scale with ticket size — keep small loans frictionless and reserve the heavy chain for where the money actually is.",
  },
  {
    id: "kyc",
    keys: /kyc|onboard|verify.*(identity|customer|borrower)|liveness|face match|iprs|id check/,
    title: "Tightening onboarding & KYC",
    summary:
      "Every rejected fraud at the door is a default you never have to collect. The elite funnel gates quality before it ever scores an applicant.",
    steps: [
      "Keep the ID quality gate strict — blurry or glare-hit captures are rejected and re-taken, so OCR and face-match run on clean inputs.",
      "Treat the face-match 'review' band as a human queue, not an auto-pass; only clear matches should sail through.",
      "Use IPRS confirmation as the identity anchor, and a consented one-time geo-pin to ground where the business actually is.",
      "For SME loans, schedule a Field business-verification so an agent confirms the shop and stock physically exist.",
    ],
    tip: "KYC runs in high-fidelity simulation until you add a Smile ID key in Settings → Vault — then the same funnel goes live with no flow change.",
    watch: ["face-match review-band volume", "IPRS mismatch rate", "field-verification fail rate by area"],
    closing: "Fraud losses are cheapest to prevent at onboarding; a dollar of KYC rigor saves several in collections.",
  },
  {
    id: "disbursement",
    keys: /disburs|float|b2c|payout|send money|pay out|maker checker.*disb/,
    title: "Disbursement & float discipline",
    summary:
      "Disbursement is where operational risk is highest — it moves real money out. Maker-checker plus a live float ledger keeps it controlled and auditable.",
    steps: [
      "Fund your B2C float and watch the ledger — the queue guards against disbursing below your float balance.",
      "Keep maker and checker as different people; the queue enforces it once you have two active staff.",
      "For orgs without B2C credentials, use the manual-confirm path — pay outside, record the M-Pesa ref, and the loan still activates cleanly.",
      "Reconcile daily: confirmed disbursements against float debits should tie out to the shilling.",
    ],
    tip: "native orgs disburse via their own Daraja B2C keys from Settings → Vault; bridged orgs keep disbursement lender-side.",
    watch: ["float burn-down vs. top-ups", "time from approval to disbursement", "manual-confirm share of total payouts"],
    closing: "Never let the queue outrun the float — a stalled disbursement is a broken promise to a borrower who already counted on the money.",
  },
  {
    id: "pricing",
    keys: /pricing|interest rate|price.*(loan|credit)|rate cut|charge.*interest|how much.*charge/,
    title: "Pricing & interest strategy",
    summary:
      "Your rate has to cover cost of funds, expected loss and operating cost, then leave margin. If defaults rise, the answer is usually better selection, not a higher rate that chases good borrowers away.",
    steps: [
      "Anchor the rate to the product's realised default rate — Riri Analyst can show you that per product.",
      "Use reducing-balance for longer tenors so the effective rate is transparent and defensible to regulators.",
      "Reserve your sharpest pricing for graduated, proven repeat borrowers — loyalty priced right lifts retention.",
      "Model any rate change against volume: a small cut that grows a well-selected book can beat a high rate on a shrinking one.",
    ],
    tip: "interest method and rate are per-product in Products — you can run a cheaper repeat-borrower product alongside a standard one.",
    watch: ["risk-adjusted yield per product", "price elasticity on repeat cohorts", "margin after expected loss, not before"],
    closing: "Compete on selection and speed, not just price — the lender who scores best can afford to charge least.",
  },
  {
    id: "growth",
    keys: /grow|scale|expand|increase.*(book|loan size|ticket)|average loan size|bigger loans|strategy/,
    title: "Growing the book responsibly",
    summary:
      "Growth that outruns your data is how microfinance books blow up. Scale the cohorts that have already proven they repay, and let graduation — not ambition — set your limits.",
    steps: [
      "Grow through graduation: reward on-time repayers with a higher limit on their next cycle rather than lifting limits across the board.",
      "Expand where your realised default rate is lowest first — Analyst shows you which product and segment that is.",
      "Add distribution (new branches/agents via Field) before you loosen credit; more reach beats looser rules.",
      "Keep PAR 30 flat as volume rises — if it climbs with growth, you're buying volume with future losses.",
    ],
    tip: "the graduation counter on each borrower and the closed ML loop already track who's earned a bigger limit.",
    watch: ["PAR 30 trend against disbursement growth", "vintage curves by cohort", "limit utilisation vs. repayment"],
    closing: "The best growth is boring: same underwriting, more good borrowers. Chase the second word, never relax the first.",
  },
];

const GENERAL_COPILOT =
  "I can help with the operational side of running your lender — collections and PAR, product design, approval workflows, KYC, disbursement and float, pricing, and growth. Tell me the situation and I'll give you concrete next steps grounded in this console.\n\nFor anything about your actual numbers — OLB, PAR, disbursed, collected, outcomes — switch me to **Riri Analyst**; I read your live book directly.";

const GENERAL_MAX =
  "**Strategy note**\n\nGive me the decision you're weighing — a pricing move, an expansion, a portfolio risk, a capital question — and I'll reason it end-to-end: the trade-offs, what the data would have to say to justify each path, and what I'd watch after you act.\n\nFor the underlying figures, **Riri Analyst** reads your live book; I'll build the strategy on top of them.";

const bullets = (xs: string[]) => xs.map((s) => `- ${s}`).join("\n");
const steps = (xs: string[]) => xs.map((s, i) => `${i + 1}. ${s}`).join("\n");

function match(question: string): Topic | null {
  const q = question.toLowerCase();
  let best: Topic | null = null, bestScore = 0;
  for (const t of TOPICS) {
    const m = q.match(new RegExp(t.keys, "g"));
    const score = m ? m.length : 0;
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return best;
}

/** Practical operator answer (Copilot). */
export function answerCopilot(question: string): string {
  const t = match(question);
  if (!t) return GENERAL_COPILOT;
  return `**${t.title}**\n\n${t.summary}\n\n${steps(t.steps)}\n\nIn the console: ${t.tip}`;
}

/** Board-ready strategy note (Max) — same substance, strategic framing. */
export function answerMax(question: string): string {
  const t = match(question);
  if (!t) return GENERAL_MAX;
  return (
    `**${t.title} — strategy note**\n\n` +
    `${t.summary}\n\n` +
    `**Levers**\n${bullets(t.steps)}\n\n` +
    `**What I'd watch**\n${bullets(t.watch)}\n\n` +
    `**Bottom line** — ${t.closing}`
  );
}

/** Unified entry for the API. Simulation for now; the live seam is llmMode. */
export async function answerReasoning(model: Exclude<RiriModelId, "analyst">, orgId: string, question: string): Promise<{ answer: string; mode: LlmMode }> {
  const mode = await llmMode(orgId);
  // When mode === "live", a real LLM call would slot in here behind the same
  // contract; until an AI key is provisioned we serve the curated corpus.
  const answer = model === "max" ? answerMax(question) : answerCopilot(question);
  return { answer, mode };
}
