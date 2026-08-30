"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE OS KIT — the pieces every screen is built from.
//
// One file rather than one-per-component on purpose: these are small, they are
// only used inside a 396-pixel panel, and keeping them together is what makes the
// screens LOOK like one operating system instead of six people's ideas of a list
// row. A design system's job at this scale is to be short enough that nobody is
// tempted to write a seventh variant.
//
// The answer renderers (rich text, chips, sparkline, table, SQL, export) live here
// too, because both the live conversation and a REPLAYED one out of the Chats app
// have to draw an answer identically. When they lived inside the dock component,
// history could only ever be plain text — which would have quietly made a saved
// figure look less trustworthy than a fresh one.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { ChevronRight, ChevronLeft, Database, Download, FileText, Loader2, Sheet } from "lucide-react";

export const SPRING = { type: "spring" as const, stiffness: 420, damping: 34 };
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

// ── Screen scaffolding ───────────────────────────────────────────────────────

/**
 * Every screen is one of these. The entrance direction is the navigation
 * direction — a screen pushed onto the stack slides in from the right, home
 * scales up from underneath — so the animation tells you which way you moved
 * before you have read a word of it.
 */
export function Screen({
  children, from = "right", className = "", pad = true,
}: {
  children: ReactNode;
  from?: "right" | "below" | "fade";
  className?: string;
  pad?: boolean;
}) {
  const variants = {
    right: { initial: { opacity: 0, x: 26 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: 18 } },
    below: { initial: { opacity: 0, scale: 0.97 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 1.02 } },
    fade: { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } },
  }[from];

  return (
    <motion.div
      {...variants}
      transition={{ duration: 0.24, ease: EASE_OUT }}
      className={`flex h-full min-h-0 flex-col ${pad ? "px-3.5" : ""} ${className}`}
    >
      {children}
    </motion.div>
  );
}

export function SectionLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`px-0.5 text-[9.5px] font-semibold uppercase tracking-[0.15em] text-ash-400 ${className}`}>
      {children}
    </p>
  );
}

/** The standard tappable row. Icon, two lines, a chevron — nothing else, ever. */
export function Row({
  icon, title, detail, right, onClick, tone, badge,
}: {
  icon?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  tone?: "default" | "danger";
  badge?: number;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { onClick, type: "button" as const } : {})}
      className={`flex w-full items-center gap-2.5 rounded-2xl border border-ash-900/[0.07] bg-paper/75 px-3 py-2.5 text-left transition-all ${
        onClick ? "hover:border-[color:var(--brand)] hover:bg-paper active:scale-[0.985]" : ""
      }`}
    >
      {icon && (
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
          tone === "danger" ? "bg-rose-50 text-rose-600" : "bg-ash-900/[0.05] text-ash-600"
        }`}>
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[12.5px] font-semibold leading-tight ${tone === "danger" ? "text-rose-700" : "text-ash-800"}`}>
          {title}
        </span>
        {detail && <span className="mt-0.5 block truncate text-[10.5px] leading-tight text-ash-500">{detail}</span>}
      </span>
      {badge != null && badge > 0 && (
        <span className="shrink-0 rounded-full bg-rose-500 px-1.5 py-px text-[9px] font-bold text-white">{badge}</span>
      )}
      {right ?? (onClick ? <ChevronRight className="h-4 w-4 shrink-0 text-ash-300" /> : null)}
    </Tag>
  );
}

export function EmptyState({ icon, title, detail, action }: { icon: ReactNode; title: string; detail: string; action?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <span className="mb-2.5 flex h-14 w-14 items-center justify-center rounded-2xl bg-ash-900/[0.04] text-ash-300">{icon}</span>
      <p className="text-[13px] font-semibold text-ash-700">{title}</p>
      <p className="mt-1 max-w-[240px] text-[11px] leading-snug text-ash-500">{detail}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** A back affordance for screens that want one in their body as well as the bar. */
export function BackLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-0.5 text-[11px] font-semibold text-ash-500 hover:text-ash-900">
      <ChevronLeft className="h-3.5 w-3.5" /> {label}
    </button>
  );
}

