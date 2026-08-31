"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE SIGN-IN HALF OF A SYSTEM'S FRONT DOOR.
//
// ── THE TWO PEOPLE WHO ARRIVE HERE ───────────────────────────────────────────
// analytics.servicesuitecloud.com is a link that gets forwarded. Two entirely
// different people open it and the page has to serve both without asking which
// they are:
//
//   · THE ONE ALREADY SIGNED IN. Their BirgenAI ID is in the cookie. They should
//     not type anything — one button, their own name on it, and they are in.
//     This is the demonstration: six products, one identity, and you can watch
//     it happen.
//   · THE ONE WHO ONLY HAS THE LINK. A collections supervisor who was sent the
//     ConnectDesk address and has never seen the lending console. Bouncing them
//     to a generic /login that has forgotten why they came is how a suite of
//     products comes to feel like one product with five aliases. They get the
//     real form, on this system's own artwork, in this system's own colour.
//
// Both states are the SAME page and the same card. Nothing is hidden behind a
// "sign in with a different account" disclosure that a first-time visitor would
// have to guess at.
//
// ── WHY THIS POSTS TO /api/auth/login LIKE EVERYTHING ELSE ───────────────────
// There is ONE credential check in this application and this is not a second
// one. Same endpoint, same rate limits, same daily-OTP second factor, same
// uniform failure message. What differs is only where a success lands: the API
// answers `/suite` because it cannot know which door you knocked on, and this
// component overrides that with the system you actually asked for.
//
// The one thing it deliberately does NOT reimplement is the forgot/reset flow.
// That lives on the full staff card at /login and is linked to rather than
// copied — a password-reset path forked across six doors is a security surface
// nobody would ever finish auditing.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import {
  ArrowRight, KeyRound, Loader2, Lock, Mail, ShieldCheck, TriangleAlert, UserRound,
} from "lucide-react";
import CodeInput from "@/components/auth/CodeInput";

type Mode = "sso" | "credentials" | "otp";

