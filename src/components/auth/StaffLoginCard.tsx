"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Lock, Mail, ArrowRight, AlertTriangle, KeyRound, MailCheck, ShieldCheck } from "lucide-react";
import type { LenderBrand } from "@/lib/lms/branding";
import { logoMetrics } from "@/lib/lms/logo";
import CodeInput from "@/components/auth/CodeInput";
import AuthAmbient from "@/components/auth/AuthAmbient";
import AccessSeal, { type SealState } from "@/components/auth/AccessSeal";

// Staff sign-in (org-scoped console). Borrowers never need this — the funnel
// at / identifies them by phone inside the wizard.
//
// Brand-aware: lms.birgenai.com/micromart wears Micromart's logo and accent,
// lms.birgenai.com/mular wears Mular's — the SAME email can hold a staff seat at
// several lenders, and the org on the URL disambiguates which book this session
// opens (orgSlug rides along to /api/auth/login).
//
// Two factors: password, then today's 6-digit code (emailed, reusable until
// midnight — one code each morning, not one per session).
//
// LAYOUT: everything in this card is LEFT-ALIGNED except the logo. Centred forms
// read like a consumer signup; a staff console is a workplace tool, and the eye
// should fall down one edge — eyebrow, heading, fields, button — without hunting.
// The Access Seal is part of the LOCKUP, not furniture parked at the far edge: it
// sits immediately after the step label, so "STAFF ACCESS 🔒" reads as one object.
// Pushed to the right margin it was a decoration floating in whitespace; beside
// the words it is a padlock ON the words, which is the whole point of it.
type Mode = "signin" | "otp" | "forgot" | "reset";

// MICRO EAZY'S PALETTE, sampled from the mark rather than eyeballed.
//
// Counting only saturated, opaque pixels inside the artwork's real bounding box:
// #003060 (46k px) and #003078 (15k px) carry the wordmark, #48a800 (18k px) and
// #60c000 (13k px) carry the M. These two constants sit between each pair, so the
// chrome is the logo's own colour and a future re-export cannot leave the page
// wearing last season's paint. Used ONLY for the un-branded door; a lender's own
// door at /<slug> passes `brand` and is untouched.
const ME_NAVY = "#00306b";
const ME_GREEN = "#4aa900";

