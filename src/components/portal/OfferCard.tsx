"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck, FileText, CheckCircle2, AlertTriangle } from "lucide-react";
import { useLang } from "@/lib/i18n/useLang";
import { fmt } from "@/lib/i18n/portal";
import OtpCard, { type OtpIssue } from "./OtpCard";

// The credit agreement, as the borrower reads it before signing.
//
// Everything they are agreeing to is on this screen — every installment, every
// date, the total they will repay. A borrower who has to tap "see schedule" to
// find out what a loan costs has not really been shown it. Mobile-first: the
// schedule scrolls inside its own box, the totals never leave the viewport.
//
// It reads in the borrower's language — a person is entitled to understand a
// credit agreement in the language they think in, and Kiswahili is exactly the
// screen where that stops being a nicety (blueprint §5.1).

type Row = { seq: number; dueDate: string; amountDue: number; principalDue: number; interestDue: number };
type Offer = {
  id: string; status: string; lender: string; productName: string | null;
  principal: number; interestRate: number; interestMethod: string;
  termCount: number; termUnit: string; totalInterest: number; totalRepayable: number;
  firstDueDate: string; expectedClearDate: string; expiresAt: string;
  schedule: Row[]; acceptedAt: string | null;
  payEarly: { savingKes: number; applies: boolean; note: string };
};

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;

