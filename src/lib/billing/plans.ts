// ─────────────────────────────────────────────────────────────────────────────
// BirgenAI_LMS — the four packages.
//
// WHY THIS IS CODE AND NOT A TABLE. A price book changes rarely and deliberately.
// In code it gets a diff, a review and a deploy; in a table it gets an UPDATE that
// silently re-prices every lender on the platform, with no record of what the
// price used to be. What DOES belong in the database is the per-org commercial
// reality — billing period, payment status, and the overrides a salesperson
// negotiates (OrgSubscription.featureOverrides / includedOverrides / seatsOverride) —
// and the price AS CHARGED, snapshotted onto every UsageEvent so an invoice is
// reproducible forever no matter how this file later moves.
//
// WHO OWNS THE PRICE. The Hub is the money system: every platform payment goes
// through its wallet and its rate card (birgen-ai-frontend/src/lib/billing/ratecard.ts),
// which recomputes the amount server-side at charge time and never trusts a caller.
// The monthly fees below are a MIRROR of that catalogue, used to render an estimate
// and to gate features locally. If the two ever drift, the Hub wins on money and
// this file is wrong — which is why the billing page says "estimate" and why the
// unit cost is frozen onto each usage event as it happens.
//
// Unit costs deliberately match the Hub's RATE_CARD so the platform never quotes
// two different prices for the same CRB pull.
// ─────────────────────────────────────────────────────────────────────────────
import type { OrgPlan } from "@prisma/client";

/** Gated capabilities. Names track the Hub's EnterpriseApp vocabulary. */
export type Feature =
  | "credit-score" // real-time scoring on every application
  | "statement-cruncher" // M-Pesa statement → cashflow features
  | "document-parser" // IDs, fee structures, invoices → structured data
  | "crb" // CRB orchestrator (pass-through cost)
  | "id-verify" // IPRS + liveness + face match + portrait
  | "riri" // the console AI, all three models
  | "route-planner" // RO geo-verification + routing
  | "portfolio-scan" // portfolio early-warning
  | "model-tuning"; // per-lender model calibration

/**
 * What we have actually BUILT. A feature absent from this list is on the roadmap:
 * it is never granted, never gated, never metered, and never sold.
 *
 * This exists because the catalogue and the code drifted once already — three
 * features were priced into the packages before anything implemented them, and a
 * lender on Advanced was paying 20,000 for a route planner that Starter also had.
 * Selling a capability we cannot deliver is worse than not offering it, so the
 * ladder is filtered through this list rather than trusted. Add a feature here in
 * the same commit that makes it real; `verify-billing` fails if a plan sells
 * anything this list does not name.
 */
export const AVAILABLE_FEATURES: Feature[] = [
  "credit-score",
  "statement-cruncher",
  "document-parser",
  "crb",
  "id-verify",
  "riri",
  "route-planner",
  "portfolio-scan",
  "model-tuning",
];

export const isAvailable = (f: Feature): boolean => AVAILABLE_FEATURES.includes(f);

/** Everything we meter. Must match the strings written to UsageEvent.kind. */
export type UsageKind = "score" | "statement" | "document" | "crb" | "kyc" | "riri_query" | "sms";

export const USAGE_KINDS: UsageKind[] = ["score", "statement", "document", "crb", "kyc", "riri_query", "sms"];

export const USAGE_LABEL: Record<UsageKind, string> = {
  score: "Credit scores",
  statement: "Statements crunched",
  document: "Documents parsed",
  crb: "CRB reports",
  kyc: "Identity verifications",
  riri_query: "Riri queries",
  sms: "SMS sent",
};

/**
 * Overage price per unit, in KES. Charged only past a plan's included allowance.
 * CRB and identity carry a real third-party cost; the compute-only ones are priced
 * barely above zero because the value is in the plan, not the click.
 */
export const UNIT_PRICE_KES: Record<UsageKind, number> = {
  score: 10,
  statement: 5,
  document: 5,
  crb: 35, // pass-through: the bureau bills us
  kyc: 40, // pass-through: the licensed KYC provider bills us
  riri_query: 3,
  sms: 1,
};

