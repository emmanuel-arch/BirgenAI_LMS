"use client";

// ─────────────────────────────────────────────────────────────────────────────
// WHY DECLINED, AND HOW TO FIX IT  (blueprint §7.1, task 0.8)
//
// The screen a lending product usually does not have. A customer who is told
// only "unsuccessful" learns nothing, cannot act, and comes back with the same
// application — which is a bad outcome for them AND a wasted assessment for the
// lender. Everything shown here already existed in the database; what was
// missing was the screen that says it out loud.
//
// THE ORDER IS DELIBERATE. What we can fix comes FIRST. A customer reading this
// after a decline is not browsing — the actionable item must be above the fold,
// and the factors they cannot change must not be what greets them.
//
// It is reachable on every host, like /myloan: the same screen serves a lender's
// white-label portal and microeazy.birgenai.com, because the decision belongs to
// the customer either way.
// ─────────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { HelpCircle, TrendingUp, TrendingDown, Minus, Wrench, ArrowRight, Scale, ShieldQuestion, CheckCircle2, Clock, XCircle } from "lucide-react";
import PortalDoor from "@/components/portal/PortalDoor";
import type { CustomerReason } from "@/lib/microeazy/reasons";

type Decision = {
  ref: string;
  verdict: string | null;
  status: string;
  decidedAt: string;
  product: string | null;
  requested: number;
  qualifiedFor: number | null;
  askingAboveLimit: boolean;
  tone: "declined" | "review" | "approved" | "pending";
  headline: string;
  body: string;
  reasons: CustomerReason[];
  appeal: { available: boolean; note: string };
};

type Payload = {
  found?: boolean;
  lender?: string;
  firstName?: string | null;
  decision?: Decision | null;
};

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;

const TONE = {
  declined: { icon: XCircle, ring: "border-red-300", bg: "bg-red-50/90", ink: "text-red-700" },
  review: { icon: Clock, ring: "border-amber-300", bg: "bg-amber-50/90", ink: "text-amber-800" },
  approved: { icon: CheckCircle2, ring: "border-emerald-300", bg: "bg-emerald-50/90", ink: "text-emerald-700" },
  pending: { icon: Clock, ring: "border-zinc-300", bg: "bg-zinc-50/90", ink: "text-zinc-700" },
} as const;

function DirectionIcon({ d }: { d: CustomerReason["direction"] }) {
  if (d === "up") return <TrendingUp className="h-4 w-4 text-emerald-600 shrink-0" aria-label="counted in your favour" />;
  if (d === "down") return <TrendingDown className="h-4 w-4 text-red-500 shrink-0" aria-label="counted against" />;
  return <Minus className="h-4 w-4 text-zinc-400 shrink-0" aria-label="neutral" />;
}

