// ─────────────────────────────────────────────────────────────────────────────
// THE PANELS CUSTOMER 360 IS MADE OF.
//
// Pure rendering, no client state — the workspace shell owns which section is
// open, and everything here is handed finished data by the page. Kept out of
// page.tsx because that file's job is the twenty-odd reads it takes to answer
// "who is this person", and mixing that with markup is how a page becomes
// unreadable to the next person.
//
// ── THE RULE EVERY PANEL FOLLOWS ─────────────────────────────────────────────
// Say where the number came from. A bridged lender's Customer 360 mixes two
// books — their ServiceSuite, which owns the loans and the money, and our
// Postgres, which owns KYC, pins, consent and everything we originated — and an
// officer reading a figure has an absolute right to know which one answered.
// That is what <Provenance> is for, and why it is not decoration.
// ─────────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, Clock, MapPin, Radio, ShieldAlert, TriangleAlert } from "lucide-react";
import type { LiveStatement, StatementLoan, StatementTxn } from "@/lib/lms/servicesuite-statement";
import type { BehaviourResult, LadderAssessment } from "@/lib/scoring/behaviour";

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const day = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

// ── Shared furniture ─────────────────────────────────────────────────────────

export function Panel({
  title, icon, note, children, right,
}: {
  title: string;
  icon?: React.ReactNode;
  note?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="glass p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="t-section flex items-center gap-2">{icon}{title}</h2>
          {note && <p className="mt-0.5 text-[12px] text-[color:var(--ink-muted)]">{note}</p>}
        </div>
        {right}
      </div>
      <div className="mt-3.5">{children}</div>
    </section>
  );
}

/**
 * WHICH BOOK ANSWERED.
 *
 * A single line, and the most important one on the page for a bridged lender.
 * The loans, the arrears and the ledger below it are the lender's OWN records,
 * read through at the moment the page rendered — not a nightly copy, and not our
 * arithmetic. An officer who does not know that has no way to judge a
 * disagreement between this screen and the system they have used for years.
 */
export function Provenance({ lender, entityId, degraded, matchedBy }: {
  lender: string; entityId: number; degraded: string[]; matchedBy?: "id" | "phone";
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-emerald-600/15 bg-emerald-500/[0.05] px-3 py-2 text-[12px]">
      <span className="flex items-center gap-1.5 font-semibold text-emerald-700">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        Live
      </span>
      <span className="text-[color:var(--ink-muted)]">
        Read from {lender}&rsquo;s own book just now · entity {entityId}
      </span>
      {/* Matched on the handset, not on a stored id. Worth saying: it is the one
          route by which the wrong person could appear, and an officer looking at a
          history that does not sound like their customer deserves the reason. */}
      {matchedBy === "phone" && (
        <span className="text-[color:var(--ink-faint)]">matched by phone number</span>
      )}
      {degraded.length > 0 && (
        <span className="flex items-center gap-1 font-semibold text-amber-700">
          <TriangleAlert className="h-3.5 w-3.5" />
          {degraded.join(" and ")} did not answer
        </span>
      )}
    </div>
  );
}

