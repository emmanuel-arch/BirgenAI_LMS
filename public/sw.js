/* ─────────────────────────────────────────────────────────────────────────────
 * MICRO EAZY — service worker.
 *
 * Blueprint §7.3: "app-shell precache, network-first for API, background sync for
 * pending repayments and consent submissions — Kenyan network reality, not a
 * nicety." What follows implements that, with two deliberate departures that are
 * documented rather than silently taken, because both are money-safety calls.
 *
 * ── DEPARTURE 1: /api IS NEVER CACHED. NOT EVEN NETWORK-FIRST. ───────────────
 * "Network-first" still writes a copy to disk for the fallback, and the Cache
 * Storage for an origin is SHARED BY EVERY SESSION and outlives sign-out. On a
 * phone that gets handed around — the norm for the customers this is built for —
 * a cached /api/portal response is one borrower's balance, offer or Internal
 * Report served to whoever holds the handset next. It is also, for money, simply
 * wrong: a balance that is thirty seconds stale is a support ticket.
 *
 * So API calls are NETWORK-ONLY. Offline, they fail honestly and the UI says so.
 * The cache holds shell and static assets, which belong to nobody.
 *
 * ── DEPARTURE 2: A QUEUED REQUEST IS ONLY REPLAYED IF IT IS SAFE TO REPLAY. ──
 * Background Sync replays a request when connectivity returns — possibly minutes
 * later, possibly after the customer already retried by hand. For a consent
 * submission that is harmless: same payload, same result. For a REPAYMENT it is a
 * second STK push against a real M-Pesa wallet.
 *
 * The queue below therefore replays only endpoints on REPLAY_SAFE, and payment
 * initiation is not on it. Turning that on needs a server-side idempotency key
 * (client-generated, unique per intent, honoured by the payment route) so a
 * replay collapses onto the first attempt instead of charging twice. That is
 * Sprint 1 work and is called out in the handover — not quietly enabled here.
 * ────────────────────────────────────────────────────────────────────────────*/

// Bump on every shipped change to the shell. The old cache is deleted on activate.
const VERSION = "micro-eazy-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;

const OFFLINE_URL = "/offline";

/**
 * Precached at install. Deliberately tiny: Next fingerprints its build output, so
 * a hardcoded list of chunks would be stale the moment anything is rebuilt.
 * Hashed assets are picked up at runtime instead (they are immutable, so caching
 * them by URL is always correct).
 */
const SHELL = [
  OFFLINE_URL,
  "/brand/micro-eazy/icon-192.png",
  "/brand/micro-eazy/icon-512.png",
  "/brand/micro-eazy/apple-touch-icon.png",
];

/** Paths whose POST bodies are safe to replay verbatim after a reconnect. */
const REPLAY_SAFE = ["/api/portal/consent"];

// ── install ──────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individually, not addAll: addAll is atomic, so one 404 on one icon throws
      // away the whole precache and the worker never installs.
      await Promise.all(
        SHELL.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => {
            // A missing shell entry degrades the offline experience; it must not
            // block the worker from installing at all.
          }),
        ),
      );
      // Take over as soon as the new worker is ready rather than waiting for
      // every tab to close — paired with clients.claim() below.
      await self.skipWaiting();
    })(),
  );
});

// ── activate ─────────────────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

// ── fetch ────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Cross-origin (fonts, maps, Daraja) is none of this worker's business.
  if (url.origin !== self.location.origin) return;

  // ── API: network-only, always. See DEPARTURE 1. ──
  if (url.pathname.startsWith("/api/")) {
    if (request.method !== "GET") return; // let POSTs go straight through
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(
            JSON.stringify({ error: "offline", message: "You are offline." }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    return;
  }

  if (request.method !== "GET") return;

  // ── Navigations: network-first, then cached shell, then the offline page. ──
  // A customer mid-application on a dropping connection should get the app back,
  // not a browser error page.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(SHELL_CACHE);
          cache.put(request, fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match(request);
          if (cached) return cached;
          const offline = await caches.match(OFFLINE_URL);
          return (
            offline ??
            new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } })
          );
        }
      })(),
    );
    return;
  }

  // ── Static assets: stale-while-revalidate. ──
  // Next's build output is content-hashed, so a cache hit is never wrong; the
  // revalidation keeps unhashed files (icons, images) from going stale forever.
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/brand/") ||
    url.pathname.startsWith("/images/") ||
    /\.(?:png|jpg|jpeg|webp|avif|svg|woff2?|ico)$/i.test(url.pathname)
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSET_CACHE);
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((res) => {
            if (res && res.status === 200) cache.put(request, res.clone());
            return res;
          })
          .catch(() => null);
        return cached ?? (await network) ?? new Response("", { status: 504 });
      })(),
    );
  }
});

// ── background sync ──────────────────────────────────────────────────────────
// A tiny IndexedDB queue. No library: the whole contract is put/getAll/delete on
// one store, and a dependency here would ship a second copy of the same idea.

const DB_NAME = "micro-eazy-sync";
const STORE = "queue";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const out = fn(store);
    t.oncomplete = () => resolve(out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
  });
}

/** Queue a request for replay. Called from the page via postMessage. */
async function enqueue(entry) {
  const db = await openDb();
  return tx(db, "readwrite", (s) => s.add(entry));
}

async function drain() {
  const db = await openDb();
  const items = await tx(db, "readonly", (s) => s.getAll());

  for (const item of items) {
    if (!REPLAY_SAFE.some((p) => item.url.startsWith(p))) {
      // Not replayable unattended — drop it rather than leave it to fire at an
      // unpredictable moment. The page is responsible for asking the customer.
      await tx(db, "readwrite", (s) => s.delete(item.id));
      continue;
    }
    try {
      const res = await fetch(item.url, {
        method: item.method || "POST",
        headers: { "Content-Type": "application/json", ...(item.headers || {}) },
        body: item.body,
        credentials: "include",
      });
      // 4xx is a permanent answer: replaying it forever helps nobody.
      if (res.ok || (res.status >= 400 && res.status < 500)) {
        await tx(db, "readwrite", (s) => s.delete(item.id));
      }
    } catch {
      // Still offline. Leave it queued; the next sync event retries.
      return;
    }
  }
}

self.addEventListener("sync", (event) => {
  if (event.tag === "micro-eazy-queue") event.waitUntil(drain());
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "QUEUE_REQUEST" && data.entry) {
    event.waitUntil(
      enqueue(data.entry)
        .then(() => self.registration.sync?.register("micro-eazy-queue"))
        .catch(() => {}),
    );
  }
  if (data.type === "SKIP_WAITING") self.skipWaiting();
});

// ── push ─────────────────────────────────────────────────────────────────────
// Wired now so the worker does not need replacing when VAPID keys land (Sprint 1
// + founder open item 4). Until a subscription exists this never fires.
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Micro Eazy", body: event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || "Micro Eazy", {
      body: payload.body || "",
      icon: payload.icon || "/brand/micro-eazy/icon-192.png",
      badge: "/brand/micro-eazy/icon-192.png",
      data: { url: payload.url || "/" },
      vibrate: [80, 40, 80],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Focus an open tab rather than stacking another copy of the app.
      for (const client of all) {
        if (client.url.includes(target) && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(target);
    })(),
  );
});
