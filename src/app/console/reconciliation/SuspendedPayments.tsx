"use client";

// ─────────────────────────────────────────────────────────────────────────────
// SUSPENDED PAYMENTS — money that arrived, and stopped.
//
// A customer pays the paybill and types a reference. When that reference does
// not match an account the payment is not lost: it is parked in the lender's own
// `payments` table with isPosted = 2. On this server that bay holds thousands of
// payments and millions of shillings belonging to people who believe they have
// paid — and it stays that way until somebody says whose money it is.
//
// The screen is deliberately one motion: SEE the payment and what they typed →
// LOOK UP who the corrected reference belongs to, IN THIS BOOK → confirm the
// name → reconcile. Their pipeline does the rest; we never touch a balance.
//
// THE NAME IS THE POINT. ServiceSuite's own check answers this question with a
// count, unscoped by entity, and 3002 and 3005 hold different people on the same
// national IDs. So every match here is shown with its name, account, phone and
// open balance, and the entity it was found in is on the screen — an officer
// about to move somebody else's money should see whose money it becomes.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { useLoad } from "@/lib/hooks/useLoad";
import {
  Loader2, Search, AlertTriangle, CheckCircle2, Banknote, Lock, ArrowRight, UserRound, X,
} from "lucide-react";

type Txn = {
  id: number;
  transId: string;
  at: string | null;
  amount: number;
  shortCode: number | null;
  billRef: string | null;
  payerName: string | null;
  methodUsed: number | null;
};
type Match = {
  borrowerId: number;
  name: string | null;
  accountNo: string | null;
  phone: string | null;
  nationalId: string | null;
  openBalance: number;
};
type Bay = {
  available: boolean;
  message?: string;
  lender?: string;
  entityId?: number;
  txns?: Txn[];
  total?: number;
  value?: number;
  shortCodes?: number[];
  writes?: { armed: boolean | null; detail: string };
};

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export function SuspendedPayments() {
  const [bay, setBay] = useState<Bay | null>(null);
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openFor, setOpenFor] = useState<number | null>(null);

  const load = async (term = q) => {
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(`/api/console/reconciliation/suspended?q=${encodeURIComponent(term.trim())}`);
      const d = (await res.json()) as Bay & { success: boolean; message?: string };
      if (!d.success) {
        setBay({ available: true });
        setError(d.message || "Could not read the suspended payments.");
        return;
      }
      setBay(d);
    } catch {
      setBay({ available: true });
      setError("Could not read the suspended payments.");
    } finally {
      setSearching(false);
    }
  };
  useLoad(() => load(""));

  if (!bay) {
    return (
      <div className="glass mt-5 flex items-center gap-2 p-5 text-sm text-ash-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Reading the parking bay…
      </div>
    );
  }

  // A native lender has no ServiceSuite, so it has no parking bay. Say that,
  // rather than showing an empty list that reads as "nothing is stuck".
  if (!bay.available) {
    return (
      <div className="glass mt-5 p-8 text-center">
        <Banknote className="mx-auto h-8 w-8 text-ash-300" />
        <p className="mt-2 text-sm font-semibold">No parking bay to read</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-ash-500">{bay.message}</p>
      </div>
    );
  }

  const txns = bay.txns ?? [];
  const readOnly = bay.writes?.armed === false;

  return (
    <div className="mt-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="glass p-3.5">
          <p className="text-[10px] uppercase tracking-wide text-ash-500">Parked</p>
          <p className="mt-1 text-lg font-bold tabular-nums text-amber-700">{(bay.total ?? 0).toLocaleString()}</p>
        </div>
        <div className="glass p-3.5">
          <p className="text-[10px] uppercase tracking-wide text-ash-500">Value</p>
          <p className="mt-1 text-lg font-bold tabular-nums text-amber-700">{kes(bay.value ?? 0)}</p>
        </div>
        <div className="glass col-span-2 p-3.5 sm:col-span-1">
          <p className="text-[10px] uppercase tracking-wide text-ash-500">Paybills</p>
          <p className="mt-1 truncate text-sm font-semibold tabular-nums" title={(bay.shortCodes ?? []).join(", ")}>
            {(bay.shortCodes ?? []).join(" · ") || "—"}
          </p>
        </div>
      </div>

      {/* The bay is the LENDER'S, but a reference only ever resolves inside the
          book being worked. Both facts belong on the screen. */}
      <p className="mt-2 text-[11px] text-ash-400">
        {bay.lender ? `${bay.lender}'s paybills` : "The lender's paybills"} — shared across their books. A reference is
        matched only against entity {bay.entityId}, so money can only be moved to a customer in the book you are working.
      </p>

      {readOnly && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50/90 px-3 py-2.5 text-sm text-amber-800">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="font-semibold">Reconciling is switched off on this deployment.</span> {bay.writes?.detail} You
            can look references up — nothing below will move any money.
          </span>
        </div>
      )}
      {notice && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50/90 px-3 py-2.5 text-sm text-emerald-700">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {notice}
        </div>
      )}
      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      <div className="mt-4 flex gap-1.5">
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-ash-900/15 bg-paper px-2.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-ash-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void load()}
            placeholder="Find a payment — M-Pesa receipt, the reference they typed, or the payer's name"
            className="flex-1 bg-transparent py-2 text-sm outline-none"
          />
          {q && (
            <button onClick={() => { setQ(""); void load(""); }} className="text-ash-400 hover:text-ash-700" aria-label="Clear">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <button
          onClick={() => void load()}
          disabled={searching}
          className="inline-flex items-center gap-1.5 rounded-lg bg-invert px-4 py-2 text-xs font-semibold text-invert-fg hover:bg-invert-2 disabled:opacity-60"
        >
          {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} Search
        </button>
      </div>

      {txns.length === 0 ? (
        <div className="glass mt-4 p-8 text-center text-sm text-ash-500">
          {q.trim() ? "No suspended payment matches that." : "Nothing is parked — every payment found its account."}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {txns.map((t) => (
            <div key={t.id} className="glass p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-bold tabular-nums">{kes(t.amount)}</p>
                    <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Suspended</span>
                    {t.methodUsed === 2 && (
                      <span className="rounded-md bg-ash-900/5 px-2 py-0.5 text-[10px] font-semibold text-ash-500">Re-uploaded</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-ash-500">
                    {t.payerName || "Unnamed payer"} · {t.transId || "no receipt"} · {when(t.at)}
                    {t.shortCode ? ` · paybill ${t.shortCode}` : ""}
                  </p>
                  {/* The reference they typed is almost always the reason this
                      payment is here. It is the first thing an officer reads. */}
                  <p className="mt-1.5 text-[11px]">
                    <span className="text-ash-400">They typed</span>{" "}
                    <span className="rounded bg-ash-900/5 px-1.5 py-0.5 font-mono text-ash-700">{t.billRef || "nothing"}</span>
                  </p>
                </div>
                <button
                  onClick={() => setOpenFor(openFor === t.id ? null : t.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold text-white"
                  style={{ backgroundColor: "var(--brand)" }}
                >
                  <UserRound className="h-3.5 w-3.5" /> {openFor === t.id ? "Close" : "Whose is this?"}
                </button>
              </div>

              {openFor === t.id && (
                <ResolveOne
                  txn={t}
                  readOnly={readOnly}
                  entityId={bay.entityId}
                  lender={bay.lender}
                  onDone={async (msg) => {
                    setOpenFor(null);
                    setNotice(msg);
                    await load();
                  }}
                />
              )}
            </div>
          ))}
          {(bay.total ?? 0) > txns.length && (
            <p className="pt-1 text-center text-[11px] text-ash-400">
              Showing the newest {txns.length} of {(bay.total ?? 0).toLocaleString()}. Search to find an older one.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── One payment, from "who is this?" to "it is hers" ─────────────────────────

function ResolveOne({ txn, readOnly, entityId, lender, onDone }: {
  txn: Txn;
  readOnly: boolean;
  entityId?: number;
  lender?: string;
  onDone: (msg: string) => void;
}) {
  // NOT prefilled with what they typed. That value is the reason this payment is
  // parked; putting it in the box invites an officer to look it up, find
  // nothing, and lose faith in the screen.
  const [ref, setRef] = useState("");
  const [normalised, setNormalised] = useState<string | null>(null);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [busy, setBusy] = useState<"lookup" | "reconcile" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lookup = async () => {
    if (!ref.trim()) return;
    setBusy("lookup");
    setError(null);
    setMatches(null);
    try {
      const res = await fetch(`/api/console/reconciliation/suspended/lookup?ref=${encodeURIComponent(ref.trim())}`);
      const d = await res.json();
      if (!d.success) {
        setError(d.message || "Could not check that reference.");
        return;
      }
      setNormalised(d.billRef);
      setMatches(d.matches ?? []);
    } catch {
      setError("Could not check that reference.");
    } finally {
      setBusy(null);
    }
  };

  const reconcile = async (m: Match) => {
    setBusy("reconcile");
    setError(null);
    try {
      const res = await fetch("/api/console/reconciliation/suspended", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentId: txn.id,
          transId: txn.transId,
          billRef: normalised ?? ref.trim(),
          borrowerId: m.borrowerId,
          amountShown: txn.amount,
        }),
      });
      const d = await res.json();
      if (!d.success) {
        setError(d.message || "The lender's system refused the reconciliation.");
        return;
      }
      onDone(`${kes(txn.amount)} is now ${m.name ?? "the customer"}'s — their system will apply it to the loan.`);
    } catch {
      setError("Could not reconcile that payment.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-ash-900/10 bg-paper/70 p-3">
      <div className="flex gap-1.5">
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-ash-900/15 bg-paper px-2.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-ash-400" />
          <input
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void lookup()}
            placeholder="The correct account — phone, ID or account number"
            className="flex-1 bg-transparent py-2 text-xs outline-none"
            autoFocus
          />
        </div>
        <button
          onClick={() => void lookup()}
          disabled={!ref.trim() || busy !== null}
          className="rounded-lg bg-invert px-3 py-2 text-xs font-semibold text-invert-fg disabled:opacity-50"
        >
          {busy === "lookup" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Look up"}
        </button>
      </div>

      {normalised && normalised !== ref.trim() && (
        // Their rule: anything nine characters or longer is a phone, taken as the
        // last nine digits behind the dialling code. Showing it means nobody has
        // to wonder what was actually written to the payment.
        <p className="mt-1.5 text-[11px] text-ash-400">
          Will be written as <span className="font-mono text-ash-600">{normalised}</span>
        </p>
      )}

      {matches?.length === 0 && (
        <p className="mt-2 text-xs text-amber-700">
          Nobody in {lender ?? "this lender"}&apos;s book{entityId ? ` (entity ${entityId})` : ""} matches that. Check the
          number with the customer — nothing has been moved.
        </p>
      )}

      {matches && matches.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {matches.length > 1 && (
            <p className="text-[11px] font-semibold text-amber-700">
              {matches.length} customers match that reference. Pick the one whose money this is.
            </p>
          )}
          {matches.map((m) => (
            <div key={m.borrowerId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ash-900/10 bg-paper px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold">{m.name ?? `Customer ${m.borrowerId}`}</p>
                <p className="truncate text-[11px] text-ash-400">
                  {[m.accountNo && `acct ${m.accountNo}`, m.phone, m.nationalId && `ID ${m.nationalId}`].filter(Boolean).join(" · ")}
                </p>
                <p className="text-[11px] text-ash-500">Open balance {kes(m.openBalance)}</p>
              </div>
              <button
                onClick={() => void reconcile(m)}
                disabled={busy !== null || readOnly}
                title={readOnly ? "Writes are switched off on this deployment." : undefined}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: readOnly ? "#9AA0A6" : "var(--brand)" }}
              >
                {busy === "reconcile" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : readOnly ? <Lock className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
                Reconcile {kes(txn.amount)}
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="mt-2 text-[11px] text-red-600">{error}</p>}

      <p className="mt-2 text-[10px] leading-relaxed text-ash-400">
        Reconciling sets the reference on the payment and hands it back to the lender&apos;s posting job, which applies it
        to the loan and writes the statement. No balance is touched here.
      </p>
    </div>
  );
}
