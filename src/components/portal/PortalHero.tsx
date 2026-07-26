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
import { useState, type CSSProperties } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Phone, ArrowRight, Loader2, Lock, ShieldCheck, AlertTriangle, IdCard, KeyRound, ChevronLeft } from "lucide-react";
import type { LenderBrand } from "@/lib/lms/branding";
import type { PortalDict } from "@/lib/i18n/portal";
import { fmt } from "@/lib/i18n/portal";
import { LangToggle } from "@/components/portal/LangToggle";

// One shared customer photo sits behind EVERY lender's portal — the constant
// across the white-label estate. Only the brand tint over it changes per lender.
//
// WebP first, JPEG fallback, via <picture>: the plate is a photograph on the
// FIRST paint of a funnel used on Kenyan mobile data, where 53kB versus 119kB
// versus the 1.8MB PNG it was generated as is the difference between a portal
// that appears and one that is still grey when the customer gives up.
// scripts/optimize-portal-bg.ts produces both from the source art.
const PORTAL_BG_WEBP = "/images/portal-bg.webp";
const PORTAL_BG_JPG = "/images/portal-bg.jpg";

/** Darken a #rrggbb by a factor (0–1) for the gradient's deep base. */
function darken(hex: string, f = 0.45): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return "#05070d";
  const n = parseInt(m[1], 16);
  const c = (v: number) => Math.max(0, Math.round(v * (1 - f))).toString(16).padStart(2, "0");
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

