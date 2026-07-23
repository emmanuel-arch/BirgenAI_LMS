"use client";

// The borrower portal's front door on a lender subdomain (mular.birgenai.com).
//
// A cinematic, brand-driven welcome — the energy of the Movies /welcome page,
// re-skinned to whichever lender owns the subdomain. Everything is derived from
// the brand tokens (accent, accent2, logo, tagline), so Mular gets green→navy,
// Micromart gets brown, Buy Simu red — one component, every lender's identity.
//
// The lender's logo rides on a white chip (many lender marks are dark wordmarks
// that would vanish on a dark gradient), while the headline and form sit on the
// immersive gradient in white. Mobile-first: this is an Android-first funnel.
import { type CSSProperties } from "react";
import { motion } from "framer-motion";
import { Phone, ArrowRight, Loader2, Lock, ShieldCheck, AlertTriangle } from "lucide-react";
import type { LenderBrand } from "@/lib/lms/branding";
import type { PortalDict } from "@/lib/i18n/portal";
import { fmt } from "@/lib/i18n/portal";
import { LangToggle } from "@/components/portal/LangToggle";

// One shared customer photo sits behind EVERY lender's portal — the constant
// across the white-label estate. Only the brand gradient tint over it changes
// per lender. Drop the final asset here; until then the gradient stands alone.
const SHARED_PORTAL_BG = "/images/portal-bg.jpg";

/** Darken a #rrggbb by a factor (0–1) for the gradient's deep base. */
function darken(hex: string, f = 0.45): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return "#05070d";
  const n = parseInt(m[1], 16);
  const c = (v: number) => Math.max(0, Math.round(v * (1 - f))).toString(16).padStart(2, "0");
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

export default function PortalHero({
  brand, t, phone, setPhone, onContinue, loading, error,
}: {
  brand: LenderBrand;
  t: PortalDict;
  phone: string;
  setPhone: (v: string) => void;
  onContinue: () => void;
  loading: boolean;
  error?: string | null;
}) {
  const accent = brand.accent;
  const accent2 = brand.accent2 || brand.accent;
  const deep = darken(accent, 0.62);

  // Solid gradient is the FALLBACK base (shows if the shared photo is absent);
  // when the photo loads, the same gradient is re-applied as a translucent tint
  // on top of it, so every lender's portal wears its own colour over one photo.
  const gradient = `linear-gradient(158deg, ${accent2} 0%, ${accent} 46%, ${deep} 104%)`;
  const bgStyle: CSSProperties = { background: gradient };

  return (
    <div className="relative min-h-screen min-h-[100dvh] overflow-hidden text-white" style={bgStyle}>
      {/* Shared customer photo — the constant behind every lender's portal */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={SHARED_PORTAL_BG} alt="" aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
      {/* Brand tint over the photo — this is what makes it Mular's (or anyone's) */}
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.86]" style={{ background: gradient }} />
      {/* Depth: two soft glows + a bottom vignette so white text always holds */}
      <div aria-hidden className="pointer-events-none absolute -top-24 -left-16 h-96 w-96 rounded-full opacity-40 blur-3xl"
        style={{ background: `radial-gradient(closest-side, ${accent2}, transparent)` }} />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 -right-10 h-[28rem] w-[28rem] rounded-full opacity-30 blur-3xl"
        style={{ background: "radial-gradient(closest-side, rgba(255,255,255,0.35), transparent)" }} />
      <div aria-hidden className="pointer-events-none absolute inset-0"
        style={{ background: `linear-gradient(to bottom, transparent 40%, ${deep} 100%)` }} />

      {/* Header — logo on a white chip (legible for dark wordmarks) + language */}
      <header className="relative z-20 flex items-center justify-between px-4 py-4 sm:px-8 sm:py-5">
        <div className="inline-flex items-center rounded-xl bg-white/95 px-3 py-1.5 shadow-sm ring-1 ring-black/5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brand.logo} alt={brand.name} className="h-7 w-auto max-w-[150px] object-contain sm:h-8"
            onError={(e) => ((e.target as HTMLImageElement).src = brand.fallbackLogo)} />
        </div>
        <div className="[&_*]:text-white/90"><LangToggle /></div>
      </header>

      {/* Hero */}
      <main className="relative z-20 mx-auto flex min-h-[calc(100dvh-9rem)] w-full max-w-2xl flex-col items-center justify-center px-4 pb-16 pt-2 text-center sm:px-6">
        <motion.p
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
          className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/70 sm:text-xs">
          {brand.blurb}
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.05 }}
          className="mt-3 text-3xl font-bold leading-[1.08] tracking-tight sm:text-5xl md:text-6xl">
          {brand.tagline}
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.12 }}
          className="mt-3 max-w-md text-sm text-white/80 sm:text-base">
          {t.landing.titleScoped} — {fmt(t.landing.subScoped, { name: brand.name })}
        </motion.p>

        {/* Phone entry — the single action */}
        <motion.form
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.2 }}
          onSubmit={(e) => { e.preventDefault(); if (!loading) onContinue(); }}
          className="mt-7 flex w-full max-w-md flex-col gap-2.5 sm:flex-row">
          <div className="flex flex-1 items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-3.5 backdrop-blur-md focus-within:border-white/60">
            <Phone className="h-4 w-4 shrink-0 text-white/60" />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              autoComplete="tel"
              placeholder={t.landing.phonePlaceholderScoped}
              className="h-14 w-full min-w-0 bg-transparent py-3.5 text-base text-white outline-none placeholder:text-white/50"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-14 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-white px-6 py-3.5 text-base font-semibold shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.99] disabled:opacity-70"
            style={{ color: accent }}>
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
            {t.common.continue}
            <ArrowRight className="h-5 w-5" />
          </button>
        </motion.form>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-white/30 bg-black/25 px-3 py-2.5 text-sm text-white backdrop-blur-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        <motion.p
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.32 }}
          className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-white/60">
          <Lock className="h-3 w-3" /> {t.landing.smsNote}
        </motion.p>
      </main>

      {/* Footer */}
      <div className="relative z-20 flex items-center justify-center gap-1.5 pb-5 text-[11px] text-white/45">
        <ShieldCheck className="h-3 w-3" /> Powered by <span className="font-semibold text-white/60">LMS Platform</span>
      </div>
    </div>
  );
}
