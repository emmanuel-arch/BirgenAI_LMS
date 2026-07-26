// ─────────────────────────────────────────────────────────────────────────────
// THE APPS — what each of the three intelligences actually is, said in full.
//
// models.ts holds the LINEUP (ids, icons, legacy translation). This file holds the
// PITCH: what an app can do, what it hands back, and the real questions people ask
// it — the material the dock's briefing screen and its use-case deck are built from.
//
// WHY IT IS SEPARATE, AND WHY IT IS LONG:
// the dock used to compress all of this into one truncated line of chrome —
// "LIVE DATA · Talks to your live book — by period, product or borrower. Sho…".
// That line was worse than nothing: it occupied the most valuable pixels on the
// panel, was cut off mid-word, and told an officer neither what the model knows
// nor what it will give back. A capability is not a subtitle. It gets a screen.
//
// THE STEP-WISE RULE (founder's, and it is a correctness rule, not a style one):
// you cannot be in two apps at once. Each app owns its own thread and its own
// composer; changing app means closing the one you are in and launching another
// from home. The failure it prevents is real and expensive — typing a question
// for Analytics, tapping Assistant while thinking, and sending a request for a
// hard number into a model that will reason its way to a plausible one instead.
// ─────────────────────────────────────────────────────────────────────────────

import type { RiriModelId } from "./models";

/** One thing an app can do, as a person would describe it. */
export type Capability = {
  /** lucide icon name, resolved client-side. */
  icon: string;
  title: string;
  detail: string;
};

/** A question worth asking, grouped so the deck reads as a menu, not a word cloud. */
export type UseCaseGroup = {
  label: string;
  /** lucide icon name for the group header. */
  icon: string;
  prompts: string[];
};

export type RiriApp = {
  id: RiriModelId;
  /** The one line that goes under the app name on the briefing screen. */
  headline: string;
  /** The paragraph the briefing opens with. `{name}` → the officer's first name,
   *  `{org}` → the lender. Interpolated client-side. */
  intro: string;
  /** What it can do. Rendered as rows on the briefing screen. */
  capabilities: Capability[];
  /** What it hands back — set expectations BEFORE the first question, not after. */
  outputs: string[];
  /** The boundary. Every app states one; an assistant that claims no limits has none
   *  worth trusting. */
  limit: string;
  /** The full deck, grouped. This is what fills the screen on an empty thread. */
  useCases: UseCaseGroup[];
  /** Tailwind-ready tile gradient stops (the app icon's "artwork"). */
  tile: { from: string; to: string };
};

