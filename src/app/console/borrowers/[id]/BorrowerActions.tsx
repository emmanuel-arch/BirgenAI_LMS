"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE ACTION BAR — the three things an officer does TO a customer, side by side,
// at the top of the page where they can be reached without hunting.
//
// This replaces two scattered sets of buttons. "Request payment" sat in the header
// while a SECOND "Request payment" sat further down under the CRB panel, on a
// different endpoint — the old bespoke /api/console/loans/[id]/stk rather than the
// one payment spine. Two buttons with the same name doing different things on one
// page is how an officer learns not to trust either. There is now one, and it is the
// spine's (src/components/payments/RequestPayment.tsx).
//
// The kebab in the card's top-right stays what it is: everything an officer may
// CHANGE. This bar is what they DO. Change opens a drawer, do happens here.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { HandCoins, Navigation, BotMessageSquare, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { RequestPaymentButton } from "@/components/payments/RequestPayment";
import { askRiriAbout, type RiriSubject } from "@/lib/riri/subject";

export function BorrowerActions({
  borrowerId, name, lat, lng, fieldEntitled, subject,
}: {
  borrowerId: string;
  name: string;
  lat: number | null;
  lng: number | null;
  /** Dispatch allocates the nearest officer — that is the route planner, so it is gated. */
  fieldEntitled: boolean;
  /** What Riri should be told she is looking at. Server-built; see lib/riri/subject.ts. */
  subject: RiriSubject;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const hasGeo = lat != null && lng != null;

  const dispatch = async () => {
    if (!hasGeo) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/console/field", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: `Visit — ${name}`, lat, lng, kind: "COLLECTION_VISIT", borrowerId }),
      });
      const d = await res.json();
      const a = d.allocation;
      setResult({
        ok: !!d.success,
        msg: d.success
          ? a
            ? `Assigned to ${a.agentName} · ${typeof a.distanceKm === "number" ? a.distanceKm.toFixed(1) : a.distanceKm} km away`
            : "Queued — no field agent is available right now"
          : d.message || "Could not dispatch",
      });
    } catch {
      setResult({ ok: false, msg: "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  };

  const BTN = "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-semibold transition-colors disabled:opacity-40";

  return (
    <div className="flex flex-col items-stretch gap-1.5 sm:items-start">
      <div className="flex flex-wrap items-center gap-2">
        {/* Asking for money is the primary act — one road, one catalogue, one price. */}
        <RequestPaymentButton
          borrowerId={borrowerId}
          borrowerName={name}
          channel="c360"
          label="Request payment"
          className={`${BTN} bg-emerald-600 text-white hover:bg-emerald-700`}
          icon={<HandCoins className="h-3.5 w-3.5" />}
        />

        {/* Sending a human costs a human's day, so it is only offered when there is
            somewhere to send them AND the lender is on a plan that plans routes. */}
        {fieldEntitled && (
          <button
            onClick={dispatch}
            disabled={busy || !hasGeo}
            title={hasGeo ? `Send the nearest agent to ${name}` : "No pin on file — drop their location first"}
            className={`${BTN} bg-zinc-900/[0.06] text-zinc-700 hover:bg-zinc-900/10`}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Navigation className="h-3.5 w-3.5" />}
            Dispatch agent
          </button>
        )}

        {/* Riri arrives already knowing who is asking and who they are looking at —
            the officer should never have to introduce the customer to her. */}
        <button
          onClick={() => askRiriAbout(subject)}
          className={`${BTN} border border-zinc-900/10 bg-white/70 text-zinc-700 hover:text-zinc-900`}
        >
          <BotMessageSquare className="h-3.5 w-3.5" style={{ color: "var(--brand)" }} />
          Ask Riri
        </button>
      </div>

      {result && (
        <span className={`inline-flex items-center gap-1 text-[11px] ${result.ok ? "text-emerald-600" : "text-rose-600"}`}>
          {result.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />} {result.msg}
        </span>
      )}
    </div>
  );
}
