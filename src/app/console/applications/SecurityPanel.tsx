"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck, Users, Package, Plus, Check, X, Clock, AlertTriangle } from "lucide-react";

// Guarantors and collateral, where the officer can act on them.
//
// Booking now refuses a product that demands a guarantor and hasn't got one, so this
// panel has to say plainly which of the four problems the officer has: nobody asked,
// asked and silent, asked and declined, or consented to terms that have since moved.

type Guarantor = {
  id: string; fullName: string; phone: string; relationship: string | null;
  status: "INVITED" | "CONSENTED" | "DECLINED" | "EXPIRED"; stale: boolean;
  consentedAt: string | null; amountGuaranteed: number | null;
};
type Collateral = {
  id: string; kind: string; description: string; estimatedValueKes: number;
  registrationRef: string | null; status: string; rejectedReason: string | null;
};
type Security = {
  required: boolean; coverPct: number; requiredValue: number;
  verifiedValue: number; pledgedValue: number; ok: boolean; shortfall: string | null;
};
type Data = {
  guarantorRequired: boolean; hasStandingGuarantor: boolean; hasOffer: boolean;
  guarantors: Guarantor[]; collateral: Collateral[]; security: Security | null;
};

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const KINDS = ["VEHICLE", "LAND", "EQUIPMENT", "STOCK", "CHATTEL", "OTHER"];

const G_TONE: Record<Guarantor["status"], string> = {
  CONSENTED: "bg-emerald-100 text-emerald-700",
  INVITED: "bg-sky-100 text-sky-700",
  DECLINED: "bg-rose-100 text-rose-700",
  EXPIRED: "bg-amber-100 text-amber-700",
};
const C_TONE: Record<string, string> = {
  VERIFIED: "bg-emerald-100 text-emerald-700",
  REGISTERED: "bg-sky-100 text-sky-700",
  REJECTED: "bg-rose-100 text-rose-700",
  RELEASED: "bg-zinc-900/5 text-zinc-500",
  SEIZED: "bg-zinc-900/10 text-zinc-700",
};

