"use client";

// ─────────────────────────────────────────────────────────────────────────────
// TAKING SOMETHING OUT OF THE SYSTEM.
//
// One control, on charts and on tables, offering only the formats that make
// sense for what it is attached to. A chart cannot be a spreadsheet and a table
// is a poor image, so the menu is built from what the thing IS rather than
// showing four options and greying two out.
//
// ── PNG IS MADE HERE, NOT ON THE SERVER ──────────────────────────────────────
// The chart is already an SVG in the DOM. Serialising it, painting it onto a
// canvas at 2x and reading the canvas back is exact, instant and needs no
// headless browser in a serverless function. The two things that go wrong doing
// this are both handled below: the SVG carries no styles of its own (its colours
// come from CSS, so they are inlined onto a clone before serialising), and a
// canvas with no background paints transparent (a chart with transparent
// "white" areas looks broken in every slide deck, so it is filled first).
//
// ── THE FILENAME IS THE POINT ────────────────────────────────────────────────
// Downloads go to a folder with forty other files. Every export from this system
// carries lender, book, subject, period and run-stamp in its name — see
// lib/reporting/naming.ts for why each part is there. The server sets it with
// Content-Disposition for data files; PNG is built here, so this file applies
// the same convention rather than a second one.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Download, FileSpreadsheet, FileText, Image as ImageIcon, Link2, Loader2, Table2 } from "lucide-react";

export type ExportKind = "table" | "chart";