export default function WhyPage() {
  return (
    <PortalDoor<Payload>
      endpoint="/api/portal/decision"
      title="Your decision, explained"
      subtitle="See exactly what your application was assessed on — and what changes it."
      icon={<HelpCircle className="h-10 w-10" />}
      notFound={
        <p className="text-sm text-zinc-600">
          No application was found for that ID with this lender. If you applied with a different
          number or ID, try that one.
        </p>
      }
    >
      {(data) => {
        const d = data.decision;

        if (!d) {
          return (
            <div className="mx-auto w-full max-w-md">
              <div className="glass rounded-3xl bg-white/65 p-6 sm:p-8">
                <h1 className="text-xl font-bold">No decision yet</h1>
                <p className="mt-2 text-sm text-zinc-600">
                  {data.lender ?? "The lender"} has not recorded a decision on an application for you yet.
                </p>
                <Link href="/" className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold" style={{ color: "var(--brand)" }}>
                  Apply <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          );
        }

        const tone = TONE[d.tone] ?? TONE.pending;
        const ToneIcon = tone.icon;
        // Actionable first — see the header note.
        const fixable = d.reasons.filter((r) => r.howToFix);
        const rest = d.reasons.filter((r) => !r.howToFix);

        return (
          <div className="mx-auto w-full max-w-lg space-y-4">
            {/* ── The verdict ─────────────────────────────────────────────── */}
            <div className={`glass rounded-3xl border ${tone.ring} ${tone.bg} p-6`}>
              <div className="flex items-start gap-3">
                <ToneIcon className={`h-6 w-6 shrink-0 ${tone.ink}`} />
                <div>
                  <h1 className={`text-xl font-bold ${tone.ink}`}>{d.headline}</h1>
                  <p className="mt-1.5 text-sm text-zinc-700">{d.body}</p>
                </div>
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-zinc-500">You asked for</dt>
                  <dd className="font-semibold">{kes(d.requested)}</dd>
                </div>
                {d.qualifiedFor != null && (
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-zinc-500">Assessed limit</dt>
                    <dd className="font-semibold">{kes(d.qualifiedFor)}</dd>
                  </div>
                )}
              </dl>
              <p className="mt-4 text-[11px] text-zinc-500">
                Reference {d.ref} · decided {new Date(d.decidedAt).toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" })}
                {d.product ? ` · ${d.product}` : ""}
              </p>
            </div>

            {/* ── The one number that is also an instruction ──────────────── */}
            {d.askingAboveLimit && d.qualifiedFor != null && (
              <div className="glass rounded-3xl border border-zinc-900/10 bg-white/70 p-5">
                <div className="flex items-start gap-3">
                  <Scale className="h-5 w-5 shrink-0" style={{ color: "var(--brand)" }} />
                  <div>
                    <h2 className="font-semibold">Try {kes(d.qualifiedFor)}</h2>
                    <p className="mt-1 text-sm text-zinc-600">
                      You asked for {kes(d.requested)}. Your assessment supports {kes(d.qualifiedFor)} —
                      applying at or below that usually goes straight through.
                    </p>
                    <Link href="/" className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold" style={{ color: "var(--brand)" }}>
                      Apply for {kes(d.qualifiedFor)} <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {/* ── What you can change ─────────────────────────────────────── */}
            {fixable.length > 0 && (
              <section className="glass rounded-3xl border border-zinc-900/10 bg-white/70 p-5">
                <h2 className="flex items-center gap-2 font-semibold">
                  <Wrench className="h-4 w-4" style={{ color: "var(--brand)" }} /> What you can change
                </h2>
                <ul className="mt-4 space-y-4">
                  {fixable.map((r, i) => (
                    <li key={`${r.code ?? "r"}-${i}`} className="border-l-2 pl-3.5" style={{ borderColor: "var(--brand-soft)" }}>
                      <div className="flex items-center gap-2">
                        <DirectionIcon d={r.direction} />
                        <h3 className="text-sm font-semibold">{r.title}</h3>
                      </div>
                      <p className="mt-1 text-sm text-zinc-600">{r.why}</p>
                      <p className="mt-1.5 text-sm text-zinc-900">{r.howToFix}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* ── What was weighed, that you cannot change ────────────────── */}
            {rest.length > 0 && (
              <section className="glass rounded-3xl border border-zinc-900/10 bg-white/70 p-5">
                <h2 className="font-semibold">Also weighed</h2>
                <ul className="mt-3 space-y-3">
                  {rest.map((r, i) => (
                    <li key={`${r.code ?? "o"}-${i}`} className="flex items-start gap-2">
                      <DirectionIcon d={r.direction} />
                      <div>
                        <h3 className="text-sm font-semibold">{r.title}</h3>
                        <p className="text-sm text-zinc-600">{r.why}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* ── The appeal right. A disclosure, not a support link ──────── */}
            {d.appeal.available && (
              <section className="glass rounded-3xl border border-zinc-900/10 bg-white/70 p-5">
                <h2 className="flex items-center gap-2 font-semibold">
                  <ShieldQuestion className="h-4 w-4" style={{ color: "var(--brand)" }} /> Ask for a human review
                </h2>
                <p className="mt-2 text-sm text-zinc-600">{d.appeal.note}</p>
                <p className="mt-3 text-[11px] text-zinc-500">
                  This assessment was made with the help of an automated model.
                  {data.lender ? ` ${data.lender} is the lender of record.` : ""}
                </p>
              </section>
            )}

            <div className="pb-4 text-center">
              <Link href="/myloan" className="text-sm font-semibold" style={{ color: "var(--brand)" }}>
                Go to my loan
              </Link>
            </div>
          </div>
        );
      }}
    </PortalDoor>
  );
}
