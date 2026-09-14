// ─────────────────────────────────────────────────────────────────────────────
// THE CUSTOMER APP'S MAP — every screen a borrower can stand on.
//
// Riri Ecosystem AI plan, §06 Table 5: "Micro Eazy app (customer) — None. ~14
// screens. One file, same shape." This is that file. It is the app's Tier A
// corpus: CODE, not an upload, and the only thing on the customer surface allowed
// to produce a navigation action. A tenant pack can say what Micromart charges; it
// can never send a customer to a button, because it does not know where the
// buttons are and is not present when they move.
//
// It lives HERE rather than in micro-eazy-app because Riri runs here — the app is
// a static bundle that talks to this server, and a map the answering brain cannot
// read is a map that does not exist. The drift is guarded from this side instead:
// scripts/verify-first-response.ts reads micro-eazy-app/src/App.tsx and fails if
// any `href` below is not a route the app actually declares.
//
// ── `/` IS HOME, AND THE APP RESOLVES IT ─────────────────────────────────────
// A signed-in customer's home is `/<lender slug>`, and `/` redirects there. The
// map says `/` so it is true for every lender; the app turns it into the lender's
// own home before it navigates (see the dock's navigate()).
//
// ── `implications` ARE WRITTEN FOR THE CUSTOMER ──────────────────────────────
// The console map's implications are for staff ("changes every open offer"). A
// customer's are the consequences THEY live with: a purpose picker that labels a
// payment rather than routing it, a standing order whose cancellation does not
// cancel the debt. Each one is here because somebody has rung an office about it.
// ─────────────────────────────────────────────────────────────────────────────
import type { RiriScreen } from "../core/context";
import type { RiriMapManifest } from "../core/destination";