/** A figure with its name under it. The unit of every summary strip on this page. */
export function Metric({
  label, value, sub, tone,
}: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-ash-900/10 bg-paper/60 px-3.5 py-2.5">
      <p className="t-label">{label}</p>
      <p className={`mt-0.5 text-lg font-bold leading-tight tabular-nums ${tone ?? "text-[color:var(--ink)]"}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-[color:var(--ink-faint)]">{sub}</p>}
    </div>
  );
}

// ── Money ────────────────────────────────────────────────────────────────────

/**
 * Every loan this customer has taken from this lender, with the lender's OWN
 * arrears figure beside it.
 *
 * Arrears is READ, never derived. Their `LoansInArrears` register is what every
 * PAR number Micromart actually looks at is computed from, and a console that
 * quietly disagrees with the system of record turns every other figure on the
 * screen into a question.
 */
export function LiveLoans({ loans, hrefFor }: { loans: StatementLoan[]; hrefFor?: (loanId: number) => string }) {
  if (loans.length === 0) {
    return <p className="t-meta">No loans on the lender&rsquo;s book for this customer.</p>;
  }
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="data-table w-full min-w-[42rem]">
        <thead>
          <tr>
            <th className="text-left">Loan</th>
            <th className="text-right">Principal</th>
            <th className="text-right">Balance</th>
            <th className="text-right">Arrears</th>
            <th className="text-left">Taken</th>
            <th className="text-left">Status</th>
          </tr>
        </thead>
        <tbody>
          {loans.map((l) => {
            const behind = l.daysInArrears != null && l.daysInArrears > 0;
            // The loan's own file. A row on this table is ONE loan, and until it
            // had a page of its own the only place a click could go was back to
            // the customer it was already sitting under.
            const name = (
              <>
                <span className="font-medium text-[color:var(--ink)]">{l.product ?? "Loan"}</span>
                <span className="ml-1.5 text-[11px] text-[color:var(--ink-faint)]">#{l.loanId}</span>
                {l.installments && <div className="text-[11px] text-[color:var(--ink-faint)]">{l.installments}</div>}
              </>
            );
            return (
              <tr key={l.loanId}>
                <td>
                  {hrefFor ? (
                    <Link href={hrefFor(l.loanId)} className="block hover:underline">{name}</Link>
                  ) : (
                    name
                  )}
                </td>
                <td className="text-right tabular-nums">{kes(l.principal)}</td>
                <td className="text-right font-semibold tabular-nums" style={{ color: l.balance > 0 ? "var(--brand)" : undefined }}>
                  {kes(l.balance)}
                </td>
                <td className="text-right tabular-nums">
                  {behind ? (
                    <span className="font-semibold text-rose-600">
                      {kes(l.arrears)}
                      <span className="ml-1 text-[10px] font-bold">{l.daysInArrears}d</span>
                    </span>
                  ) : (
                    <span className="text-[color:var(--ink-faint)]">—</span>
                  )}
                </td>
                <td>{day(l.borrowDate)}</td>
                <td>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      l.status === "CLEARED" ? "bg-emerald-500/12 text-emerald-700" : behind ? "bg-rose-500/12 text-rose-700" : "bg-sky-500/12 text-sky-700"
                    }`}
                  >
                    {behind && l.status !== "CLEARED" ? "IN ARREARS" : l.status}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The ledger, newest first.
 *
 * THEIR sense of direction, kept: "in" is money reaching the CUSTOMER, so a
 * disbursement is in and a repayment is out. Flipping it to the lender's point of
 * view would read more naturally to finance and would disagree with the
 * statement the customer is holding, which is the document this has to match.
 */
export function LiveLedger({ txns, truncated }: { txns: StatementTxn[]; truncated: boolean }) {
  if (txns.length === 0) return <p className="t-meta">Nothing has moved on this account yet.</p>;
  return (
    <>
      <div className="-mx-1 overflow-x-auto">
        <table className="data-table w-full min-w-[38rem]">
          <thead>
            <tr>
              <th className="text-left">When</th>
              <th className="text-left">What</th>
              <th className="text-left">Reference</th>
              <th className="text-right">Amount</th>
              <th className="text-right">Balance after</th>
            </tr>
          </thead>
          <tbody>
            {txns.map((t) => (
              <tr key={t.id}>
                <td className="whitespace-nowrap">{day(t.at)}</td>
                <td>
                  <span className="flex items-center gap-1.5">
                    {t.direction === "in"
                      ? <ArrowDownLeft className="h-3.5 w-3.5 shrink-0 text-sky-600" aria-label="to the customer" />
                      : <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-label="from the customer" />}
                    <span className="truncate">{t.narration ?? (t.direction === "in" ? "Disbursement" : "Repayment")}</span>
                  </span>
                </td>
                <td className="text-[11px] text-[color:var(--ink-faint)]">{t.reference ?? "—"}</td>
                <td className={`text-right font-semibold tabular-nums ${t.direction === "in" ? "text-sky-700" : "text-emerald-700"}`}>
                  {t.direction === "in" ? "+" : "−"}{kes(t.amount)}
                </td>
                <td className="text-right tabular-nums text-[color:var(--ink-muted)]">
                  {t.loanBalance != null ? kes(t.loanBalance) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncated && (
        <p className="mt-2 text-[11px] text-[color:var(--ink-faint)]">
          Older entries exist beyond this page — the totals above are computed across the whole ledger, not this extract.
        </p>
      )}
    </>
  );
}

// ── Risk ─────────────────────────────────────────────────────────────────────

/**
 * WHY the score is what it is.
 *
 * The single most requested thing on any credit screen, and the thing almost no
 * lending system shows: not "98.5", but which factor earned which part of it. The
 * engine already computes this per factor — it was simply never rendered, so an
 * officer asking "why is she Moderate?" had to take it on faith.
 */
export function ScoreFactors({ behaviour }: { behaviour: BehaviourResult }) {
  return (
    <div className="space-y-3">
      {behaviour.factors.map((f) => (
        <div key={f.key}>
          <div className="flex items-baseline justify-between gap-3 text-[12px]">
            <span className="font-semibold text-[color:var(--ink)]">{f.label}</span>
            <span className="shrink-0 text-[color:var(--ink-muted)]">
              <span className="font-bold tabular-nums text-[color:var(--ink)]">{f.raw.toFixed(1)}</span>
              <span className="text-[color:var(--ink-faint)]"> / 100 · weight {f.weight}%</span>
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-ash-900/[0.08]">
            <div
              className="h-full rounded-full transition-[width] duration-700"
              style={{
                width: `${Math.max(0, Math.min(100, f.raw))}%`,
                backgroundColor: f.raw >= 76 ? "#059669" : f.raw >= 51 ? "#d97706" : "#e11d48",
              }}
            />
          </div>
          <p className="mt-1 text-[11px] text-[color:var(--ink-faint)]">
            Most instalments landed in &ldquo;{f.commonBand}&rdquo; · contributed{" "}
            <span className="font-semibold tabular-nums">{f.contribution.toFixed(1)}</span> points
          </p>
        </div>
      ))}
      {behaviour.reasons.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-ash-900/10 pt-3">
          {behaviour.reasons.map((r, i) => (
            <li key={i} className="flex gap-2 text-[12px] text-[color:var(--ink-body)]">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ backgroundColor: "var(--brand)" }} />
              {r}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * What the ladder would do to their limit, and why it would stop there.
 *
 * The CAP is the part that has to be visible. A 30% uplift on a 50,000 limit is
 * 5,000, not 15,000, because a single step is capped — and a screen that shows
 * the percentage without the cap is lying by omission to the officer who is about
 * to promise a customer a number.
 */
export function LadderPanel({ ladder }: { ladder: LadderAssessment }) {
  const tone =
    ladder.move === "graduate" ? { fg: "#047857", bg: "rgba(5,150,105,0.10)", label: "Would graduate" }
    : ladder.move === "demote" ? { fg: "#be123c", bg: "rgba(225,29,72,0.10)", label: "Would be reduced" }
    : { fg: "var(--ink-muted)", bg: "rgba(0,0,0,0.04)", label: "Holds where it is" };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-lg px-2.5 py-1 text-[12px] font-bold" style={{ backgroundColor: tone.bg, color: tone.fg }}>
          {tone.label}
        </span>
        {ladder.newLimit != null && ladder.newLimit !== ladder.currentLimit && (
          <span className="flex items-center gap-2 text-[15px] font-bold tabular-nums">
            <span className="text-[color:var(--ink-faint)] line-through">{kes(ladder.currentLimit)}</span>
            <span aria-hidden>→</span>
            <span style={{ color: tone.fg }}>{kes(ladder.newLimit)}</span>
          </span>
        )}
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--ink-body)]">{ladder.reason}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Cleared loans" value={String(ladder.clearedLoans)} />
        <Metric label="Uplift earned" value={`${ladder.graduationPercent}%`} sub={ladder.basisAmount ? `of ${kes(ladder.basisAmount)}` : undefined} />
        <Metric label="Proven principal" value={ladder.provenPrincipal != null ? kes(ladder.provenPrincipal) : "—"} sub="repeated, not rising" />
        <Metric label="Instalments read" value={String(ladder.behaviour.installmentsUsed)} />
      </div>
      {(ladder.cappedByStep || ladder.cappedByCeiling) && (
        <p className="mt-2.5 flex items-start gap-1.5 text-[12px] font-medium text-amber-700">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
          {ladder.cappedByStep
            ? "The uplift was capped by the single-step limit — the percentage alone would have moved them further."
            : "The uplift was capped by this lender's ceiling."}
        </p>
      )}
    </div>
  );
}

/**
 * Our score beside the lender's own.
 *
 * Shown because they will not always be identical and the difference is
 * information, not an error: theirs was frozen when their nightly job last ran,
 * ours is computed against the schedule as it stands now — so a customer who has
 * fallen behind since then reads worse here, which is the whole point of
 * computing it live. Across all 17,018 customers on entity 3005 the two agree to
 * a mean of 0.33 points, so a WIDE gap on one customer is worth looking at.
 */
export function ScoreComparison({
  ours, theirs, theirLabel, lastRun,
}: { ours: number; theirs: number | null; theirLabel: string | null; lastRun: string | null }) {
  if (theirs == null) return null;
  const delta = ours - theirs;
  const wide = Math.abs(delta) >= 5;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-ash-900/10 bg-paper/60 px-3.5 py-2.5">
      <div>
        <p className="t-label">This console, now</p>
        <p className="text-base font-bold tabular-nums text-[color:var(--ink)]">{ours.toFixed(1)}</p>
      </div>
      <div>
        <p className="t-label">Their own score</p>
        <p className="text-base font-bold tabular-nums text-[color:var(--ink-muted)]">
          {theirs.toFixed(1)}
          {theirLabel && <span className="ml-1.5 text-[11px] font-semibold">{theirLabel}</span>}
        </p>
      </div>
      <p className={`text-[12px] ${wide ? "font-semibold text-amber-700" : "text-[color:var(--ink-faint)]"}`}>
        {wide ? (
          <>Apart by {Math.abs(delta).toFixed(1)} points — worth a look.</>
        ) : (
          <>Agree to {Math.abs(delta).toFixed(1)} of a point.</>
        )}
        {lastRun && <> Theirs was last written {day(lastRun)}.</>}
      </p>
    </div>
  );
}

// ── Small panels reused across sections ──────────────────────────────────────

export function EarlyWarning({ risk }: {
  risk: { band: string; riskScore: number; reasons: string[]; action: { label: string }; expectedLoss: number } | null;
}) {
  if (!risk) {
    return (
      <p className="flex items-center gap-2 t-meta">
        <CheckCircle2 className="h-4 w-4 text-emerald-500" /> No early-warning signals — performing to schedule.
      </p>
    );
  }
  const colour = risk.band === "HIGH" ? "#e11d48" : risk.band === "ELEVATED" ? "#d97706" : "#a1a1aa";
  return (
    <div>
      <div className="flex items-center gap-2.5">
        <span
          className="rounded-md px-2 py-0.5 text-xs font-bold"
          style={{ backgroundColor: `${colour}1f`, color: colour }}
        >
          {risk.band}
        </span>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-ash-900/[0.08]">
          <div className="h-full rounded-full" style={{ width: `${risk.riskScore}%`, backgroundColor: colour }} />
        </div>
        <span className="text-xs font-bold tabular-nums">{risk.riskScore}</span>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {risk.reasons.map((r, i) => (
          <span key={i} className="rounded-full border border-ash-900/10 bg-paper/60 px-2 py-0.5 text-[10px] text-[color:var(--ink-muted)]">{r}</span>
        ))}
      </div>
      <p className="mt-2.5 t-meta">
        Recommended: <span className="font-semibold text-[color:var(--ink)]">{risk.action.label}</span> · projected loss {kes(risk.expectedLoss)}
      </p>
    </div>
  );
}

export function PeoplePanel({
  kin, officer, branchTrail, guarantors,
}: {
  kin: { name?: string; relationship?: string; phone?: string } | null;
  officer: string | null;
  branchTrail: string[];
  guarantors: { id: string; fullName: string; phone: string; relationship: string | null; status: string }[];
}) {
  const nothing = !kin?.name && !officer && branchTrail.length === 0 && guarantors.length === 0;
  if (nothing) {
    return <p className="t-meta">Nobody is recorded around this customer yet — no next of kin, no guarantor, no officer.</p>;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {kin?.name && (
        <div className="rounded-xl border border-ash-900/10 bg-paper/60 p-3.5">
          <p className="t-label">Next of kin</p>
          <p className="mt-1 text-sm font-semibold text-[color:var(--ink)]">{kin.name}</p>
          <p className="text-[12px] text-[color:var(--ink-muted)]">
            {[kin.relationship, kin.phone].filter(Boolean).join(" · ")}
          </p>
          <p className="mt-1.5 text-[11px] text-[color:var(--ink-faint)]">
            A collections contact — never a guarantor, and never liable.
          </p>
        </div>
      )}
      {(officer || branchTrail.length > 0) && (
        <div className="rounded-xl border border-ash-900/10 bg-paper/60 p-3.5">
          <p className="t-label">Whose book they sit on</p>
          {officer && <p className="mt-1 text-sm font-semibold text-[color:var(--ink)]">{officer}</p>}
          {branchTrail.length > 0 && (
            <p className="text-[12px] text-[color:var(--ink-muted)]">{branchTrail.join(" › ")}</p>
          )}
          <p className="mt-1.5 text-[11px] text-[color:var(--ink-faint)]">
            Visibility scopes follow this — move them and their whole record moves.
          </p>
        </div>
      )}
      {guarantors.length > 0 && (
        <div className="rounded-xl border border-ash-900/10 bg-paper/60 p-3.5 sm:col-span-2">
          <p className="t-label">Standing behind them</p>
          <div className="mt-2 space-y-1.5">
            {guarantors.map((g) => (
              <div key={g.id} className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                <span className="font-semibold text-[color:var(--ink)]">
                  {g.fullName}
                  {g.relationship && <span className="ml-1.5 font-normal text-[color:var(--ink-faint)]">{g.relationship}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-[color:var(--ink-muted)]">{g.phone}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      g.status === "CONSENTED" ? "bg-emerald-500/12 text-emerald-700"
                      : g.status === "DECLINED" ? "bg-rose-500/12 text-rose-700"
                      : "bg-ash-900/[0.06] text-[color:var(--ink-muted)]"
                    }`}
                  >
                    {g.status}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function PlacesPanel({
  places, visits,
}: {
  places: { kind: "business" | "home"; lat: number; lng: number; address: string | null }[];
  visits: { id: string; label: string; status: string; agent: string | null }[];
}) {
  return (
    <div className="space-y-4">
      {places.length === 0 ? (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-3.5">
          <p className="flex items-center gap-2 text-[13px] font-semibold text-amber-800">
            <MapPin className="h-4 w-4" /> No pin on this customer
          </p>
          <p className="mt-1 text-[12px] text-[color:var(--ink-muted)]">
            They are invisible to route planning and cannot be reached by a field agent. Drop a pin from Manage → Locations.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {places.map((p) => (
            <div key={`${p.kind}-${p.lat}-${p.lng}`} className="rounded-xl border border-ash-900/10 bg-paper/60 p-3.5">
              <p className="t-label">{p.kind === "business" ? "Business" : "Home"}</p>
              <p className="mt-1 text-[13px] font-semibold text-[color:var(--ink)]">{p.address ?? "Pinned, no address recorded"}</p>
              <p className="mt-0.5 text-[11px] tabular-nums text-[color:var(--ink-faint)]">
                {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
              </p>
              <Link
                href={`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`}
                target="_blank"
                rel="noopener"
                className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold hover:underline"
                style={{ color: "var(--brand)" }}
              >
                Open a route <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
          ))}
        </div>
      )}

      {visits.length > 0 && (
        <div>
          <p className="t-label">Field visits</p>
          <div className="mt-2 space-y-1.5">
            {visits.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-2 text-[12px]">
                <span className="truncate text-[color:var(--ink-body)]">{v.label}{v.agent ? ` · ${v.agent}` : ""}</span>
                <span className="flex shrink-0 items-center gap-1.5 text-[color:var(--ink-muted)]">
                  {v.status === "VERIFIED" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    : v.status === "FAILED" ? <ShieldAlert className="h-3.5 w-3.5 text-rose-500" />
                    : <Clock className="h-3.5 w-3.5 text-amber-500" />}
                  {v.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Ratiba ───────────────────────────────────────────────────────────────────

export type RatibaView = {
  id: string;
  status: "PENDING" | "ACTIVE" | "CANCELLED" | "FAILED" | string;
  amount: number;
  frequency: string;
  startDate: string;
  endDate: string | null;
  simulated: boolean;
  /** True when an officer set it up rather than the customer. */
  byStaff: boolean;
};

/**
 * WHETHER THIS CUSTOMER IS COLLECTED AUTOMATICALLY, AND WHAT TO SAY IF NOT.
 *
 * The machinery for M-PESA Ratiba has existed on the server for months — the
 * StandingOrder table, the Daraja call, the callback that turns an order ACTIVE,
 * even a `createdById` column for "the officer who set it up". None of it had a
 * console surface, so the one person best placed to get a customer onto a
 * standing order — the officer already on the phone to them about a late
 * instalment — could not see whether they had one.
 *
 * The copy is lifted, deliberately, from the borrower app's own Ratiba screen
 * (micro-eazy-app/src/screens/onboarding/Ratiba.tsx), because that screen has
 * already done the hard work of explaining a direct debit to somebody who has
 * never authorised one, and an officer reading a DIFFERENT explanation down the
 * phone is how a customer ends up distrusting both. Three facts decide whether
 * anyone says yes, and all three are here for the officer to read out:
 *
 *   WHO debits      Safaricom, on the customer's own instruction — not us.
 *   WHAT and WHEN   amount, rhythm, first date, last date. An open-ended mandate
 *                   with no end date is the thing people are actually afraid of.
 *   HOW to stop it  theirs, without our permission, no reason required.
 *
 * And the thing nobody is told, which belongs on the officer's screen more than
 * anywhere: a debit against an empty wallet simply FAILS — no overdraft, no
 * charge — but the instalment is still late, and a late instalment still reaches
 * the bureau. An officer who promises otherwise is making a promise Safaricom
 * has not made.
 */
export function RatibaPanel({ orders, nextDue }: { orders: RatibaView[]; nextDue: { date: string; amount: number } | null }) {
  const live = orders.find((o) => o.status === "ACTIVE") ?? orders.find((o) => o.status === "PENDING") ?? null;

  if (!live) {
    const failed = orders.find((o) => o.status === "FAILED");
    return (
      <div>
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-3.5">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-amber-800">
              Every instalment is collected by hand
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-[color:var(--ink-muted)]">
              {failed
                ? "Their last standing order was rejected or declined, so nothing is collecting automatically."
                : "No M-PESA standing order. Each repayment depends on this customer remembering, and on somebody chasing them when they do not."}
              {nextDue && <> Their next instalment is {kes(nextDue.amount)} on {day(nextDue.date)}.</>}
            </p>
          </div>
        </div>

        {/* The script. An officer on the phone has about twenty seconds to
            explain a direct debit, and these are the sentences that work. */}
        <div className="mt-3 rounded-xl border border-ash-900/10 bg-paper/60 p-3.5">
          <p className="t-label">What to tell them</p>
          <ul className="mt-2 space-y-2 text-[12.5px] leading-relaxed text-[color:var(--ink-body)]">
            <li className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ backgroundColor: "var(--brand)" }} />
              <span><strong className="font-semibold">Safaricom</strong> moves the money from their own M-PESA on the due date, on an instruction they approve on their own handset. We never reach into their wallet — we could not if we wanted to.</span>
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ backgroundColor: "var(--brand)" }} />
              <span>It has a <strong className="font-semibold">last date</strong>. It ends on its own when the loan clears, cannot be used for anything else, and cannot take more than the instalment.</span>
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ backgroundColor: "var(--brand)" }} />
              <span>They can <strong className="font-semibold">stop it themselves</strong>, from their M-PESA app, without our permission and without giving a reason. Say this before they agree, not after.</span>
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
              <span>If the wallet is empty that day the debit simply fails — no overdraft, no charge. But <strong className="font-semibold">the instalment is still late</strong>, and a late instalment still reaches the bureau. Do not promise otherwise.</span>
            </li>
          </ul>
          <p className="mt-3 border-t border-ash-900/[0.07] pt-2.5 text-[11.5px] text-[color:var(--ink-faint)]">
            The customer can turn it on themselves from Repay in their app. An officer-initiated mandate is not wired to
            this screen yet — the customer still has to authorise it on their handset either way.
          </p>
        </div>
      </div>
    );
  }

  const pending = live.status === "PENDING";
  return (
    <div>
      <div
        className="flex items-start gap-3 rounded-xl border p-3.5"
        style={{
          borderColor: pending ? "rgba(2,132,199,0.25)" : "rgba(5,150,105,0.25)",
          backgroundColor: pending ? "rgba(2,132,199,0.05)" : "rgba(5,150,105,0.05)",
        }}
      >
        <Radio className={`mt-0.5 h-4 w-4 shrink-0 ${pending ? "text-sky-600" : "text-emerald-600"}`} aria-hidden />
        <div className="min-w-0">
          <p className={`text-[13px] font-semibold ${pending ? "text-sky-800" : "text-emerald-800"}`}>
            {pending ? "Waiting for them to approve it on their handset" : "Auto-repay is on"}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-[color:var(--ink-muted)]">
            {pending
              ? "Safaricom has sent the mandate. Nothing is debited until they approve it with their M-PESA PIN."
              : <>Safaricom moves {kes(live.amount)} {live.frequency.toLowerCase()} from their wallet{live.endDate ? <> until {day(live.endDate)}</> : null}. Nobody has to chase these.</>}
          </p>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Amount" value={kes(live.amount)} />
        <Metric label="How often" value={live.frequency.charAt(0) + live.frequency.slice(1).toLowerCase()} />
        <Metric label="First payment" value={day(live.startDate)} />
        <Metric label="Last payment" value={live.endDate ? day(live.endDate) : "open-ended"} />
      </dl>

      <p className="mt-2.5 text-[11.5px] leading-snug text-[color:var(--ink-faint)]">
        {live.byStaff ? "Set up by an officer. " : "Set up by the customer themselves. "}
        A failed debit does not overdraw them and carries no charge — but the instalment is still late, and still
        reaches the bureau.
        {live.simulated && " This lender has no M-PESA connection yet, so the order is recorded and no money moves."}
      </p>
    </div>
  );
}

/** Exported so page.tsx can build the money summary without re-deriving totals. */
export function MoneySummary({ statement }: { statement: LiveStatement }) {
  const active = statement.loans.filter((l) => l.status === "ACTIVE");
  const arrears = statement.loans.reduce((s, l) => s + (l.arrears || 0), 0);
  const worstDpd = statement.loans.reduce((m, l) => Math.max(m, l.daysInArrears ?? 0), 0);
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
      <Metric label="Outstanding" value={kes(active.reduce((s, l) => s + l.balance, 0))} tone="text-[color:var(--brand)]" />
      <Metric label="Ever borrowed" value={kes(statement.loans.reduce((s, l) => s + l.principal, 0))} sub={`${statement.loans.length} loans`} />
      <Metric label="Ever repaid" value={kes(statement.totals.moneyOut)} sub={`${statement.totals.count} entries`} />
      <Metric label="Disbursed to them" value={kes(statement.totals.moneyIn)} />
      <Metric
        label="In arrears"
        value={arrears > 0 ? kes(arrears) : "—"}
        sub={worstDpd > 0 ? `${worstDpd} days past due` : "nothing behind"}
        tone={arrears > 0 ? "text-rose-600" : undefined}
      />
      <Metric
        label="Banking since"
        value={statement.totals.firstAt ? day(statement.totals.firstAt).slice(-8) : "—"}
        sub={statement.totals.lastAt ? `last moved ${day(statement.totals.lastAt)}` : undefined}
      />
    </div>
  );
}

