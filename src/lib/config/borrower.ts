// ─────────────────────────────────────────────────────────────────────────────
// THE BORROWER NAMESPACE — everything a lender decides about who their customers
// are, how they are numbered, what they must prove, and what they may borrow.
//
// This is the first Tenant Definition Layer document (docs/SUPER-LMS-ARCHITECTURE.md).
// The system it replaces spreads the same ideas across one wide `BorrowerSettings`
// table and SEVEN hand-written POST handlers, each with its own 40-line MERGE —
// `KycSettings`, `AccountSettings`, `LoanLimitSettings`, `CreditScoreSettings`,
// `OnboardingRules`, `OnboardingWelcomeSms`, `OnboardingAttachments`. Here it is one
// typed document, one endpoint, one renderer, and one validator.
//
// Everything a lender did not set falls back to a platform default, so a new
// setting appears for everyone WITHOUT overwriting anyone's choices — the thing an
// ALTER TABLE can never do.
//
// WHAT WE ADD THAT THEY DO NOT HAVE:
//   · scoring.schedule — scoring the book on a cadence, not only at application.
//     Their system scores a customer when someone remembers to press the button.
//   · kyc field `verify` — which identity fields are checked against the national
//     registry rather than merely typed in.
//   · limit.laddering — a graduation ladder, so a good repayer's ceiling rises by
//     rule instead of by a manager's memory.
// ─────────────────────────────────────────────────────────────────────────────

import { normaliseBindings, type CheckBinding } from "@/lib/workflow/checks";

// ── KYC fields ────────────────────────────────────────────────────────────────

/** The identity fields the console and the portal both render. */
export const KYC_FIELDS = [
  { key: "firstName", label: "First name", desc: "Borrower's first name", lockRequired: true },
  { key: "otherName", label: "Other name", desc: "Middle and last names" },
  { key: "dob", label: "Date of birth", desc: "Drives the age rule below" },
  { key: "gender", label: "Gender", desc: "Male / Female" },
  { key: "nationalId", label: "National ID / Passport", desc: "The identity document number", lockRequired: true, canVerify: true },
  { key: "phone", label: "Phone number", desc: "Primary telephone — also the M-Pesa number", lockRequired: true, canVerify: true },
  { key: "email", label: "Email address", desc: "Primary email address" },
  { key: "postalAddress", label: "Postal address", desc: "Postal address" },
  { key: "physicalAddress", label: "Physical address", desc: "Where they actually are" },
  { key: "occupation", label: "Occupation", desc: "What they do for a living" },
  { key: "businessName", label: "Business name", desc: "For micro-business lending" },
  { key: "nextOfKin", label: "Next of kin", desc: "Name and phone of a contact" },
] as const;

export type KycFieldKey = (typeof KYC_FIELDS)[number]["key"];

export type KycFieldRule = {
  /** Must be filled before the borrower record can be created. */
  required: boolean;
  /** No two borrowers in this org may share the value. */
  unique: boolean;
  /** Not shown at all — the field does not exist for this lender. */
  hidden: boolean;
  /**
   * Checked against the national registry (IPRS) rather than merely captured.
   * Only meaningful on fields the registry can answer for; ignored elsewhere.
   */
  verify: boolean;
};

// ── Onboarding rails ──────────────────────────────────────────────────────────
//
// The four ways a stranger becomes a customer. A lender owns which of them they
// have credentials for, which one the counter opens on, and what happens when it
// fails — and BOTH the console and the customer app read this same block, so a
// lender who runs IPRS-only gets an app that asks for one ID number and nothing
// else, without anybody shipping a second screen.

export const ONBOARDING_METHODS = [
  {
    key: "iprs",
    label: "National registry (IPRS)",
    blurb: "One ID number. The registry returns the person, and the name on file is the state's, not a typist's.",
    needsVault: "IPRS",
  },
  {
    key: "ocr",
    label: "ID document scan (OCR)",
    blurb: "A photo of the ID front. The card is read and the fields fill themselves. Free on every plan.",
    needsVault: null,
  },
  {
    key: "crb",
    label: "Credit bureau (Metropol)",
    blurb: "The bureau identifies the person and returns their credit standing in the same call.",
    needsVault: "CRB",
  },
  {
    key: "manual",
    label: "Typed in by hand",
    blurb: "An officer enters everything. Always available as a fallback; never the fastest.",
    needsVault: null,
  },
] as const;

export type OnboardingMethod = (typeof ONBOARDING_METHODS)[number]["key"];

