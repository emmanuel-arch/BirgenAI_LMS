"use client";

// First-run setup checklist — shown on the console home while the org is
// PENDING. Walks a new lender through the exact steps that make them
// activatable (products, workflows, roles, team, vault) and ends with
// "Request activation", which surfaces on the founder's platform review queue.
import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, Loader2, Rocket, X } from "lucide-react";

export type ChecklistItem = {
  key: string;
  label: string;
  detail: string;
  href: string;
  done: boolean;
};

export default function SetupChecklist({
  items,
  canAct,
  activationRequestedAt,
}: {
  items: ChecklistItem[];
  /** settings.manage — may request activation / dismiss the card. */
  canAct: boolean;
  activationRequestedAt: string | null;
}) {
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [requestedAt, setRequestedAt] = useState(activationRequestedAt);
  const [error, setError] = useState<string | null>(null);

  if (hidden) return null;
  const doneCount = items.filter((i) => i.done).length;
  const allDone = doneCount === items.length;

  const act = async (action: "request-activation" | "dismiss") => {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/console/org/setup", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "That didn't work."); return; }
      if (action === "dismiss") setHidden(true);
      else setRequestedAt(new Date().toISOString());
    } catch { setError("That didn't work."); } finally { setBusy(false); }
  };

  return (
    <div className="glass mt-5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold flex items-center gap-1.5">
            <Rocket className="h-4 w-4" style={{ color: "var(--brand)" }} /> Set up your lending operation
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            {doneCount} of {items.length} done. Finish these and request activation — BirgenAI reviews and switches on live lending.
          </p>
        </div>
        {canAct && (
          <button type="button" onClick={() => act("dismiss")} disabled={busy} aria-label="Dismiss checklist"
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-900/5 hover:text-zinc-600">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <Link key={item.key} href={item.href}
            className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors ${
              item.done ? "border-emerald-200 bg-emerald-50/60" : "border-zinc-900/10 bg-white/70 hover:bg-white"
            }`}>
            {item.done
              ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-300" />}
            <span>
              <span className={`block text-[13px] font-medium ${item.done ? "text-emerald-800" : "text-zinc-800"}`}>{item.label}</span>
              <span className="block text-[11px] text-zinc-500">{item.detail}</span>
            </span>
          </Link>
        ))}
      </div>

      {error && <p className="mt-3 text-[11px] text-red-600">{error}</p>}

      <div className="mt-4 flex items-center gap-3">
        {requestedAt ? (
          <p className="text-[12px] font-medium text-emerald-700">
            ✓ Activation requested {new Date(requestedAt).toLocaleDateString()} — BirgenAI is reviewing your setup.
          </p>
        ) : canAct ? (
          <>
            <button type="button" onClick={() => act("request-activation")} disabled={busy || !allDone}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: "var(--brand)" }}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
              Request activation
            </button>
            {!allDone && <p className="text-[11px] text-zinc-400">Complete the steps above first.</p>}
          </>
        ) : (
          <p className="text-[11px] text-zinc-400">Your administrator requests activation once setup is complete.</p>
        )}
      </div>
    </div>
  );
}
