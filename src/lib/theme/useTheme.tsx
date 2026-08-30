"use client";

// ─────────────────────────────────────────────────────────────────────────────
// APPEARANCE — three states, one attribute, four systems.
//
// The applied value is stamped on <html data-theme>, because every token in
// src/app/theme-dark.css keys off that selector and custom properties cascade
// from the root. Nothing else in the suite needs to know which theme is on.
//
// Stored value is "light" | "dark" | "system" and only an explicit press is
// written. Somebody who has never touched the control has not chosen light —
// they have chosen whatever their machine is doing, and at 7pm that changes
// underneath them. Collapsing that to a boolean is the usual bug.
//
// ── WHY useSyncExternalStore AND NOT useState + useEffect ────────────────────
// The two things this reads — localStorage and a media query — are EXTERNAL
// STORES. Mirroring them into state and syncing in an effect gives you a render
// with the wrong answer followed by a second render with the right one, which is
// the flash this module exists to prevent, and React's own lint rejects it.
// Subscribing instead means the first render already has the true value, and a
// second tab changing the preference updates this one for free (the `storage`
// event), which a mirrored copy would never notice.
//
// ── THE FLASH ────────────────────────────────────────────────────────────────
// First paint still has to be correct before any React runs at all, so
// layout.tsx carries a small inline script that stamps the attribute. The two
// share THEME_STORAGE_KEY and must move together.
// ─────────────────────────────────────────────────────────────────────────────
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export type ThemeChoice = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

/** Duplicated as a literal inside layout.tsx's inline script. Change both. */
export const THEME_STORAGE_KEY = "suite:appearance";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * THE STAFF REALM — the only place appearance applies.
 *
 * The root layout wraps everything, borrower surfaces included, and those share
 * this origin: microeazy.servicesuitecloud.com serves `/` (the borrower app) and
 * `/console` (staff) from one deployment. Honouring `prefers-color-scheme`
 * globally would silently flip the PUBLIC borrower portal to dark on every
 * dark-mode phone in Kenya — a surface that was designed light-only, carries
 * brand gradients and photographs chosen against white, and has not been
 * reviewed in dark.
 *
 * So the theme is scoped by route. Borrower surfaces are pinned light until
 * their own dark pass is done and looked at.
 *
 * DUPLICATED as a literal regex inside layout.tsx's inline script, which runs
 * before any module. Change one, change both.
 */
const STAFF_ROUTE = /^\/(console|analytics|desk|books|people|suite|platform)(\/|$)/;

function isStaffRoute(): boolean {
  try {
    return STAFF_ROUTE.test(window.location.pathname);
  } catch {
    return false;
  }
}

// Same-tab writes do not fire `storage` — that event is for OTHER tabs. This is
// the local half of the subscription.
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener("change", onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    mq.removeEventListener("change", onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Where the choice lives when storage refuses. A browser set to block site data
 *  throws on ACCESS, not only on write — and without this the control would move
 *  and then snap back, which reads as a broken toggle rather than as a blocked
 *  one. It lasts the session, which is the most that setting allows. */
let memoryChoice: ThemeChoice | null = null;

/** Snapshots must be primitives, or React re-renders forever comparing objects. */
function choiceSnapshot(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* fall through to memory */
  }
  return memoryChoice ?? "system";
}

function systemDarkSnapshot(): boolean {
  try {
    return window.matchMedia(DARK_QUERY).matches;
  } catch {
    return false;
  }
}

/** The server has no storage and no device. "system" resolving to light is the
 *  only answer that is never wrong, and the inline script corrects it before
 *  anything is painted. */
const serverChoice = (): ThemeChoice => "system";
const serverDark = () => false;

interface ThemeCtx {
  choice: ThemeChoice;
  resolved: ResolvedTheme;
  setChoice: (c: ThemeChoice) => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const choice = useSyncExternalStore(subscribe, choiceSnapshot, serverChoice);
  const systemDark = useSyncExternalStore(subscribe, systemDarkSnapshot, serverDark);
  const staff = useSyncExternalStore(subscribe, isStaffRoute, serverDark);

  const resolved: ResolvedTheme = !staff
    ? "light"
    : choice === "system"
      ? systemDark
        ? "dark"
        : "light"
      : choice;

  // Updating the DOM from the latest state is exactly what an effect is for.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolved);
  }, [resolved]);

  const setChoice = useCallback((c: ThemeChoice) => {
    memoryChoice = c;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, c);
    } catch {
      /* preference is a convenience, never a requirement */
    }
    emit();
  }, []);

  const value = useMemo(() => ({ choice, resolved, setChoice }), [choice, resolved, setChoice]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const c = useContext(Ctx);
  // A no-op fallback rather than a throw: this hook is called from shared chrome
  // that also renders on borrower surfaces, which are light-only by design and
  // deliberately mount no provider.
  return c ?? { choice: "light", resolved: "light", setChoice: () => {} };
}