export type OnboardingConfig = {
  /**
   * Which rails this lender has. A method that is off is not offered, not
   * attempted, and not mentioned — that is what makes the screen feel built for
   * them rather than switched down from something bigger.
   */
  methods: Record<OnboardingMethod, boolean>;
  /** The one the counter and the app open on. Must be enabled. */
  primary: OnboardingMethod;
  /**
   * When the primary rail fails or finds nothing, may staff fall through to
   * another enabled method? Off = a registry outage stops the counter, which
   * some lenders genuinely want and most emphatically do not.
   */
  allowFallback: boolean;
  /** Manual entry stays reachable even when it is not in the fallback chain. */
  allowManualOverride: boolean;
  /** The customer must consent before any third-party identity call is made. */
  requireConsent: boolean;

  ocr: {
    /** Front alone, or both sides of the card. */
    capture: "front" | "both";
    /** Below this the read is shown for correction rather than accepted. */
    minConfidence: number;
    /** Fields the parser filled may still be edited before saving. */
    allowEdit: boolean;
  };

  crb: {
    /** How deep a pull to make at ONBOARDING — the cheapest that answers the question. */
    depth: "score" | "standard" | "full";
    /** Refuse to register anyone below this bureau score. 0 = never refuse. */
    minScore: number;
    /** Register them anyway and flag the file, rather than refusing. */
    warnOnly: boolean;
  };

  /**
   * The face of the person, and whether it must be proved live. Held here rather
   * than in `kyc` because it is a step in the flow, not a field on a form.
   */
  selfie: { required: boolean; liveness: boolean; faceMatch: boolean };

  /** A consented location snapshot is taken while the customer is standing there. */
  geo: { ask: boolean; required: boolean; places: ("business" | "home")[] };

  /** Which channels may onboard at all. */
  channels: { console: boolean; portal: boolean; ussd: boolean; field: boolean };

  /** What to do when the ID or phone already exists on this book. */
  onDuplicate: "block" | "warn" | "open_existing";

  /**
   * Extra automated checks to run during onboarding — blacklist, AML, an early CRB
   * pull. Ids from lib/workflow/checks.ts, surface "onboarding". This is what lets a
   * lender put a bureau check at the DOOR rather than at the finance stage.
   */
  checks: CheckBinding[];

  /** A new customer is not usable until a human has approved the KYC pack. */
  requireReview: boolean;
};

export type BorrowerConfig = {
  onboarding: OnboardingConfig;
  kyc: {
    fields: Record<KycFieldKey, KycFieldRule>;
    /** Which document a borrower may identify with. */
    idDocument: "national_id" | "passport" | "either";
    /** A photo of the person. */
    passportPhoto: { required: boolean; hidden: boolean };
    /** A photo of the document itself. */
    idPhoto: { required: boolean; hidden: boolean };
    /** Face-match the selfie against the ID photo before the record is usable. */
    faceMatch: boolean;
    /** A human must sign off KYC before the borrower may transact. */
    manualReview: boolean;
  };

  account: {
    /** What a borrower's account number IS. */
    numbering: "phone" | "national_id" | "system";
    /** System-generated only. */
    prefix: string;
    /** System-generated only — total digits after the prefix. */
    length: number;
  };

  limit: {
    /** Where a new borrower's ceiling comes from. */
    source: "onboarding" | "default" | "scored";
    /** Used when source = "default". */
    defaultLimit: number;
    /** Never exceed this, whatever the engine says. */
    maxLimit: number;
    /** A good repayer's ceiling rises by rule, not by memory. */
    laddering: { enabled: boolean; stepPct: number; afterCleanLoans: number };
  };

  scoring: {
    /** Where a new borrower's score comes from before they have any history. */
    source: "none" | "default" | "engine";
    defaultScore: number;
    /** Below this, no product may be offered at all. */
    minToBorrow: number;
    /**
     * Re-scoring the BOOK, not just applicants. The reference system has no
     * equivalent: a customer is scored when somebody presses the button.
     */
    schedule: {
      enabled: boolean;
      cadence: "daily" | "weekly" | "monthly" | "quarterly";
      /** Which slice of the book each run touches. */
      population: "active" | "all" | "arrears";
      /** Raise a watchlist item when a score falls by more than this. */
      alertOnDropBy: number;
    };
  };

  rules: {
    age: { enabled: boolean; min: number; max: number };
    joiningFee: { enabled: boolean; amount: number };
    dormancy: { enabled: boolean; afterDays: number };
    reactivationFee: { enabled: boolean; amount: number };
    referees: { enabled: boolean; min: number; max: number };
    /** A borrower's business/home pin must be on file before money moves. */
    requireGeoPin: boolean;
    /** One borrower, one live loan across the whole lender. */
    oneActiveLoan: boolean;
  };

  welcome: {
    enabled: boolean;
    /** SmsTemplate.id, or null to use the platform wording. */
    templateId: string | null;
  };

  attachments: {
    /** Document kinds required at ONBOARDING. */
    onboarding: string[];
    /** Document kinds required on a LOAN APPLICATION. Products may add more. */
    application: string[];
  };
};