/** Mirrors lib/reporting/naming.ts. Duplicated because that module is server-side. */
function slug(v: string): string {
  return (v ?? "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, "and")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-")
    .slice(0, 48) || "chart";
}
const two = (n: number) => String(n).padStart(2, "0");
const isoDate = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
const stamp = (d: Date) => `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;

export function buildFilename(opts: {
  org: string; books: string[]; subject: string;
  period?: { from: string; to: string } | null; ext: string;
}): string {
  const at = new Date();
  const book = opts.books.length === 1 ? slug(opts.books[0]) : opts.books.length > 1 ? "All-Books" : "Book";
  const when = opts.period
    ? `${opts.period.from}_${opts.period.to}`
    : `as-at-${isoDate(at)}`;
  return `${slug(opts.org)}_${book}_${slug(opts.subject)}_${when}_${stamp(at)}.${opts.ext}`;
}

async function svgToPng(svg: SVGSVGElement, scale = 2): Promise<Blob> {
  const rect = svg.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  // A clone, because computed styles are copied ONTO it and the original must
  // not be touched — the chart is still on screen and still interactive.
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  // Recharts colours come from attributes, but text colour and font come from
  // CSS that will not exist inside the serialised document.
  const src = svg.querySelectorAll("*");
  const dst = clone.querySelectorAll("*");
  for (let i = 0; i < src.length; i++) {
    const cs = window.getComputedStyle(src[i]);
    const el = dst[i] as HTMLElement;
    for (const prop of ["fill", "stroke", "stroke-width", "font-family", "font-size", "font-weight", "opacity", "text-anchor"]) {
      const v = cs.getPropertyValue(prop);
      if (v) el.style.setProperty(prop, v);
    }
  }

  const xml = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("The chart could not be rasterised."));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser has no 2D canvas.");
    // Opaque, always. A transparent PNG dropped on a dark slide is unreadable.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The image could not be encoded."))), "image/png"),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in Safari; one tick is enough.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * One row of the menu. Declared at module scope on purpose — a component
 * defined inside another component is a new type on every render, so React
 * unmounts and remounts it each time and anything stateful inside resets.
 */
function Item({ icon: Icon, label, hint, onClick, id, busy }: {
  icon: typeof FileText; label: string; hint: string; onClick: () => void; id: string; busy: string | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy !== null}
      className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-ash-900/[0.04] disabled:opacity-50"
    >
      {busy === id
        ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-ash-400" />
        : <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ash-500" />}
      <span className="min-w-0">
        <span className="block text-[12px] font-semibold text-ash-800">{label}</span>
        <span className="block text-[11px] leading-snug text-ash-500">{hint}</span>
      </span>
    </button>
  );
}

export default function ExportMenu({
  kind,
  subject,
  org,
  books,
  period,
  /** Table only: where the server builds csv/xlsx/pdf. `format` is appended. */
  downloadHref,
  /** Chart only: the element holding the SVG. */
  targetRef,
  compact,
}: {
  kind: ExportKind;
  subject: string;
  org: string;
  books: string[];
  period?: { from: string; to: string } | null;
  downloadHref?: string;
  targetRef?: React.RefObject<HTMLElement | null>;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, []);

  const download = (format: "csv" | "xlsx" | "pdf") => {
    if (!downloadHref) return;
    setBusy(format);
    setError(null);
    // A normal navigation: the server names the file with Content-Disposition,
    // so the naming convention lives in exactly one place.
    const sep = downloadHref.includes("?") ? "&" : "?";
    const frame = document.createElement("iframe");
    frame.style.display = "none";
    frame.src = `${downloadHref}${sep}format=${format}`;
    document.body.appendChild(frame);
    setTimeout(() => { frame.remove(); setBusy(null); setOpen(false); }, 2500);
  };

  const png = async () => {
    setBusy("png");
    setError(null);
    try {
      const svg = targetRef?.current?.querySelector("svg");
      if (!svg) throw new Error("There is no chart on this panel to export.");
      const blob = await svgToPng(svg as SVGSVGElement);
      save(blob, buildFilename({ org, books, subject, period, ext: "png" }));
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The image could not be made.");
    } finally {
      setBusy(null);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("The browser would not let us copy. Copy the address bar instead.");
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-lg border border-ash-900/10 bg-paper font-semibold text-ash-700 transition-colors hover:bg-ash-900/[0.03] ${
          compact ? "px-2 py-1.5 text-[11px]" : "px-3 py-2 text-[12px]"
        }`}
      >
        <Download className="h-3.5 w-3.5" />
        {compact ? "" : "Export"}
        <ChevronDown className="h-3 w-3 text-ash-400" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1.5 w-[19rem] rounded-xl border border-ash-900/10 bg-paper p-1.5 shadow-xl"
        >
          {kind === "table" && (
            <>
              <Item busy={busy} id="xlsx" icon={FileSpreadsheet} label="Excel workbook (.xlsx)"
                hint="Typed columns, number formats, a totals row and a filter — ready to pivot."
                onClick={() => download("xlsx")} />
              <Item busy={busy} id="pdf" icon={FileText} label="PDF report (.pdf)"
                hint="Landscape, paginated, with the provenance header. For a board pack."
                onClick={() => download("pdf")} />
              <Item busy={busy} id="csv" icon={Table2} label="CSV (.csv)"
                hint="For loading into another system."
                onClick={() => download("csv")} />
            </>
          )}
          {kind === "chart" && (
            <Item busy={busy} id="png" icon={ImageIcon} label="Image (.png)"
              hint="Twice actual size on a white ground — drops straight into a slide."
              onClick={png} />
          )}

          <div className="my-1 h-px bg-ash-900/[0.07]" aria-hidden />
          <Item busy={busy} id="link" icon={copied ? Check : Link2}
            label={copied ? "Link copied" : "Copy a link to this view"}
            hint="Every filter is in the address, so whoever opens it sees exactly this."
            onClick={copyLink} />

          <p className="mt-1 px-2.5 py-1.5 text-[10px] leading-snug text-ash-400">
            Files are named{" "}
            <span className="font-mono text-[9.5px] text-ash-500">Lender_Book_Report_Period_When</span>
            {" "}so they still make sense in six months.
          </p>
          {error && <p className="px-2.5 pb-1.5 text-[11px] font-medium text-rose-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
