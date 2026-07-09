"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, FileText, CheckCircle2, Clock, XCircle, Send, Store } from "lucide-react";

// Where the officer sees the credit agreement and its signature.
//
// This panel exists because booking now refuses an unsigned offer. Without it the
// queue would dead-end: an officer approves, the loan will not book, and nothing on
// screen explains why. So the state of the agreement is shown next to the decision.

type Offer = {
  id: string; status: "OFFERED" | "ACCEPTED" | "DECLINED" | "EXPIRED";
  principal: number; totalRepayable: number; totalInterest: number;
  interestRate: number; interestMethod: string; termCount: number; termUnit: string;
  expectedClearDate: string; expiresAt: string; acceptedAt: string | null;
  channel: "PORTAL" | "BRANCH" | null; termsHash: string; branchNote: string | null;
};

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

const TONE: Record<Offer["status"], { cls: string; icon: typeof Clock; label: string }> = {
  OFFERED: { cls: "bg-sky-100 text-sky-700", icon: Clock, label: "Awaiting the borrower's signature" },
  ACCEPTED: { cls: "bg-emerald-100 text-emerald-700", icon: CheckCircle2, label: "Signed" },
  DECLINED: { cls: "bg-rose-100 text-rose-700", icon: XCircle, label: "Declined by the borrower" },
  EXPIRED: { cls: "bg-amber-100 text-amber-700", icon: Clock, label: "Expired unsigned" },
};

export function OfferPanel({ applicationId, onChanged }: { applicationId: string; onChanged?: () => void }) {
  const [offer, setOffer] = useState<Offer | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [branchNote, setBranchNote] = useState("");
  const [recording, setRecording] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/console/applications/${applicationId}/offer`);
      const d = await res.json();
      if (d.success) setOffer(d.offer);
    } catch { /* leave empty */ } finally { setLoaded(true); }
  }, [applicationId]);

  useEffect(() => { void load(); }, [load]);

  const post = async (body: Record<string, unknown>) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/console/applications/${applicationId}/offer`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!d.success) { setError(d.message || "That didn't work."); return false; }
      await load();
      onChanged?.();
      return true;
    } catch { setError("That didn't work."); return false; } finally { setBusy(false); }
  };

  if (!loaded) return <div className="py-3"><Loader2 className="h-4 w-4 animate-spin text-zinc-400" /></div>;

  if (!offer) {
    return (
      <div className="mt-3 rounded-xl border border-zinc-900/10 bg-white/60 p-3">
        <p className="text-xs text-zinc-500">
          No offer has been made. A loan cannot be booked until the borrower agrees to its terms.
        </p>
        <button onClick={() => post({ action: "issue" })} disabled={busy}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Issue offer
        </button>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  const tone = TONE[offer.status];
  const Icon = tone.icon;

  return (
    <div className="mt-3 rounded-xl border border-zinc-900/10 bg-white/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold">
          <FileText className="h-3.5 w-3.5 text-zinc-400" /> Credit agreement
        </p>
        <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold ${tone.cls}`}>
          <Icon className="h-3 w-3" /> {tone.label}
        </span>
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <Item label="Principal" value={kes(offer.principal)} />
        <Item label="Repayable" value={kes(offer.totalRepayable)} />
        <Item label="Terms" value={`${offer.termCount} × ${offer.termUnit} · ${offer.interestRate}% ${offer.interestMethod}`} />
        <Item label="Cleared by" value={day(offer.expectedClearDate)} />
      </dl>

      {offer.status === "ACCEPTED" && (
        <p className="mt-2 text-[11px] text-zinc-500">
          Signed {offer.acceptedAt ? day(offer.acceptedAt) : ""} {offer.channel === "PORTAL" ? "by the borrower, with a code sent to their phone" : "in person, recorded by staff"}
          {offer.branchNote ? ` — “${offer.branchNote}”` : ""}. Reference <span className="font-mono">{offer.termsHash.slice(0, 12)}</span>.
        </p>
      )}

      {offer.status === "OFFERED" && (
        <>
          <p className="mt-2 text-[11px] text-zinc-500">Valid until {day(offer.expiresAt)}. The borrower signs it in the portal.</p>
          {!recording ? (
            <button onClick={() => setRecording(true)} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-zinc-900/15 bg-white/70 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-white">
              <Store className="h-3.5 w-3.5" /> They signed in branch
            </button>
          ) : (
            <div className="mt-2">
              <input
                value={branchNote}
                onChange={(e) => setBranchNote(e.target.value)}
                placeholder="Where they signed, and what identification you saw"
                className="w-full rounded-lg border border-zinc-900/15 bg-white px-3 py-2 text-xs outline-none focus:border-zinc-400"
              />
              <p className="mt-1 text-[10px] text-zinc-400">This note is the evidence. It is recorded against your name.</p>
              <div className="mt-2 flex gap-2">
                <button
                  disabled={busy || branchNote.trim().length < 8}
                  onClick={async () => { if (await post({ action: "record-branch-acceptance", note: branchNote })) setRecording(false); }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-40">
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Record acceptance
                </button>
                <button onClick={() => setRecording(false)} className="rounded-lg px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-800">Cancel</button>
              </div>
            </div>
          )}
        </>
      )}

      {(offer.status === "EXPIRED" || offer.status === "DECLINED") && (
        <button onClick={() => post({ action: "issue" })} disabled={busy}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Issue a new offer
        </button>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-zinc-400">{label}</dt>
      <dd className="font-medium text-zinc-800">{value}</dd>
    </div>
  );
}