export type PlanDef = {
  key: OrgPlan;
  name: string;
  monthlyKes: number;
  blurb: string;
  features: Feature[];
  /** Included units per billing month. Absent ⇒ zero included. */
  included: Partial<Record<UsageKind, number>>;
  /** Staff seats. null = unlimited. */
  seats: number | null;
};

// The ladder ascends by price. Note "Enterprise" sits at tier 2 by the founder's
// naming, so it is NOT the top package — Premium is.
//
// Everything on this ladder is built. Add a feature here only in the same commit that
// implements it and lists it in AVAILABLE_FEATURES — `verify-billing` enforces that.
const STARTER_FEATURES: Feature[] = ["credit-score", "statement-cruncher", "document-parser"];
const ENTERPRISE_FEATURES: Feature[] = [...STARTER_FEATURES, "crb", "id-verify"];
const ADVANCED_FEATURES: Feature[] = [...ENTERPRISE_FEATURES, "riri", "route-planner"];
const PREMIUM_FEATURES: Feature[] = [...ADVANCED_FEATURES, "portfolio-scan", "model-tuning"];

export const PLANS: Record<OrgPlan, PlanDef> = {
  STARTER: {
    key: "STARTER",
    name: "Starter",
    monthlyKes: 10_000,
    blurb: "Lend on our rails. The full loan book, credit scoring, the M-Pesa cruncher and the document parser.",
    features: STARTER_FEATURES,
    included: { score: 300, statement: 150, document: 100, sms: 500 },
    seats: 5,
  },
  ENTERPRISE: {
    key: "ENTERPRISE",
    name: "Enterprise",
    monthlyKes: 15_000,
    blurb: "Know who you are lending to. Adds the CRB orchestrator and the ID verifier.",
    features: ENTERPRISE_FEATURES,
    included: { score: 1_000, statement: 500, document: 300, crb: 100, kyc: 150, sms: 1_000 },
    seats: 15,
  },
  ADVANCED: {
    key: "ADVANCED",
    name: "Advanced",
    monthlyKes: 20_000,
    blurb: "Run the book with AI. Adds Riri across the console and the RO route planner.",
    features: ADVANCED_FEATURES,
    included: { score: 3_000, statement: 1_500, document: 800, crb: 300, kyc: 400, riri_query: 2_000, sms: 2_000 },
    seats: 40,
  },
  PREMIUM: {
    key: "PREMIUM",
    name: "Premium",
    monthlyKes: 30_000,
    blurb: "See defaults coming. Adds portfolio early-warning, your own risk policy and unlimited seats.",
    features: PREMIUM_FEATURES,
    included: { score: 10_000, statement: 5_000, document: 3_000, crb: 1_000, kyc: 1_500, riri_query: 10_000, sms: 5_000 },
    seats: null,
  },
};

/** Ascending by price — the order the pricing page renders. */
export const PLAN_ORDER: OrgPlan[] = ["STARTER", "ENTERPRISE", "ADVANCED", "PREMIUM"];

export const planFor = (plan: OrgPlan): PlanDef => PLANS[plan] ?? PLANS.STARTER;

/**
 * The cheapest plan that includes `feature` — what an upgrade prompt should offer.
 * Null for a roadmap feature: there is no price at which we can sell it today.
 */
export function cheapestPlanWith(feature: Feature): PlanDef | null {
  if (!isAvailable(feature)) return null;
  for (const key of PLAN_ORDER) {
    if (PLANS[key].features.includes(feature)) return PLANS[key];
  }
  return null;
}

/** The features a plan actually delivers today. */
export function deliverableFeatures(plan: PlanDef): Feature[] {
  return plan.features.filter(isAvailable);
}

/** A metered kind is billable only if the feature behind it exists. */
export function isBillableKind(kind: UsageKind): boolean {
  const feature = KIND_FEATURE[kind];
  return feature === null || isAvailable(feature);
}

/** Which feature does this metered kind belong to? Used to gate before metering. */
export const KIND_FEATURE: Record<UsageKind, Feature | null> = {
  score: "credit-score",
  statement: "statement-cruncher",
  document: "document-parser",
  crb: "crb",
  kyc: "id-verify",
  riri_query: "riri",
  sms: null, // comms are part of every plan
};