/** Every field visible and optional unless the platform has a reason otherwise. */
function defaultFieldRules(): Record<KycFieldKey, KycFieldRule> {
  const out = {} as Record<KycFieldKey, KycFieldRule>;
  for (const f of KYC_FIELDS) {
    const required = "lockRequired" in f && f.lockRequired === true;
    out[f.key] = {
      required,
      // Identity and phone are unique by default: two borrower records sharing a
      // national ID is the single most expensive data error in a lending book.
      unique: f.key === "nationalId" || f.key === "phone",
      hidden: false,
      verify: "canVerify" in f && f.canVerify === true,
    };
  }
  return out;
}

export const BORROWER_DEFAULTS: BorrowerConfig = {
  onboarding: {
    // OCR is the platform default because it is the only rail that costs a lender
    // nothing and needs no credentials — a lender who signs up today can onboard a
    // customer today. IPRS and CRB switch themselves on when their vault is filled.
    methods: { iprs: false, ocr: true, crb: false, manual: true },
    primary: "ocr",
    allowFallback: true,
    allowManualOverride: true,
    requireConsent: true,
    ocr: { capture: "front", minConfidence: 0.7, allowEdit: true },
    crb: { depth: "score", minScore: 0, warnOnly: true },
    selfie: { required: true, liveness: false, faceMatch: true },
    geo: { ask: true, required: false, places: ["business", "home"] },
    channels: { console: true, portal: true, ussd: false, field: true },
    onDuplicate: "open_existing",
    checks: [{ id: "duplicate.check", blocking: true, maxAgeDays: 0, threshold: null }],
    requireReview: true,
  },
  kyc: {
    fields: defaultFieldRules(),
    idDocument: "national_id",
    passportPhoto: { required: true, hidden: false },
    idPhoto: { required: true, hidden: false },
    faceMatch: true,
    manualReview: true,
  },
  account: { numbering: "phone", prefix: "", length: 8 },
  limit: {
    source: "scored",
    defaultLimit: 0,
    maxLimit: 500_000,
    laddering: { enabled: true, stepPct: 25, afterCleanLoans: 2 },
  },
  scoring: {
    source: "engine",
    defaultScore: 500,
    minToBorrow: 400,
    schedule: { enabled: true, cadence: "monthly", population: "active", alertOnDropBy: 60 },
  },
  rules: {
    age: { enabled: true, min: 18, max: 70 },
    joiningFee: { enabled: false, amount: 0 },
    dormancy: { enabled: false, afterDays: 180 },
    reactivationFee: { enabled: false, amount: 0 },
    referees: { enabled: false, min: 1, max: 3 },
    requireGeoPin: true,
    oneActiveLoan: true,
  },
  welcome: { enabled: true, templateId: null },
  attachments: { onboarding: [], application: [] },
};

// ── Validation ────────────────────────────────────────────────────────────────
//
// The definition carries its own constraints, so the SAME rules run on the client,
// on the server and on the public API. The reference system has none of this: it
// will happily store minAge 70 / maxAge 22, or a system-generated account number
// with no prefix, and only find out at the counter.

export type ConfigIssue = { path: string; message: string };

