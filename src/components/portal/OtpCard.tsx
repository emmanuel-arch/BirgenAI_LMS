"use client";

// The code screen. Mobile-first: six big tap targets, numeric keyboard, paste of
// a whole code from the SMS, auto-advance, auto-submit on the sixth digit.
//
// The caller issues the first code (so it can surface a 429 or a bad number on
// its own button) and hands the outcome in; this card owns verification, resend
// and the cooldown.
import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { motion } from "framer-motion";
import { Loader2, ArrowLeft, AlertTriangle, MessageSquare, FlaskConical } from "lucide-react";
import { useLang } from "@/lib/i18n/useLang";
import { fmt } from "@/lib/i18n/portal";

const LEN = 6;
const RESEND_COOLDOWN_S = 30;

export type OtpIssue = { delivered: boolean; devCode?: string };

export default function OtpCard({
  lenderSlug,
  phone,
  issue,
  onVerified,
  onChangeNumber,
  title,
  verifyCode,
  resendCode,
}: {
  lenderSlug: string;
  /** As the borrower typed it — display only. The server works in msisdn. */
  phone: string;
  /** Result of the caller's initial POST /api/portal/otp. */
  issue: OtpIssue;
  onVerified: () => void;
  onChangeNumber: () => void;
  title?: string;
  /**
   * Where the code goes. Defaults to exchanging it for a borrower session. Signing a
   * loan offer passes its own verifier, so the same six boxes — with their paste
   * handling, auto-submit and burn-aware errors — serve both purposes and neither
   * grows a second, less-tested copy. Reject with a message to show it under the boxes.
   */
  verifyCode?: (code: string) => Promise<void>;
  /** Where a resend goes. Defaults to re-issuing an identity code. */
  resendCode?: () => Promise<OtpIssue | void>;
}) {
  const { lang, t } = useLang();
  const [digits, setDigits] = useState<string[]>(Array(LEN).fill(""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState(issue.devCode ?? null);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => { boxes.current[0]?.focus(); }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const clearBoxes = () => {
    setDigits(Array(LEN).fill(""));
    boxes.current[0]?.focus();
  };

  const submit = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      if (verifyCode) {
        await verifyCode(value);
        onVerified();
        return;
      }
      const res = await fetch("/api/portal/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lenderSlug, phone, code: value }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.message || t.otp.wrongCode);
        clearBoxes();
        return;
      }
      onVerified();
    } catch (err) {
      setError(err instanceof Error && verifyCode ? err.message : t.otp.couldNotVerify);
      if (verifyCode) clearBoxes();
    } finally {
      setBusy(false);
    }
  };

  /** Submit the moment the sixth digit lands — nobody should hunt for a button. */
  const commit = (next: string[]) => {
    setDigits(next);
    const code = next.join("");
    if (code.length === LEN && !busy) void submit(code);
  };

  const setDigit = (i: number, v: string) => {
    const d = v.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[i] = d;
    commit(next);
    if (d && i < LEN - 1) boxes.current[i + 1]?.focus();
  };

  const onKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) boxes.current[i - 1]?.focus();
    if (e.key === "ArrowLeft" && i > 0) boxes.current[i - 1]?.focus();
    if (e.key === "ArrowRight" && i < LEN - 1) boxes.current[i + 1]?.focus();
  };

  // Android SMS autofill and long-press paste both deliver the whole code at once.
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, LEN);
    if (!text) return;
    e.preventDefault();
    const next: string[] = Array(LEN).fill("");
    for (let i = 0; i < text.length; i++) next[i] = text[i]!;
    commit(next);
    boxes.current[Math.min(text.length, LEN - 1)]?.focus();
  };

  const resend = async () => {
    if (cooldown > 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (resendCode) {
        const issued = await resendCode();
        setDevCode(issued?.devCode ?? null);
      } else {
        const res = await fetch("/api/portal/otp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lenderSlug, phone, lang }),
        });
        const data = await res.json();
        if (!data.success) { setError(data.message || t.otp.couldNotResend); return; }
        setDevCode(data.devCode ?? null);
      }
      clearBoxes();
      setCooldown(RESEND_COOLDOWN_S);
    } catch {
      setError(t.otp.couldNotResend);
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="glass w-full rounded-3xl border border-white/70 bg-white/65 backdrop-blur-2xl p-6 sm:p-8 shadow-[0_8px_30px_rgba(0,0,0,0.06)]">
      <div className="text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl" style={{ backgroundColor: "var(--brand-soft, #f4f4f5)" }}>
          <MessageSquare className="h-7 w-7" style={{ color: "var(--brand, #18181b)" }} />
        </div>
        <h1 className="mt-4 text-2xl font-bold">{title ?? t.otp.title}</h1>
        <p className="mt-2 text-sm text-zinc-500">
          {issue.delivered ? t.otp.sentTo : t.otp.codeFor}{" "}
          <span className="font-semibold text-zinc-900">{phone}</span>
        </p>
      </div>

      {devCode && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50/90 px-3 py-2.5 text-sm text-amber-800">
          <FlaskConical className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{t.otp.devCode} <span className="font-mono font-bold">{devCode}</span>.</span>
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      <div className="mt-6 flex justify-center gap-2 sm:gap-2.5" onPaste={onPaste}>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => { boxes.current[i] = el; }}
            value={d}
            onChange={(e) => setDigit(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            onFocus={(e) => e.target.select()}
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            aria-label={fmt(t.otp.digit, { n: i + 1 })}
            disabled={busy}
            className="h-14 w-11 sm:h-16 sm:w-13 rounded-xl border border-zinc-900/15 bg-white/80 text-center text-2xl font-bold outline-none transition-colors focus:border-[var(--brand,#18181b)] focus:ring-2 focus:ring-[var(--brand-soft,#e4e4e7)] disabled:opacity-60"
          />
        ))}
      </div>

      {busy && (
        <p className="mt-4 flex items-center justify-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> {t.otp.verifying}
        </p>
      )}

      <div className="mt-6 flex items-center justify-between gap-3">
        <button onClick={onChangeNumber} disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-900/15 px-3.5 py-2.5 text-sm text-zinc-600 hover:bg-zinc-900/5 disabled:opacity-60">
          <ArrowLeft className="h-4 w-4" /> {t.otp.changeNumber}
        </button>
        <button onClick={resend} disabled={cooldown > 0 || busy}
          className="text-sm font-semibold disabled:text-zinc-400"
          style={cooldown > 0 || busy ? undefined : { color: "var(--brand, #18181b)" }}>
          {cooldown > 0 ? fmt(t.otp.resendIn, { s: cooldown }) : t.otp.resend}
        </button>
      </div>
    </motion.div>
  );
}
