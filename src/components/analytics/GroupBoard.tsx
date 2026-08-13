// ─────────────────────────────────────────────────────────────────────────────
// THE GROUP BOARD — a lender's whole business, in the words their own system uses.
//
// TWO RULES GOVERN EVERY NUMBER ON THIS SCREEN.
//
// 1. IT SPEAKS SERVICESUITE. OLB (TOTAL), OLB (CLEAN), PQS, active loans and NPL
//    are computed by the definitions lifted from their MainDashboard proc, not by
//    ours. A GM who opens this beside the dashboard they already trust must find
//    the same figures — verified to the shilling on entities 3002 and 3005. The
//    moment a studio disagrees with the system of record, it stops being insight
//    and becomes a bug report.
//
// 2. IT SHOWS THE WHOLE GROUP, AND LEADS WITH THE RETAIL BOOKS. All four entities
//    appear, including the empty one — hiding an entity is how a board loses faith
//    in a total it cannot reconcile against its own org chart. But the two retail
//    books get the space, because they are the two the board actually runs.
//
//    The focus pair is chosen BY BORROWER COUNT, not hardcoded. On Micromart that
//    picks 3002 (140,607) and 3005 (17,017) over Check off (2,420) and IPF (0) —
//    which is exactly right, and stays right when they add a fifth entity or when
//    Micro Eazy overtakes the core book. A hardcoded [3002, 3005] would be a lie
//    waiting to happen.
//
// The group roll-up at the top has never existed anywhere in their world:
// ServiceSuite scopes its dashboard to one entity by the signed-in user's
// EntityID. This is the first screen that adds them up.
// ─────────────────────────────────────────────────────────────────────────────
import { RadioTower, Layers, TrendingUp, AlertTriangle, MapPinOff } from "lucide-react";
import type { EntityBook, GroupBook, GroupTrendPoint } from "@/lib/analytics/group";
import { staleShare } from "@/lib/analytics/group";

const fmt = (n: number) => Math.round(n).toLocaleString("en-KE");
const kes = (n: number) => `Ksh ${Math.round(n).toLocaleString("en-KE")}`;
/** Board-scale money. Nobody reads nine digits; everybody reads "KES 84.5M". */
const money = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return `Ksh ${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `Ksh ${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `Ksh ${(n / 1e3).toFixed(0)}K`;
  return `Ksh ${Math.round(n)}`;
};
const pct = (n: number) => `${n.toFixed(2)}%`;

/** Fixed hue per entity, assigned by position and never by rank — a series that
    changes colour when the sort changes is a chart that cannot be read twice. */
const ENTITY_HUE = ["#0284c7", "#059669", "#7c3aed", "#d97706", "#db2777"];

