// ─────────────────────────────────────────────────────────────────────────────
// THE WEB APP MANIFEST — and why there is exactly one file for two products.
//
// Blueprint D1: ONE customer PWA, at microeazy.birgenai.com, owned by BirgenAI.
// One manifest, one icon, one install base — lender #2 costs zero re-installs.
//
// But this Next application also serves lms.birgenai.com (the staff console) and
// every lender's white-label portal, from the SAME app directory. A manifest is
// app-root-scoped, so a fixed one would offer an officer "Install Micro Eazy" on
// the console — the customer brand on a staff tool, in front of a lender.
//
// So the manifest reads the Host header and answers per host. That is a Next 16
// Request-time API, which opts this route out of static caching — deliberately,
// and it is the entire reason the route is a .ts and not a .json.
//
//   node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/
//     01-metadata/manifest.md          — "cached by default UNLESS it uses a
//                                        Request-time API"
//   node_modules/next/dist/docs/01-app/03-api-reference/04-functions/headers.md
//                                      — headers() is ASYNC in this version
//
// WHAT MAKES IT INSTALLABLE, so the list is not re-derived from memory later:
// name, short_name, start_url, display:standalone, and an icon of at least 192px.
// Chrome additionally wants a maskable icon before it will stop warning. All five
// are here; the missing sixth is HTTPS, which localhost is exempt from and
// production gets from Vercel.
// ─────────────────────────────────────────────────────────────────────────────
import { headers } from "next/headers";
import type { MetadataRoute } from "next";
import { MICRO_EAZY } from "@/lib/microeazy/brand";

/** Leading label of the host, port stripped — matches proxy.ts's `subdomain()`. */
function subdomain(host: string): string {
  return host.split(":")[0].trim().toLowerCase().split(".")[0];
}

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const host = (await headers()).get("host") ?? "";
  const label = subdomain(host);

  // "microeazy.birgenai.com" in production; "microeazy.localhost:3000" in dev.
  // The /microeazy path is how it is reachable before the host routing of task
  // 0.6 exists, so a plain localhost:3000 can still be install-tested.
  const isMicroEazy = label === "microeazy";

  if (!isMicroEazy) {
    // The console and the lender portals. Installable-but-plain: a lender who
    // pins the console gets THEIR tool, not the consumer brand.
    return {
      name: "BirgenAI LMS",
      short_name: "BirgenAI",
      description:
        "Loan origination and management for licensed lenders.",
      start_url: "/console",
      display: "standalone",
      background_color: "#fafafa",
      theme_color: "#0c0c10",
      orientation: "any",
      icons: [{ src: "/images/logo.png", sizes: "512x512", type: "image/png" }],
    };
  }

  const c = MICRO_EAZY.colors;

  return {
    // `id` pins the app's identity across start_url changes. Without it, editing
    // start_url later makes browsers treat this as a DIFFERENT app and the
    // installed base silently orphans — the one manifest field whose absence
    // only hurts you months after launch.
    id: "/?src=pwa",
    name: `${MICRO_EAZY.name} — ${MICRO_EAZY.tagline}`,
    short_name: MICRO_EAZY.shortName,
    description: MICRO_EAZY.description,

    // ?src=pwa is what lets analytics separate installed sessions from browser
    // ones, which is how "did the install actually change behaviour?" is answered.
    start_url: "/?src=pwa",
    scope: "/",
    display: "standalone",
    // If a browser cannot honour standalone it should fall back to something
    // still app-like rather than straight to a full browser tab.
    display_override: ["standalone", "minimal-ui"],

    // Paper, not navy: it matches the icon tile's own ground, so the splash and
    // the first paint are the same colour and the launch does not flash.
    background_color: c.paper,
    // The status bar in standalone. Navy frames the app the way the mark does.
    theme_color: c.navy,

    orientation: "portrait",
    lang: "en-KE",
    dir: "ltr",
    categories: ["finance"],

    icons: [
      { src: MICRO_EAZY.icons.any192, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: MICRO_EAZY.icons.any512, sizes: "512x512", type: "image/png", purpose: "any" },
      // Separate file, not the same one re-declared: a maskable icon is drawn at
      // a smaller mark-to-tile ratio so a circular launcher mask cannot clip the
      // arrow off. scripts/make-pwa-icons.ts emits both.
      { src: MICRO_EAZY.icons.maskable512, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],

    // Long-press the home-screen icon. Three verbs, in the order a customer with
    // a live loan actually wants them.
    shortcuts: [
      {
        name: "Pay now",
        short_name: "Pay",
        description: "Repay your loan by M-Pesa STK push",
        url: "/myloan?src=shortcut",
        icons: [{ src: MICRO_EAZY.icons.any192, sizes: "192x192", type: "image/png" }],
      },
      {
        name: "My loan",
        short_name: "My loan",
        description: "Balance, schedule and receipts",
        url: "/myloan?src=shortcut",
        icons: [{ src: MICRO_EAZY.icons.any192, sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Apply",
        short_name: "Apply",
        description: "Start a new application",
        url: "/?src=shortcut",
        icons: [{ src: MICRO_EAZY.icons.any192, sizes: "192x192", type: "image/png" }],
      },
    ],

    // Re-launching should return the customer to the session already open rather
    // than stacking a second one on top of a half-finished application.
    launch_handler: { client_mode: "navigate-existing" },
    prefer_related_applications: false,
  };
}