/** Relative time, short enough for a list row. */
export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short" });
}

// ── Answer rendering ─────────────────────────────────────────────────────────

export type Chip = { label: string; value: string; sub?: string; tone?: "good" | "warn" | "bad" };
export type Series = { unit: "KES" | "count"; points: { x: string; y: number }[] };
export type Table = { head: string[]; rows: string[][] };

function renderInline(text: string, k: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("**") && p.endsWith("**")
      ? <strong key={k + i} className="font-semibold text-ash-900">{p.slice(2, -2)}</strong>
      : <span key={k + i}>{p}</span>,
  );
}

/** Bold, bullets and numbered steps. No dependency, and no HTML from the server. */
export function RichText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  text.split("\n").forEach((raw, i) => {
    const l = raw.trimEnd();
    if (!l.trim()) { out.push(<div key={i} className="h-1.5" />); return; }
    const bullet = /^-\s+(.*)/.exec(l);
    const num = /^(\d+)\.\s+(.*)/.exec(l);
    if (bullet) {
      out.push(
        <div key={i} className="flex gap-2">
          <span className="mt-px shrink-0" style={{ color: "var(--brand)" }}>•</span>
          <span className="flex-1">{renderInline(bullet[1], `${i}b`)}</span>
        </div>,
      );
    } else if (num) {
      out.push(
        <div key={i} className="flex gap-2">
          <span className="shrink-0 font-semibold" style={{ color: "var(--brand)" }}>{num[1]}.</span>
          <span className="flex-1">{renderInline(num[2], `${i}n`)}</span>
        </div>,
      );
    } else {
      out.push(<p key={i}>{renderInline(l, `${i}p`)}</p>);
    }
  });
  return <div className="space-y-1 text-[13px] leading-relaxed text-ash-700">{out}</div>;
}

const toneClass = (t?: Chip["tone"]) =>
  t === "good" ? "text-emerald-600" : t === "warn" ? "text-amber-600" : t === "bad" ? "text-rose-600" : "text-[color:var(--brand)]";

export function Chips({ chips }: { chips: Chip[] }) {
  return (
    <div className="mt-2.5 grid grid-cols-3 gap-1.5">
      {chips.map((c, i) => (
        <div key={i} className="rounded-lg border border-ash-900/10 bg-paper/70 px-2 py-1.5">
          <p className="truncate text-[9px] uppercase leading-tight tracking-wide text-ash-500">{c.label}</p>
          <p className={`text-sm font-bold leading-tight ${toneClass(c.tone)}`}>{c.value}</p>
          {c.sub && <p className="truncate text-[9px] leading-tight text-ash-400">{c.sub}</p>}
        </div>
      ))}
    </div>
  );
}

