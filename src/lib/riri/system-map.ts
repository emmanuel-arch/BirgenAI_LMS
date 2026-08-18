// ─────────────────────────────────────────────────────────────────────────────
// THE SYSTEM MAP — everything ServiceSuite AI knows about this platform.
//
// knowledge.ts is the CORPUS: prose answers to the questions people ask most, in
// two languages, hand-written. It is deliberately small, because every article is
// a paragraph somebody had to write and keep true.
//
// This file is the INDEX: every screen the console has, what it is for, what you
// can do on it, what changes when you touch it, and the words a person would use
// when they want it. Fifty-odd screens, one entry each. It is not prose — it is
// the map the assistant reads before deciding where you should be standing.
//
// WHY BOTH, AND WHY THIS ONE MATTERS MORE
// ---------------------------------------
// The old failure was silent and total: the corpus held 28 articles, the console
// held 50 screens, and everything in the gap — the credit policy editor, the
// pipeline board, the income statement, the reconciliation queue — simply did not
// exist as far as the assistant was concerned. Ask "take me to where I write our
// credit policy" and it said, honestly and uselessly, that it did not know. An
// assistant that is honest about a hole is better than one that invents a menu
// path, but the hole is still the product failing.
//
// So: the corpus keeps teaching (the long "how do I…" walkthroughs), and the map
// keeps knowing (every door, every consequence). Support answers from the corpus
// when there is an article and from the map when there is not — and the map is
// never allowed to fall behind, because:
//
//   1. `href` is checked against the real route table by scripts/verify-system-map.ts.
//      Delete a screen and the test fails.
//   2. `right` / `feature` are typed against the real rights catalogue and the real
//      plan features. Rename a right and it stops compiling.
//   3. Every NAV_REGISTRY href must appear here. Ship a screen with a menu item and
//      forget to describe it and the test fails.
//
// ON LANGUAGE. `asks` carries both English and Kiswahili phrasings in one list,
// because retrieval is keyword scoring and does not care which language a word
// came from. The bilingual PROSE lives in knowledge.ts where it belongs; the map's
// job is to know which door, not to write the paragraph.
//
// ON `implications`. The founder's actual ask: "things that I don't know how to
// configure, or its implications". A settings screen that tells you what a control
// does but not what happens downstream is how a lender discovers in six weeks that
// nobody has graduated since March. Where a screen can bite, it says so here.
// ─────────────────────────────────────────────────────────────────────────────
import type { Right } from "@/lib/rbac/rights";
import type { Feature } from "@/lib/billing/plans";

export type SystemModule =
  | "dashboard" | "borrowers" | "loans" | "payments" | "collections"
  | "intelligence" | "field" | "comms" | "organization" | "access"
  | "billing" | "suite" | "assistant";

