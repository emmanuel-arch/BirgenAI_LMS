// ─────────────────────────────────────────────────────────────────────────────
// The Micro Eazy route group.
//
// Until the host routing of task 0.6 lands, this path IS the consumer app's
// address: microeazy.birgenai.com will be a proxy rewrite onto it, exactly as
// analytics.birgenai.com already rewrites onto /console/intelligence/analytics
// (see src/proxy.ts). Building it as a real route first means the demo can be
// rehearsed on localhost:3000/microeazy before DNS exists.
//
// The service worker is registered HERE rather than in the root layout — see
// ServiceWorkerRegistrar for why putting a customer cache in front of the staff
// console would be a mistake.
// ─────────────────────────────────────────────────────────────────────────────
import type { Metadata, Viewport } from "next";
import ServiceWorkerRegistrar from "@/components/pwa/ServiceWorkerRegistrar";
import { MICRO_EAZY } from "@/lib/microeazy/brand";

export const metadata: Metadata = {
  title: `${MICRO_EAZY.name} — ${MICRO_EAZY.tagline}`,
  description: MICRO_EAZY.description,
  // iOS reads none of the manifest for the home-screen icon; it reads this.
  // Without it, Safari screenshots the page and uses that as the icon.
  appleWebApp: {
    capable: true,
    title: MICRO_EAZY.shortName,
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: MICRO_EAZY.icons.any192,
    apple: MICRO_EAZY.icons.appleTouch,
  },
};

export const viewport: Viewport = {
  // The navy is what Android paints the status bar, and iOS the notch area.
  themeColor: MICRO_EAZY.colors.navy,
  width: "device-width",
  initialScale: 1,
  // NOT maximumScale/userScalable — pinch-zoom is an accessibility requirement,
  // and locking it is the most common a11y defect in "app-like" web builds.
  viewportFit: "cover",
};

export default function MicroEazyLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ServiceWorkerRegistrar />
      {children}
    </>
  );
}