export default function PortalHero({
  brand, t, phone, setPhone, onContinue, loading, error, onPinSignedIn,
}: {
  brand: LenderBrand;
  t: PortalDict;
  phone: string;
  setPhone: (v: string) => void;
  onContinue: () => void;
  loading: boolean;
  error?: string | null;
  /** Fired once the ID + PIN door has minted a session — the funnel takes over. */
  onPinSignedIn?: () => void;
}) {
  // WHICH DOOR. Two kinds of person arrive here and they can prove different
  // things, so they get different front doors — see PortalSignIn below.
  const [door, setDoor] = useState<"new" | "returning">("new");
  const accent = brand.accent;
  const accent2 = brand.accent2 || brand.accent;
  const deep = darken(accent, 0.62);

  // Solid gradient is the FALLBACK base (shows if the shared photo is absent);
  // over the photo it returns as a much lighter tint — see the stack below.
  const gradient = `linear-gradient(158deg, ${accent2} 0%, ${accent} 46%, ${deep} 104%)`;
  const bgStyle: CSSProperties = { background: gradient };

  return (
    <div className="relative min-h-screen min-h-[100dvh] overflow-hidden text-white" style={bgStyle}>
      {/* ── THE BACKGROUND STACK ──────────────────────────────────────────────
          The tint used to sit at opacity .86, which is not a tint — it is paint.
          A customer photograph under it was a rumour: you could tell something
          was there and nothing more, and we were paying full download for it.
          So the stack is now built the way a photographer would light this shot,
          in four layers, each with one job:

            1. PHOTO      full-bleed, anchored 30% from the top so the subject's
                          face survives the crop on a wide desktop viewport (the
                          plate is 2:3 portrait; centre-cropping a laptop would
                          otherwise land on her apron).
            2. BRAND TINT the lender's colour at .42 — enough that Mular's portal
                          is unmistakably green-navy and Micromart's is brown,
                          nowhere near enough to erase the person.
            3. SCRIM      dark at the very top (the logo chip and language toggle
                          sit there), light through the middle (her face), heavy
                          at the bottom (headline, form, footer). This is what
                          makes white text legible without flattening the image.
            4. GLOW       one soft brand bloom for depth.

          The order matters: tint before scrim, so the scrim darkens the tinted
          image rather than being tinted itself. */}
      <picture>
        <source srcSet={PORTAL_BG_WEBP} type="image/webp" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={PORTAL_BG_JPG} alt="" aria-hidden fetchPriority="high"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover object-[50%_30%]"
          onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
      </picture>
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.42]" style={{ background: gradient }} />
      <div aria-hidden className="pointer-events-none absolute inset-0"
        style={{
          background:
            `linear-gradient(to bottom, ${deep}e6 0%, ${deep}59 18%, transparent 38%, ${deep}73 66%, ${deep}f2 100%)`,
        }} />
      <div aria-hidden className="pointer-events-none absolute -top-24 -left-16 h-96 w-96 rounded-full opacity-30 blur-3xl"
        style={{ background: `radial-gradient(closest-side, ${accent2}, transparent)` }} />

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

        {/* ── THE TWO DOORS ──────────────────────────────────────────────────
            A stranger and a customer can prove different things, so they are not
            asked the same question. A first-timer has no relationship with this
            lender: the only thing they can demonstrate is that they hold a number
            we can reach, so they get phone + SMS code. Someone already in the book
            has a national ID on file and a PIN — they get straight in, with no SMS
            to wait for, no cost to the lender, and no habit of trusting codes that
            arrive unasked. */}
        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.2 }}
          className="mt-7 w-full max-w-md"
        >
          <div className="flex rounded-xl border border-white/20 bg-white/10 p-1 backdrop-blur-md">
            {([["new", t.landing.doorNew], ["returning", t.landing.doorReturning]] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setDoor(k)}
                className={`flex-1 rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors ${
                  door === k ? "bg-white shadow-sm" : "text-white/75 hover:text-white"
                }`}
                style={door === k ? { color: accent } : undefined}
              >
                {label}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            {door === "new" ? (
              <motion.form
                key="door-new"
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
                onSubmit={(e) => { e.preventDefault(); if (!loading) onContinue(); }}
                className="mt-3 flex w-full flex-col gap-2.5 sm:flex-row"
              >
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
            ) : (
              <motion.div
                key="door-returning"
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
                className="mt-3"
              >
                <PortalSignIn
                  brand={brand}
                  t={t}
                  accent={accent}
                  onSignedIn={() => onPinSignedIn?.()}
                  onUsePhone={() => setDoor("new")}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-white/30 bg-black/25 px-3 py-2.5 text-sm text-white backdrop-blur-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        <motion.p
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.32 }}
          className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-white/60">
          <Lock className="h-3 w-3" /> {door === "new" ? t.landing.smsNote : t.landing.pinNote}
        </motion.p>
      </main>

      {/* Footer */}
      <div className="relative z-20 flex items-center justify-center gap-1.5 pb-5 text-[11px] text-white/45">
        <ShieldCheck className="h-3 w-3" /> Powered by <span className="font-semibold text-white/60">BirgenAI</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// THE RETURNING CUSTOMER'S DOOR — national ID, then PIN.
//
// Two steps, and the split is deliberate rather than cosmetic. Asking for an ID
// and a PIN on one screen means every wrong submission is ambiguous: the customer
// cannot tell whether they mistyped the ID they have had since they were 18, or
// the PIN they were given last week. Splitting it means step one either finds
// their account or does not, and step two is only ever about the PIN.
//
// WHAT THIS SCREEN IS NOT ALLOWED TO SAY. Step one shows a MASKED phone and
// nothing else — never the name on the account. "Welcome back, Emmanuel" in
// response to a typed ID number hands a stranger the account holder's name for
// the price of nine digits. The masked number is enough for the real customer to
// recognise themselves and useless to anyone else. The server enforces the same
// rule (src/app/api/portal/pin/route.ts); this is the second lock on it.
//
// The escape hatch is always visible: a customer with no PIN, a locked account,
// or an ID we cannot place is offered the phone door instead of being stranded.
// ─────────────────────────────────────────────────────────────────────────────
function PortalSignIn({
  brand, t, accent, onSignedIn, onUsePhone,
}: {
  brand: LenderBrand;
  t: PortalDict;
  accent: string;
  onSignedIn: () => void;
  onUsePhone: () => void;
}) {
  const [step, setStep] = useState<"id" | "pin">("id");
  const [nationalId, setNationalId] = useState("");
  const [pin, setPin] = useState("");
  const [phoneMasked, setPhoneMasked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [tone, setTone] = useState<"info" | "error">("info");

  const say = (m: string, kind: "info" | "error" = "error") => { setMsg(m); setTone(kind); };

  const findAccount = async () => {
    setMsg(null);
    if (nationalId.trim().length < 5) { say(t.landing.pinEnterId); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/portal/pin", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lenderSlug: brand.slug, nationalId: nationalId.trim() }),
      });
      const d = await res.json();
      if (!d.success) { say(d.message || t.errors.checkFailed); return; }
      if (!d.known || !d.hasPin) {
        // Not stranded: the phone door is right there, and it is the same funnel.
        say(d.message, "info");
        return;
      }
      setPhoneMasked(d.phoneMasked ?? null);
      if (d.locked) { say(d.message); return; }
      setStep("pin");
    } catch { say(t.errors.couldNotRunCheck); } finally { setBusy(false); }
  };

  const unlock = async () => {
    setMsg(null);
    if (pin.trim().length !== 6) { say(t.landing.pinSixDigits); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/portal/pin", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lenderSlug: brand.slug, nationalId: nationalId.trim(), pin: pin.trim() }),
      });
      const d = await res.json();
      if (!d.success) { say(d.message || t.errors.checkFailed); setPin(""); return; }
      onSignedIn();
    } catch { say(t.errors.couldNotRunCheck); } finally { setBusy(false); }
  };

  const field = "flex flex-1 items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-3.5 backdrop-blur-md focus-within:border-white/60";
  const inputCls = "h-14 w-full min-w-0 bg-transparent py-3.5 text-base text-white outline-none placeholder:text-white/50";
  const go = "inline-flex h-14 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-white px-6 py-3.5 text-base font-semibold shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.99] disabled:opacity-70";

  return (
    <div>
      {step === "id" ? (
        <form onSubmit={(e) => { e.preventDefault(); if (!busy) findAccount(); }} className="flex w-full flex-col gap-2.5 sm:flex-row">
          <div className={field}>
            <IdCard className="h-4 w-4 shrink-0 text-white/60" />
            <input
              value={nationalId}
              onChange={(e) => setNationalId(e.target.value)}
              inputMode="numeric"
              autoComplete="off"
              placeholder={t.landing.pinIdPlaceholder}
              className={inputCls}
            />
          </div>
          <button type="submit" disabled={busy} className={go} style={{ color: accent }}>
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
            {t.common.continue}
            <ArrowRight className="h-5 w-5" />
          </button>
        </form>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); if (!busy) unlock(); }} className="flex w-full flex-col gap-2.5">
          {phoneMasked && (
            <p className="text-left text-[12px] text-white/70">
              {fmt(t.landing.pinFoundAccount, { phone: phoneMasked })}
            </p>
          )}
          <div className="flex w-full flex-col gap-2.5 sm:flex-row">
            <div className={field}>
              <KeyRound className="h-4 w-4 shrink-0 text-white/60" />
              <input
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                type="password"
                autoFocus
                placeholder={t.landing.pinPlaceholder}
                className={`${inputCls} tracking-[0.4em]`}
              />
            </div>
            <button type="submit" disabled={busy || pin.length !== 6} className={go} style={{ color: accent }}>
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
              {t.landing.pinSignIn}
              <ArrowRight className="h-5 w-5" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => { setStep("id"); setPin(""); setMsg(null); }}
            className="inline-flex items-center gap-1 self-start text-[12px] text-white/60 hover:text-white/90"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> {t.landing.pinDifferentId}
          </button>
        </form>
      )}

      {msg && (
        <div className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-left text-[13px] backdrop-blur-sm ${
          tone === "error" ? "border-white/30 bg-black/25 text-white" : "border-white/25 bg-white/10 text-white/90"
        }`}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {msg}
        </div>
      )}

      {/* The way out, always. A locked or PIN-less customer must never hit a wall. */}
      <button
        type="button"
        onClick={onUsePhone}
        className="mt-3 text-[12px] text-white/60 underline-offset-2 hover:text-white/90 hover:underline"
      >
        {t.landing.pinUsePhoneInstead}
      </button>
    </div>
  );
}