export function SecurityPanel({ applicationId, onChanged }: { applicationId: string; onChanged?: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [addingG, setAddingG] = useState(false);
  const [addingC, setAddingC] = useState(false);
  const [g, setG] = useState({ fullName: "", phone: "", relationship: "" });
  const [c, setC] = useState({ kind: "VEHICLE", description: "", estimatedValueKes: "", registrationRef: "" });

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/console/applications/${applicationId}/security`);
      const d = await res.json();
      if (d.success) setData(d);
    } catch { /* leave */ }
  }, [applicationId]);

  useEffect(() => { void load(); }, [load]);

  const post = async (body: Record<string, unknown>) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch(`/api/console/applications/${applicationId}/security`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!d.success) { setError(d.message || "That didn't work."); return null; }
      if (d.message) setNotice(d.message);
      await load(); onChanged?.();
      return d;
    } catch { setError("That didn't work."); return null; } finally { setBusy(false); }
  };

  if (!data) return null;
  // Nothing to show for a product that asks for neither.
  if (!data.guarantorRequired && !data.security?.required && data.guarantors.length === 0 && data.collateral.length === 0) return null;

  return (
    <div className="mt-3 rounded-xl border border-zinc-900/10 bg-white/60 p-3">
      {/* Guarantors */}
      {(data.guarantorRequired || data.guarantors.length > 0) && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold">
              <Users className="h-3.5 w-3.5 text-zinc-400" /> Guarantors
              {data.guarantorRequired && <span className="text-[10px] font-normal text-zinc-400">required by this product</span>}
            </p>
            {data.guarantorRequired && (
              <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold ${data.hasStandingGuarantor ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                {data.hasStandingGuarantor ? <><Check className="h-3 w-3" /> Covered</> : <><Clock className="h-3 w-3" /> Not yet covered</>}
              </span>
            )}
          </div>

          {!data.hasOffer && data.guarantorRequired && (
            <p className="mt-1.5 text-[11px] text-zinc-500">Issue the offer first — nobody can guarantee an agreement that does not exist yet.</p>
          )}

          <div className="mt-2 space-y-1.5">
            {data.guarantors.map((x) => (
              <div key={x.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/70 px-2.5 py-1.5">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{x.fullName} <span className="font-normal text-zinc-400">{x.phone}</span></p>
                  <p className="text-[10px] text-zinc-400">
                    {x.relationship ?? "guarantor"}
                    {x.amountGuaranteed ? ` · stands behind ${kes(x.amountGuaranteed)}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {x.stale && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700" title="They agreed to terms that have since changed">
                      <AlertTriangle className="h-3 w-3" /> Agreed to older terms
                    </span>
                  )}
                  <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${G_TONE[x.status]}`}>{x.status.toLowerCase()}</span>
                  {x.status !== "CONSENTED" && (
                    <button onClick={() => post({ action: "remove-guarantor", guarantorId: x.id })} disabled={busy}
                      className="rounded p-1 text-zinc-400 hover:bg-zinc-900/5 hover:text-zinc-700" title="Withdraw the request">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {addingG ? (
            <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
              <input value={g.fullName} onChange={(e) => setG({ ...g, fullName: e.target.value })} placeholder="Their full name"
                className="rounded-lg border border-zinc-900/15 bg-white px-2.5 py-1.5 text-xs outline-none" />
              <input value={g.phone} onChange={(e) => setG({ ...g, phone: e.target.value })} placeholder="07XX XXX XXX" inputMode="tel"
                className="rounded-lg border border-zinc-900/15 bg-white px-2.5 py-1.5 text-xs outline-none" />
              <input value={g.relationship} onChange={(e) => setG({ ...g, relationship: e.target.value })} placeholder="Relationship"
                className="rounded-lg border border-zinc-900/15 bg-white px-2.5 py-1.5 text-xs outline-none" />
              <div className="flex gap-1.5 sm:col-span-3">
                <button disabled={busy || !g.fullName || !g.phone}
                  onClick={async () => { if (await post({ action: "invite-guarantor", ...g })) { setAddingG(false); setG({ fullName: "", phone: "", relationship: "" }); } }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Send the request
                </button>
                <button onClick={() => setAddingG(false)} className="px-2 text-xs text-zinc-500 hover:text-zinc-800">Cancel</button>
              </div>
              <p className="text-[10px] text-zinc-400 sm:col-span-3">They get an SMS. Only they can agree — you cannot agree for them.</p>
            </div>
          ) : (
            <button onClick={() => setAddingG(true)}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-zinc-900/15 bg-white/70 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 hover:bg-white">
              <Plus className="h-3 w-3" /> Ask someone to guarantee
            </button>
          )}
        </>
      )}

      {/* Collateral */}
      {(data.security?.required || data.collateral.length > 0) && (
        <div className={data.guarantorRequired || data.guarantors.length > 0 ? "mt-4 border-t border-zinc-900/5 pt-3" : ""}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold">
              <Package className="h-3.5 w-3.5 text-zinc-400" /> Security
              {data.security?.required && (
                <span className="text-[10px] font-normal text-zinc-400">
                  {data.security.coverPct}% of principal · {kes(data.security.requiredValue)} needed
                </span>
              )}
            </p>
            {data.security?.required && (
              <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold ${data.security.ok ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                <ShieldCheck className="h-3 w-3" /> {kes(data.security.verifiedValue)} verified
              </span>
            )}
          </div>

          {data.security?.shortfall && <p className="mt-1.5 text-[11px] text-amber-700">{data.security.shortfall}</p>}

          <div className="mt-2 space-y-1.5">
            {data.collateral.map((x) => (
              <div key={x.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/70 px-2.5 py-1.5">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{x.description} <span className="font-normal text-zinc-400">{kes(x.estimatedValueKes)}</span></p>
                  <p className="text-[10px] text-zinc-400">
                    {x.kind.toLowerCase()}{x.registrationRef ? ` · ${x.registrationRef}` : ""}
                    {x.rejectedReason ? ` · ${x.rejectedReason}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${C_TONE[x.status] ?? ""}`}>{x.status.toLowerCase()}</span>
                  {x.status === "REGISTERED" && (
                    <>
                      <button onClick={() => post({ action: "verify-collateral", collateralId: x.id })} disabled={busy}
                        title="You have seen it" className="rounded p-1 text-emerald-600 hover:bg-emerald-50"><Check className="h-3 w-3" /></button>
                      <button onClick={() => { const reason = prompt("Why are you rejecting it?"); if (reason) void post({ action: "reject-collateral", collateralId: x.id, reason }); }}
                        disabled={busy} title="Reject it" className="rounded p-1 text-rose-600 hover:bg-rose-50"><X className="h-3 w-3" /></button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          {addingC ? (
            <div className="mt-2 grid gap-1.5 sm:grid-cols-4">
              <select value={c.kind} onChange={(e) => setC({ ...c, kind: e.target.value })}
                className="rounded-lg border border-zinc-900/15 bg-white px-2.5 py-1.5 text-xs outline-none">
                {KINDS.map((k) => <option key={k} value={k}>{k.toLowerCase()}</option>)}
              </select>
              <input value={c.description} onChange={(e) => setC({ ...c, description: e.target.value })} placeholder="What it is"
                className="rounded-lg border border-zinc-900/15 bg-white px-2.5 py-1.5 text-xs outline-none sm:col-span-2" />
              <input value={c.estimatedValueKes} onChange={(e) => setC({ ...c, estimatedValueKes: e.target.value.replace(/\D/g, "") })} placeholder="Worth (KES)" inputMode="numeric"
                className="rounded-lg border border-zinc-900/15 bg-white px-2.5 py-1.5 text-xs outline-none" />
              <input value={c.registrationRef} onChange={(e) => setC({ ...c, registrationRef: e.target.value })} placeholder="Logbook / title / serial"
                className="rounded-lg border border-zinc-900/15 bg-white px-2.5 py-1.5 text-xs outline-none sm:col-span-2" />
              <div className="flex gap-1.5 sm:col-span-2">
                <button disabled={busy || !c.description || !c.estimatedValueKes}
                  onClick={async () => { if (await post({ action: "add-collateral", ...c, estimatedValueKes: Number(c.estimatedValueKes) })) { setAddingC(false); setC({ kind: "VEHICLE", description: "", estimatedValueKes: "", registrationRef: "" }); } }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Register it
                </button>
                <button onClick={() => setAddingC(false)} className="px-2 text-xs text-zinc-500 hover:text-zinc-800">Cancel</button>
              </div>
              <p className="text-[10px] text-zinc-400 sm:col-span-4">Registering records a claim. Only verified security counts — somebody has to see it.</p>
            </div>
          ) : (
            <button onClick={() => setAddingC(true)}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-zinc-900/15 bg-white/70 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 hover:bg-white">
              <Plus className="h-3 w-3" /> Pledge security
            </button>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {notice && <p className="mt-2 text-xs text-emerald-700">{notice}</p>}
    </div>
  );
}
