"use client";

// ─────────────────────────────────────────────────────────────────────────────
// NEEDS LOCATION — the worklist behind the location gate.
//
// A customer with no business/home pin is invisible to routes and, once the gate
// is on, cannot be disbursed to. This screen is that exact set on the officer's
// own book, worst first: a live loan you can't visit, then the biggest exposure.
// Each row goes straight to Customer 360 where the pin is dropped by hand.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import Link from "next/link";
import { useLoad } from "@/lib/hooks/useLoad";
import { Loader2, AlertTriangle, MapPinOff, MapPin, CheckCircle2, ShieldCheck, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";

type Customer = {
  id: string; name: string; phone: string; verified: boolean;
  activeLoans: number; olb: number; since: string;
};

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;

export function NeedsLocationClient() {
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useLoad(async () => {
    try {
      const res = await fetch("/api/console/field/needs-location");
      const d = await res.json();
      if (!d.success) { setError(d.message || "Could not load the list."); return; }
      setCustomers(d.customers ?? []);
    } catch { setError("Could not load the list."); }
  });

  return (
    <main className="mx-auto max-w-4xl px-4 sm:px-6 py-8">
      <PageHeader
        icon={MapPinOff}
        title="Needs Location"
        subtitle="Customers on your book with no business or home pin — missing from routes, and blocked from disbursement until you drop it. Capture it on the next visit."
      />

      {error && (
        <div className="mt-6 flex items-center gap-2 rounded-xl border border-rose-300 bg-rose-50/80 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {!customers && !error && (
        <div className="mt-10 flex items-center justify-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      )}

      {customers && customers.length === 0 && (
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 text-sm text-emerald-800">
          <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" />
          <div>
            <p className="font-semibold">Every customer on your book has a location.</p>
            <p className="mt-0.5 text-emerald-700">Nobody is missing from your routes.</p>
          </div>
        </div>
      )}

      {customers && customers.length > 0 && (
        <>
          <p className="mt-6 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            {customers.length} to capture
          </p>
          <ul className="mt-2 space-y-2">
            {customers.map((c) => {
              const hasLive = c.activeLoans > 0;
              return (
                <li key={c.id}>
                  <Link
                    href={`/console/borrowers/${c.id}?drop=location`}
                    className="flex items-center gap-3 rounded-2xl border border-zinc-900/10 bg-white/70 p-3.5 transition-colors hover:bg-white"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-500">
                      <MapPinOff className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-zinc-900">
                        {c.name}
                        {c.verified
                          ? <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-label="Verified" />
                          : <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-label="Not verified" />}
                      </p>
                      <p className="truncate text-xs text-zinc-500">{c.phone}</p>
                    </div>
                    {hasLive && (
                      <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                        {c.activeLoans} active · {kes(c.olb)} out
                      </span>
                    )}
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ backgroundColor: "var(--brand)" }}>
                      <MapPin className="h-3.5 w-3.5" /> Drop pin
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </main>
  );
}