export function validateBorrowerConfig(c: BorrowerConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const bad = (path: string, message: string) => issues.push({ path, message });

  // Account numbering
  if (c.account.numbering === "system") {
    if (!c.account.prefix.trim()) bad("account.prefix", "A system-generated account number needs a prefix.");
    if (c.account.length < 4 || c.account.length > 16) bad("account.length", "Account number length must be between 4 and 16 digits.");
  }
  // A number the lender does not collect cannot BE the account number.
  if (c.account.numbering === "phone" && c.kyc.fields.phone.hidden) {
    bad("account.numbering", "Phone number is hidden in KYC, so it cannot be the account number.");
  }
  if (c.account.numbering === "national_id" && c.kyc.fields.nationalId.hidden) {
    bad("account.numbering", "National ID is hidden in KYC, so it cannot be the account number.");
  }
  // An account number must identify exactly one borrower.
  if (c.account.numbering === "phone" && !c.kyc.fields.phone.unique) {
    bad("account.numbering", "Phone must be unique to be used as the account number.");
  }
  if (c.account.numbering === "national_id" && !c.kyc.fields.nationalId.unique) {
    bad("account.numbering", "National ID must be unique to be used as the account number.");
  }

  // Limits
  if (c.limit.source === "default" && c.limit.defaultLimit <= 0) {
    bad("limit.defaultLimit", "Set the default loan limit, or choose another source.");
  }
  if (c.limit.maxLimit > 0 && c.limit.defaultLimit > c.limit.maxLimit) {
    bad("limit.defaultLimit", "The default limit is above the maximum limit.");
  }
  if (c.limit.laddering.enabled && c.limit.laddering.stepPct <= 0) {
    bad("limit.laddering.stepPct", "A graduation step of 0% never raises anyone's limit.");
  }

  // Scoring
  if (c.scoring.source === "default" && c.scoring.defaultScore <= 0) {
    bad("scoring.defaultScore", "Set the default credit score, or choose another source.");
  }
  if (c.scoring.source === "none" && c.scoring.minToBorrow > 0) {
    bad("scoring.minToBorrow", "You require a minimum score but never assign one — nobody would qualify.");
  }

  // Onboarding rules
  if (c.rules.age.enabled) {
    if (c.rules.age.min < 18) bad("rules.age.min", "Lending below 18 is not permitted.");
    if (c.rules.age.min >= c.rules.age.max) bad("rules.age.max", "Maximum age must be greater than minimum age.");
    if (c.kyc.fields.dob.hidden) bad("rules.age.enabled", "An age limit needs date of birth, which is hidden in KYC.");
  }
  if (c.rules.referees.enabled && c.rules.referees.min > c.rules.referees.max) {
    bad("rules.referees.max", "Maximum referees must be at least the minimum.");
  }
  if (c.rules.joiningFee.enabled && c.rules.joiningFee.amount <= 0) {
    bad("rules.joiningFee.amount", "Set the joining fee amount, or switch it off.");
  }
  if (c.rules.reactivationFee.enabled && !c.rules.dormancy.enabled) {
    bad("rules.reactivationFee.enabled", "A reactivation fee needs dormancy switched on — nothing would ever become dormant.");
  }
  if (c.rules.reactivationFee.enabled && c.rules.reactivationFee.amount <= 0) {
    bad("rules.reactivationFee.amount", "Set the reactivation fee amount, or switch it off.");
  }

  // ── Onboarding rails ──
  const o = c.onboarding;
  if (!o.methods[o.primary]) {
    bad("onboarding.primary", "The default onboarding method is switched off.");
  }
  if (!Object.values(o.methods).some(Boolean)) {
    bad("onboarding.methods", "Choose at least one way to onboard a customer.");
  }
  // IPRS and CRB both identify a person BY their ID number. Hiding the field they
  // key on is the configuration that produces a lookup screen with nothing to look up.
  if ((o.methods.iprs || o.methods.crb) && c.kyc.fields.nationalId.hidden) {
    bad("onboarding.methods", "Registry and bureau onboarding both key on the National ID, which is hidden in KYC.");
  }
  if (o.methods.ocr && c.kyc.fields.nationalId.hidden) {
    bad("onboarding.methods", "The document scan reads the ID number, which is hidden in KYC.");
  }
  if (o.ocr.minConfidence < 0.3 || o.ocr.minConfidence > 1) {
    bad("onboarding.ocr.minConfidence", "The OCR confidence bar must be between 0.3 and 1.");
  }
  if (o.methods.crb && o.crb.minScore > 0 && o.crb.warnOnly) {
    bad("onboarding.crb.minScore", "A minimum bureau score is set but the check only warns — nobody would ever be refused.");
  }
  if (o.selfie.faceMatch && !o.selfie.required) {
    bad("onboarding.selfie.faceMatch", "Face matching needs a selfie, which is not being collected.");
  }
  if (o.geo.required && !o.geo.ask) {
    bad("onboarding.geo.required", "A location is required but is never asked for.");
  }
  if (o.geo.required && o.geo.places.length === 0) {
    bad("onboarding.geo.places", "A location is required but no place is being pinned.");
  }
  if (!o.channels.console && !o.channels.portal && !o.channels.ussd && !o.channels.field) {
    bad("onboarding.channels", "Onboarding is switched off everywhere — no customer could ever be registered.");
  }
  // Consent is not ours to waive on the lender's behalf where money changes hands
  // with a third party over a named person.
  if (!o.requireConsent && (o.methods.iprs || o.methods.crb)) {
    bad("onboarding.requireConsent", "Registry and bureau lookups are made against a named person. Consent cannot be switched off.");
  }

  // A required field that is also hidden can never be satisfied.
  for (const f of KYC_FIELDS) {
    const rule = c.kyc.fields[f.key];
    if (rule?.hidden && rule?.required) {
      bad(`kyc.fields.${f.key}`, `${f.label} is required but hidden — it could never be filled in.`);
    }
  }

  return issues;
}