export function Sparkline({ series }: { series: Series }) {
  const max = Math.max(...series.points.map((p) => p.y), 1);
  const fmt = (y: number) =>
    series.unit === "KES" ? (y >= 1000 ? `${Math.round(y / 1000)}k` : String(Math.round(y))) : String(y);
  return (
    <div className="mt-2.5 rounded-lg border border-ash-900/10 bg-paper/70 p-2.5">
      <div className="flex h-16 items-end gap-1.5">
        {series.points.map((p, i) => (
          <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
            <span className="text-[8px] text-ash-400">{p.y > 0 ? fmt(p.y) : ""}</span>
            <div
              className="w-full rounded-t transition-all"
              style={{ height: `${Math.max(4, (p.y / max) * 100)}%`, backgroundColor: "var(--brand)", opacity: 0.35 + 0.65 * (p.y / max) }}
            />
            <span className="text-[8px] text-ash-500">{p.x}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MiniTable({ table }: { table: Table }) {
  if (!table.rows.length) return null;
  return (
    <div className="mt-2.5 overflow-x-auto rounded-lg border border-ash-900/10 bg-paper/70">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-ash-900/10 text-ash-500">
            {table.head.map((h, i) => (
              <th key={i} className={`px-2.5 py-1.5 font-medium ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, ri) => (
            <tr key={ri} className="border-b border-ash-900/5 last:border-0">
              {r.map((c, ci) => (
                <td key={ci} className={`px-2.5 py-1.5 ${ci === 0 ? "text-left font-medium text-ash-800" : "text-right tabular-nums text-ash-600"}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Take this away as a file.
 *
 * Offered only when there is a query behind the answer — a number reasoned to is
 * not a dataset, and offering to export it would imply it is one. The server
 * RE-RUNS the query and builds the workbook; nothing here posts the rows it is
 * showing. It is not a screenshot either: the people this is for pivot these
 * numbers, and a picture of a table is a rumour about data.
 */
export function ExportBar({ question, sql }: { question: string; sql: string }) {
  const [busy, setBusy] = useState<"xlsx" | "pdf" | null>(null);
  const [done, setDone] = useState<{ filename: string; url?: string | null; stored: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (format: "xlsx" | "pdf") => {
    setBusy(format); setError(null); setDone(null);
    try {
      const res = await fetch("/api/console/riri/export", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, sql, format }),
      });
      const d = await res.json();
      if (!d.success) { setError(d.message || "Could not build that report."); return; }
      setDone({ filename: d.filename, url: d.url, stored: d.stored });
      if (d.url) window.open(d.url, "_blank", "noopener");
    } catch {
      setError("Could not reach the server.");
    } finally { setBusy(null); }
  };

  const btn = "inline-flex items-center gap-1 rounded-md border border-ash-900/10 bg-paper/70 px-2 py-1 text-[10px] font-semibold text-ash-600 hover:text-ash-900 disabled:opacity-40";

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] text-ash-400">Download?</span>
      <button onClick={() => run("xlsx")} disabled={!!busy} className={btn}>
        {busy === "xlsx" ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Sheet className="h-2.5 w-2.5" />} Excel
      </button>
      <button onClick={() => run("pdf")} disabled={!!busy} className={btn}>
        {busy === "pdf" ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <FileText className="h-2.5 w-2.5" />} PDF
      </button>
      {done && (
        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600">
          <Download className="h-2.5 w-2.5" />
          {done.stored ? `Saved as ${done.filename}` : `${done.filename} — downloaded, not filed`}
        </span>
      )}
      {error && <span className="text-[10px] text-rose-600">{error}</span>}
    </div>
  );
}

/**
 * The SQL behind the number.
 *
 * A trust feature, not a debugging one: a lender who cannot check a figure cannot
 * act on it. Collapsed by default because an officer chasing arrears does not want
 * a query in their face — but one click away, always, and never a different query
 * from the one that ran.
 */
export function SqlDisclosure({ sql, rows, ms }: { sql: string; rows?: number | null; ms?: number | null }) {
  return (
    <details className="group mt-2.5">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[10px] font-medium text-ash-400 hover:text-ash-700">
        <Database className="h-2.5 w-2.5" />
        <span className="group-open:hidden">Show the SQL</span>
        <span className="hidden group-open:inline">Hide the SQL</span>
        {rows != null && <span className="tabular-nums">· {rows} row{rows === 1 ? "" : "s"}</span>}
        {ms != null && <span className="tabular-nums">· {ms}ms</span>}
      </summary>
      <pre className="mt-1.5 max-h-40 overflow-auto rounded-lg border border-ash-900/10 bg-ash-950/[0.03] px-2.5 py-2 text-[10px] leading-relaxed text-ash-600">
        <code>{sql}</code>
      </pre>
      <p className="mt-1 text-[9px] leading-snug text-ash-400">
        Read-only, and scoped to your organisation by the database itself.
      </p>
    </details>
  );
}
