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
//   Chats     — the ones you have already had, still there on Monday.
//   Alerts    — what it would have told you if you hadn't asked. Counted rows.
//   Calls     — the number, and who it belongs to before it rings.
//   Customers — find a person, then talk about them.
//   Settings  — voice, language, autopilot, memory, and the account.
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
  },
];

export const appFor = (route: RouteName): OsApp | undefined => OS_APPS.find((a) => a.route === route);

/** The grid: everything, in learned order. The dock repeats four of them. */
export const GRID_APPS = OS_APPS;
export const DOCK_APPS = OS_APPS.filter((a) => a.dock);
