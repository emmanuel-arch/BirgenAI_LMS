"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Registers /sw.js, and nothing else.
//
// SCOPED ON PURPOSE. This is mounted by the Micro Eazy layout, not the root one.
// A service worker registered at "/" controls EVERY route on the origin — the
// staff console and every lender portal included — so mounting it globally would
// put the customer app's cache in front of an officer's console. The console has
// no offline story and wants none.
//
// `updateViaCache: "none"` stops the browser from serving sw.js itself out of the
// HTTP cache, which is how a fixed worker sits unnoticed behind a stale copy for
// up to 24 hours.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect } from "react";

export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Dev builds recompile constantly; a worker caching that output produces
    // confusing stale-asset bugs that look like code bugs.
    if (process.env.NODE_ENV !== "production") return;

    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch(() => {
          // An unavailable worker costs offline support, not the app. Never
          // surface this to a customer mid-application.
        });
    };

    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);

  return null;
}