/**
 * Fill a stored document forward to the current shape.
 *
 * A lender who configured this three platform versions ago gets today's defaults for
 * anything they never chose, and keeps every choice they did make. This is the whole
 * reason the document beats a wide table: a new setting rolls out without a migration
 * and without trampling a tenant.
 */
export function mergeBorrowerConfig(stored: unknown): BorrowerConfig {
  const s = (stored ?? {}) as Partial<BorrowerConfig>;
  const d = BORROWER_DEFAULTS;

  const fields = {} as Record<KycFieldKey, KycFieldRule>;
  for (const f of KYC_FIELDS) {
    fields[f.key] = { ...d.kyc.fields[f.key], ...(s.kyc?.fields?.[f.key] ?? {}) };
    // A field the platform will not let a lender make optional stays required
    // however the stored document was written.
    if ("lockRequired" in f && f.lockRequired) fields[f.key].required = true;
  }

  // A stored document may hold any subset of any block, so the onboarding half is
  // read as partial-all-the-way-down rather than as the finished shape.
  type PartialOnboarding = {
    [K in keyof OnboardingConfig]?: OnboardingConfig[K] extends object
      ? Partial<OnboardingConfig[K]>
      : OnboardingConfig[K];
  };
  const so: PartialOnboarding = (s.onboarding ?? {}) as PartialOnboarding;
  const methods = { ...d.onboarding.methods, ...so.methods };
  // Manual is never fully removable: every other rail depends on a third party that
  // will one day be down, and a counter with no way to serve the person in front of
  // it is not a configuration a lender should be able to publish by accident.
  methods.manual = methods.manual || !Object.entries(methods).some(([k, v]) => k !== "manual" && v);
  const primary: OnboardingMethod = methods[so.primary as OnboardingMethod]
    ? (so.primary as OnboardingMethod)
    : (ONBOARDING_METHODS.map((m) => m.key).find((k) => methods[k]) ?? "manual");

  return {
    onboarding: {
      ...d.onboarding, ...so, methods, primary,
      ocr: { ...d.onboarding.ocr, ...so.ocr },
      crb: { ...d.onboarding.crb, ...so.crb },
      selfie: { ...d.onboarding.selfie, ...so.selfie },
      geo: { ...d.onboarding.geo, ...so.geo },
      channels: { ...d.onboarding.channels, ...so.channels },
      checks: normaliseBindings(so.checks ?? d.onboarding.checks, "onboarding"),
    },
    kyc: { ...d.kyc, ...s.kyc, fields,
      passportPhoto: { ...d.kyc.passportPhoto, ...s.kyc?.passportPhoto },
      idPhoto: { ...d.kyc.idPhoto, ...s.kyc?.idPhoto } },
    account: { ...d.account, ...s.account },
    limit: { ...d.limit, ...s.limit, laddering: { ...d.limit.laddering, ...s.limit?.laddering } },
    scoring: { ...d.scoring, ...s.scoring, schedule: { ...d.scoring.schedule, ...s.scoring?.schedule } },
    rules: {
      ...d.rules, ...s.rules,
      age: { ...d.rules.age, ...s.rules?.age },
      joiningFee: { ...d.rules.joiningFee, ...s.rules?.joiningFee },
      dormancy: { ...d.rules.dormancy, ...s.rules?.dormancy },
      reactivationFee: { ...d.rules.reactivationFee, ...s.rules?.reactivationFee },
      referees: { ...d.rules.referees, ...s.rules?.referees },
    },
    welcome: { ...d.welcome, ...s.welcome },
    attachments: { ...d.attachments, ...s.attachments },
  };
}
