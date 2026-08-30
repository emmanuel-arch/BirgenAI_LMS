"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE CUSTOMER DOOR — phone, then the texted code, then the national ID.
//
// Possession (the SMS) plus knowledge (the ID). A SIM swap alone opens nothing.
// This is the exact door /myloan already puts in front of a loan balance, lifted
// into one component because tasks 0.8 and 0.9 each need it and a security
// control that exists in three hand-copied versions will eventually differ in
// one of them — which is how the weakest copy becomes the one that matters.
//
// The door owns the credentials and never hands them to the screen inside it.
// `children` receives the ANSWER and a `reload`, so a screen built on this cannot
// accidentally hold the national ID in its own state or put it in a URL.
//
// i18n: the door's own words come from the shared portal dictionary, so it is
// bilingual today. Screens built on it supply their own English copy — the full
// Kiswahili pass over the new Micro Eazy screens is Sprint 1, per the blueprint.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useState, type ReactNode } from "react";
import { Loader2, AlertTriangle, Phone, CreditCard, ArrowRight, Lock } from "lucide-react";
import { useLoad } from "@/lib/hooks/useLoad";
import { useBrand, lenderFromLocation } from "@/lib/lms/useBrand";
import { useLang } from "@/lib/i18n/useLang";
import { LangToggle } from "./LangToggle";
import OtpCard, { type OtpIssue } from "./OtpCard";

type Stage = "phone" | "code" | "id";

export default function PortalDoor<T extends { found?: boolean }>({
  endpoint,
  title,
  subtitle,
  icon,
  notFound,
  children,
}: {
  /** POST target. Receives { lenderSlug, nationalId }. */
  endpoint: string;
  title: string;
  subtitle: string;
  icon: ReactNode;
  /** Shown when the door opens but the lender has no record of this person. */
  notFound: ReactNode;
  children: (data: T, ctx: { lender: string; reload: () => void }) => ReactNode;
}) {
  const { lang, t } = useLang();
  const [lender, setLender] = useState<string>("");
  const [stage, setStage] = useState<Stage>("phone");
  const [phone, setPhone] = useState("");
  const [otpIssue, setOtpIssue] = useState<OtpIssue | null>(null);
  const [nationalId, setNationalId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<T | null>(null);

  useLoad(() => { setLender(lenderFromLocation() ?? "hub"); });
  const brand = useBrand(lender);

  /** The session expired mid-flow — back to the phone step. */
  const expired = () => { setStage("phone"); setOtpIssue(null); setData(null); setError(t.errors.sessionExpired); };

  const requestOtp = async () => {
    setError(null);
    if (!phone.trim()) { setError(t.errors.enterPhone); return; }
    setLoading(true);
    try {
      // Skip the SMS when this number is already verified with this lender.
      try {
        const s = await fetch(`/api/portal/session?phone=${encodeURIComponent(phone.trim())}`).then((r) => r.json());
        if (s?.authenticated && s.lenderSlug === lender && s.matchesPhone) { setStage("id"); return; }
      } catch { /* no session — issue a code as normal */ }

      const res = await fetch("/api/portal/otp", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lenderSlug: lender, phone: phone.trim(), lang }),
      });
      const body = await res.json();
      if (!body.success) { setError(body.message || t.errors.couldNotSendCode); return; }
      setOtpIssue({ delivered: !!body.delivered, devCode: body.devCode });
      setStage("code");
    } catch { setError(t.errors.couldNotSendCode); } finally { setLoading(false); }
  };

  const load = useCallback(async (id: string) => {
    setError(null);
    if (!id.trim()) { setError(t.myloan.enterId); return; }
    setLoading(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lenderSlug: lender, nationalId: id }),
      });
      const body = await res.json();
      if (body.needsOtp) { expired(); return; }
      if (!body.success) { setError(body.message || "Could not load this."); return; }
      setData(body as T);
    } catch { setError("Could not load this."); } finally { setLoading(false); }
    // `expired` and the dictionary are stable enough for this callback's purpose;
    // re-creating it on every keystroke would remount the card underneath.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, lender]);

  const field = "flex items-center gap-2 rounded-lg border border-ash-900/15 bg-paper/80 px-3";
  const input = "flex-1 bg-transparent outline-none text-sm py-3 placeholder:text-ash-400";

  // Opened, and the lender has a record — the screen inside takes over entirely.
  if (data?.found) {
    return (
      <div className="min-h-screen relative text-ash-900" style={{ ["--brand" as never]: brand.accent, ["--brand-soft" as never]: brand.accentSoft }}>
        <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />
        <div className="relative z-10 min-h-screen px-4 py-8">
          {children(data, { lender, reload: () => load(nationalId) })}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative text-ash-900" style={{ ["--brand" as never]: brand.accent, ["--brand-soft" as never]: brand.accentSoft }}>
      <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />
      <div className="relative z-10 min-h-screen flex items-center justify-center px-4 py-8">
        {stage === "code" && otpIssue ? (
          <div className="w-full max-w-md">
            {error && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
              </div>
            )}
            <OtpCard
              lenderSlug={lender}
              phone={phone.trim()}
              issue={otpIssue}
              onVerified={() => { setError(null); setStage("id"); }}
              onChangeNumber={() => { setOtpIssue(null); setError(null); setStage("phone"); }}
            />
          </div>
        ) : (
          <div className="glass w-full max-w-md rounded-3xl bg-paper/65 p-6 sm:p-8">
            <div className="flex justify-end"><LangToggle /></div>
            <div className="text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center" style={{ color: "var(--brand)" }}>{icon}</div>
              <h1 className="mt-3 text-2xl font-bold">{title}</h1>
              <p className="mt-1.5 text-sm text-ash-500">{subtitle}</p>
            </div>

            {error && (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
              </div>
            )}

            {stage === "phone" && (
              <>
                <div className={`mt-5 ${field}`}>
                  <Phone className="h-4 w-4 text-ash-400 shrink-0" />
                  <input
                    className={input} inputMode="tel" autoComplete="tel"
                    placeholder={t.landing.phonePlaceholderOpen}
                    value={phone} onChange={(e) => setPhone(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") requestOtp(); }}
                  />
                </div>
                <button
                  onClick={requestOtp} disabled={loading}
                  className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-invert px-5 py-3 text-sm font-semibold text-invert-fg hover:bg-invert-2 disabled:opacity-60"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {t.common.continue} <ArrowRight className="h-4 w-4" />
                </button>
                <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-ash-400">
                  <Lock className="h-3 w-3" /> {t.landing.smsNote}
                </p>
              </>
            )}

            {stage === "id" && (
              <>
                <div className={`mt-5 ${field}`}>
                  <CreditCard className="h-4 w-4 text-ash-400 shrink-0" />
                  <input
                    className={input} inputMode="numeric" autoComplete="off"
                    placeholder={t.myloan.enterId}
                    value={nationalId} onChange={(e) => setNationalId(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") load(nationalId); }}
                  />
                </div>
                <button
                  onClick={() => load(nationalId)} disabled={loading}
                  className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-invert px-5 py-3 text-sm font-semibold text-invert-fg hover:bg-invert-2 disabled:opacity-60"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {t.common.continue} <ArrowRight className="h-4 w-4" />
                </button>
              </>
            )}

            {/* Opened, but this lender holds no record for that ID. */}
            {data && !data.found && <div className="mt-5">{notFound}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