export const APP_SCREENS: RiriScreen[] = [
  {
    id: "app-home",
    href: "/",
    title: "Home",
    purpose: "Your account at a glance — what you can borrow, what you owe, your savings, your score, and anything waiting for you.",
    does: [
      "See your limit and how much of it is available",
      "See your open loan and its balance",
      "See your savings and your score",
      "Open the latest message from the team",
    ],
    asks: ["home", "my account", "dashboard", "main page", "go home", "account summary", "nyumbani", "akaunti yangu", "ukurasa wa mwanzo"],
    implications: [
      "If it says your lender's book could not be reached, that is a connection problem — not a zero balance. Nothing you owe has changed.",
    ],
  },
  {
    id: "app-kyc",
    href: "/kyc",
    title: "KYC verification",
    purpose: "Prove who you are once: your National ID, a selfie, and the details a licensed lender has to hold.",
    does: ["Photograph the front of your ID", "Take a selfie", "Confirm your details and location"],
    asks: ["kyc", "verify my id", "id check", "identity verification", "verify identity", "upload my id", "thibitisha kitambulisho", "kitambulisho", "uthibitisho"],
    implications: [
      "A person at your lender signs off every new customer's identity before any money moves, so a check can say 'under review' for a while. That is normal.",
      "Use your own ID and your own face — a check on someone else's card is refused and cannot be appealed from the app.",
    ],
  },
  {
    id: "app-crunch",
    href: "/crunch",
    title: "Statement cruncher",
    purpose: "Upload your six-month M-PESA statement so your starting limit is set from your real cashflow, not a guess.",
    does: ["Upload the PDF Safaricom emailed you", "Enter the statement password", "See your score and starting limit, with the reasons"],
    asks: ["statement", "upload statement", "mpesa statement", "crunch", "statement cruncher", "my statement", "taarifa ya mpesa", "pakia statement"],
    implications: [
      "A statement can only score the person named on it. If yours is registered under a different name, raise it from that screen and a person will look at it.",
    ],
  },
  {
    id: "app-apply",
    href: "/apply",
    title: "Apply now",
    purpose: "Choose a product, an amount and how long to repay, see every shilling it costs, and send the application.",
    does: ["Pick a product your limit unlocks", "Choose the amount and the number of weeks", "Read the full cost before you agree", "Send the application"],
    asks: ["apply", "apply for a loan", "new loan", "borrow", "get a loan", "i want a loan", "take a loan", "omba mkopo", "nataka mkopo", "kopa"],
    implications: [
      "Interest is priced for exactly the number of weeks you choose — fewer weeks costs less.",
      "Sending an application does not approve it. It goes to the lender's desks in order, and you can follow each one under Application.",
    ],
  },
  {
    id: "app-track",
    href: "/track",
    title: "Application",
    purpose: "Where your application is right now, named the same way the officer handling it sees it.",
    does: ["See the desk your application is on", "See how long each stage usually takes", "Ask the team about it"],
    asks: ["track", "track my application", "application status", "where is my loan", "where is my application", "is my loan approved", "ombi langu", "mkopo wangu uko wapi", "status ya mkopo"],
    implications: [
      "The stage names are the lender's own — 'Risk' on your screen is the same desk an officer sees.",
    ],
  },
  {
    id: "app-messages",
    href: "/messages",
    title: "Messages",
    purpose: "Your conversations with the team handling your account — and every update about your case, in the same scroll.",
    does: ["Read replies from the team", "Reply to a conversation", "See case updates as they happen"],
    asks: ["messages", "inbox", "my messages", "conversations", "did they reply", "reply from the team", "ujumbe", "jumbe zangu"],
    implications: [
      "Riri answers first. Anything she cannot sort out, she passes to a person with what she already checked, so you never have to explain twice.",
    ],
  },
  {
    id: "app-thread",
    href: "/messages/:threadId",
    title: "Conversation",
    purpose: "One conversation with the team, with every case update in order.",
    does: ["Read the conversation", "Write a reply"],
    asks: ["open conversation", "the conversation", "reply to the team"],
    contextual: true,
  },
  {
    id: "app-repay",
    href: "/repay",
    title: "Repay",
    purpose: "What you owe, and a Pay now button that sends an M-PESA prompt to your registered phone.",
    does: ["See your balance", "Pay with an M-PESA prompt", "See how auto-repay with Ratiba works"],
    asks: ["repay", "pay", "pay my loan", "make a payment", "how do i pay", "pay now", "lipa", "lipa mkopo", "nilipe", "kulipa"],
    implications: [
      "Money goes to your loan first; anything left over goes to your savings. Choosing a purpose labels the payment — it does not redirect it.",
      "Press Pay now once and wait for the prompt. Pressing again sends a second prompt for the same money.",
    ],
  },
  {
    id: "app-loans",
    href: "/loans",
    title: "Your loans",
    purpose: "The loans you hold with this lender.",
    does: ["See your loans"],
    asks: ["my loans", "your loans", "loan history", "past loans", "mikopo yangu"],
  },
  {
    id: "app-score",
    href: "/score",
    title: "Your score",
    purpose: "The decision on your application and the reasons behind it — with what you can do about each one.",
    does: ["Read why you were approved, declined or referred", "See what would change it", "See how to appeal"],
    asks: ["my score", "credit score", "why was i declined", "why this decision", "decision", "reasons", "alama yangu", "kwa nini nimekataliwa"],
    implications: [
      "Checking your own score never counts against you.",
      "Where a reason says nothing you do changes it, that is true — it is usually time that has to pass.",
    ],
  },
  {
    id: "app-ladder",
    href: "/ladder",
    title: "Limit ladder",
    purpose: "How your limit got to where it is — every step up and down, and the rule for the next one.",
    does: ["See each limit change and why", "See the rule for your next step"],
    asks: ["limit ladder", "my limit", "limit history", "how do i increase my limit", "raise my limit", "kiwango changu", "ongeza kiwango"],
    implications: ["Limits are reviewed when you repay. Nobody sets them by hand."],
  },
  {
    id: "app-exposure",
    href: "/exposure",
    title: "Credit file",
    purpose: "What the credit system can see about you: this lender, your bureau file, and what other lenders report.",
    does: ["See your bureau file from the last check", "See what other lenders in the network report", "See what you have consented to"],
    asks: ["credit file", "crb", "my crb", "bureau", "metropol", "credit report", "am i listed", "listed on crb", "faili la mkopo"],
    implications: [
      "'We could not ask' and 'nothing found' are different answers, and this screen keeps them apart.",
    ],
  },
  {
    id: "app-identity",
    href: "/identity",
    title: "Your ID check",
    purpose: "Why your identity check was referred to a person, and the one thing that would help.",
    does: ["Read what the check was unsure about", "Retake a photo when that would help", "Message a person when it would not"],
    asks: ["id check referred", "why is my id under review", "identity review", "id review"],
    contextual: true,
  },
  {
    id: "app-you",
    href: "/you",
    title: "You",
    purpose: "Your appearance settings, your account, and signing out.",
    does: ["Choose light or dark", "Choose a background photo", "Sign out"],
    asks: ["settings", "profile", "you", "dark mode", "change background", "sign out", "log out", "mipangilio", "toka"],
  },
];

/** Bump when a screen is added, removed or re-described. */
export const APP_MAP_VERSION = 1;

export function appManifest(base: string): RiriMapManifest {
  return { system: "app", base, version: APP_MAP_VERSION, title: "the Micro Eazy app", screens: APP_SCREENS };
}

export const appScreenById = (id: string) => APP_SCREENS.find((s) => s.id === id);