export default function SuiteDoorForm({
  systemName,
  accent,
  continueHref,
  who,
  firstName,
  orgSlug,
}: {
  systemName: string;
  accent: string;
  /** Where a successful sign-in — or the SSO button — actually lands. */
  continueHref: string;
  /** Full name of the signed-in person, or null. */
  who: string | null;
  /** Just their first name, for the button. Null when nobody is signed in. */
  firstName: string | null;
  /**
   * Pins the sign-in to one lender when the door was reached through their own
   * branded host. The same email can hold a staff seat at several lenders, and
   * without this the server picks the oldest — which is the wrong book.
   */
  orgSlug: string | null;
}) {
  const [mode, setMode] = useState<Mode>(who ? "sso" : "credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const vars = { "--brand": accent, "--brand-soft": `${accent}33` } as CSSProperties;

  const submit = async (withOtp?: string) => {
    setError(null);
    if (!email.trim() || !password) { setError("Enter your email and password."); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          ...(orgSlug ? { orgSlug } : {}),
          ...(withOtp ? { otp: withOtp } : {}),
        }),
      });
      // Guard the parse: a cold backend can answer with an HTML error page, and a
      // reachability blip must never read to the user as a wrong password.
      const data = await res.json().catch(() => null);
      if (res.status === 503 || data?.wakingUp) {
        setError(data?.message || "The service is waking up — please try again in a moment.");
        return;
      }
      if (!data) { setError("Couldn't reach the sign-in service. Please try again in a moment."); return; }

      if (data.otpRequired) {
        setMode("otp");
        setNotice(data.message ?? null);
        if (withOtp) { setError(data.message || "That code didn't match."); setOtp(""); }
        return;
      }
      if (!data.success) { setError(data.message || "Sign-in failed."); return; }

      // WHERE THIS LANDS. The API answers `/suite` for staff because it does not
      // know which door was knocked on — this one does, so it wins. The single
      // exception is the platform administrator: `/platform` is not a system in
      // the suite and sending him into ConnectDesk instead would be worse than
      // ignoring the door he happened to use.
      const to = data.platform && typeof data.destination === "string" ? data.destination : continueHref;
      // A hard navigation, not router.push: the session cookie was set by the
      // response we just read, and every server component from here down has to
      // be re-evaluated with it. Crossing to another origin (a federated system)
      // is not something the client router can do at all.
      window.location.assign(to);
    } catch {
      setError("Couldn't reach the sign-in service. Please try again in a moment.");
    } finally {
      setLoading(false);
    }
  };

  const field = "flex items-center gap-2.5 rounded-xl border border-white/[0.12] bg-paper/[0.06] px-3.5 transition-colors focus-within:border-[color:var(--brand)] focus-within:bg-paper/[0.09]";
  const input = "flex-1 bg-transparent py-3 text-[14px] text-white outline-none placeholder:text-white/35";
  const primary = "flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-[13.5px] font-bold text-white transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60 disabled:hover:scale-100";

  return (
    <div style={vars} className="rounded-2xl border border-white/[0.10] bg-paper/[0.05] p-4 backdrop-blur-xl">
      {/* ── Already signed in: one button, their own name on it ───────────── */}
      {mode === "sso" && who && (
        <>
          {/* ── ONE STATEMENT OF WHO YOU ARE, NOT TWO ──────────────────────
              There used to be a green banner above this button reading "Signed
              in as Birgen Krosovic with BirgenAI ID." It said the same thing the
              button says, in a second voice, and it named an internal product
              ("BirgenAI ID") that no lender has any reason to recognise — on the
              first screen their staff ever see.

              The button carries it. It has the person's own name on it, and the
              line underneath says why no password is being asked for. That is
              the whole fact, once. */}
          <Link href={continueHref} className={`${primary} group relative overflow-hidden`} style={{ backgroundColor: accent }}>
            {/* The one moving control on the page. A highlight crossing the
                primary action, and nothing else on this door, so it reads as
                "press this" rather than as decoration. */}
            <span
              aria-hidden
              className="suite-sheen pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 skew-x-[-20deg]"
              style={{ background: "linear-gradient(90deg, transparent, rgb(255 255 255 / 0.28), transparent)" }}
            />
            <UserRound className="relative h-4 w-4" />
            <span className="relative">Continue as {firstName ?? who}</span>
            <ArrowRight className="relative h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>

          <p className="mt-2.5 flex items-center justify-center gap-1.5 text-center text-[11px] text-white/40">
            <KeyRound className="h-3 w-3" /> No password — one identity, every system you hold.
          </p>

          <div className="mt-3.5 flex items-center gap-3">
            <span className="h-px flex-1 bg-paper/[0.09]" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/25">or</span>
            <span className="h-px flex-1 bg-paper/[0.09]" />
          </div>

          <button
            type="button"
            onClick={() => { setMode("credentials"); setError(null); setNotice(null); }}
            className="mt-3 w-full rounded-xl border border-white/[0.12] bg-paper/[0.04] px-4 py-2.5 text-[12.5px] font-semibold text-white/70 transition-colors hover:bg-paper/[0.08] hover:text-white"
          >
            Sign in as someone else
          </button>
        </>
      )}

      {/* ── The real form ──────────────────────────────────────────────────── */}
      {mode === "credentials" && (
        <form
          onSubmit={(e) => { e.preventDefault(); void submit(); }}
          className="space-y-2.5"
        >
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">
            {systemName} · staff access
          </p>

          <label className={field}>
            <Mail className="h-4 w-4 shrink-0 text-white/35" />
            <input
              type="email"
              autoComplete="username"
              inputMode="email"
              placeholder="you@lender.co.ke"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={input}
              aria-label="Email"
            />
          </label>

          <label className={field}>
            <Lock className="h-4 w-4 shrink-0 text-white/35" />
            <input
              type="password"
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={input}
              aria-label="Password"
            />
          </label>

          <button type="submit" disabled={loading} className={`${primary} !mt-3.5`} style={{ backgroundColor: accent }}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Sign in to {systemName}
          </button>

          <div className="flex items-center justify-between pt-1">
            <Link href="/login" className="text-[11px] text-white/40 transition-colors hover:text-white/75">
              Forgot your password?
            </Link>
            {who && (
              <button
                type="button"
                onClick={() => { setMode("sso"); setError(null); }}
                className="text-[11px] text-white/40 transition-colors hover:text-white/75"
              >
                Back to {firstName ?? "your account"}
              </button>
            )}
          </div>
        </form>
      )}

      {/* ── Today's code ───────────────────────────────────────────────────── */}
      {mode === "otp" && (
        <div className="space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">Enter today&rsquo;s code</p>
          <p className="text-[12px] leading-relaxed text-white/55">
            {notice ?? "Use today's code from your inbox — it works until midnight."}
          </p>
          <CodeInput
            tone="dark"
            value={otp}
            onChange={setOtp}
            onComplete={(code) => void submit(code)}
            disabled={loading}
          />
          <button
            type="button"
            disabled={loading || otp.length !== 6}
            onClick={() => void submit(otp)}
            className={primary}
            style={{ backgroundColor: accent }}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Confirm and open {systemName}
          </button>
          <button
            type="button"
            onClick={() => { setMode("credentials"); setOtp(""); setError(null); setNotice(null); }}
            className="w-full text-center text-[11px] text-white/40 transition-colors hover:text-white/75"
          >
            Use a different account
          </button>
        </div>
      )}

      {error && (
        <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-rose-500/12 px-3 py-2 text-[11.5px] leading-snug text-rose-200 ring-1 ring-rose-400/25">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}
    </div>
  );
}