export type SystemScreen = {
  /** Stable id — used by related[], by the router, and in logs. */
  id: string;
  /** The real route. Verified against the route table by the drift test. */
  href: string;
  /** What the menu calls it. */
  title: string;
  module: SystemModule;
  /** One sentence: what this screen is FOR. Spoken, not documented. */
  purpose: string;
  /** The verbs. What a person actually does here. */
  does: string[];
  /** How a real person asks for it — English and Kiswahili in one list. */
  asks: string[];
  /** Vocabulary this screen owns. Feeds concept lookup and disambiguation. */
  concepts?: string[];
  /** What changes elsewhere when you act here. The part nobody documents. */
  implications?: string[];
  /** Who may open it. Absent ⇒ any signed-in staff member. */
  right?: Right;
  /** Any-of (per-report access). */
  anyRight?: Right[];
  /** Plan feature required. Absent ⇒ every package. */
  feature?: Feature;
  /** Where to go next, by id. */
  related?: string[];
  /** True for screens reached from a row, not from the menu (needs an id in the URL). */
  contextual?: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// THE SCREENS
// ─────────────────────────────────────────────────────────────────────────────

export const SYSTEM_SCREENS: SystemScreen[] = [
  // ── Dashboard ──────────────────────────────────────────────────────────────
  {
    id: "dashboard",
    href: "/console",
    title: "Overview",
    module: "dashboard",
    purpose:
      "The command view of the whole book — what is out, what is at risk, what moved today — and, for a lender still setting up, the checklist that says what to do next.",
    does: [
      "Read the portfolio headline: outstanding, at risk, collected, disbursed",
      "See today's movement and the accounts that changed band",
      "Work the setup checklist while the lender is still being configured",
      "Request activation once configuration is complete",
    ],
    asks: [
      "home", "dashboard", "overview", "console home", "portfolio command",
      "what do i do next", "setup checklist", "how is my book doing",
      "ukurasa wa mwanzo", "dashibodi", "nifanye nini sasa",
    ],
    concepts: ["outstanding", "portfolio at risk", "setup checklist", "activation"],
    related: ["analytics-studio", "early-warning", "billing"],
  },

  // ── Borrowers ──────────────────────────────────────────────────────────────
  {
    id: "borrowers-list",
    href: "/console/borrowers",
    title: "Borrowers List",
    module: "borrowers",
    purpose: "Every customer you are allowed to see, searchable, with their state on the row.",
    does: [
      "Search by name, phone or national ID",
      "Filter by KYC state, risk band and branch",
      "Open a customer's 360",
    ],
    asks: [
      "borrowers", "customers", "customer list", "borrower list", "find a customer",
      "clients", "my customers", "who are my borrowers",
      "wakopaji", "wateja", "orodha ya wateja", "tafuta mteja",
    ],
    concepts: ["data scope", "risk band", "KYC status"],
    implications: [
      "You see the customers your role's DATA SCOPE allows — OWN shows only the ones you registered, BRANCH your office, ORG the whole book. A customer you cannot find may exist and simply not be yours.",
    ],
    right: "borrowers.view",
    related: ["borrower-new", "borrower-360", "kyc-queue", "who-sees-what"],
  },
  {
    id: "borrower-new",
    href: "/console/borrowers/new",
    title: "New Borrower",
    module: "borrowers",
    purpose:
      "Turn a walk-in into a record from ONE number: the national registry fills the person in, you confirm, and they exist.",
    does: [
      "Enter a national ID and let IPRS prefill name and date of birth",
      "Confirm contact details and consent",
      "Take a one-time location snapshot of home and/or business",
      "Fall back to manual entry when the registry is down",
    ],
    asks: [
      "add a borrower", "register a customer", "new customer", "onboard a borrower",
      "create a customer", "sign up a client", "walk-in customer", "iprs lookup",
      "sajili mteja", "ongeza mkopaji", "mteja mpya",
    ],
    concepts: ["IPRS", "consent", "location snapshot", "joining fee"],
    implications: [
      "The location snapshot is what Field Ops routes and dispatch run on. Skip it and the customer is invisible to route planning and appears in Needs Location.",
      "If your borrower settings carry a joining fee, it is raised the moment the customer is registered — before any loan exists.",
    ],
    right: "borrowers.create",
    related: ["kyc-queue", "borrower-settings", "field-needs-location", "crunch"],
  },
  {
    id: "borrower-360",
    href: "/console/borrowers",
    title: "Customer 360",
    module: "borrowers",
    purpose:
      "One customer, whole: identity, score history, loans, repayments, guarantors, next of kin, and a single timeline of everything that ever happened to them.",
    does: [
      "Read the timeline — limit changes, scores, approvals, calls, interactions",
      "Log an interaction with a disposition and a note",
      "Add or fix next of kin (ID-first, autofilled)",
      "Open their statement, apply on their behalf, request a payment",
    ],
    asks: [
      "customer 360", "customer profile", "borrower file", "open a customer",
      "customer timeline", "log an interaction", "disposition", "next of kin",
      "faili la mteja", "historia ya mteja",
    ],
    concepts: ["timeline", "disposition", "next of kin", "loan limit", "score history"],
    implications: [
      "Next of kin cannot be the customer themselves — the platform blocks it on both phone and national ID.",
      "Interactions logged here also surface in Oversight, because a call is an action on a customer's file.",
    ],
    right: "borrowers.view",
    contextual: true,
    related: ["borrowers-list", "customer-statement", "apply-for-borrower", "collections-queue"],
  },
  {
    id: "customer-statement",
    href: "/console/borrowers",
    title: "Customer Statement",
    module: "borrowers",
    purpose:
      "Everything that has ever passed between the lender and this customer, on one printable sheet — money out, money in, fees, and their savings passbook.",
    does: ["Read every disbursement and repayment ever", "See fees charged and paid", "Print or hand it to the customer"],
    asks: [
      "customer statement", "borrower statement", "full statement", "account statement",
      "what have they paid us", "taarifa ya mteja",
    ],
    concepts: ["statement", "savings passbook"],
    right: "borrowers.view",
    contextual: true,
    related: ["loan-statement", "borrower-360"],
  },
  {
    id: "kyc-queue",
    href: "/console/kyc",
    title: "KYC Verification",
    module: "borrowers",
    purpose: "The gate between a registered customer and their money — nobody is paid out unverified.",
    does: [
      "Work the queue of customers awaiting verification",
      "Read the document, the registry match and the face match",
      "Verify, reject, or vouch for a failed match",
    ],
    asks: [
      "kyc", "verify a customer", "identity verification", "kyc queue", "id check",
      "face match", "liveness", "why is kyc failing", "vouch",
      "uthibitisho wa kitambulisho", "hakiki mteja",
    ],
    concepts: ["KYC gate", "IPRS", "face match", "liveness", "vouching"],
    implications: [
      "An unverified customer can be registered and can apply, but cannot be disbursed. That is the gate, and it is deliberate.",
      "Vouching overrides a failed face or liveness check. It is head-office level, it is audited by name, and it is the first thing a regulator asks about.",
    ],
    right: "borrowers.view",
    related: ["kyc-verify", "borrower-new", "disbursements"],
  },
  {
    id: "kyc-verify",
    href: "/console/kyc",
    title: "Verify a customer",
    module: "borrowers",
    purpose: "The verification itself, done inside the console — the officer never leaves the building.",
    does: ["Compare the document to the registry", "Approve or reject the identity", "Record the reason"],
    asks: ["verify this customer", "do the kyc", "approve identity", "reject identity"],
    right: "kyc.verify",
    contextual: true,
    related: ["kyc-queue"],
  },
  {
    id: "crunch",
    href: "/console/crunch",
    title: "Statement Cruncher",
    module: "borrowers",
    purpose:
      "Turn six months of a customer's M-Pesa statement into an internal score, a starting limit, and the products they actually qualify for.",
    does: [
      "Pick a KYC-verified customer with no score yet",
      "Upload and crunch their M-Pesa statement",
      "Read the internal score, the affordability ceiling and the reason codes",
      "Allocate the resulting starting limit to their file",
    ],
    asks: [
      "statement cruncher", "crunch a statement", "mpesa statement", "score a customer",
      "internal score", "starting limit", "what do they qualify for", "affordability",
      "reason codes", "kokotoa taarifa ya mpesa", "alama za mkopaji",
    ],
    concepts: ["internal score", "starting limit", "affordability ceiling", "reason codes", "product match", "score snapshot"],
    implications: [
      "The verdict is SAVED to the customer's file: a score snapshot in their history plus the full report as a document. It is evidence, not a preview.",
      "The starting limit it allocates becomes the ceiling every later application is measured against, until graduation moves it.",
      "The statement holder must be the customer. A statement in someone else's name is refused, not scored.",
    ],
    right: "loans.apply",
    feature: "statement-cruncher",
    related: ["credit-policy", "scoring", "apply-for-borrower", "closed-loop"],
  },

  // ── Loans ──────────────────────────────────────────────────────────────────
  {
    id: "applications",
    href: "/console/applications",
    title: "Applications Queue",
    module: "loans",
    purpose: "Every person waiting on a decision, as a list you work down.",
    does: ["See who is waiting and at which stage", "Filter by stage, product and officer", "Open the dossier that decides it"],
    asks: [
      "applications", "application queue", "pending loans", "loan requests",
      "who is waiting for approval", "maombi ya mikopo", "foleni ya maombi",
    ],
    concepts: ["workflow stage", "application status"],
    right: "applications.view",
    related: ["application-dossier", "pipeline", "workflows", "apply-for-borrower"],
  },
  {
    id: "application-dossier",
    href: "/console/applications",
    title: "Application Dossier",
    module: "loans",
    purpose:
      "One loan, one decision: the face and the ID, the model's read, the recommendation, the schedule — and then the three buttons that move it.",
    does: [
      "Weigh identity, score, recommendation and repayment schedule",
      "Approve to the next stage, send back to be fixed, or decline",
      "Invite a guarantor (ID-first) and track their consent",
      "Read the approval trail — every stage, decision, message and actor",
    ],
    asks: [
      "application dossier", "approve a loan", "decline a loan", "send back an application",
      "why is this stuck", "approval trail", "who approved this", "add a guarantor",
      "idhinisha mkopo", "kataa mkopo",
    ],
    concepts: ["maker-checker", "workflow stage", "tier", "approval trail", "guarantor consent", "offer letter"],
    implications: [
      "Approving does not disburse. It moves the application one stage; the money still has to be released through Disbursements, by a different pair of eyes.",
      "A stage can carry a maximum amount and an OTP requirement. Above the cap, or without the code, the button will not finalise — that is the workflow, not a bug.",
      "Every decision captures a message, and that message is permanent. It is what the trail shows a regulator.",
    ],
    right: "applications.decide",
    contextual: true,
    related: ["applications", "workflows", "sureties", "disbursements"],
  },
  {
    id: "apply-for-borrower",
    href: "/console/applications/new",
    title: "Apply for a Borrower",
    module: "loans",
    purpose: "Book a loan on a customer's behalf — the counter and the field officer's path into the same queue.",
    does: [
      "Find the customer and let the platform check them (no running loan, score, liveness, what they qualify for)",
      "Pick the product, the amount and the term",
      "Submit into the same approval chain as any other application",
    ],
    asks: [
      "apply for a customer", "create an application", "book a loan", "new loan application",
      "assisted application", "apply on behalf", "mwombee mteja mkopo", "omba mkopo kwa niaba",
    ],
    concepts: ["assisted origination", "qualification", "product match"],
    implications: [
      "The server rescores. A statement crunched earlier rides in, but nothing you type sets the score — that is why an officer cannot talk a number up.",
      "Booking still needs a signed offer. Approval and signature are two different events.",
    ],
    right: "loans.apply",
    related: ["crunch", "applications", "products", "sureties"],
  },
  {
    id: "pipeline",
    href: "/console/pipeline",
    title: "Pipeline",
    module: "loans",
    purpose:
      "The same applications as a value-weighted funnel board — six columns from first touch to money out, each with a running headcount and a running value.",
    does: ["Watch the funnel fill", "See how much money is stuck at each stage", "Open any card into its dossier"],
    asks: [
      "pipeline", "funnel", "leads", "kanban", "how much is in review",
      "where are my applications stuck", "mkondo wa maombi",
    ],
    concepts: ["funnel", "conversion", "stage value"],
    right: "applications.view",
    related: ["applications", "application-dossier"],
  },
  {
    id: "loans-list",
    href: "/console/loans",
    title: "Loans List",
    module: "loans",
    purpose: "The booked book — what IS a loan, as opposed to what wants to be one.",
    does: ["See every live loan with its balance and state", "Open a loan statement", "Filter by status, product and officer"],
    asks: [
      "loans", "loan list", "active loans", "booked loans", "the book",
      "mikopo", "orodha ya mikopo",
    ],
    concepts: ["outstanding balance", "loan status", "arrears"],
    right: "loans.view",
    related: ["loan-statement", "repayments", "collections-queue"],
  },
  {
    id: "loan-statement",
    href: "/console/loans",
    title: "Loan Statement",
    module: "loans",
    purpose: "One loan's whole life: schedule, what was paid, what is late, what is left.",
    does: ["Read the installment schedule against actual payments", "Print it for the customer"],
    asks: ["loan statement", "repayment schedule", "what do they still owe", "ratiba ya malipo"],
    concepts: ["installment", "schedule", "arrears"],
    right: "loans.view",
    contextual: true,
    related: ["loans-list", "customer-statement"],
  },
  {
    id: "sureties",
    href: "/console/sureties",
    title: "Sureties",
    module: "loans",
    purpose:
      "The people standing behind the money, as cards — who they back, how much they consented to, and the evidence of that consent.",
    does: [
      "Filter guarantors by consent state: consented, pending, lapsed, declined",
      "See consented coverage in shillings",
      "Chase a signature before its window closes",
    ],
    asks: [
      "guarantors", "sureties", "who guaranteed this loan", "guarantor consent",
      "coverage", "chase a signature", "wadhamini", "mdhamini",
    ],
    concepts: ["guarantor consent", "coverage", "consent evidence", "invite expiry"],
    implications: [
      "A guarantor cannot be the borrower. The platform blocks it on both national ID and phone.",
      "An invitation expires. An unsigned guarantee past its window is coverage you do not actually have.",
    ],
    right: "applications.view",
    related: ["application-dossier", "loans-list"],
  },

  // ── Payments ───────────────────────────────────────────────────────────────
  {
    id: "disbursements",
    href: "/console/disbursements",
    title: "Disbursements & Float",
    module: "payments",
    purpose: "Where approved money actually leaves — a maker-checker queue sitting on top of your float balance.",
    does: [
      "Initiate a payout and have a second person confirm it",
      "Watch the float balance and top it up",
      "See failed payouts and why they failed",
    ],
    asks: [
      "disburse", "disbursement", "pay out a loan", "release money", "float",
      "top up float", "why can't i disburse", "b2c", "send money to customer",
      "toa mkopo", "lipa mteja", "kwa nini siwezi kutoa pesa",
    ],
    concepts: ["maker-checker", "float", "B2C", "payout", "activation gate"],
    implications: [
      "Four things can block a payout and they are checked in this order: the lender is not ACTIVE yet, the customer is not KYC-verified, the float is short, or your M-Pesa B2C credentials are not connected in Settings → Vault.",
      "Maker-checker means the person who initiates cannot be the person who confirms. That is not configurable away — it is the control.",
    ],
    right: "disbursements.view",
    related: ["vault-settings", "kyc-queue", "reconciliation", "repayments"],
  },
  {
    id: "repayments",
    href: "/console/repayments",
    title: "Repayments",
    module: "payments",
    purpose: "Money coming in — request it, receive it, and see it land against the right loan.",
    does: [
      "Send an STK push to a customer's phone",
      "Record a cash or bank repayment",
      "Allocate a receipt to a loan",
      "See what came in through paybill",
    ],
    asks: [
      "repayment", "record a payment", "stk push", "request payment", "collect money",
      "cash repayment", "paybill", "allocate a receipt", "auto repayment", "ratiba",
      "malipo", "rekodi malipo", "kusanya pesa",
    ],
    concepts: ["STK push", "allocation", "receipt", "C2B", "standing order"],
    implications: [
      "STK requires your own M-Pesa Daraja credentials in the Vault. Without them the button is there but the push cannot leave.",
      "A payment that arrives without a matching loan does not vanish — it lands in Reconciliation as an unallocated exception.",
    ],
    right: "repayments.view",
    related: ["reconciliation", "vault-settings", "collections-queue", "loans-list"],
  },
  {
    id: "reconciliation",
    href: "/console/reconciliation",
    title: "Reconciliation",
    module: "payments",
    purpose:
      "Finance's exceptions queue — every disagreement between what M-Pesa says happened and what the book says happened.",
    does: [
      "Work unallocated payments: see the money, find the customer, pick their loan, reconcile",
      "Re-apply a payment that landed wrong",
      "Resolve or explain an exception — never silently close it",
    ],
    asks: [
      "reconciliation", "unallocated payment", "exceptions", "money not matched",
      "payment doesn't match", "reconcile", "suspense", "upatanisho", "malipo hayajalingana",
    ],
    concepts: ["exception", "unallocated C2B", "allocation", "suspense"],
    implications: [
      "The queue empties by work or by an explained decision. There is no button that just makes an exception disappear, because that is how a book stops balancing.",
    ],
    right: "reconciliation.view",
    related: ["repayments", "disbursements", "income-statement"],
  },

  // ── Collections ────────────────────────────────────────────────────────────
  {
    id: "collections-queue",
    href: "/console/collections",
    title: "Collections Work Queue",
    module: "collections",
    purpose: "Live arrears, freshest first, with a call button big enough to work from a phone.",
    does: ["Call the customer", "Log the call and its outcome", "Take a promise to pay", "Escalate into a ticket"],
    asks: [
      "collections", "arrears", "chase payment", "who is late", "work queue",
      "call a defaulter", "log a call", "madeni", "wachelewa kulipa", "fuatilia malipo",
    ],
    concepts: ["arrears", "call outcome", "promise to pay", "days past due"],
    implications: [
      "Freshest arrears sort first on purpose — they are the most recoverable. Working the oldest first feels responsible and collects less.",
    ],
    right: "collections.view",
    related: ["collections-ptp", "collections-tickets", "early-warning", "borrower-360"],
  },
  {
    id: "collections-ptp",
    href: "/console/collections?tab=ptp",
    title: "Promises to Pay",
    module: "collections",
    purpose: "Every promise a customer made, and whether the money actually came.",
    does: ["See promises due today", "Watch a promise resolve or break"],
    asks: ["promise to pay", "ptp", "promises", "who promised to pay", "ahadi ya kulipa"],
    concepts: ["promise to pay", "kept vs broken"],
    right: "collections.view",
    related: ["collections-queue"],
  },
  {
    id: "collections-tickets",
    href: "/console/collections?tab=tickets",
    title: "Collections Tickets",
    module: "collections",
    purpose: "Disputes, hardship, fraud, complaints and legal — the cases a phone call cannot close.",
    does: ["Raise a ticket against a loan", "Work it to resolution with a mandatory note"],
    asks: ["tickets", "dispute", "hardship", "complaint", "fraud case", "customer says they paid", "malalamiko"],
    concepts: ["dispute", "hardship", "restructure candidate"],
    right: "collections.view",
    related: ["collections-queue", "compliance"],
  },

  // ── Intelligence ───────────────────────────────────────────────────────────
  {
    id: "closed-loop",
    href: "/console/intelligence/loop",
    title: "Closed ML Loop",
    module: "intelligence",
    purpose:
      "What the platform is learning from THIS lender's own book, and how far it is from deciding with a model fitted on it.",
    does: ["See outcomes collected against the gate", "Read the confidence intervals", "Understand what a wrong decision costs"],
    asks: [
      "closed loop", "machine learning", "is the model learning", "how many outcomes",
      "when will we have our own model", "model maturity", "kujifunza kwa mashine",
    ],
    concepts: ["outcome gate", "Wilson interval", "priced errors", "model fitting"],
    right: "intelligence.view",
    related: ["scoring", "model-tuning", "credit-policy"],
  },
  {
    id: "early-warning",
    href: "/console/intelligence",
    title: "Early Warning",
    module: "intelligence",
    purpose: "The watchlist — who is about to go wrong, before they do.",
    does: ["Read the at-risk list", "See what changed since the last scan", "Hand an account to collections"],
    asks: [
      "early warning", "watchlist", "who is about to default", "at risk",
      "portfolio scan", "risk radar", "nani atashindwa kulipa", "orodha ya hatari",
    ],
    concepts: ["watchlist", "default probability", "portfolio scan"],
    right: "intelligence.view",
    feature: "portfolio-scan",
    related: ["scoring", "collections-queue", "model-tuning"],
  },
  {
    id: "scoring",
    href: "/console/intelligence/scoring",
    title: "Credit Scoring",
    module: "intelligence",
    purpose:
      "The engines, the batch and what to do about the number: every scorer the platform runs, the whole book scored, and the accounts to cure to hit a target.",
    does: [
      "See the fleet of engines and how many scores each produced on your book",
      "Run or read a portfolio batch and compare it to last week",
      "Read the projection: cure THESE accounts to be at X% next week",
    ],
    asks: [
      "credit scoring", "scoring engines", "score the book", "portfolio run",
      "band migration", "how does scoring work", "default probability",
      "upimaji wa mkopo", "alama za mkopo",
    ],
    concepts: ["thin-file", "origination v2", "pooled v3", "behavioural v1", "fused score", "band migration", "portfolio run"],
    implications: [
      "A batch run is a RECORDING, never a re-decision. Scoring the book does not re-approve or re-decline anything already booked.",
    ],
    right: "intelligence.view",
    feature: "portfolio-scan",
    related: ["credit-policy", "closed-loop", "crunch", "model-tuning"],
  },
  {
    id: "analytics-studio",
    // Its own system now, at its own address — not a console screen. The old
    // console route still resolves and redirects here.
    href: "/analytics",
    title: "Analytics Studio",
    module: "intelligence",
    purpose: "A system of its own: the whole book by branch, officer, product, region, cohort and channel — any measure, any dimension, any chart, plus a builder for the questions we did not anticipate.",
    does: [
      "Read the board view — the business on one screen",
      "Rank officers or branches by any definition of \"best\"",
      "Follow each month's lending forward as a cohort",
      "Build a chart from the columns of the book",
      "Open the table beneath any chart to check it",
    ],
    asks: [
      "analytics", "charts", "graphs", "analysis studio", "demographics",
      "repayment trends", "retention", "customers by region", "takwimu", "chati",
      "best agent", "best officer", "branch comparison", "cohort", "vintage",
      "build a chart", "pivot", "explore the data", "par by branch",
    ],
    concepts: ["distribution", "retention", "repayment trend", "cohort", "portfolio at risk"],
    anyRight: ["reports.view", "reports.analytics"],
    related: ["report-builder", "portfolio-report", "income-statement"],
  },
  {
    id: "model-tuning",
    href: "/console/intelligence/tuning",
    title: "Model Tuning",
    module: "intelligence",
    purpose: "The weights behind the early-warning engine, in your hands.",
    does: ["Adjust factor weights", "See the effect before saving"],
    asks: ["model tuning", "adjust weights", "tune the model", "change the risk model", "rekebisha modeli"],
    concepts: ["factor weight", "engine tuning"],
    implications: [
      "Tuning changes what the watchlist flags tomorrow. It does not re-decide loans already booked.",
      "This tunes the early-warning engine. The rules that decide who borrows and how much live in Credit Policy, which is a different screen.",
    ],
    right: "intelligence.tune",
    feature: "model-tuning",
    related: ["early-warning", "credit-policy", "closed-loop"],
  },
  {
    id: "metrics",
    href: "/console/intelligence/metrics",
    title: "Metric Catalogue",
    module: "intelligence",
    purpose: "Every measure ServiceSuite AI knows, with the exact SQL behind it — and the log of what has been asked.",
    does: ["Browse the governed measures", "Read the SQL behind a number", "Teach a synonym, rename a measure, set a target"],
    asks: [
      "metric catalogue", "what metrics do you know", "definitions", "how is par calculated",
      "query log", "teach a synonym", "vipimo", "maana ya kipimo",
    ],
    concepts: ["governed metric", "metric definition", "query log", "synonym"],
    right: "metrics.view",
    feature: "riri",
    related: ["report-builder", "analytics-studio"],
  },
  {
    id: "documents",
    href: "/console/documents",
    title: "Document Parser",
    module: "intelligence",
    purpose: "Upload a document and have the platform read it into fields.",
    does: ["Upload and parse", "Review what was extracted", "Attach it to a customer"],
    asks: ["document parser", "upload a document", "scan a document", "ocr", "read a payslip", "soma hati"],
    concepts: ["OCR", "extraction"],
    right: "documents.view",
    feature: "document-parser",
    related: ["crunch", "kyc-queue"],
  },
  {
    id: "report-builder",
    href: "/console/intelligence/reports",
    title: "Report Builder",
    module: "intelligence",
    purpose: "Compose your own report from the metric catalogue — pick measures, a period and a slice, print the sheet.",
    does: ["Tick the measures you want", "Choose a period and a slice", "Render and print as a document"],
    asks: [
      "report builder", "build a report", "custom report", "make my own report",
      "tengeneza ripoti", "ripoti maalum",
    ],
    concepts: ["measure", "slice", "period"],
    anyRight: ["reports.view", "reports.builder"],
    feature: "riri",
    related: ["metrics", "portfolio-report", "income-statement"],
  },
  {
    id: "portfolio-report",
    href: "/console/report",
    title: "Portfolio Report",
    module: "intelligence",
    purpose: "The standing portfolio document, on the lender's own letterhead.",
    does: ["Read the portfolio position", "Print or hand it on"],
    asks: ["portfolio report", "reports", "print a report", "ripoti ya mikopo"],
    anyRight: ["reports.view", "reports.portfolio"],
    related: ["income-statement", "analytics-studio", "report-builder"],
  },
  {
    id: "income-statement",
    href: "/console/report/income",
    title: "Income Statement",
    module: "intelligence",
    purpose:
      "The lender's revenue on their own letterhead: interest EARNED and fees COLLECTED, this month against year to date.",
    does: ["Read revenue grouped and sub-totalled by source", "Compare month to year", "Print it for an owner, an auditor or a funder"],
    asks: [
      "income statement", "revenue", "profit", "how much did we make", "earnings",
      "interest income", "fee income", "mapato", "taarifa ya mapato",
    ],
    concepts: ["interest earned", "fee income", "recognition", "share of revenue"],
    implications: [
      "Interest is recognised as EARNED — the interest portion of installments actually paid in the window, not what was billed. Fees are recognised as COLLECTED. That is why this will not match a naive 'interest due' total, and why it is the honest number.",
    ],
    anyRight: ["reports.view", "reports.income"],
    related: ["portfolio-report", "reconciliation", "charges"],
  },

  // ── Field Ops ──────────────────────────────────────────────────────────────
  {
    id: "field-visits",
    href: "/console/field",
    title: "Visits & Routes",
    module: "field",
    purpose: "The field roster — who is being visited, by whom, in what order.",
    does: ["Plan a day of visits", "Assign an officer", "Track completion"],
    asks: ["field visits", "route planner", "visits", "field ops", "ziara", "mpango wa safari"],
    concepts: ["visit", "route", "roster"],
    right: "field.view",
    feature: "route-planner",
    related: ["field-map", "field-nearby", "field-dispatch"],
  },
  {
    id: "field-nearby",
    href: "/console/field/nearby",
    title: "Customers Near Me",
    module: "field",
    purpose: "Where am I, where is my book, who is closest.",
    does: ["See customers by distance from your current position", "Start a route to the nearest"],
    asks: ["customers near me", "nearby customers", "who is close", "wateja walio karibu"],
    right: "field.view",
    feature: "route-planner",
    related: ["field-map", "field-visits"],
  },
  {
    id: "field-needs-location",
    href: "/console/field/needs-location",
    title: "Needs Location",
    module: "field",
    purpose: "The customers with no pin — invisible to routing, and blocked from disbursement.",
    does: ["Work the list of unpinned customers", "Capture their location on the next visit"],
    asks: ["needs location", "no gps", "customers without location", "unpinned", "hakuna mahali"],
    implications: [
      "A customer with no location cannot be routed to and, depending on your rules, cannot be paid out. This list is the fix.",
    ],
    right: "field.view",
    feature: "route-planner",
    related: ["borrower-new", "field-visits"],
  },
  {
    id: "field-dispatch",
    href: "/console/field/dispatch",
    title: "Dispatch Inbox",
    module: "field",
    purpose: "Requests land here and the nearest agent says yes.",
    does: ["Accept or decline a dispatch", "Get a route on acceptance"],
    asks: ["dispatch", "dispatch inbox", "send an agent", "assign an agent", "tuma wakala"],
    right: "field.view",
    feature: "route-planner",
    related: ["field-map", "field-visits"],
  },
  {
    id: "field-map",
    href: "/console/field/map",
    title: "Route Map",
    module: "field",
    purpose: "Real streets: pick a start and a customer, get the route and the fare.",
    does: ["Plot a route", "See distance, time and fare", "Ask the assistant to guide the ride"],
    asks: ["route map", "map", "directions", "fare", "how far is this customer", "ramani", "njia"],
    concepts: ["route", "fare estimate", "risk map"],
    right: "field.view",
    feature: "route-planner",
    related: ["field-nearby", "field-visits"],
  },

  // ── Comms ──────────────────────────────────────────────────────────────────
  {
    id: "sms-campaigns",
    href: "/console/comms",
    title: "SMS Campaigns",
    module: "comms",
    purpose: "Compose to a live segment — audience counted and cost shown before you send.",
    does: ["Build a segment", "See the audience size and the cost in SMS segments", "Send and read delivery stats"],
    asks: [
      "sms", "send sms", "campaign", "blast", "text customers", "bulk sms",
      "tuma ujumbe", "ujumbe kwa wateja",
    ],
    concepts: ["segment", "SMS credit", "delivery report"],
    implications: [
      "Cost is shown in SMS segments before you send, not after. A long message is more than one segment and is billed as more than one.",
      "Messages go out under your own sender ID from your own SMS account — connect it in Settings → Vault first.",
    ],
    right: "sms.view",
    related: ["sms-templates", "email-log", "vault-settings", "billing"],
  },
  {
    id: "sms-templates",
    href: "/console/comms?tab=templates",
    title: "Message Templates",
    module: "comms",
    purpose: "Every SMS the platform sends on your behalf, editable in your own words.",
    does: ["Override a built-in message", "Keep the placeholders valid"],
    asks: ["templates", "message templates", "edit an sms", "change the wording", "kigezo cha ujumbe"],
    implications: [
      "Placeholders are validated. An override that loses {code} would send a sign-in message with no code in it, so the platform refuses to save it.",
    ],
    right: "sms.view",
    related: ["sms-campaigns"],
  },
  {
    id: "email-log",
    href: "/console/comms?tab=email",
    title: "Email Log",
    module: "comms",
    purpose: "Every transactional email and what happened to it — 'did the system email them?' answered.",
    does: ["Search the log", "See the outcome of an invite, a code or an approval mail"],
    asks: ["email log", "did the email send", "invite not received", "kumbukumbu za barua pepe"],
    right: "sms.view",
    related: ["sms-campaigns", "team"],
  },

  // ── Organization ───────────────────────────────────────────────────────────
  {
    id: "branches",
    href: "/console/branches",
    title: "Structure",
    module: "organization",
    purpose: "One tree — head office, regions, branches, units — and everything else hangs off it.",
    does: ["Create the head office first", "Add regions and branches underneath", "Name the levels in your own words"],
    asks: [
      "structure", "branches", "org chart", "add a branch", "head office", "regions",
      "muundo wa shirika", "matawi", "ongeza tawi",
    ],
    concepts: ["branch tree", "data scope", "reporting line"],
    implications: [
      "Structure is what makes DATA SCOPE mean anything. A role scoped to BRANCH_TREE sees an office and everything under it — so where you hang a branch decides who can read its customers.",
    ],
    right: "branches.view",
    related: ["team", "roles", "who-sees-what"],
  },
  {
    id: "products",
    href: "/console/products",
    title: "Products",
    module: "organization",
    purpose:
      "What you lend: how much, for how long, at what rate, what the borrower must bring, and which approval workflow it runs.",
    does: [
      "Walk the stepped setup: amounts, term, interest, schedule",
      "Require a guarantor or security",
      "Pick the workflow for a new loan and for a repeat loan",
      "Edit an existing product through the same wizard",
    ],
    asks: [
      "products", "loan products", "create a product", "new product", "interest rate",
      "loan terms", "change the rate", "tenor", "repayment period",
      "bidhaa za mikopo", "tengeneza bidhaa", "riba",
    ],
    concepts: ["product", "interest method", "tenor", "schedule", "security", "workflow binding"],
    implications: [
      "Nothing can be applied for until at least one active product exists.",
      "A product binds an approval workflow — change the binding and the NEXT application takes the new chain; the ones already in flight keep the chain they entered on.",
      "Editing a live product does not rewrite loans already booked on it. Their terms are frozen at booking.",
    ],
    right: "products.view",
    related: ["charges", "workflows", "credit-policy", "apply-for-borrower"],
  },
  {
    id: "charges",
    href: "/console/charges",
    title: "Charges",
    module: "organization",
    purpose: "Your own fees — what you charge, when it applies, and who it goes to.",
    does: ["Create a fee: flat or percentage", "Choose when it is raised and whether it blocks", "See the read-only platform fee"],
    asks: [
      "charges", "fees", "processing fee", "joining fee", "registration fee",
      "add a fee", "penalty", "ada", "malipo ya ziada",
    ],
    concepts: ["charge trigger", "apply-at", "upfront charge", "joining fee", "processing fee"],
    implications: [
      "A JOINING fee belongs to the borrower, is raised once at registration, and is configured in Borrower Settings — not per product.",
      "A PROCESSING fee belongs to a product and is raised per application. Flat or a percentage of the amount.",
      "Only an UPFRONT charge blocks a loan. Everything else is raised and collected without holding the money back.",
    ],
    right: "products.view",
    related: ["products", "borrower-settings", "income-statement"],
  },
  {
    id: "workflows",
    href: "/console/workflows",
    title: "Workflows",
    module: "organization",
    purpose: "The approval chain: which stages an application passes, who may act at each, and what caps them.",
    does: [
      "Build a stage chain",
      "Set the tier that may act at each stage — initiator, authoriser, validator",
      "Cap a stage by amount and require an OTP to finalise",
    ],
    asks: [
      "workflow", "approval workflow", "approval chain", "stages", "who approves",
      "maker checker", "two tier approval", "otp on approval", "amount cap",
      "mtiririko wa idhini", "hatua za idhini",
    ],
    concepts: ["stage", "tier", "maker-checker", "finalise cap", "OTP gate"],
    implications: [
      "A stage's maximum amount is a hard stop: above it, that stage cannot finalise no matter who is standing there.",
      "Changing a workflow affects applications that enter it next. In-flight applications keep the chain they started on.",
      "Every stage decision captures a message into the permanent approval trail.",
    ],
    right: "workflows.view",
    related: ["products", "application-dossier", "roles"],
  },
  {
    id: "branding",
    href: "/console/settings/branding",
    title: "Branding",
    module: "organization",
    purpose: "Your logo, your colours and the words your customers read.",
    does: ["Upload a logo", "Set the brand colours", "Write the tagline and blurb"],
    asks: ["branding", "logo", "colours", "colors", "change our colours", "nembo", "rangi za shirika"],
    implications: [
      "Colours apply to the console on the next page load and to the borrower portal immediately. No sign-out needed.",
      "The logo is also what appears on your printed documents — statements, the income statement, offer letters.",
    ],
    right: "branding.manage",
    related: ["settings", "income-statement"],
  },
  {
    id: "settings",
    href: "/console/settings",
    title: "Settings & Vault",
    module: "organization",
    purpose:
      "The launcher for everything configurable — credentials in a vault, and a tile for every other setting surface.",
    does: [
      "Connect M-Pesa collections (STK) and payouts (B2C)",
      "Connect SMS, email, CRB and, if you bring one, your own KYC vendor",
      "Open credit policy, borrower settings, branding, products, charges, structure, roles, workflows and billing",
    ],
    asks: [
      "settings", "vault", "credentials", "configure", "integrations", "connect mpesa",
      "daraja", "api keys", "mipangilio", "unganisha mpesa",
    ],
    concepts: ["vault", "integration status", "Daraja", "credentials"],
    implications: [
      "Credentials are stored in the vault and shown masked. Saving re-tests the connection live; nothing here needs a sign-out.",
      "Identity verification runs on PLATFORM credentials as standard. You only fill in the KYC tile if you bring your own vendor.",
    ],
    right: "settings.view",
    related: ["vault-settings", "credit-policy", "borrower-settings", "branding", "disbursements"],
  },
  {
    id: "vault-settings",
    href: "/console/settings",
    title: "Money rails (Vault)",
    module: "organization",
    purpose: "Your own M-Pesa Daraja credentials — collections on one side, payouts on the other.",
    does: [
      "Enter the STK app: consumer key, secret, shortcode, passkey, environment",
      "Enter the B2C app: shortcode, initiator, security credential",
      "Test the connection",
    ],
    asks: [
      "mpesa credentials", "daraja", "stk credentials", "b2c credentials", "shortcode",
      "paybill", "passkey", "connect our mpesa", "vitambulisho vya mpesa",
    ],
    concepts: ["Daraja", "STK", "B2C", "shortcode", "sandbox vs production"],
    implications: [
      "Until B2C is connected you cannot pay a loan out. Until STK is connected you cannot request a repayment to a phone.",
      "Sandbox credentials work end to end but move no real money. Switching to production is a deliberate change, not a default.",
    ],
    right: "settings.manage",
    related: ["settings", "disbursements", "repayments"],
  },
  {
    id: "credit-policy",
    href: "/console/settings/credit",
    title: "Credit Policy",
    module: "organization",
    purpose:
      "The lender document that decides who borrows, how much, and what good repayment earns — score ceilings, affordability, hard stops, the behaviour matrix and the graduation ladder.",
    does: [
      "Set the SCORE CEILINGS — the most a statement of each quality can ever justify",
      "Set AFFORDABILITY — how much of an assessed capacity you are willing to commit",
      "Set the HARD STOPS — the conditions under which you will not lend at all",
      "Draw the FACTOR CURVES — drag the bands and watch the cliff appear",
      "Set the GRADUATION LADDER — what clean repayment earns on the next loan",
      "Read the LIVE PREVIEW before publishing — how many real customers this moves, and which ones",
      "Publish as a new version, or roll back to an earlier one",
    ],
    asks: [
      "credit policy", "create a credit policy", "write our credit policy", "lending policy",
      "credit policy document", "score ceilings", "scoring bands", "hard stops",
      "affordability", "graduation ladder", "behaviour matrix", "who qualifies",
      "how much can we lend", "risk appetite", "policy version", "roll back the policy",
      "sera ya mikopo", "sheria za kukopesha", "vigezo vya mkopo",
    ],
    concepts: [
      "score ceiling", "affordability band", "hard stop", "factor curve", "behaviour matrix",
      "graduation ladder", "policy version", "policy impact preview",
    ],
    implications: [
      "This is the document the decision engine and the graduation cron actually read. Publishing changes what the NEXT application is offered, immediately.",
      "The live preview runs your edit over the real book with the same code the cron uses. It tells you how many customers move and shows you one of them — publish blind and you find out in six weeks.",
      "It is versioned. Every publish records what changed and when, and you can roll back.",
      "It decides who borrows and how much. Model Tuning is a different screen: that tunes the early-warning engine, which decides who is FLAGGED.",
    ],
    right: "settings.view",
    related: ["borrower-settings", "scoring", "crunch", "model-tuning", "products"],
  },
  {
    id: "borrower-settings",
    href: "/console/settings/borrowers",
    title: "Borrower Settings",
    module: "organization",
    purpose:
      "Who your customers are and what they must prove: KYC fields, account numbering, loan limits, scoring cadence, onboarding rules and required attachments.",
    does: [
      "Choose which KYC details you collect, which you verify, and which you never ask for",
      "Define what a borrower's account number actually is",
      "Set where a new borrower's ceiling comes from and how it grows",
      "Set age limits and the global joining fee",
      "Publish as one document, with validation and a version history",
    ],
    asks: [
      "borrower settings", "kyc fields", "account number format", "age limit",
      "minimum age", "joining fee", "customer rules", "onboarding rules",
      "loan limit source", "mipangilio ya wakopaji", "ada ya kujiunga",
    ],
    concepts: ["KYC field", "account numbering", "loan limit source", "joining fee", "config version"],
    implications: [
      "The JOINING FEE lives here, not on a product — it is charged once per new customer at registration.",
      "One dirty state and one Publish. Validation runs before the write, so 'minimum age 70, maximum 22' is refused rather than stored.",
      "It is versioned, and publishing applies live — the console picks it up on the next request, with no sign-out.",
    ],
    right: "settings.view",
    related: ["credit-policy", "borrower-new", "charges", "kyc-queue"],
  },
  {
    id: "compliance",
    href: "/console/compliance",
    title: "Compliance & Data",
    module: "organization",
    purpose:
      "The screen you open when a customer says 'delete me', and the one you show the regulator when asked how you handle that.",
    does: [
      "Read the retention schedule — what is kept, for how long, and the law that says so",
      "Work the data-subject register: exports and erasures",
      "Approve an erasure with a second pair of eyes",
      "Export the book in a machine-readable format",
    ],
    asks: [
      "compliance", "data protection", "odpc", "delete a customer", "erasure",
      "right to be forgotten", "retention", "data subject request", "export our data",
      "ulinzi wa data", "futa mteja",
    ],
    concepts: ["retention schedule", "data-subject request", "erasure", "financial tombstone", "AML floor"],
    implications: [
      "An erasure leaves a financial tombstone for the AML retention floor. The person stops being a searchable customer; the money record survives because the law requires it.",
      "Erasures wait for a second approver. One person cannot delete a customer alone.",
    ],
    right: "compliance.view",
    related: ["oversight", "borrowers-list", "settings"],
  },
  {
    id: "oversight",
    href: "/console/oversight",
    title: "Oversight",
    module: "organization",
    purpose: "The audit trail as a living stream — who did what, from where, and when.",
    does: [
      "Read the day's activity down a timeline",
      "Filter by category: access, lending, money, customers, config, field, security",
      "Search for the one odd event",
    ],
    asks: [
      "oversight", "audit log", "audit trail", "who did this", "who changed this",
      "activity log", "security events", "logins", "kumbukumbu za matukio", "nani alifanya hivi",
    ],
    concepts: ["audit log", "immutability", "actor", "category"],
    implications: [
      "Nothing here can be edited. An audit trail you can change is not one.",
    ],
    right: "compliance.view",
    related: ["compliance", "team", "roles"],
  },

  // ── Access ─────────────────────────────────────────────────────────────────
  {
    id: "team",
    href: "/console/team",
    title: "Team",
    module: "access",
    purpose: "Your staff: invite them, put them in a branch, give them a role, switch them off.",
    does: ["Invite a staff member by email", "Assign a role and a branch", "Set their approval tier", "Deactivate someone"],
    asks: [
      "team", "staff", "invite a user", "add a user", "new staff member", "deactivate a user",
      "give someone access", "timu", "alika mfanyakazi", "ongeza mtumiaji",
    ],
    concepts: ["invitation", "role assignment", "approval tier", "step-up OTP"],
    implications: [
      "You cannot grant a role with more access than you hold yourself. The platform refuses it — that is the anti-escalation rule.",
      "Inviting someone into a role that manages access demands a fresh one-time code from YOU first.",
      "The branch you put them in decides whose customers they can see, together with their role's data scope.",
    ],
    right: "team.view",
    related: ["roles", "branches", "oversight", "who-sees-what"],
  },
  {
    id: "roles",
    href: "/console/roles",
    title: "Roles & Rights",
    module: "access",
    purpose:
      "Where an admin decides what each role may DO and how much of the book it may SEE — with a live preview of the menu that results.",
    does: [
      "Tick the rights a role holds, grouped by area",
      "Choose the role's DATA SCOPE: own, branch, branch tree, or the whole org",
      "Tick which report screens the role may open",
      "Watch the sidebar preview change as you tick",
    ],
    asks: [
      "roles", "rights", "permissions", "who can see whose customers", "data scope",
      "report access", "give approval rights", "restrict a user", "access control",
      "majukumu", "ruhusa", "nani anaona nini",
    ],
    concepts: ["right", "data scope", "OWN", "BRANCH", "BRANCH_TREE", "ORG", "report access", "menu preview"],
    implications: [
      "RIGHTS and SCOPE are two different questions. A right says what you may do; the scope says whose records you may do it to. 'Loans view' plus OWN scope is a very different job from 'loans view' plus ORG.",
      "What you tick is literally what the staff member's sidebar becomes on their next page load — under thirty seconds, no re-login.",
      "You cannot create or edit a role above your own access. Both the editor and the assignment path enforce it.",
      "`reports.view` is the umbrella that opens every report. Grant the specific rights instead when you want a role to see only one.",
    ],
    right: "roles.view",
    related: ["team", "branches", "who-sees-what", "portfolio-report"],
  },

  // ── Billing ────────────────────────────────────────────────────────────────
  {
    id: "billing",
    href: "/console/billing",
    title: "Package & Usage",
    module: "billing",
    purpose: "What you are on, what you have used, what it will cost — and the way to change it.",
    does: ["Compare packages", "Read this month's usage", "Top up SMS", "Change your package"],
    asks: [
      "billing", "package", "plan", "upgrade", "how much am i paying", "usage",
      "invoice", "sms credits", "top up sms", "subscription", "downgrade",
      "malipo ya jukwaa", "kifurushi", "pandisha daraja",
    ],
    concepts: ["package", "feature entitlement", "usage event", "SMS credit", "wallet"],
    implications: [
      "Packages change which intelligence tools you get. They never change whether you can lend — your book keeps working on any plan.",
      "Payment settles through the BirgenAI wallet. This screen never touches M-Pesa directly.",
    ],
    right: "billing.view",
    related: ["settings", "sms-campaigns", "metrics"],
  },

  // ── Connected Suite ────────────────────────────────────────────────────────
  {
    id: "suite",
    href: "/suite",
    title: "Connected Suite",
    module: "suite",
    purpose: "One BirgenAI ID across every system — lending, HR, accounting and the call centre — signed in once.",
    does: ["Launch a connected system with no second password", "Switch between systems", "See who you are signed in as"],
    asks: [
      "suite", "sso", "single sign on", "birgenai id", "other systems", "hr system",
      "accounting", "call center", "switch system", "mifumo mingine",
    ],
    concepts: ["SSO", "BirgenAI ID", "federated session"],
    related: ["team", "roles"],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// CROSS-CUTTING CONCEPTS
//
// The things that are not a screen. A lender asking "who can see whose customers"
// is not asking to be taken anywhere — they are asking how the model works, and
// answering with a link is answering a different question. Each concept names the
// screens where it becomes concrete, so the answer can still end in a door.
// ─────────────────────────────────────────────────────────────────────────────

export type SystemConcept = {
  id: string;
  title: string;
  asks: string[];
  /** The explanation, in the words a lender's staff would use. */
  body: string;
  /** Where it becomes real. Screen ids. */
  screens?: string[];
};

export const SYSTEM_CONCEPTS: SystemConcept[] = [
  {
    id: "who-sees-what",
    title: "Who can see whose customers",
    asks: [
      "who can see whose customers", "data scope", "visibility", "why can't i see this customer",
      "can my officer see everyone", "restrict what someone sees", "own scope", "branch scope",
      "nani anaona wateja wa nani", "kwa nini siwezi kuona mteja huyu",
    ],
    body:
      "Two separate things decide it, and confusing them is the most common access mistake on the platform.\n\n" +
      "**Rights** say what you may DO — view borrowers, decide applications, release money.\n" +
      "**Data scope** says WHOSE records you may do it to, and it lives on the role:\n\n" +
      "- **OWN** — only the customers that person registered.\n" +
      "- **BRANCH** — everyone in their office.\n" +
      "- **BRANCH_TREE** — their office and every office under it.\n" +
      "- **ORG** — the whole book.\n\n" +
      "So a loan officer with `borrowers.view` on OWN scope and a regional manager with the same right on BRANCH_TREE hold the identical permission and see completely different books. " +
      "This is also why 'no customer by that name' is never quite the whole truth — the honest version is 'nobody by that name **that you can see**', and the assistant says it that way on purpose.",
    screens: ["roles", "branches", "team"],
  },
  {
    id: "maker-checker",
    title: "Maker-checker, and why approval is not disbursement",
    asks: [
      "maker checker", "two person rule", "why do i need a second person", "four eyes",
      "approval vs disbursement", "i approved it but no money", "dual control",
    ],
    body:
      "Money moves in two acts by different people, always.\n\n" +
      "**Approving** an application moves it one stage along its workflow. Nothing has left the float.\n" +
      "**Disbursing** it releases the money, and the person who initiates the payout cannot be the person who confirms it.\n\n" +
      "That is why an approved loan can sit unpaid: it is not stuck, it is waiting for the second act. " +
      "The split is not a setting you can switch off — it is the control that makes a single compromised account unable to pay itself.",
    screens: ["application-dossier", "disbursements", "workflows"],
  },
  {
    id: "why-blocked",
    title: "Why something is blocked",
    asks: [
      "why is this greyed out", "why can't i", "button disabled", "blocked", "not allowed",
      "why is it stuck", "kwa nini imezuiwa", "kitufe hakifanyi kazi",
    ],
    body:
      "A blocked action on this platform has exactly one of five causes, and they are worth checking in this order:\n\n" +
      "1. **The lender is not ACTIVE yet.** Everything configures; no real money moves.\n" +
      "2. **Your role does not hold the right.** The screen may not even be on your menu.\n" +
      "3. **Your package does not include it.** Named honestly, with the price, rather than a wall.\n" +
      "4. **A gate upstream is unmet** — KYC not verified, no signed offer, no active product, no float, credentials not connected.\n" +
      "5. **The workflow says not you, or not this amount** — the stage caps it, or your tier cannot finalise it.\n\n" +
      "Ask about any specific one and it can be named exactly.",
    screens: ["dashboard", "roles", "billing", "workflows", "disbursements"],
  },
  {
    id: "money-in-out",
    title: "How money actually moves",
    asks: [
      "how does money move", "payment flow", "how do repayments work", "how do payouts work",
      "c2b", "b2c", "stk", "paybill", "pesa inatembeaje",
    ],
    body:
      "**Out:** application approved → disbursement initiated → a second person confirms → M-Pesa B2C pays the customer → the float drops.\n\n" +
      "**In:** either you push (an STK request to their phone) or they push (a paybill payment). Either way a receipt arrives, is matched to a loan, and is allocated across the installment — penalties, then interest, then principal, in that order.\n\n" +
      "**When matching fails**, the money is never lost. It lands in Reconciliation as an unallocated exception and waits for a human to point it at the right loan.\n\n" +
      "**M-Pesa Ratiba** is the standing-order path: the customer approves once and Safaricom debits the installment on the loan's own cycle.",
    screens: ["disbursements", "repayments", "reconciliation"],
  },
  {
    id: "score-to-limit",
    title: "From statement to score to limit to product",
    asks: [
      "how does scoring work", "where does the limit come from", "internal score",
      "how much can they borrow", "starting limit", "how is the limit decided",
      "graduation", "how do they get a bigger loan", "kikomo cha mkopo",
    ],
    body:
      "For a **new customer**: their six-month M-Pesa statement is crunched into an internal score. Two ceilings come out of it — what the SCORE can justify and what their AFFORDABILITY can carry — and the starting limit is the **lower of the two**, snapped down to a real product tier. Reason codes say which ceiling bound it and why.\n\n" +
      "For a **repeat customer**: the graduation ladder takes over. Clean repayment earns the next rung; arrears cost one. That ladder is written in Credit Policy, and the cron that walks it reads the same document you edit.\n\n" +
      "The limit is a ceiling, not a promise: an application still has to pass the product's rules and the approval chain.",
    screens: ["crunch", "credit-policy", "scoring", "apply-for-borrower"],
  },
  {
    id: "fees",
    title: "Joining fee, processing fee, penalties",
    asks: [
      "fees", "what fees can we charge", "joining fee vs processing fee", "registration fee",
      "penalty", "late fee", "which fee blocks a loan", "ada zipi",
    ],
    body:
      "**Joining fee** — belongs to the BORROWER, charged once when they are registered. Configured in Borrower Settings, not on a product, because it is a fact about becoming a customer rather than about a loan.\n\n" +
      "**Processing fee** — belongs to a PRODUCT, charged per application. Flat, or a percentage of the amount.\n\n" +
      "**Penalties** — raised by the arrears rules against a late installment.\n\n" +
      "Only a charge marked **upfront** actually blocks a loan. The rest are raised and collected without holding the money back — which is why 'we charge for it' and 'they cannot get the loan until they pay it' are two different decisions.",
    screens: ["charges", "borrower-settings", "products"],
  },
  {
    id: "security-model",
    title: "How the platform protects itself",
    asks: [
      "security", "how secure is it", "session expiry", "otp", "two factor",
      "can an admin make themselves super admin", "privilege escalation", "usalama",
    ],
    body:
      "**Tenancy** — every read is fenced to your organisation by the database itself, not by a WHERE clause somebody has to remember.\n\n" +
      "**No self-escalation** — you cannot create, edit or assign a role that holds more access than you do. Enforced in the roles editor and again at assignment.\n\n" +
      "**Sessions expire** — twelve hours, absolute.\n\n" +
      "**Daily code** — a six-digit second factor, reusable until midnight so it is not a tax on a busy counter, and it burns after five wrong tries.\n\n" +
      "**Step-up** — granting access-managing rights demands a fresh single-use code from the person doing the granting.\n\n" +
      "**Everything is audited** — immutably, with the actor, the device and the place.",
    screens: ["roles", "team", "oversight", "compliance"],
  },
  {
    id: "assistant-apps",
    title: "The assistant's own apps",
    asks: [
      "where are my old conversations", "saved chats", "chat history", "previous conversations",
      "where are the alerts", "notifications", "how do i dial a customer", "dialler", "dialer",
      "call from here", "autopilot", "turn on autopilot", "how do i change the language",
      "make it read out loud", "voice", "mazungumzo ya awali", "arifa", "piga simu",
    ],
    body:
      "I run as a handset in the corner of the console. Tap the round face to open me, and the home button at the bottom always brings you back to the app grid.\n\n" +
      "- **Ask** — one conversation for everything. You don't pick which of my engines answers; I work that out from the question and tell you which one it was.\n" +
      "- **Chats** — every conversation you've had, kept. Pin the ones you're still working through; delete any of them and they're gone, not archived.\n" +
      "- **Alerts** — what's worth knowing on your book right now. Every line is a count off your live rows, not a prediction.\n" +
      "- **Calls** — a keypad that tells you whose number it is, what they owe and what was said to them last, before it rings. Log the outcome afterwards and it lands on their timeline.\n" +
      "- **Customers** — find anyone by name, phone or national ID, then every question is about them.\n" +
      "- **Settings** — voice, language, **Autopilot**, and everything I remember about you.\n\n" +
      "**Autopilot** is off until you turn it on. With it on, an answer that ends somewhere opens that screen instead of offering you a button. It only ever NAVIGATES — it never approves, disburses or changes a permission when it arrives.",
    screens: [],
  },
  {
    id: "assistant-limits",
    title: "What ServiceSuite AI will and will not do",
    asks: [
      "what can you do", "what can't you do", "can you approve a loan", "are you safe",
      "do you make things up", "can you delete", "unaweza kufanya nini",
    ],
    body:
      "**It explains, it measures, it navigates, and it drafts.** It never approves, declines, disburses, deletes, or changes anyone's permissions — not with Autopilot on, not if you ask it to. The irreversible half of every action stays with a human.\n\n" +
      "**It sees exactly what you see.** Your data scope is its data scope; on OWN scope it cannot read the branch next door either.\n\n" +
      "**It shows its working.** A number off the book comes with the query that produced it. A fact about a customer comes from their record. Anything reasoned is labelled as reasoned. If it does not know, it says so — a made-up menu path is worse than an admission, because you cannot tell one from the other until you are standing in front of a screen that does not exist.",
    screens: [],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// RETRIEVAL
//
// Boring on purpose — weighted keyword scoring over titles, asks, concepts and
// purposes. A navigation question is short and vocabulary-bound, and a wrong
// destination delivered confidently is worse than a right one delivered plainly.
// ─────────────────────────────────────────────────────────────────────────────

const STOP = new Set([
  "the", "a", "an", "to", "for", "of", "in", "on", "at", "is", "are", "do", "does",
  "how", "what", "where", "who", "why", "can", "i", "we", "my", "our", "me", "us",
  "you", "it", "this", "that", "and", "or", "with", "from", "please", "want", "need",
  "take", "go", "open", "show", "find", "get", "make", "set", "up", "page", "screen",
  "ninataka", "nataka", "ni", "na", "ya", "wa", "kwa", "je", "nini", "vipi", "wapi",
]);

/**
 * The smallest stemmer that fixes the real bug.
 *
 * The founder typed "take me to create credit policies" and it scored ten points —
 * because the entry says "credit policy" and a plural is a different string. Nobody
 * types the singular the map happens to be written in, and a navigation engine that
 * only works when you guess its vocabulary is not a navigation engine.
 *
 * Deliberately not Porter: over-stemming costs precision, and precision is the whole
 * safety story here — "policies"→"polic" would collide with words that mean other
 * things. Plurals are the entire observed failure, so plurals are the entire fix.
 */
function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(?:s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("ss")) return w;
  if (w.length > 3 && w.endsWith("s")) return w.slice(0, -1);
  return w;
}

const words = (s: string): string[] =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));

/**
 * A question and an entry, reduced to the same shape: stopwords gone, plurals
 * folded, one space between tokens. Both sides go through it, so "create credit
 * policies" and "create a credit policy" become the same string and match exactly
 * rather than glancing off each other.
 */
const norm = (s: string): string => words(s).map(stem).join(" ");

/**
 * The normalised forms, computed once.
 *
 * Fifty screens times a dozen phrasings is six hundred small string operations, and
 * retrieval runs on every support question — including inside the keystroke-debounced
 * paths. Doing it at module load costs one pass at boot and nothing afterwards.
 */
type Indexed = { asks: string[]; title: string; concepts: string[]; hay: Set<string>; purposeHay: Set<string> };
const INDEX = new Map<string, Indexed>();
for (const s of SYSTEM_SCREENS) {
  INDEX.set(s.id, {
    asks: s.asks.map(norm),
    title: norm(s.title),
    concepts: (s.concepts ?? []).map(norm),
    hay: new Set(words(`${s.title} ${s.asks.join(" ")} ${(s.concepts ?? []).join(" ")}`).map(stem)),
    purposeHay: new Set(words(`${s.purpose} ${s.does.join(" ")}`).map(stem)),
  });
}
const CONCEPT_INDEX = new Map<string, { asks: string[]; title: string; hay: Set<string> }>();
for (const c of SYSTEM_CONCEPTS) {
  CONCEPT_INDEX.set(c.id, {
    asks: c.asks.map(norm),
    title: norm(c.title),
    hay: new Set(words(`${c.title} ${c.asks.join(" ")}`).map(stem)),
  });
}

export type ScreenHit = {
  screen: SystemScreen;
  score: number;
  /** False when the caller's rights or package would not let them open it. */
  permitted: boolean;
  entitled: boolean;
};

export type Access = { rights: ReadonlySet<string>; features: ReadonlySet<string> };

const admits = (s: SystemScreen, rights: ReadonlySet<string>): boolean => {
  if (rights.has("*")) return true;
  if (s.right && !rights.has(s.right)) return false;
  if (s.anyRight && !s.anyRight.some((r) => rights.has(r))) return false;
  return true;
};

/**
 * Rank the screens against a question.
 *
 * Scoring, highest signal first: an exact phrase in `asks` is somebody having said
 * this exact thing before and is worth more than any number of scattered word hits;
 * a title match is next; then concepts, then `does`, then the purpose sentence.
 *
 * Screens the caller cannot open are NOT dropped — they are returned marked, because
 * "that screen exists and it is not yours" is a real answer and silently pretending
 * it does not exist is not.
 */
export function findScreens(question: string, access?: Access, limit = 4): ScreenHit[] {
  const qw = words(question).map(stem);
  if (!qw.length) return [];
  const nq = qw.join(" ");

  const hits: ScreenHit[] = [];
  for (const screen of SYSTEM_SCREENS) {
    const ix = INDEX.get(screen.id)!;
    let score = 0;

    // THE BEST PHRASING, NOT HOW MANY GLANCED.
    //
    // Summing over `asks` looked harmless until stemming collapsed "customers",
    // "my customers" and "find a customer" into three copies of the token
    // "customer" — and the borrower list out-scored "customers near me" on its own
    // exact phrase, three times over. A screen is not a better answer for having
    // been described in more ways. Take the strongest single match.
    //
    // And a one-token ask only counts on an exact question. "customer" is a common
    // noun, not a phrasing; it still contributes through the loose pass below.
    let askScore = 0;
    for (const a of ix.asks) {
      if (!a) continue;
      const phrase = a.includes(" ");
      if (nq === a) askScore = Math.max(askScore, 60);
      else if (phrase && nq.includes(a)) askScore = Math.max(askScore, 30 + a.length / 4);
      else if (phrase && a.includes(nq) && nq.length > 4) askScore = Math.max(askScore, 18);
    }
    score += askScore;

    if (ix.title && nq.includes(ix.title)) score += 26;
    for (const c of ix.concepts) if (c && nq.includes(c)) score += 14;

    // Scattered word hits — the weakest signal, and capped so a long `does` list
    // cannot out-shout an exact phrase somebody actually typed.
    let loose = 0;
    for (const w of qw) {
      if (ix.hay.has(w)) loose += 5;
      else if (ix.purposeHay.has(w)) loose += 2;
    }
    score += Math.min(loose, 24);

    if (score <= 0) continue;
    // A screen you reach from a row, not the menu, is a worse answer to "take me to…"
    // than one you can actually open from where you stand.
    if (screen.contextual) score -= 6;

    hits.push({
      screen,
      score,
      permitted: access ? admits(screen, access.rights) : true,
      entitled: access ? !screen.feature || access.features.has(screen.feature) : true,
    });
  }

  hits.sort((a, z) => z.score - a.score);
  return hits.slice(0, limit);
}

/** Concept lookup — same shape, same discipline. */
export function findConcepts(question: string, limit = 2): { concept: SystemConcept; score: number }[] {
  const qw = words(question).map(stem);
  if (!qw.length) return [];
  const nq = qw.join(" ");

  const out: { concept: SystemConcept; score: number }[] = [];
  for (const concept of SYSTEM_CONCEPTS) {
    const ix = CONCEPT_INDEX.get(concept.id)!;
    let score = 0;
    let askScore = 0;
    for (const a of ix.asks) {
      if (!a) continue;
      if (nq === a) askScore = Math.max(askScore, 60);
      else if (a.includes(" ") && nq.includes(a)) askScore = Math.max(askScore, 30 + a.length / 4);
    }
    score += askScore;
    if (ix.title && nq.includes(ix.title)) score += 20;
    let loose = 0;
    for (const w of qw) if (ix.hay.has(w)) loose += 5;
    score += Math.min(loose, 20);
    if (score > 0) out.push({ concept, score });
  }
  out.sort((a, z) => z.score - a.score);
  return out.slice(0, limit);
}

export const screenById = (id: string): SystemScreen | undefined => SYSTEM_SCREENS.find((s) => s.id === id);
export const screenByHref = (href: string): SystemScreen | undefined => SYSTEM_SCREENS.find((s) => s.href === href);

/** Every screen this caller can actually open, in menu order. Feeds "what can I do here?". */
export function screensFor(access: Access): SystemScreen[] {
  return SYSTEM_SCREENS.filter(
    (s) => !s.contextual && admits(s, access.rights) && (!s.feature || access.features.has(s.feature)),
  );
}

/**
 * THE DESTINATION.
 *
 * One screen, or none — the question Autopilot asks before it is allowed to move
 * anything. It answers only when the top hit is both clearly ahead of the runner-up
 * and above an absolute floor: navigating someone to a screen they did not ask for
 * is worse than offering nothing, because they now have to work out where they are
 * before they can work out where they wanted to be.
 */
export function resolveDestination(question: string, access?: Access): ScreenHit | null {
  const hits = findScreens(question, access, 3);
  if (!hits.length) return null;
  const [top, second] = hits;
  if (top.score < 26) return null;
  if (second && top.score - second.score < 8) return null;
  return top;
}
