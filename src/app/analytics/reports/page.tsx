// ─────────────────────────────────────────────────────────────────────────────
// REPORTS — the screen that replaces ServiceSuite's Report Browser, and the two
// report pages that used to live in the console.
//
// Everything is decided on the server, as everywhere else in the studio: who is
// asking, which book they are in, and which reports exist. The catalogue is
// serialisable metadata only — a report's SQL never leaves this process.
// ─────────────────────────────────────────────────────────────────────────────
import { studioContext } from "@/lib/analytics/context";
import { REPORTS, CATEGORY_ORDER, reportById } from "@/lib/reporting/definitions";
import { runReport, SCREEN_ROWS } from "@/lib/reporting/run";
import { StudioPage } from "@/components/analytics/StudioPage";
import ReportBrowser, { type RunResult } from "@/components/analytics/ReportBrowser";
import type { SearchParams } from "@/lib/analytics/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const iso = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await studioContext(searchParams);

  // ── THE REPORT RUNS HERE, ON THE SERVER ───────────────────────────────────
  // Same discipline as every other studio screen: the filters arrive as
  // searchParams, the aggregation happens against the lender's own server, and
  // only the finished rows cross to the browser. The API route beside this page
  // exists for DOWNLOADS, which need a higher row cap and a file response — it
  // runs the identical query, so an export can never disagree with the table.
  const sp = await searchParams;
  const picked = typeof sp.r === "string" ? sp.r : Array.isArray(sp.r) ? sp.r[0] : "";
  let result: RunResult | null = null;

  if (picked && reportById(picked)) {
    const def = reportById(picked)!;
    try {
      const r = await runReport(ctx.scope, picked, {
        from: ctx.filters.range.from,
        to: ctx.filters.range.to,
        branchIds: ctx.filters.branchIds.map(Number).filter(Number.isInteger),
        officerIds: ctx.filters.officerIds.map(Number).filter(Number.isInteger),
        limit: SCREEN_ROWS,
      });
      result = {
        meta: { id: def.id, name: def.name, category: def.category, purpose: def.purpose, mirrors: def.mirrors, divergence: def.divergence ?? null, ranged: def.ranged },
        columns: def.columns,
        rows: r.rows,
        truncated: r.truncated,
        elapsedMs: r.elapsedMs,
        error: null,
      };
    } catch (e) {
      // A named refusal, never an empty table. An empty arrears report reads as
      // "nothing is late", which is the most expensive wrong answer here.
      result = {
        meta: { id: def.id, name: def.name, category: def.category, purpose: def.purpose, mirrors: def.mirrors, divergence: def.divergence ?? null, ranged: def.ranged },
        columns: def.columns, rows: [], truncated: false, elapsedMs: 0,
        error: e instanceof Error ? e.message : "That report could not be run.",
      };
    }
  }

  const catalogue = [...REPORTS]
    .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.name.localeCompare(b.name))
    .map((r) => ({
      id: r.id, name: r.name, category: r.category, purpose: r.purpose,
      mirrors: r.mirrors, divergence: r.divergence ?? null, ranged: r.ranged,
    }));

  return (
    <StudioPage
      title="Reports"
      blurb="The reports your team already runs, rebuilt so they can be read on screen before they are downloaded — and scoped to the book you are actually in."
      range={ctx.filters.range}
      axes={ctx.axes}
      lenses={ctx.lenses}
      activeLenses={ctx.active.map((l) => l.id)}
      split={ctx.split}
      unavailable={ctx.unavailable}
      showGrain={false}
    >
      <ReportBrowser
        catalogue={catalogue}
        org={ctx.orgName}
        books={ctx.active.map((l) => ({ id: l.id, label: l.label }))}
        from={iso(ctx.filters.range.from)}
        to={iso(ctx.filters.range.to)}
        result={result}
      />
    </StudioPage>
  );
}
