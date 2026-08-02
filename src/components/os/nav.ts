// ─────────────────────────────────────────────────────────────────────────────
// THE NAVIGATION STACK — why Back is a real button now.
//
// The old dock kept `screen: "home" | "brief" | "app" | "find" | "account"` in a
// single state variable, and Back was `goHome()`. That is not navigation, it is a
// radio group: every route was one level deep, so "back" and "home" were the same
// action, and any screen that wanted a sub-screen (a conversation inside the Chats
// list, a customer inside the dialler) had nowhere to put it. The founder's words
// were "no proper back buttons", and this is the reason — there was no stack for a
// back button to pop.
//
// So: a real stack. Push goes deeper, pop goes back exactly one level, home clears
// to the root. Three consequences fall out for free and all three were bugs before:
//
//   · The header can DERIVE its chrome. Depth 0 shows the profile button; depth > 0
//     shows a chevron labelled with where it goes. Nothing has to remember to render
//     its own back button, so nothing can forget to.
//   · Escape and the hardware-ish home button mean different things, correctly.
//   · A route carries its own params, so "the conversation I opened" survives
//     navigating away and coming back to it.
//
// It is a plain reducer over an array, not a router: this is a 396-pixel panel with
// six destinations, and a URL-backed router inside a floating dock would fight the
// console's own routing for the address bar.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useMemo, useState } from "react";

export type Route =
  | { name: "home" }
  | { name: "ask"; threadId?: string | null; prompt?: string }
  | { name: "chats" }
  | { name: "alerts" }
  | { name: "calls" }
  | { name: "find" }
  | { name: "settings" };

export type RouteName = Route["name"];

/** What the status bar calls each destination. Home is the assistant's own name. */
export const ROUTE_TITLES: Record<RouteName, string> = {
  home: "",
  ask: "Ask",
  chats: "Conversations",
  alerts: "Alerts",
  calls: "Calls",
  find: "Customers",
  settings: "Settings",
};

const HOME: Route = { name: "home" };

export function useOsNav() {
  const [stack, setStack] = useState<Route[]>([HOME]);

  const route = stack[stack.length - 1];
  const depth = stack.length - 1;
  const parent = depth > 0 ? stack[stack.length - 2] : null;

  const push = useCallback((next: Route) => {
    setStack((s) => {
      // Re-entering the screen you are already on REPLACES rather than stacks —
      // otherwise tapping Chats twice buries a back button that goes nowhere
      // visible, which is exactly the confusion this file exists to remove.
      if (s[s.length - 1].name === next.name) return [...s.slice(0, -1), next];
      return [...s, next];
    });
  }, []);

  /** Swap the top of the stack without deepening it — used when a screen re-targets itself. */
  const replace = useCallback((next: Route) => {
    setStack((s) => [...s.slice(0, -1), next]);
  }, []);

  const pop = useCallback(() => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);

  const home = useCallback(() => setStack([HOME]), []);

  /** Launch from the home grid: always exactly one level deep, never stacked on a sibling. */
  const launch = useCallback((next: Route) => setStack([HOME, next]), []);

  const backLabel = useMemo(() => {
    if (!parent) return null;
    return parent.name === "home" ? "Home" : ROUTE_TITLES[parent.name];
  }, [parent]);

  return { route, stack, depth, push, replace, pop, home, launch, backLabel, atHome: depth === 0 };
}

export type OsNav = ReturnType<typeof useOsNav>;
