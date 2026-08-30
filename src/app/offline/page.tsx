// ─────────────────────────────────────────────────────────────────────────────
// The offline fallback, precached by the service worker at install.
//
// This exists so a dropped connection produces the PRODUCT saying something
// useful, rather than the browser's error page — which on Android is a dinosaur
// and reads, to a customer halfway through a loan application, as "the app broke
// and my application is gone".
//
// It must render with zero network: no data fetch, no remote font, no API call.
// The only asset is the icon, which the worker precached alongside this page.
// ─────────────────────────────────────────────────────────────────────────────
import Image from "next/image";
import { MICRO_EAZY, HERO_GRADIENT } from "@/lib/microeazy/brand";

export const metadata = { title: "You're offline — Micro Eazy" };

export default function OfflinePage() {
  const C = MICRO_EAZY.colors;
  return (
    <main
      className="flex min-h-dvh flex-col items-center justify-center px-8 text-center"
      style={{ background: HERO_GRADIENT }}
    >
      <Image
        src={MICRO_EAZY.icons.any512}
        alt=""
        width={72}
        height={72}
        className="h-[72px] w-[72px] rounded-[18px] bg-paper"
        style={{ boxShadow: "0 18px 40px -14px rgba(0,0,0,0.6)" }}
      />

      <h1 className="mt-7 text-[1.5rem] font-bold tracking-[-0.02em] text-white">
        You&apos;re offline
      </h1>
      <p className="mt-3 max-w-[20rem] text-[0.875rem] leading-relaxed text-white/70">
        Micro Eazy needs a connection for anything involving money — your balance and
        your repayments are always read live, never from this phone&apos;s memory.
      </p>
      <p className="mt-3 max-w-[20rem] text-[0.8125rem] leading-relaxed text-white/50">
        Nothing you had entered has been lost. Reconnect and carry on where you left off.
      </p>

      {/* A PLAIN ANCHOR, and the lint rule is suppressed rather than obeyed.
          <Link> needs the React runtime to have loaded and hydrated — which is
          precisely what cannot be assumed on the screen whose entire job is to
          appear when the network failed. A bare <a> is still a working button
          with zero JavaScript, and a full document request is what actually
          retries the connection. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/"
        className="mt-8 flex min-h-[52px] w-full max-w-[20rem] items-center justify-center rounded-2xl px-6 text-[1rem] font-bold"
        style={{
          background: `linear-gradient(135deg, ${C.lime} 0%, ${C.green} 100%)`,
          color: C.navy,
        }}
      >
        Try again
      </a>
    </main>
  );
}