export function OfferCard({
  offerId, lenderSlug, phone, onAccepted,
}: {
  offerId: string;
  lenderSlug: string;
  /** Display only — the server reads the phone from the borrower's session cookie. */
  phone: string;
  onAccepted: () => void;
}) {
  const { lang, t } = useLang();
  const locale = lang === "sw" ? "sw-KE" : "en-GB";
  const day = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: "2-digit", month: "short" });
  const fullDay = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });

  const [offer, setOffer] = useState<Offer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<OtpIssue | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/offer/${offerId}`);
      const d = await res.json();
      if (!d.success) { setError(d.message || t.offer.couldNotLoad); return; }
      setOffer(d.offer);
    } catch { setError(t.offer.couldNotLoad); }
    // t is stable per language; reloading on a language flip would be wasteful
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerId]);

  useEffect(() => { void load(); }, [load]);

  /** Issue a signing code. Shared by the "Accept and sign" button and OtpCard's resend. */
  const requestCode = async (): Promise<OtpIssue> => {
    const res = await fetch(`/api/portal/offer/${offerId}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sign", lang }),
    });
    const d = await res.json();
    if (!d.success) throw new Error(d.message || t.offer.couldNotSendCode);
    return { delivered: !!d.delivered, devCode: d.devCode };
  };

  const startSigning = async () => {
    setBusy(true); setError(null);
    try {
      setIssue(await requestCode());
    } catch (e) {
      setError(e instanceof Error ? e.message : t.offer.couldNotSendCode);
    } finally { setBusy(false); }
  };

  const submitCode = async (code: string) => {
    const res = await fetch(`/api/portal/offer/${offerId}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sign", code }),
    });
    const d = await res.json();
    if (!d.success) throw new Error(d.message || t.offer.wrongCode);
  };

  const decline = async () => {
    if (!confirm(t.offer.declineConfirm)) return;
    setBusy(true);
    try {
      await fetch(`/api/portal/offer/${offerId}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "decline" }),
      });
      await load();
    } finally { setBusy(false); }
  };

  if (error && !offer) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
      </div>
    );
  }
  if (!offer) {
    return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>;
  }

  if (offer.status === "ACCEPTED") {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center">
        <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
        <p className="mt-2 font-semibold text-emerald-900">{t.offer.signedTitle}</p>
        <p className="mt-1 text-xs text-emerald-800">
          {fmt(t.offer.signedNote, { total: kes(offer.totalRepayable), date: fullDay(offer.expectedClearDate), lender: offer.lender })}
        </p>
      </div>
    );
  }
  if (offer.status !== "OFFERED") {
    return (
      <div className="rounded-2xl border border-zinc-900/10 bg-white/70 p-5 text-center text-sm text-zinc-600">
        {fmt(t.offer.statusNote, { status: t.offer.statusWord[offer.status] ?? offer.status.toLowerCase(), lender: offer.lender })}
      </div>
    );
  }

  if (issue) {
    return (
      <div>
        {/* What is being signed stays on screen while they type the code. */}
        <div className="mb-4 rounded-2xl border border-zinc-900/10 bg-white/70 p-4 text-center">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">{t.offer.signingFor}</p>
          <p className="mt-1 text-2xl font-bold">{kes(offer.principal)}</p>
          <p className="text-xs text-zinc-500">{fmt(t.offer.repayingBy, { total: kes(offer.totalRepayable), date: fullDay(offer.expectedClearDate) })}</p>
        </div>
        <OtpCard
          lenderSlug={lenderSlug}
          phone={phone}
          issue={issue}
          title={t.offer.signTitle}
          verifyCode={submitCode}
          resendCode={requestCode}
          onVerified={onAccepted}
          onChangeNumber={() => setIssue(null)}
        />
        <button onClick={() => setIssue(null)} className="mt-3 w-full text-xs text-zinc-500 hover:text-zinc-800">
          {t.offer.backToAgreement}
        </button>
      </div>
    );
  }

  return (
    <div className="text-left">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4" style={{ color: "var(--brand)" }} />
        <h2 className="text-sm font-semibold">{fmt(t.offer.fromLender, { lender: offer.lender })}</h2>
      </div>

      {/* The two numbers that matter, before anything else. */}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-zinc-900/10 bg-white/70 p-4">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">{t.offer.youReceive}</p>
          <p className="mt-1 text-2xl font-bold">{kes(offer.principal)}</p>
        </div>
        <div className="rounded-2xl border border-zinc-900/10 bg-white/70 p-4">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">{t.offer.youRepay}</p>
          <p className="mt-1 text-2xl font-bold">{kes(offer.totalRepayable)}</p>
        </div>
      </div>

      <dl className="mt-3 rounded-2xl border border-zinc-900/10 bg-white/70 p-4 text-sm">
        <Line label={t.offer.interest} value={`${kes(offer.totalInterest)} · ${offer.interestRate}% ${offer.interestMethod}`} />
        <Line label={t.offer.repayments} value={`${offer.termCount} × ${unitWord(offer.termUnit, offer.termCount, t.offer)}`} />
        <Line label={t.offer.firstPayment} value={fullDay(offer.firstDueDate)} />
        <Line label={t.offer.fullyRepaidBy} value={fullDay(offer.expectedClearDate)} />
        <Line label={t.offer.validUntil} value={fullDay(offer.expiresAt)} />
      </dl>

      {/* Pay early, pay less — but only where that is true. */}
      <div className={`mt-3 rounded-2xl border p-3 text-xs ${offer.payEarly.applies ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-zinc-900/10 bg-white/60 text-zinc-600"}`}>
        {offer.payEarly.applies && offer.payEarly.savingKes > 0 && (
          <p className="font-semibold">{fmt(t.offer.saveHalf, { kes: kes(offer.payEarly.savingKes) })}</p>
        )}
        <p className={offer.payEarly.applies && offer.payEarly.savingKes > 0 ? "mt-0.5" : ""}>
          {t.offer.payEarlyNotes[offer.payEarly.note] ?? offer.payEarly.note}
        </p>
      </div>

      {/* Every installment, on the same screen. */}
      <div className="mt-3 overflow-hidden rounded-2xl border border-zinc-900/10 bg-white/70">
        <div className="max-h-56 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white/95 backdrop-blur">
              <tr className="text-left text-zinc-500">
                <th className="px-3 py-2 font-medium">{t.offer.seq}</th>
                <th className="px-3 py-2 font-medium">{t.offer.due}</th>
                <th className="px-3 py-2 text-right font-medium">{t.offer.principal}</th>
                <th className="px-3 py-2 text-right font-medium">{t.offer.interestCol}</th>
                <th className="px-3 py-2 text-right font-medium">{t.offer.total}</th>
              </tr>
            </thead>
            <tbody>
              {offer.schedule.map((r) => (
                <tr key={r.seq} className="border-t border-zinc-900/5">
                  <td className="px-3 py-2 text-zinc-400">{r.seq}</td>
                  <td className="px-3 py-2">{day(r.dueDate)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-500">{Math.round(r.principalDue).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-500">{Math.round(r.interestDue).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{Math.round(r.amountDue).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      <button
        onClick={startSigning}
        disabled={busy}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg px-5 py-3.5 text-sm font-semibold text-white disabled:opacity-60"
        style={{ backgroundColor: "var(--brand)" }}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
        {t.offer.acceptAndSign}
      </button>
      <button onClick={decline} disabled={busy} className="mt-2 w-full rounded-lg border border-zinc-900/15 bg-white/70 px-5 py-3 text-sm text-zinc-700 hover:bg-white disabled:opacity-60">
        {t.offer.noThanks}
      </button>

      <p className="mt-3 text-center text-[11px] text-zinc-500">
        {t.offer.codeNote}
      </p>
    </div>
  );
}

/** WEEK/MONTH/DAY → the word the borrower reads, pluralised per language. */
function unitWord(
  termUnit: string,
  count: number,
  o: { unitWeek: string; unitWeeks: string; unitMonth: string; unitMonths: string; unitDay: string; unitDays: string },
): string {
  const u = termUnit.toUpperCase();
  const many = count > 1;
  if (u.startsWith("WEEK")) return many ? o.unitWeeks : o.unitWeek;
  if (u.startsWith("MONTH")) return many ? o.unitMonths : o.unitMonth;
  if (u.startsWith("DAY")) return many ? o.unitDays : o.unitDay;
  return termUnit.toLowerCase();
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