export const RIRI_APPS: Record<RiriModelId, RiriApp> = {
  support: {
    id: "support",
    headline: "Knows this platform inside out",
    intro:
      "Hi {name}. I know every screen, every rule and every reason something is blocked in {org} — and I know which of them YOUR role can actually open. Ask me how to do anything and I'll walk you there.",
    capabilities: [
      { icon: "Route", title: "Walks you through any task", detail: "Step by step, in the order that actually works — not a menu of links." },
      { icon: "ShieldAlert", title: "Explains why something is blocked", detail: "A greyed-out button always has a reason. I name it, and I name who can lift it." },
      { icon: "ListChecks", title: "Knows where your setup stands", detail: "Reads your live configuration, so \"what do I do next\" has a real answer on day one." },
      { icon: "Navigation", title: "Takes you there", detail: "Turn on Autopilot and I don't offer a button — I move the screen for you." },
      { icon: "Languages", title: "English or Kiswahili", detail: "Ask in either. Same answers, same honesty — not a thinner second language." },
    ],
    outputs: ["Step-by-step instructions", "The exact screen, opened", "Who to ask when it isn't yours to do"],
    limit: "I explain and I navigate. I never approve, disburse or change anyone's permissions — those stay with you.",
    useCases: [
      {
        label: "Getting things done", icon: "Play",
        prompts: [
          "How do I apply for a loan for a customer?",
          "How do I register a new borrower?",
          "How do I record a repayment that came in by cash?",
          "How do I disburse to a customer's M-Pesa?",
        ],
      },
      {
        label: "When something is blocked", icon: "ShieldAlert",
        prompts: [
          "Why can't I disburse this loan?",
          "Why is this application stuck in review?",
          "Why can't I see this customer?",
          "Why is the approve button greyed out?",
        ],
      },
      {
        label: "Setting up the lender", icon: "Settings2",
        prompts: [
          "What do I do next?",
          "How do I create a loan product?",
          "How do I connect our own M-Pesa?",
          "How do I add a branch and put staff in it?",
        ],
      },
      {
        label: "Access & billing", icon: "KeyRound",
        prompts: [
          "Who can see whose customers?",
          "How do I give someone approval rights?",
          "How do I upgrade our package?",
          "What am I being charged for?",
        ],
      },
    ],
    tile: { from: "#0ea5e9", to: "#0369a1" },
  },

  assistant: {
    id: "assistant",
    headline: "Knows you, your book and the customer on your screen",
    intro:
      "Niaje {name} 👋 I know your role, the slice of {org}'s book you're responsible for, and whoever you have open. I remember what I told you last week. Ask me in English, Kiswahili or Sheng.",
    capabilities: [
      { icon: "UserSearch", title: "Knows the customer in front of you", detail: "Open me from anyone's page — or just say their name — and every question after that is about them." },
      { icon: "Brain", title: "Remembers your history", detail: "What you asked, what I advised, what happened. \"What did you tell me last week?\" has an answer." },
      { icon: "Scale", title: "Argues both sides of a decision", detail: "Should you top them up? I'll give you the case for and the case against, with the numbers behind each." },
      { icon: "PhoneCall", title: "Writes what you'll actually say", detail: "The collections call, the decline that keeps the customer, the follow-up SMS." },
      { icon: "Eye", title: "Sees only what you may see", detail: "Your data scope is mine. On OWN scope I can't read the branch next door either." },
    ],
    outputs: ["A recommendation, with its reasoning", "The exact words for a call or message", "A named next action"],
    limit: "I reason — I don't run queries. For a hard number off the book, close me and open Analytics.",
    useCases: [
      {
        label: "About a customer", icon: "UserSearch",
        prompts: [
          "Tell me about Emmanuel Kipleting",
          "Can I give this customer a top-up?",
          "Why is their limit so low?",
          "Are they likely to pay this month?",
        ],
      },
      {
        label: "My day", icon: "Sun",
        prompts: [
          "Who should I chase first today?",
          "What's changed on my book since yesterday?",
          "Which of my loans go into arrears this week?",
          "What did you tell me last week?",
        ],
      },
      {
        label: "Hard conversations", icon: "PhoneCall",
        prompts: [
          "How do I say no to them without losing them?",
          "Draft the call for a customer 12 days late",
          "They're asking for more than their limit — what do I say?",
          "Write an SMS reminding them, in Kiswahili",
        ],
      },
      {
        label: "Judgement", icon: "Scale",
        prompts: [
          "Is my book drifting?",
          "Should I restructure or push for full payment?",
          "Is this customer worth graduating?",
          "What am I missing about this application?",
        ],
      },
    ],
    tile: { from: "#8b5cf6", to: "#5b21b6" },
  },

  analytics: {
    id: "analytics",
    headline: "Talks to your live book, and shows its working",
    intro:
      "{name} — I read {org}'s live book. Ask me a number and I'll pull it straight from your data, show you the SQL I ran, and hand you an Excel or PDF of it.",
    capabilities: [
      { icon: "Database", title: "Reads the real book", detail: "Not a nightly extract, not a cache. The rows as they are, this second." },
      { icon: "Code2", title: "Shows the query", detail: "Every figure comes with the SQL behind it. A number you can't check isn't a number you can act on." },
      { icon: "SlidersHorizontal", title: "Slices any way you ask", detail: "By period, product, branch, officer or borrower — and combinations of them." },
      { icon: "TrendingUp", title: "Trends, rankings and ratios", detail: "PAR by bucket, collection rate over time, top-N by any measure, month-on-month movement." },
      { icon: "FileDown", title: "Hands you the file", detail: "Excel for the people who pivot it, PDF for the people who sign it. The server re-runs the query to build it." },
    ],
    outputs: ["The figure, with the period it covers", "The SQL that produced it", "An Excel workbook or a PDF"],
    limit: "Read-only, and scoped to your organisation by the database itself. I can measure the book; I can't change a row in it.",
    useCases: [
      {
        label: "The book right now", icon: "Landmark",
        prompts: [
          "What's my outstanding loan book?",
          "How many active loans do we have?",
          "What's my portfolio at risk?",
          "How much is in arrears over 90 days?",
        ],
      },
      {
        label: "Risk & quality", icon: "Gauge",
        prompts: [
          "What's my PAR 30 by product?",
          "Which branch has the worst arrears?",
          "What's my write-off rate this year?",
          "Show me PAR buckets: 1-30, 31-60, 61-90, 90+",
        ],
      },
      {
        label: "Money in, money out", icon: "Banknote",
        prompts: [
          "How much did we collect last month?",
          "Disbursements over time",
          "What's our collection rate this quarter?",
          "Interest earned by product this year",
        ],
      },
      {
        label: "Who and what", icon: "Users",
        prompts: [
          "Top 5 borrowers by balance",
          "Which officer disbursed the most last month?",
          "Which product is growing fastest?",
          "New borrowers per month this year",
        ],
      },
    ],
    tile: { from: "#059669", to: "#065f46" },
  },
};

/** Fill {name} / {org} in a briefing string. */
export function personalise(text: string, name: string | null | undefined, org: string): string {
  return text.replace(/\{name\}/g, name?.split(" ")[0] || "there").replace(/\{org\}/g, org);
}
