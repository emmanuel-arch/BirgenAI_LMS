// ─────────────────────────────────────────────────────────────────────────────
// THE APP REGISTRY.
//
// What used to live here was a lineup of THREE MODELS — Support, Assistant,
// Analytics — one tile each, and the tiles were the product's architecture drawn
// on the home screen. The founder's note was exact: "let's not have three models,
// let's showcase brilliance." Three tiles named after three engines is not
// brilliance, it is a wiring diagram with rounded corners, and it made every user
// answer a question about our implementation before asking their own.
//
// So the apps are now named after WHAT SOMEBODY WANTS TO DO, and the engines are
// invisible behind them:
//
//   Ask       — one conversation. The router picks the engine (lib/riri/router.ts)
//               and the answer says which one ran.
//   Due Today — the money the book is owed before close of business.
//   Arrears   — the money it is already owed, aged into buckets.
//   Promises  — who said they would pay today, and what they said.
//   Chats     — the ones you have already had, still there on Monday.
//   Alerts    — what it would have told you if you hadn't asked. Counted rows.
//   Calls     — the number, and who it belongs to before it rings.
//   Customers — find a person, then talk about them.
//   Settings  — voice, language, autopilot, memory, and the account.
//
// THE MORNING THREE SIT SECOND, THIRD AND FOURTH. An assistant that can answer any
// question is worth less at 8am than a screen that already knows what today's
// question is — so the three figures a lending team opens their day on are app
// icons with live badges, not something you have to think to ask for.
//
// The gradients are the identity system: an officer learns an app by its colour
// two weeks before they read its label, which is the entire reason phone home
// screens work. They are fixed and they do not follow --brand — a white-label
// lender's orange must not turn five apps orange and destroy the only thing
// distinguishing them.
// ─────────────────────────────────────────────────────────────────────────────
import type { RouteName } from "./nav";

export type OsApp = {
  route: RouteName;
  /** The label under the icon. One word wherever possible. */
  name: string;
  /** lucide icon name, resolved in the client. */
  icon: string;
  /** Icon artwork. Fixed hues — see the header. */
  tile: { from: string; to: string };
  /** The one line on the home screen's "what is this" row. */
  blurb: string;
  /** In the bottom dock (always visible) rather than the grid. */
  dock?: boolean;
  /** Dock ONLY — kept off the grid so the grid stays a whole number of rows. */
  dockOnly?: boolean;
};

export const OS_APPS: OsApp[] = [
  {
    route: "ask",
    name: "Ask",
    icon: "MessageCircle",
    tile: { from: "#6366f1", to: "#4338ca" },
    blurb: "One conversation. It works out whether you want a fact, a figure or a plan.",
    dock: true,
  },
  {
    route: "alerts",
    name: "Alerts",
    icon: "BellRing",
    tile: { from: "#f43f5e", to: "#9f1239" },
    blurb: "What's worth knowing on your book right now, counted — not guessed.",
    dock: true,
  },
  {
    route: "due",
    name: "Due Today",
    icon: "CalendarClock",
    tile: { from: "#14b8a6", to: "#0f766e" },
    blurb: "Every shilling the book is owed before close of business, and who owes it.",
  },
  {
    route: "arrears",
    name: "Arrears",
    icon: "TrendingDown",
    tile: { from: "#f97316", to: "#9a3412" },
    blurb: "What is already late, aged 1–7, 8–30, 31–60 and beyond — worst first.",
  },
  {
    route: "promises",
    name: "Promises",
    icon: "Handshake",
    tile: { from: "#8b5cf6", to: "#5b21b6" },
    blurb: "Who promised to pay today, how much, and what they said on the call.",
  },
  {
    route: "calls",
    name: "Calls",
    icon: "Phone",
    tile: { from: "#10b981", to: "#065f46" },
    blurb: "Dial a number and know who it is, what they owe and what was said last.",
    dock: true,
  },
  {
    route: "chats",
    name: "Chats",
    icon: "History",
    tile: { from: "#0ea5e9", to: "#0369a1" },
    blurb: "Every conversation you've had, kept — pick one up where you left it.",
  },
  {
    route: "find",
    name: "Customers",
    icon: "UserSearch",
    tile: { from: "#f59e0b", to: "#b45309" },
    blurb: "Find anyone on your book by name, phone or national ID.",
  },
  {
    route: "settings",
    name: "Settings",
    icon: "Settings",
    tile: { from: "#64748b", to: "#334155" },
    blurb: "Voice, language, Autopilot, and what I remember about you.",
    dock: true,
    dockOnly: true,
  },
];

export const appFor = (route: RouteName): OsApp | undefined => OS_APPS.find((a) => a.route === route);

/**
 * The grid is EIGHT, four across, two rows — a whole rectangle.
 *
 * Settings is the one app that lives in the dock alone. Not an arbitrary cut: a
 * home screen whose last row is one lonely icon reads as unfinished, and Settings
 * is the only one of the nine nobody navigates to by looking for it. The dock
 * repeats the three you reach for without looking, plus that one.
 */
export const GRID_APPS = OS_APPS.filter((a) => !a.dockOnly);
export const DOCK_APPS = OS_APPS.filter((a) => a.dock);
