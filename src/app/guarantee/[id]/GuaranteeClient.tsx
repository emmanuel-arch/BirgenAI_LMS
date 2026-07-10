"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck, AlertTriangle, CheckCircle2, HandCoins, FlaskConical } from "lucide-react";

type Agreement = {
  principal: number; totalRepayable: number; termCount: number; termUnit: string;
  firstDueDate: string; expectedClearDate: string; borrowerSigned: boolean;
};
type Guarantee = {
  id: string; status: "INVITED" | "CONSENTED" | "DECLINED" | "EXPIRED";
  lender: string; yourName: string; yourPhone: string; borrowerFirstName: string;
  relationship: string | null; expiresAt: string; consentedAt: string | null;
  agreement: Agreement | null;
};

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export function GuaranteeClient({ id }: { id: string }) {
  const [g, setG] = useState<Guarantee | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signing, setSigning] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/guarantee/${id}`);
      const d = await res.json();
      if (!d.success) { setError(d.message || "This request could not be found."); return; }
      setG(d.guarantee);
    } catch { setError("This request could not be found."); } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const post = async (body: Record<string, unknown>) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/portal/guarantee/${id}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!d.success) { setError(d.message || "That didn't work."); return null; }
      return d;
    } catch { setError("That didn't work."); return null; } finally { setBusy(false); }
  };

  const start = async () => {
    const d = await post({ action: "request-code" });
    if (d) { setDevCode(d.devCode ?? null); setSigning(true); }
  };
  const consent = async () => {
    const d = await post({ action: "consent", code });
    if (d) { setSigning(false); await load(); }
  };
  const decline = async () => {
    if (!confirm("Decline this request? The lender will be told.")) return;
    const d = await post({ action: "decline" });
    if (d) await load();
  };

  if (loading) return <Shell><div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div></Shell>;

  if (!g) {
    return (
      <Shell>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-center">
          <AlertTriangle className="mx-auto h-7 w-7 text-amber-600" />
          <p className="mt-2 text-sm text-amber-900">{error ?? "This request could not be found."}</p>
        </div>
      </Shell>
    );
  }

  if (g.status === "CONSENTED") {
    return (
      <Shell>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
          <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-600" />
          <h1 className="mt-3 text-lg font-bold text-emerald-900">You agreed to guarantee this loan</h1>
          {g.agreement && (
            <p className="mt-1.5 text-xs text-emerald-800">
              {kes(g.agreement.principal)} to {g.borrowerFirstName}, repayable {kes(g.agreement.totalRepayable)} by {day(g.agreement.expectedClearDate)}.
            </p>
          )}
          <p className="mt-3 text-[11px] text-emerald-700">
            If {g.borrowerFirstName} does not repay, {g.lender} may ask you to. Keep this message.
          </p>
        </div>
      </Shell>
    );
  }

  if (g.status !== "INVITED") {
    return (
      <Shell>
        <div className="rounded-2xl border border-zinc-900/10 bg-white/70 p-6 text-center text-sm text-zinc-600">
          {g.status === "DECLINED" ? "You declined this request." : "This request has expired."}
        </div>
      </Shell>
    );
  }

  if (!g.agreement) {
    return (
      <Shell>
        <div className="rounded-2xl border border-zinc-900/10 bg-white/70 p-6 text-center text-sm text-zinc-600">
          {g.borrowerFirstName} has not finished their application yet. {g.lender} will text you again when there is
          something to read.
        </div>
      </Shell>
    );
  }

  if (signing) {
    return (
      <Shell>
        <div className="rounded-2xl border border-zinc-900/10 bg-white/70 p-5 text-center">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">You are guaranteeing</p>
          <p className="mt-1 text-2xl font-bold">{kes(g.agreement.principal)}</p>
          <p className="text-xs text-zinc-500">for {g.borrowerFirstName}</p>
        </div>
        {devCode && (
          <p className="mt-3 flex items-center justify-center gap-1.5 rounded-lg bg-amber-100 px-3 py-2 text-[11px] font-semibold text-amber-800">
            <FlaskConical className="h-3 w-3" /> NO SMS PROVIDER — your code is {devCode}
          </p>
        )}
        <p className="mt-4 text-center text-sm text-zinc-600">Enter the code we sent to {g.yourPhone}.</p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          className="mx-auto mt-2 block w-40 rounded-xl border border-zinc-900/15 bg-white px-3 py-3 text-center text-2xl tracking-[0.4em] tabular-nums outline-none focus:border-zinc-400"
        />
        <p className="mt-3 text-center text-[11px] text-zinc-500">
          Entering this code makes you liable for this loan if {g.borrowerFirstName} does not repay it.
        </p>
        {error && <p className="mt-2 text-center text-xs text-red-600">{error}</p>}
        <button onClick={consent} disabled={busy || code.length !== 6}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 py-3.5 text-sm font-semibold text-white disabled:opacity-40">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} I agree to guarantee this loan
        </button>
        <button onClick={() => setSigning(false)} className="mt-2 w-full py-2 text-xs text-zinc-500 hover:text-zinc-800">
          Go back
        </button>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-900/5">
          <HandCoins className="h-7 w-7 text-zinc-500" />
        </div>
        <h1 className="mt-3 text-xl font-bold">{g.borrowerFirstName} has asked you to guarantee a loan</h1>
        <p className="mt-1.5 text-sm text-zinc-500">
          From {g.lender}. You were named as {g.relationship ? `their ${g.relationship}` : "a guarantor"}.
        </p>
      </div>

      {/* What it means, before what it is. */}
      <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-semibold text-amber-900">If {g.borrowerFirstName} does not repay, you will be asked to.</p>
        <p className="mt-1 text-xs text-amber-800">
          That is what guaranteeing means. Only agree if you are willing and able to pay {kes(g.agreement.totalRepayable)}.
        </p>
      </div>

      <dl className="mt-4 rounded-2xl border border-zinc-900/10 bg-white/70 p-4 text-sm">
        <Row label="They receive" value={kes(g.agreement.principal)} />
        <Row label="They repay" value={kes(g.agreement.totalRepayable)} />
        <Row label="Over" value={`${g.agreement.termCount} ${g.agreement.termUnit}${g.agreement.termCount > 1 ? "s" : ""}`} />
        <Row label="First payment" value={day(g.agreement.firstDueDate)} />
        <Row label="Fully repaid by" value={day(g.agreement.expectedClearDate)} />
        <Row label="You are" value={g.yourName} />
      </dl>

      {!g.agreement.borrowerSigned && (
        <p className="mt-3 text-center text-[11px] text-zinc-500">
          {g.borrowerFirstName} has not signed this agreement yet. You can still decide now.
        </p>
      )}

      {error && <p className="mt-3 text-center text-xs text-red-600">{error}</p>}

      {/* Two buttons of equal weight. "No" is not a link buried in grey text. */}
      <button onClick={start} disabled={busy}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 py-3.5 text-sm font-semibold text-white disabled:opacity-50">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Yes, I will guarantee it
      </button>
      <button onClick={decline} disabled={busy}
        className="mt-2 w-full rounded-xl border border-zinc-900/15 bg-white py-3.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">
        No, I will not
      </button>

      <p className="mt-4 text-center text-[11px] text-zinc-400">
        This request expires on {day(g.expiresAt)}. Nobody can agree on your behalf.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-zinc-50 text-zinc-900">
      <main className="mx-auto max-w-md px-4 py-10">{children}</main>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
