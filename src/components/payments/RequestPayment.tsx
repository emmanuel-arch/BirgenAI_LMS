"use client";

// ─────────────────────────────────────────────────────────────────────────────
// REQUEST PAYMENT — one button, every surface.
//
// Drop it on the Customer-360, in the collections work queue beside a name an agent
// is about to ring, at the counter next to a walk-in, in Field Ops at a customer's
// shop. It always shows the SAME truth for the same customer — what they owe, and
// what fees are outstanding — because all of them read one endpoint
// (/api/console/payments/request) which reads one catalogue.
//
// WHAT IT DELIBERATELY DOES NOT DO: let anyone type the amount for a fee, or type the
// phone number. The price of a registration fee is the lender's decision, not the
// officer's, and the number the prompt goes to is the customer's REGISTERED number —
// otherwise an officer could send the prompt to their own handset, pay KES 100
// themselves, and mark the customer as having paid.
//
// A custom amount IS allowed, because a customer who offers KES 500 against a KES
// 2,000 installment is a real thing that happens on a doorstep. It is recorded as
// CUSTOM, it carries a note, and it is audited under the officer's name.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useState } from "react";
import { Loader2, Smartphone, AlertTriangle, CheckCircle2, X, Landmark, Building2 } from "lucide-react";
import { useLoad } from "@/lib/hooks/useLoad";

type Askable = {
  kind: "charge" | "installment";
  id: string;
  label: string;
  sublabel: string;
  amount: number;
  beneficiary: "LENDER" | "PLATFORM";
  loanId?: string;
};

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;

export function RequestPaymentButton({
  borrowerId,
  borrowerName,
  channel,
  className,
  label = "Request payment",
  icon,
  onSent,
}: {
  borrowerId: string;
  borrowerName?: string | null;
  /** c360 | collections | counter | field */
  channel: string;
  className?: string;
  label?: string;
  /** Overrides the default phone glyph where a surface wants a payment-first read. */
  icon?: React.ReactNode;
  onSent?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={className ?? "inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"}
      >
        {icon ?? <Smartphone className="h-3.5 w-3.5" />} {label}
      </button>
      {open && (
        <RequestPaymentModal
          borrowerId={borrowerId}
          borrowerName={borrowerName}
          channel={channel}
          onClose={() => setOpen(false)}
          onSent={onSent}
        />
      )}
    </>
  );
}

export function RequestPaymentModal({
  borrowerId,
  borrowerName,
  channel,
  onClose,
  onSent,
}: {
  borrowerId: string;
  borrowerName?: string | null;
  channel: string;
  onClose: () => void;
  onSent?: () => void;
}) {
  const [askables, setAskables] = useState<Askable[] | null>(null);
  const [picked, setPicked] = useState<Askable | null>(null);
  const [custom, setCustom] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/console/payments/request?borrowerId=${borrowerId}`);
      const d = await res.json();
      if (!d.success) { setError(d.message ?? "Could not load."); return; }
      setAskables(d.askables ?? []);
    } catch { setError("Could not reach the server."); }
  }, [borrowerId]);

  useLoad(load);

  const send = async (body: Record<string, unknown>) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/console/payments/request", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ borrowerId, channel, ...body }),
      });
      const d = await res.json();
      if (!d.success) { setError(d.message ?? "The request did not go out."); return; }
      setSent(d.message);
      onSent?.();
    } catch { setError("Could not reach the server."); } finally { setBusy(false); }
  };

  const sendAskable = (a: Askable) =>
    send(
      a.kind === "charge"
        ? { purpose: "CHARGE", chargeId: a.id, loanId: a.loanId }
        : { purpose: "INSTALLMENT", loanId: a.loanId },
    );

  const sendCustom = () =>
    send({
      purpose: "CUSTOM",
      amount: Number(custom),
      loanId: askables?.find((a) => a.kind === "installment")?.loanId,
      note: note.trim() || undefined,
    });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 backdrop-blur-sm sm:items-center"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-3xl border border-zinc-900/10 bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold">
              <Smartphone className="h-4 w-4" style={{ color: "var(--brand)" }} /> Request payment
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              An M-Pesa prompt goes to {borrowerName ? <span className="font-semibold text-zinc-700">{borrowerName}</span> : "the customer"} on their
              registered number.
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-900/5 hover:text-zinc-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2 text-xs text-red-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
          </p>
        )}

        {sent ? (
          <div className="mt-5 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100">
              <CheckCircle2 className="h-6 w-6 text-emerald-600" />
            </div>
            <p className="mt-3 text-sm font-semibold text-zinc-800">{sent}</p>
            <p className="mt-1 text-[11px] text-zinc-500">
              Nothing is paid until they enter their PIN. The receipt lands on their record by itself.
            </p>
            <button onClick={onClose} className="mt-4 rounded-lg px-5 py-2.5 text-sm font-semibold text-white" style={{ backgroundColor: "var(--brand)" }}>
              Done
            </button>
          </div>
        ) : (
          <>
            {!askables && !error && (
              <p className="mt-4 flex items-center gap-2 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Working out what they owe…
              </p>
            )}

            {askables && (
              <div className="mt-4 space-y-1.5">
                {askables.length === 0 && (
                  <p className="rounded-lg bg-zinc-900/5 px-3 py-2.5 text-xs text-zinc-500">
                    Nothing outstanding, and no fees set up. You can still ask for a custom amount below.
                  </p>
                )}
                {askables.map((a) => (
                  <button
                    key={`${a.kind}:${a.id}`}
                    disabled={busy}
                    onClick={() => { setPicked(a); sendAskable(a); }}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-zinc-900/10 bg-white/70 px-3 py-2.5 text-left transition-colors hover:bg-white disabled:opacity-50"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-[13px] font-semibold text-zinc-800">
                        {a.kind === "charge"
                          ? <Building2 className="h-3.5 w-3.5 text-zinc-400" />
                          : <Landmark className="h-3.5 w-3.5 text-zinc-400" />}
                        {a.label}
                        {/* Whose money this becomes. A lender is entitled to know which of
                            these fees is theirs and which is ours. */}
                        {a.beneficiary === "PLATFORM" && (
                          <span className="rounded bg-violet-100 px-1 py-0.5 text-[9px] font-bold uppercase text-violet-700">BirgenAI</span>
                        )}
                      </span>
                      <span className="block truncate text-[11px] text-zinc-500">{a.sublabel}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 text-sm font-bold text-zinc-800">
                      {busy && picked?.id === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      {kes(a.amount)}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* A doorstep part-payment. Real, and it must not be forced through a fee. */}
            <div className="mt-4 border-t border-zinc-900/10 pt-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Or a custom amount</p>
              <div className="mt-1.5 flex gap-2">
                <input
                  className="w-32 rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2 text-sm outline-none"
                  inputMode="numeric" placeholder="KES" value={custom}
                  onChange={(e) => setCustom(e.target.value.replace(/\D/g, ""))}
                />
                <input
                  className="min-w-0 flex-1 rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2 text-sm outline-none"
                  placeholder="What is it for?" value={note} onChange={(e) => setNote(e.target.value)}
                />
                <button
                  onClick={sendCustom}
                  disabled={busy || !(Number(custom) > 0)}
                  className="shrink-0 rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
                >
                  {busy && !picked ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Send"}
                </button>
              </div>
              <p className="mt-1 text-[10px] text-zinc-400">Recorded under your name, and applied to their loan if they have one.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
