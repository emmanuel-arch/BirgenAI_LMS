"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE LIMIT LADDER  (blueprint §7.1, task 0.9)
//
// "Borrow well and your limit grows" is the promise the whole product rests on.
// Until this screen it was invisible — the graduation cron wrote GraduationEvent
// rows nobody outside the console could see, so the customer experienced the
// ladder as a number that occasionally changed for no stated reason.
//
// WHAT MAKES THIS HONEST RATHER THAN A GAME MECHANIC:
//
//   · Decreases are shown. The engine can lower a limit, and a ladder that only
//     draws the rungs going up would hide the one movement a customer most needs
//     explained.
//   · The cap is shown. When the per-step ceiling paid out less than the
//     percentage earned, the row says so — otherwise the ladder looks arbitrary
//     exactly when it did not do what the number implied.
//   · No dates are promised. The next rung is stated as the RULE, because the
//     engine decides on the evidence at the time and this screen cannot sign for
//     it.
// ─────────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { TrendingUp, TrendingDown, ArrowRight, Trophy, Info, CircleDot } from "lucide-react";
import PortalDoor from "@/components/portal/PortalDoor";

type Rung = {
  id: string;
  at: string;
  previousLimit: number;
  newLimit: number;
  change: number;
  direction: "up" | "down" | "flat";
  move: string;
  clearedLoans: number;
  provenPrincipal: number;
  graduationPercent: number;
  riskBand: string | null;
  cappedByCeiling: boolean;
};

type Payload = {
  found?: boolean;
  lender?: string;
  firstName?: string | null;
  current?: { limit: number | null; graduationCount: number; riskBand: string | null; clearedLoans: number; activeLoans: number };
  startedAt?: number | null;
  totalGained?: number;
  rungs?: Rung[];
  next?: { rule: string; hasActiveLoan: boolean; action: string };
};

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const when = (iso: string) => new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });

export default function LadderPage() {
  return (
    <PortalDoor<Payload>
      endpoint="/api/portal/ladder"
      title="Your limit ladder"
      subtitle="Where your limit started, every step it has taken, and what moves it next."
      icon={<Trophy className="h-10 w-10" />}
      notFound={
        <p className="text-sm text-ash-600">
          No record was found for that ID with this lender. If you borrowed under a different
          number or ID, try that one.
        </p>
      }
    >
      {(data) => {
        const cur = data.current;
        const rungs = data.rungs ?? [];
        const gained = data.totalGained ?? 0;

        return (
          <div className="mx-auto w-full max-w-lg space-y-4">
            {/* ── Where you stand ─────────────────────────────────────────── */}
            <div className="glass rounded-3xl border border-ash-900/10 bg-paper/70 p-6">
              <p className="text-[11px] uppercase tracking-wide text-ash-500">Your limit today</p>
              <p className="mt-1 text-3xl font-bold" style={{ color: "var(--brand)" }}>
                {cur?.limit != null ? kes(cur.limit) : "Not set yet"}
              </p>

              {data.startedAt != null && gained > 0 && (
                <p className="mt-2 text-sm text-ash-600">
                  Started at {kes(data.startedAt)} — up {kes(gained)} across{" "}
                  {rungs.filter((r) => r.direction === "up").length} step
                  {rungs.filter((r) => r.direction === "up").length === 1 ? "" : "s"}.
                </p>
              )}

              <dl className="mt-5 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-ash-500">Cleared</dt>
                  <dd className="font-semibold">{cur?.clearedLoans ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-ash-500">Running</dt>
                  <dd className="font-semibold">{cur?.activeLoans ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-ash-500">Standing</dt>
                  <dd className="font-semibold">{cur?.riskBand ?? "—"}</dd>
                </div>
              </dl>
            </div>

            {/* ── What earns the next rung ────────────────────────────────── */}
            {data.next && (
              <div className="glass rounded-3xl border border-ash-900/10 bg-paper/70 p-5">
                <h2 className="flex items-center gap-2 font-semibold">
                  <CircleDot className="h-4 w-4" style={{ color: "var(--brand)" }} /> The next step
                </h2>
                <p className="mt-2 text-sm text-ash-900">{data.next.action}</p>
                <p className="mt-1.5 text-sm text-ash-600">{data.next.rule}</p>
              </div>
            )}

            {/* ── The ladder itself ───────────────────────────────────────── */}
            <section className="glass rounded-3xl border border-ash-900/10 bg-paper/70 p-5">
              <h2 className="font-semibold">Every step so far</h2>

              {rungs.length === 0 ? (
                <p className="mt-3 text-sm text-ash-600">
                  No steps yet. Your limit is reviewed after each loan you clear — the first
                  cleared loan starts the ladder.
                </p>
              ) : (
                <ol className="mt-4 space-y-4">
                  {rungs.map((r) => {
                    const up = r.direction === "up";
                    return (
                      <li key={r.id} className="flex items-start gap-3">
                        <div
                          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${up ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500"}`}
                        >
                          {up ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="text-sm font-semibold">
                              {kes(r.previousLimit)} → {kes(r.newLimit)}
                            </span>
                            <span className={`text-xs font-semibold ${up ? "text-emerald-600" : "text-red-500"}`}>
                              {up ? "+" : "−"}{kes(Math.abs(r.change))}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-ash-500">
                            {when(r.at)}
                            {r.clearedLoans > 0 ? ` · ${r.clearedLoans} loan${r.clearedLoans === 1 ? "" : "s"} cleared` : ""}
                            {r.provenPrincipal > 0 ? ` · ${kes(r.provenPrincipal)} repaid in full` : ""}
                          </p>
                          {r.cappedByCeiling && up && (
                            <p className="mt-1 flex items-start gap-1.5 text-xs text-ash-600">
                              <Info className="mt-0.5 h-3 w-3 shrink-0" />
                              You earned {Math.round(r.graduationPercent)}%, but a single step is
                              capped — the rest carries into your next review.
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>

            <p className="px-2 text-center text-[11px] text-ash-500">
              Limits are reviewed automatically. You never need to ask for an increase.
              {data.lender ? ` ${data.lender} is the lender of record.` : ""}
            </p>

            <div className="pb-4 text-center">
              <Link href="/myloan" className="text-sm font-semibold" style={{ color: "var(--brand)" }}>
                Go to my loan <ArrowRight className="inline h-4 w-4" />
              </Link>
            </div>
          </div>
        );
      }}
    </PortalDoor>
  );
}
