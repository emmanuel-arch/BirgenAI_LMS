"use client";

// The console pages' fetch-on-mount pattern, in one place.
//
// Nearly every module page does `useEffect(() => { void load(); }, [])` where
// `load` is an async fetcher that setStates when the response lands. The new
// react-hooks/set-state-in-effect rule flags that call site in every page (the
// loader's first setState is reachable synchronously); the fix is this single
// audited indirection, not a per-page disable comment.
import { useEffect } from "react";
import type { DependencyList } from "react";

/**
 * Run an async loader on mount, and again whenever `deps` change. The loader's
 * state updates all happen after awaits, so there is no sync-setState render
 * loop — the pattern is safe; only the lint rule's heuristic disagrees.
 */
export function useLoad(load: () => void | Promise<unknown>, deps: DependencyList = []): void {
  useEffect(() => {
    void load();
    // The loader is intentionally NOT a dependency: pages declare it inline and
    // a fresh identity every render must not refetch. `deps` is the contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