export default function StaffLoginCard({ brand }: { brand?: LenderBrand | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  // Shown ONLY when neither email nor SMS could deliver — never on a healthy
  // send. It is a lockout escape hatch, not a debug readout, and the server
  // withholds it entirely in production.
  const [fallbackCode, setFallbackCode] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [nextPass, setNextPass] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sealed, setSealed] = useState(false);
  // Which field has the caret — drives the Sentinel, nothing else.
  const [focusField, setFocusField] = useState<"email" | "password" | null>(null);
  // Non-OTP status line (forgot/reset). The OTP step renders its own branded
  // confirmation, so we never fall back to a generic green tick banner.
  const [notice, setNotice] = useState<string | null>(null);

  const orgSlug = brand?.slug ?? null;

  const submit = async (withOtp?: string) => {
    setError(null);
    if (!email.trim() || !password) { setError("Enter your email and password."); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, ...(orgSlug ? { orgSlug } : {}), ...(withOtp ? { otp: withOtp } : {}) }),
      });
      // Guard the parse: a cold backend can answer with an HTML error page, and a
      // reachability blip must never read as a wrong password.
      const data = await res.json().catch(() => null);
      if (res.status === 503 || data?.wakingUp) {
        setError(data?.message || "The service is waking up — please try again in a moment."); return;
      }
      if (!data) { setError("Couldn't reach the sign-in service. Please try again in a moment."); return; }
      if (data.otpRequired) {
        setMode("otp");
        setFallbackCode(data.fallbackCode ?? null);
        if (withOtp) { setError(data.message || "That code didn't match."); setOtp(""); }
        return;
      }
      if (!data.success) { setError(data.message || "Sign-in failed."); return; }
      // Let the seal finish opening before the console replaces the screen — the
      // shackle snapping shut mid-animation is the difference between a product and
      // a prototype. Only on the OTP path; a bare password sign-in has no second
      // door to open, so it goes straight through.
      if (withOtp) {
        setSealed(true);
        setTimeout(() => router.replace("/console"), 620);
        return;
      }
      router.replace("/console");
    } catch { setError("Couldn't reach the sign-in service. Please try again in a moment."); } finally { setLoading(false); }
  };

  const requestCode = async () => {
    setError(null); setNotice(null);
    if (!email.trim()) { setError("Enter your email."); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      setNotice(data.message || "If that email is on a team, a reset code is on its way.");
      setMode("reset");
    } catch { setError("Could not send the code."); } finally { setLoading(false); }
  };

  const confirmReset = async () => {
    setError(null); setNotice(null);
    if (code.length !== 6 || nextPass.length < 10) { setError("Enter the 6-digit code and a new password (10+ chars)."); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code, next: nextPass }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Reset failed."); return; }
      setNotice(data.message || "Password updated — sign in with the new one.");
      setMode("signin"); setPassword(""); setCode(""); setNextPass("");
    } catch { setError("Reset failed."); } finally { setLoading(false); }
  };

  const wrap = "flex items-center gap-2.5 rounded-xl border border-zinc-900/12 bg-white/80 px-3.5 transition-colors focus-within:border-[color:var(--brand)] focus-within:bg-white";
  const input = "flex-1 bg-transparent outline-none text-[15px] py-3.5 placeholder:text-zinc-400";
  // The branded accent drives the primary button; the un-branded default now wears
  // MICRO EAZY'S OWN COLOURS rather than the old near-black. Sampled from the mark
  // itself so the paint and the logo cannot drift apart: the wordmark is navy
  // (#003060–#003078 across ~46k px) and the M is apple green (#48a800–#60c000).
  // A black crown seam and a black button over a green-and-navy logo is what made
  // the door read as a generic form with someone's picture on it.
  const accentVars = {
    "--brand": brand?.accent ?? ME_NAVY,
    "--brand-soft": brand?.accentSoft ?? "rgba(0,48,107,0.12)",
  } as CSSProperties;
  const primaryBtn = "mt-5 w-full inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-[15px] font-semibold text-white shadow-lg shadow-zinc-900/10 transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-60 disabled:hover:brightness-100";
  const accent = brand?.accent ?? ME_NAVY;
  const accent2 = brand?.accent2 ?? (brand ? accent : ME_GREEN);
  const primaryStyle: CSSProperties = { background: `linear-gradient(120deg, ${accent}, ${accent2})` };

  // THE UN-BRANDED DOOR WEARS MICRO EAZY.
  //
  // /login is the generic staff entrance; a lender's own door is /<org-slug> and
  // passes `brand`, so nothing here touches a lender's branding. Micro Eazy is the
  // consumer-facing name of the ecosystem, and it is what a Micromart officer should
  // recognise on the way in — "Powered by BirgenAI" stays in the footer, which is
  // the honest split (BirgenAI never lends; see the ecosystem blueprint's D2).
  //
  // logo-auth.png is the 655x304 build of the founder's export, produced by
  // scripts/prep-brand-asset.ts (1536x1024 / 433 KB in, 40.8 KB out).
  //
  // AND IT HAD TO BE REBUILT, because the first build was the bug in src/lib/lms/logo.ts
  // happening again in a new file. The export carries a faint alpha wash out to every
  // corner — 0.6% of its pixels sit at alpha 1–31 — so `trim({threshold: 1})` found
  // nothing to crop and reported a 0% gutter, while the artwork actually occupies just
  // 35% of the canvas. The mark therefore rendered 165x73 inside a 228x152 box: two
  // thirds of the logo on the product's front door was air, which is exactly what it
  // looked like. The script now computes the bounding box from the alpha channel at a
  // threshold that means something, and the same mark renders 342x152 — 4.3x the
  // visible area, with no change to the artwork itself.
  const logoSrc = brand?.logo ?? "/brand/micro-eazy/logo-auth.png";
  const logoFallback = brand?.fallbackLogo ?? "/brand/micro-eazy/logo-transparent.png";
  // NOTE ON THE SLOGAN, deliberately NOT re-typeset here. "Quick Loans. Better
  // Living." is part of the Micro Eazy mark, and at the corrected size it renders
  // ~10px tall and reads cleanly. Setting it again as HTML under the image would
  // print the same words twice, which is worse than small — so the fix for an
  // illegible slogan was the crop, not a caption.
  // Both dimensions capped, neither pinned — see src/lib/lms/logo.ts. The old
  // fixed-height box could letterbox, and the file's own transparent gutter was
  // what actually made the heading look shoved down the card.
  const logo = logoMetrics("auth", brand?.logoScale);

  // ONE label per step. The OTP step used to carry both "Second factor" (eyebrow)
  // and "Enter today's code" (heading) — two ways of saying the same thing, with
  // the more useful of the two demoted to small print. Now the instruction IS the
  // label, set in the same treatment that "STAFF ACCESS" wears, so the two doors a
  // staffer walks through look like a sequence rather than two different screens.
  const heading =
    mode === "forgot" ? "Reset your password"
      : mode === "reset" ? "Set a new password" : "";
  const eyebrow =
    mode === "signin" ? "Staff access"
      : mode === "otp" ? "Enter today's code"
        : "Account recovery";
  /** No heading under it ⇒ the label carries the row, and is sized to. */
  const soloEyebrow = !heading;

  // The door's state, in one expression. Note the ORDER: a granted seal outranks
  // everything, and a live error outranks whichever field has the caret — the mark
  // must never sit there looking calm while a red banner is up.
  const seal: SealState =
    sealed ? "granted"
      : loading ? "working"
        : error ? "error"
          : focusField === "password" ? "shielded"
            : focusField === "email" ? "open" : "locked";

  return (
    <div className="min-h-screen relative text-zinc-900" style={accentVars}>
      <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />
      <AuthAmbient accent={accent} accent2={accent2} />

      <div className="relative z-10 min-h-screen flex items-center justify-center px-4 py-10">
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="glass w-full max-w-md overflow-hidden rounded-3xl bg-white/75 shadow-2xl shadow-zinc-900/10"
        >
          {/* Brand-lit crown — a thin gradient seam so every door feels bespoke.
              On the un-branded door this is now navy→green rather than the old
              black-on-black, which is what turned the top of the card into a bar. */}
          <div aria-hidden className="h-1.5 w-full" style={{ background: `linear-gradient(90deg, ${accent}, ${accent2})` }} />

          <div className="px-6 pt-7 pb-7 sm:px-8 sm:pt-8 sm:pb-8">
            {/* THE LOCKUP. The mark, then a hairline in its own colours — structure
                that costs one element and makes the mark read as a masthead instead
                of an image that happens to be at the top of a form. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoSrc}
              alt={brand?.name ?? "Micro Eazy"}
              style={{ maxWidth: logo.maxWidth, maxHeight: logo.maxHeight, width: "auto", height: "auto", marginBottom: logo.marginBottom }}
              className="mx-auto block"
              onError={(e) => (((e.target as HTMLImageElement).src = logoFallback))}
            />
            <div
              aria-hidden
              className="mx-auto mt-5 h-px w-full max-w-[15rem]"
              style={{ background: `linear-gradient(90deg, transparent, ${accent2}66 30%, ${accent}66 70%, transparent)` }}
            />

            {/* Heading lockup: label, then seal. On the sign-in and second-factor
                steps the eyebrow IS the heading — the logo above has already said
                which lender this is, and "Sign in to Mular Credit Ltd" under a Mular
                logo is the same sentence twice. Only the recovery steps still carry a
                title, because there the label alone would not say what the screen
                wants from you.

                So the label is sized for the JOB IT IS DOING, not for its name.
                Standing alone it inherits the space the absent heading left — sitting
                lower and set larger. Above a real heading it shrinks back to a true
                eyebrow, because two things competing to be the heading is worse than
                either of them being it. */}
            {/* The hairline above already carries 20px, so the label sits closer to
                it than it used to sit to the bare logo — the rule is what separates
                the masthead from the form now, not empty space. */}
            <div className={soloEyebrow ? "mt-6" : "mt-4"}>
              {/* The seal rides WITH the label, not opposite it — so it stays in the
                  lockup at every step, and the heading (when a step has one) flows
                  underneath the pair rather than beside a floating glyph. */}
              <div className="flex items-center gap-2.5">
                {/* Letter-spacing is applied AFTER the last glyph too, so a tracked
                    label carries an invisible 0.2em tail. Left in, the seal sits
                    visibly further from "ACCESS" than the gap says it should — so
                    the tail is subtracted back out and the optical gap is the real one. */}
                <p
                  className={`font-semibold uppercase ${soloEyebrow ? "text-[15px] tracking-[0.2em]" : "text-[11px] tracking-[0.16em]"}`}
                  style={{ color: accent, marginRight: soloEyebrow ? "-0.2em" : "-0.16em" }}
                >
                  {eyebrow}
                </p>
                {/* Sized to the label it accompanies: a 34px lock next to an 11px
                    eyebrow would be the tail wagging the dog. */}
                <AccessSeal state={seal} accent={accent} accent2={accent2} size={soloEyebrow ? 34 : 26} />
              </div>
              {heading && <h1 className="mt-1.5 text-[22px] font-bold leading-tight tracking-tight text-zinc-900">{heading}</h1>}
            </div>

            {error && (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-300/70 bg-red-50/90 px-3 py-2.5 text-sm text-red-700">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
              </div>
            )}
            {/* Higher-calibre status line (forgot/reset) — brand-toned, not a green tick banner */}
            {notice && mode !== "otp" && (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-zinc-900/10 bg-white/70 px-3 py-2.5 text-sm text-zinc-700">
                <MailCheck className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "var(--brand)" }} /> {notice}
              </div>
            )}

            <AnimatePresence mode="wait">
              {mode === "signin" && (
                <motion.div key="signin" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                  <div className="mt-5 space-y-3">
                    <div className={wrap}>
                      <Mail className="h-4 w-4 text-zinc-400 shrink-0" />
                      <input
                        value={email} onChange={(e) => setEmail(e.target.value)}
                        onFocus={() => setFocusField("email")} onBlur={() => setFocusField(null)}
                        inputMode="email" autoComplete="username" placeholder="Work email" className={input}
                      />
                    </div>
                    <div className={wrap}>
                      <Lock className="h-4 w-4 text-zinc-400 shrink-0" />
                      <input
                        value={password} onChange={(e) => setPassword(e.target.value)}
                        onFocus={() => setFocusField("password")} onBlur={() => setFocusField(null)}
                        type="password" autoComplete="current-password" placeholder="Password"
                        onKeyDown={(e) => e.key === "Enter" && submit()} className={input}
                      />
                    </div>
                  </div>
                  <button onClick={() => submit()} disabled={loading} className={primaryBtn} style={primaryStyle}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Sign in <ArrowRight className="h-4 w-4" />
                  </button>
                  <div className="mt-4 flex items-center justify-between text-xs">
                    <button onClick={() => { setMode("forgot"); setError(null); setNotice(null); }} className="text-zinc-500 hover:text-zinc-800">Forgot password?</button>
                    {!brand && (
                      <Link href="/onboard" className="font-semibold" style={{ color: "var(--brand)" }}>Create your organization</Link>
                    )}
                  </div>
                  <p className="mt-4 flex items-center gap-1.5 text-[11px] text-zinc-400">
                    <ShieldCheck className="h-3 w-3 shrink-0" /> Two-factor protected · every action audited
                  </p>
                </motion.div>
              )}

              {mode === "otp" && (
                <motion.div key="otp" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                  {/* No centrepiece here any more. The 132px vault door was the most
                      elaborate thing on the screen and it guarded the LEAST important
                      moment — a person copying six digits out of their inbox. The six
                      boxes are the progress indicator; the seal in the lockup above
                      carries the state, and opens when the code clears. */}
                  <div className="mt-5">
                    <CodeInput value={otp} onChange={(v) => { setOtp(v); if (error) setError(null); }} onComplete={(c) => submit(c)} disabled={loading || sealed} />
                  </div>

                  {fallbackCode && (
                    <p className="mt-3 rounded-lg border border-amber-300/60 bg-amber-50/80 px-3 py-2 text-[12px] leading-snug text-amber-800">
                      We couldn&apos;t deliver the email or SMS from this environment — your code is{" "}
                      <span className="font-mono font-bold tracking-widest">{fallbackCode}</span>.
                    </p>
                  )}

                  <button onClick={() => submit(otp)} disabled={loading || sealed || otp.length !== 6} className={primaryBtn} style={primaryStyle}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {sealed ? "Opening…" : "Verify & sign in"} {!loading && !sealed && <ArrowRight className="h-4 w-4" />}
                  </button>
                  <p className="mt-3 text-center text-[11px] leading-relaxed text-zinc-400">
                    No email? The code from earlier today still works — check your inbox and spam.
                  </p>
                  <button onClick={() => { setMode("signin"); setOtp(""); setError(null); setNotice(null); setFallbackCode(null); }} className="mt-3 w-full text-center text-xs text-zinc-500 hover:text-zinc-800">Back to sign in</button>
                </motion.div>
              )}

              {mode === "forgot" && (
                <motion.div key="forgot" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                  <div className="mt-5"><div className={wrap}><Mail className="h-4 w-4 text-zinc-400 shrink-0" /><input value={email} onChange={(e) => setEmail(e.target.value)} onFocus={() => setFocusField("email")} onBlur={() => setFocusField(null)} inputMode="email" placeholder="Work email" onKeyDown={(e) => e.key === "Enter" && requestCode()} className={input} /></div></div>
                  <button onClick={requestCode} disabled={loading} className={primaryBtn} style={primaryStyle}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Send reset code
                  </button>
                  <button onClick={() => { setMode("signin"); setError(null); setNotice(null); }} className="mt-4 w-full text-center text-xs text-zinc-500 hover:text-zinc-800">Back to sign in</button>
                </motion.div>
              )}

              {mode === "reset" && (
                <motion.div key="reset" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                  <div className="mt-5 space-y-3">
                    <CodeInput value={code} onChange={setCode} length={6} disabled={loading} autoFocus />
                    <div className={wrap}><Lock className="h-4 w-4 text-zinc-400 shrink-0" /><input value={nextPass} onChange={(e) => setNextPass(e.target.value)} onFocus={() => setFocusField("password")} onBlur={() => setFocusField(null)} type="password" placeholder="New password (10+ chars)" onKeyDown={(e) => e.key === "Enter" && confirmReset()} className={input} /></div>
                  </div>
                  <button onClick={confirmReset} disabled={loading} className={primaryBtn} style={primaryStyle}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Update password
                  </button>
                  <button onClick={() => { setMode("signin"); setError(null); setNotice(null); }} className="mt-4 w-full text-center text-xs text-zinc-500 hover:text-zinc-800">Back to sign in</button>
                </motion.div>
              )}
            </AnimatePresence>

            <p className="mt-6 text-center text-[11px] text-zinc-400">
              Powered by <span className="font-semibold text-zinc-500">BirgenAI</span>
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