/** PQS as a ring, the way their own dashboard draws it. */
function PqsRing({ value, size = 62 }: { value: number; size?: number }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const safe = Math.max(0, Math.min(value, 100));
  // Green above 90, amber 70–90, red below — the same reading a credit committee
  // gives portfolio quality, so the colour never contradicts the number.
  const tone = safe >= 90 ? "#059669" : safe >= 70 ? "#d97706" : "#dc2626";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Portfolio quality score ${pct(safe)}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(24,24,27,0.10)" strokeWidth="6" />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth="6" strokeLinecap="round"
        strokeDasharray={`${(safe / 100) * c} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

function Figure({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div>
      <p className="t-label">{label}</p>
      <p className="t-num mt-1 text-xl font-bold leading-none" style={{ color: tone ?? "var(--ink)" }}>{value}</p>
      {hint && <p className="t-meta mt-1 text-[11px] leading-tight">{hint}</p>}
    </div>
  );
}

/** One retail book, laid out the way their own dashboard lays it out. */
function EntityCard({ e, hue }: { e: EntityBook; hue: string }) {
  return (
    <section className="glass p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="t-section flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: hue }} aria-hidden />
            <span className="truncate">{e.name}</span>
          </h3>
          <p className="t-meta">entity {e.entityId}</p>
        </div>
        <div className="flex items-center gap-2.5">
          <PqsRing value={e.pqs} />
          <div>
            <p className="t-num text-lg font-bold leading-none" style={{ color: "var(--ink)" }}>{pct(e.pqs)}</p>
            <p className="t-label">PQS</p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Figure label="Customers" value={fmt(e.borrowers)} hint={`${fmt(e.activeBorrowers)} active`} />
        <Figure label="Active loans" value={fmt(e.activeLoans)} hint={`${pct(e.pctFunded)} funded`} />
        <Figure label="30-day lending" value={money(e.disbursed30d)} hint={`${fmt(e.loans30d)} loans`} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-zinc-900/[0.07] pt-3.5">
        <Figure label="OLB (total)" value={money(e.olbTotal)} hint="performing book" />
        <Figure label="OLB (clean)" value={money(e.olbClean)} hint={`less ${money(e.arrears)} in arrears`} />
      </div>

      {/* The carve-out, stated on every card. A performing-book figure shown
          without the book it excludes is only half a portfolio. */}
      <div className="mt-3 flex items-start gap-2 rounded-lg px-3 py-2.5" style={{ backgroundColor: "rgba(24,24,27,0.035)" }}>
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
        <p className="t-meta leading-relaxed">
          <span className="font-semibold" style={{ color: "var(--ink)" }}>
            {fmt(e.nplCount)} loans · {money(e.nplAmount)} non-performing
          </span>{" "}
          — over 90 days past due, held outside OLB by the lender&rsquo;s own rule.
          {e.olbAllOpen > 0 && <> Every uncleared balance totals {money(e.olbAllOpen)}.</>}
        </p>
      </div>
    </section>
  );
}

export function GroupBoard({ book, trend, orgName }: { book: GroupBook; trend: GroupTrendPoint[]; orgName: string }) {
  const t = book.totals;
  // Retail books first — see the header note on why this is ranked, not listed.
  const ranked = [...book.entities].sort((a, b) => b.borrowers - a.borrowers);
  const focus = ranked.filter((e) => e.borrowers > 0).slice(0, 2);
  const hueOf = (id: number) => ENTITY_HUE[book.entities.findIndex((x) => x.entityId === id) % ENTITY_HUE.length];
  const stale = staleShare(t.aging);

  // Trend: months on the x-axis, one stacked bar per month split by entity.
  const months = [...new Set(trend.map((p) => p.month))].sort().slice(-12);
  const byMonth = months.map((m) => {
    const pts = trend.filter((p) => p.month === m);
    return { month: m, total: pts.reduce((s, p) => s + p.disbursed, 0), parts: pts };
  });
  const peak = Math.max(...byMonth.map((m) => m.total), 1);

  return (
    <div className="space-y-4">
      {/* ── The group, which no screen in their world has ever shown ───────── */}
      <section className="glass overflow-hidden">
        <div className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="t-section flex items-center gap-2">
              <Layers className="h-4 w-4" style={{ color: "var(--brand)" }} aria-hidden />
              {orgName} — the whole group
            </h2>
            <p className="t-meta">
              {t.activeEntities} trading {t.activeEntities === 1 ? "entity" : "entities"} of {t.entities}
            </p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Figure label="Customers" value={fmt(t.borrowers)} hint={`${fmt(t.activeBorrowers)} active`} />
            <Figure label="Active loans" value={fmt(t.activeLoans)} hint={`of ${fmt(t.loans)} ever written`} />
            <Figure label="OLB (total)" value={money(t.olbTotal)} hint="performing" />
            <Figure label="OLB (clean)" value={money(t.olbClean)} hint={`less ${money(t.arrears)} arrears`} />
            <Figure label="Group PQS" value={pct(t.pqs)} hint="weighted, not averaged" tone={t.pqs >= 90 ? "#059669" : t.pqs >= 70 ? "#b45309" : "#b91c1c"} />
            <Figure label="Lent in 30 days" value={money(t.disbursed30d)} hint={`${fmt(t.loans30d)} loans`} />
          </div>
        </div>
        <p className="t-meta flex flex-wrap items-center gap-1.5 border-t border-zinc-900/[0.06] px-5 py-2">
          <RadioTower className="h-3.5 w-3.5" style={{ color: "var(--brand)" }} aria-hidden />
          Read live from the lender&rsquo;s own system · every entity on their server · OLB, PQS and NPL computed by
          their MainDashboard definitions, not ours
        </p>
      </section>

      {/* ── The two retail books, side by side ─────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {focus.map((e) => <EntityCard key={e.entityId} e={e} hue={hueOf(e.entityId)} />)}
      </div>

      {/* ── Every entity, including the empty one ──────────────────────────── */}
      <section className="glass p-5">
        <h2 className="t-section">Every entity</h2>
        <p className="t-meta mt-0.5">
          Including any that are provisioned but not trading — a missing row reads as a bug.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="border-b border-zinc-900/10">
                <th className="t-label py-2 text-left font-medium">Entity</th>
                <th className="t-label py-2 text-right font-medium">Customers</th>
                <th className="t-label py-2 text-right font-medium">Active loans</th>
                <th className="t-label py-2 text-right font-medium">OLB (total)</th>
                <th className="t-label py-2 text-right font-medium">OLB (clean)</th>
                <th className="t-label py-2 text-right font-medium">PQS</th>
                <th className="t-label py-2 text-right font-medium">NPL</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((e) => (
                <tr key={e.entityId} className="border-b border-zinc-900/[0.06]">
                  <td className="py-2.5">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: hueOf(e.entityId) }} aria-hidden />
                      <span className="font-medium">{e.name}</span>
                      {e.borrowers === 0 && <span className="t-meta">· not trading</span>}
                    </span>
                  </td>
                  <td className="t-num py-2.5 text-right">{fmt(e.borrowers)}</td>
                  <td className="t-num py-2.5 text-right">{fmt(e.activeLoans)}</td>
                  <td className="t-num py-2.5 text-right font-semibold">{money(e.olbTotal)}</td>
                  <td className="t-num py-2.5 text-right">{money(e.olbClean)}</td>
                  <td className="t-num py-2.5 text-right">{e.olbTotal > 0 ? pct(e.pqs) : "—"}</td>
                  <td className="t-num py-2.5 text-right text-amber-700">{e.nplCount > 0 ? money(e.nplAmount) : "—"}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-zinc-900/15">
                <td className="py-2.5 font-bold">Group</td>
                <td className="t-num py-2.5 text-right font-bold">{fmt(t.borrowers)}</td>
                <td className="t-num py-2.5 text-right font-bold">{fmt(t.activeLoans)}</td>
                <td className="t-num py-2.5 text-right font-bold">{money(t.olbTotal)}</td>
                <td className="t-num py-2.5 text-right font-bold">{money(t.olbClean)}</td>
                <td className="t-num py-2.5 text-right font-bold">{pct(t.pqs)}</td>
                <td className="t-num py-2.5 text-right font-bold text-amber-700">{money(t.nplAmount)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Where the 90-day line falls ────────────────────────────────────── */}
      <section className="glass p-5">
        <h2 className="t-section">The performing book, and what sits behind it</h2>
        <p className="t-meta mt-0.5">
          Every open loan by how far past its expected clear date it is. The 90-day line is the lender&rsquo;s own:
          above it counts toward OLB, below it is non-performing.
        </p>
        <div className="mt-3.5 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <tbody>
              {([
                ["Current", t.aging.current, false],
                ["1–30 days past due", t.aging.d1to30, false],
                ["31–90 days past due", t.aging.d31to90, false],
                ["91–365 days past due", t.aging.d91to365, true],
                ["Over a year past due", t.aging.stale, true],
              ] as const).map(([label, b, npl], i) => {
                const share = t.olbAllOpen > 0 ? (b.olb / t.olbAllOpen) * 100 : 0;
                return (
                  <tr key={label} className={i === 3 ? "border-t-2 border-dashed border-amber-500/50" : ""}>
                    <td className="py-2 pr-3">
                      <span className="flex items-center gap-2">
                        <span className="font-medium">{label}</span>
                        {npl && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">NPL</span>}
                      </span>
                    </td>
                    <td className="t-num py-2 pr-3 text-right whitespace-nowrap">{fmt(b.loans)} loans</td>
                    <td className="t-num py-2 pr-3 text-right font-semibold whitespace-nowrap">{money(b.olb)}</td>
                    <td className="w-1/3 py-2">
                      <span className="block h-2 w-full overflow-hidden rounded-full bg-zinc-900/[0.06]">
                        <span
                          className="block h-full rounded-full"
                          style={{ width: `${Math.max(share, 0.4)}%`, backgroundColor: npl ? "#d97706" : "var(--brand)" }}
                        />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="t-meta mt-3 leading-relaxed">
          <span className="font-semibold" style={{ color: "var(--ink)" }}>
            {fmt(stale.loans)} loans carrying {money(stale.olb)} have been past due for over a year
          </span>{" "}
          — {stale.pctLoans.toFixed(0)}% of every open loan on the group. Their system files this with the rest of
          NPL at 90 days; it is broken out here because whether it will ever collect is a different question from
          whether a four-month arrear will.
        </p>
      </section>

      {/* ── Twelve months of lending ───────────────────────────────────────── */}
      <section className="glass p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="t-section flex items-center gap-2">
            <TrendingUp className="h-4 w-4" style={{ color: "var(--brand)" }} aria-hidden />
            Lending, twelve months
          </h2>
          <p className="t-meta">Disbursement by month, split by entity</p>
        </div>
        <div className="mt-4 flex items-end gap-1.5 sm:gap-2.5" style={{ height: "9rem" }}>
          {byMonth.map((m) => (
            <div key={m.month} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <span className="t-num text-[10px] leading-none text-zinc-500">{m.total > 0 ? money(m.total).replace("Ksh ", "") : ""}</span>
              <div className="flex w-full flex-col-reverse justify-start" style={{ height: `${(m.total / peak) * 100}%`, minHeight: m.total > 0 ? "3px" : "0" }}>
                {m.parts.map((p) => (
                  <span
                    key={p.entityId}
                    title={`${p.month} · entity ${p.entityId} · ${kes(p.disbursed)} across ${fmt(p.loans)} loans`}
                    style={{ height: `${(p.disbursed / Math.max(m.total, 1)) * 100}%`, backgroundColor: hueOf(p.entityId) }}
                  />
                ))}
              </div>
              <span className="t-meta text-[10px] leading-none">{m.month.slice(5)}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-zinc-900/[0.06] pt-3">
          {ranked.filter((e) => e.borrowers > 0).map((e) => (
            <span key={e.entityId} className="t-meta flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: hueOf(e.entityId) }} aria-hidden />
              {e.name}
            </span>
          ))}
        </div>
      </section>

      {/* ── The one operational gap that spans the whole group ─────────────── */}
      {t.pinned === 0 && t.borrowers > 0 && (
        <p className="t-meta flex items-start gap-1.5 leading-relaxed">
          <MapPinOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
          <span>
            Not one of the group&rsquo;s <span className="t-num">{fmt(t.borrowers)}</span> customers carries a
            location — across every entity, not just one. <span className="t-num">{fmt(t.scored)}</span> carry a credit
            score, so the risk data is there and only the geography is missing.
          </span>
        </p>
      )}
    </div>
  );
}
